const { LlmError, ACTIONS } = require('./errors');
const { allAdapters, keyFor, isConfigured } = require('./providers');
const registry = require('./registry');
const budget = require('./budget');
const usage = require('./usage');

/**
 * One chat completion, routed across every free allowance available, with the
 * error taxonomy deciding what happens when one of them says no.
 *
 * The shape of a turn:
 *   pick a tier -> list candidate models -> take the first with headroom ->
 *   send -> on failure, act on the error's CLASS, not its text -> try the next.
 *
 * The caller never learns which model answered unless it asks. A person waiting
 * at a counter should not find out about our billing arrangements.
 */

const MAX_ATTEMPTS = 6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pinned model / disabled provider / forced deterministic, from settings. */
let overrides = { pinnedModel: null, disabledProviders: [], deterministicOnly: false, dailyTokenCap: 0 };
function setOverrides(next = {}) {
  overrides = { ...overrides, ...next };
}
function getOverrides() {
  return { ...overrides };
}

/** Is there any configured provider at all? */
function isConfiguredAnywhere() {
  return allAdapters().some((adapter) => isConfigured(adapter));
}

/**
 * Roughly how many tokens a request will cost, per model.
 *
 * ~4 characters per token is close for English and JSON, but tokenizers differ
 * enough to matter: qwen counted the same prompt at about twice what gpt-oss
 * did, and a budget built on the wrong number either wastes allowance or walks
 * into a 429. tokenizer_factor is measured per family and applied here.
 */
function estimateTokens(body, factor = 1) {
  const text = JSON.stringify(body.messages || []) + JSON.stringify(body.tools || []);
  const prompt = Math.ceil(text.length / 4);
  const reply = Math.min(body.max_tokens || 300, 600);
  return Math.ceil((prompt + reply) * (factor || 1));
}

function adapterFor(providerKey) {
  return allAdapters().find((adapter) => adapter.id === providerKey) || null;
}

/**
 * Shortens a conversation that came back too long, keeping the system prompt
 * and the most recent exchanges - the parts that carry the current request.
 */
function compress(messages) {
  if (messages.length <= 4) {
    return messages.map((m) => ({ ...m, content: String(m.content || '').slice(0, 4000) }));
  }
  const system = messages.filter((m) => m.role === 'system').slice(0, 1);
  const rest = messages.filter((m) => m.role !== 'system');
  const kept = rest.slice(-Math.ceil(rest.length / 2));
  // A history that opens mid tool-exchange is rejected by the API outright.
  while (kept.length && kept[0].role === 'tool') kept.shift();
  return [...system, ...kept];
}

/**
 * The main entry point.
 *
 * @param {object}  options
 * @param {Array}   options.messages
 * @param {Array}   [options.tools]        tool schema; forces the mid tier
 * @param {string}  [options.tier]         'nano' | 'small' | 'mid'
 * @param {number}  [options.maxWaitMs]    how long it may wait for allowance
 * @param {string}  [options.purpose]      recorded in the usage ledger
 */
async function chat({
  messages,
  tools = null,
  toolChoice = null,
  tier = null,
  temperature = 0.2,
  maxTokens = null,
  json = false,
  timeoutMs = 30000,
  maxWaitMs = 20000,
  purpose = 'chat',
  conversationId = null,
} = {}) {
  if (overrides.deterministicOnly) {
    throw new LlmError('Receptionist AI is set to work without a language model.', {
      errorClass: 'content_filter', status: 503,
    });
  }
  if (!isConfiguredAnywhere()) {
    throw new LlmError(
      'No AI provider is set up. Add a free key to server/.env - GROQ_API_KEY is the quickest.',
      { errorClass: 'auth', status: 503 }
    );
  }

  // A daily cap the owner set is enforced BEFORE routing, so a runaway loop
  // cannot spend the whole allowance before anyone notices.
  if (overrides.dailyTokenCap > 0) {
    const spent = await usage.tokensToday().catch(() => 0);
    if (spent >= overrides.dailyTokenCap) {
      await usage.note({
        kind: 'budget_capped',
        message: `The daily AI limit you set (${overrides.dailyTokenCap.toLocaleString()} tokens) has been reached. Receptionist AI is answering without a model until tomorrow.`,
      });
      throw new LlmError('The daily AI limit set in Settings has been reached for today.', {
        errorClass: 'quota_daily', status: 429,
      });
    }
  }

  await budget.hydrate();

  const wantsTools = Boolean(tools?.length);
  const effectiveTier = wantsTools ? 'mid' : tier || 'small';
  const spec = registry.TIERS[effectiveTier] || registry.TIERS.small;

  let pool = await registry.candidates(effectiveTier, { requireTools: wantsTools });

  // Nothing discovered yet - first run, or discovery has not happened since a
  // key was added. Do it now rather than telling the owner there is no AI.
  if (!pool.length) {
    await registry.discover({ force: true });
    pool = await registry.candidates(effectiveTier, { requireTools: wantsTools });
  }
  if (overrides.pinnedModel) {
    const pinned = pool.filter((c) => c.model === overrides.pinnedModel);
    if (pinned.length) pool = pinned;
  }
  if (overrides.disabledProviders?.length) {
    pool = pool.filter((c) => !overrides.disabledProviders.includes(c.provider));
  }

  if (!pool.length) {
    throw new LlmError(
      'No AI model is available right now. Receptionist AI is answering from its own rules instead.',
      { errorClass: 'quota_daily', status: 503 }
    );
  }

  const body = {
    messages,
    temperature,
    max_tokens: maxTokens || spec.maxTokens || 900,
  };
  if (wantsTools) {
    body.tools = tools;
    body.tool_choice = toolChoice || 'auto';
  }

  const tried = new Set();
  let lastError = null;
  let previousModel = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const choice = pickNext(pool, tried, body, maxWaitMs);
    if (!choice) break;

    const { candidate, waitMs } = choice;
    const adapter = adapterFor(candidate.provider);
    if (!adapter) {
      tried.add(candidate.model);
      continue;
    }

    if (waitMs > 0) await sleep(Math.min(waitMs + 200, maxWaitMs));

    const estimated = estimateTokens(body, candidate.tokenizerFactor);
    const requestBody = { ...body };
    if (json && adapter.supportsJsonMode && !wantsTools) {
      requestBody.response_format = { type: 'json_object' };
    }

    budget.reserve(candidate.provider, candidate.model, { tokens: estimated, requests: 1 });
    const startedAt = Date.now();

    try {
      const result = await adapter.chat({
        apiKey: keyFor(adapter),
        model: candidate.model,
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
      });

      const latencyMs = Date.now() - startedAt;
      budget.reconcile(candidate.provider, candidate.model, result.quota);
      registry.recordHealth(candidate.provider, { ok: true, latencyMs });
      usage.record({
        conversationId, purpose, provider: candidate.provider, model: candidate.model, tier: effectiveTier,
        tokensIn: result.usage?.prompt_tokens || 0,
        tokensOut: result.usage?.completion_tokens || 0,
        latencyMs, outcome: 'ok', retriedFrom: previousModel,
      });

      // Only worth a word to the owner when it actually moved.
      if (previousModel && previousModel !== candidate.model) {
        await usage.note({
          kind: 'fell_back',
          provider: candidate.provider,
          model: candidate.model,
          message: `${lastError?.message || 'The previous model was unavailable.'} Receptionist AI switched to ${candidate.providerLabel}.`,
          detail: { from: previousModel, to: candidate.model },
        });
      }

      return {
        message: result.message,
        model: candidate.model,
        provider: candidate.provider,
        providerLabel: candidate.providerLabel,
        tier: effectiveTier,
        latencyMs,
        usage: result.usage || null,
        switched: previousModel && previousModel !== candidate.model ? { from: previousModel, to: candidate.model } : null,
      };
    } catch (err) {
      const error = err instanceof LlmError ? err : new LlmError(err.message, { errorClass: 'transient' });
      lastError = error;
      previousModel = candidate.model;
      const latencyMs = Date.now() - startedAt;

      usage.record({
        conversationId, purpose, provider: candidate.provider, model: candidate.model, tier: effectiveTier,
        latencyMs, outcome: 'error', errorClass: error.errorClass,
      });
      registry.recordHealth(candidate.provider, { ok: false, latencyMs });

      const keepGoing = await handle(error, { candidate, tried, body, adapter });
      if (!keepGoing) throw error;
    }
  }

  throw lastError || new LlmError('No AI model could answer.', { errorClass: 'transient', status: 503 });
}

/**
 * Acts on an error's class. Returns true to carry on down the pool, false to
 * give up and let the caller fall back to the deterministic path.
 */
async function handle(error, { candidate, tried, body, adapter }) {
  switch (error.action) {
    case ACTIONS.RETRY_THEN_REROUTE:
      // One more go at the same model before writing it off - most transient
      // failures are exactly that.
      if (!tried.has(candidate.model)) {
        tried.add(`${candidate.model} once`);
        await sleep(300 + Math.random() * 400);
        return true;
      }
      tried.add(candidate.model);
      return true;

    case ACTIONS.WAIT_OR_REROUTE:
      // A per-minute limit is never treated as exhausted: it refills in
      // seconds. Mark it spent for as long as the provider asked and move on;
      // it will come back into the pool by itself.
      budget.exhaust(candidate.provider, candidate.model, 'tpm', Date.now() + (error.waitMs || 20000));
      tried.add(candidate.model);
      return true;

    case ACTIONS.PARK_MODEL:
      if (error.errorClass === 'model_missing') {
        await registry.disableModel(candidate.provider, candidate.model, error.message);
        await usage.note({
          kind: 'model_retired',
          provider: candidate.provider,
          model: candidate.model,
          message: `${candidate.model} is no longer offered by ${candidate.providerLabel}. DocDesk found what is available instead - nothing needs doing.`,
        });
        // The provider's list is stale, so refresh it - but not inside this
        // turn. A discovery racing the request that triggered it writes model
        // rows while the same turn is still reading them.
        setTimeout(() => registry.discover({ force: true }).catch(() => {}), 30_000).unref?.();
      } else {
        const until = Date.now() + (error.waitMs || 6 * 3600000);
        budget.exhaust(candidate.provider, candidate.model, 'tpd', until);
        await registry.parkProvider(candidate.provider, 'quota_daily', error.message, until);
        // Deliberately recorded against the provider rather than the model.
        // The owner reads one sentence about Groq; they do not want the same
        // sentence once for every model behind it.
        await usage.note({
          kind: 'quota_daily',
          provider: candidate.provider,
          message: `Today's free allowance on ${candidate.providerLabel} is used up. It comes back on its own - Receptionist AI is using another provider until then.`,
          detail: { model: candidate.model },
        });
      }
      tried.add(candidate.model);
      return true;

    case ACTIONS.PARK_PROVIDER: {
      const isAuth = error.errorClass === 'auth';
      await registry.parkProvider(candidate.provider, isAuth ? 'auth' : 'credits_exhausted', error.message);
      await usage.note({
        kind: isAuth ? 'auth_failed' : 'credits_exhausted',
        provider: candidate.provider,
        message: isAuth
          ? `${candidate.providerLabel} refused the API key. Put a new one in ${adapter.keyVar} in server/.env and restart DocDesk. Get one at ${adapter.consoleUrl || candidate.providerLabel}.`
          : `The free credit on your ${candidate.providerLabel} account has run out. Receptionist AI is using another provider; to bring this one back, top it up or add a different key.`,
        detail: { keyVar: adapter.keyVar, console: adapter.consoleUrl },
      });
      // Everything behind this key is affected, not just this model.
      for (const model of [...tried]) tried.add(model);
      tried.add(candidate.model);
      tried.add(`${candidate.provider} provider`);
      return true;
    }

    case ACTIONS.COMPRESS_RETRY: {
      const shorter = compress(body.messages);
      if (shorter.length < body.messages.length) {
        body.messages = shorter;
        return true;
      }
      tried.add(candidate.model);
      return true;
    }

    case ACTIONS.DETERMINISTIC:
      // Asking a different model the same question that one just refused is
      // both rude and pointless. Hand back to the rules.
      return false;

    case ACTIONS.FAIL:
    default:
      console.error(`[llm] ${candidate.provider}/${candidate.model} rejected the request: ${error.message}`);
      return false;
  }
}

/** The next model worth trying: preference order, then whoever frees up soonest. */
function pickNext(pool, tried, body, maxWaitMs) {
  const usable = pool.filter(
    (c) => !tried.has(c.model) && !tried.has(`${c.provider} provider`)
  );
  if (!usable.length) return null;

  const withWaits = usable.map((candidate) => ({
    candidate,
    waitMs: budget.waitFor(candidate.provider, candidate.model, {
      tokens: estimateTokens(body, candidate.tokenizerFactor),
      requests: 1,
    }),
  }));

  const ready = withWaits.filter((entry) => entry.waitMs === 0);
  if (ready.length) return ready[0];

  const soonest = withWaits
    .filter((entry) => Number.isFinite(entry.waitMs))
    .sort((a, b) => a.waitMs - b.waitMs)[0];

  if (!soonest || soonest.waitMs > maxWaitMs) return null;
  return soonest;
}

module.exports = { chat, estimateTokens, compress, setOverrides, getOverrides, isConfiguredAnywhere };
