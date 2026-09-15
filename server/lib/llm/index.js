const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

/**
 * Model providers behind one interface. Every candidate speaks the OpenAI
 * chat-completions shape, so a provider is a base URL plus a model preference.
 *
 * Models get retired without notice (Groq dropped llama-3.3-70b-versatile), so
 * nothing here depends on one hardcoded name: the preference list is checked
 * against what the key can actually use, and a "model not found" at request
 * time falls through to the next one instead of surfacing to the user.
 */
const PROVIDERS = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Ordered by tool-calling reliability for multi-step work, then speed.
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
    keyVar: 'GROQ_API_KEY',
    console: 'https://console.groq.com/keys',
    supportsJsonMode: true,
    supportsTools: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-oss-120b:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    keyVar: 'OPENROUTER_API_KEY',
    console: 'https://openrouter.ai/keys',
    supportsJsonMode: true,
    supportsTools: true,
  },
  together: {
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['openai/gpt-oss-120b', 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free'],
    keyVar: 'TOGETHER_API_KEY',
    console: 'https://api.together.ai/settings/api-keys',
    supportsJsonMode: true,
    supportsTools: true,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: '',
    models: [],
    keyVar: 'LLM_API_KEY',
    console: null,
    supportsJsonMode: false,
    supportsTools: true,
  },
};

function activeProviderName() {
  const explicit = String(process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit && PROVIDERS[explicit]) return explicit;
  for (const [name, config] of Object.entries(PROVIDERS)) {
    if (name !== 'custom' && process.env[config.keyVar]) return name;
  }
  if (process.env.LLM_BASE_URL) return 'custom';
  return null;
}

function providerConfig(name = activeProviderName()) {
  if (!name) return null;
  const config = PROVIDERS[name];
  if (!config) return null;
  const preferred = process.env.LLM_MODEL ? [process.env.LLM_MODEL] : [];
  return {
    name,
    ...config,
    baseUrl: process.env.LLM_BASE_URL || config.baseUrl,
    models: [...new Set([...preferred, ...config.models])],
    apiKey: String(process.env[config.keyVar] || process.env.LLM_API_KEY || '').trim(),
  };
}

function isConfigured() {
  const config = providerConfig();
  if (!config) return false;
  return Boolean(config.apiKey) || config.name === 'custom';
}

class LlmError extends Error {
  constructor(message, { status = 502, retryable = false, code = null } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

// ---- model discovery --------------------------------------------------------

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
let discovery = { provider: null, at: 0, available: null };
// The model that most recently worked, so we don't re-walk the list per call.
let workingModel = null;

// Free tiers meter tokens per minute *per model*. Tracking what each model has
// left lets a request go straight to one with room, instead of eating a 429
// round trip, and pools several models' allowances into one.
const budgets = new Map(); // model -> { remaining, resetAt, coolUntil }

function parseDuration(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(text)) return Math.ceil(Number(text) * 1000);
  let ms = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    const n = Number(amount);
    ms += unit === 'h' ? n * 3600000 : unit === 'm' ? n * 60000 : unit === 's' ? n * 1000 : n;
  }
  return ms ? Math.ceil(ms) : null;
}

function recordBudget(model, headers) {
  const remaining = Number(headers.get('x-ratelimit-remaining-tokens'));
  const reset = parseDuration(headers.get('x-ratelimit-reset-tokens'));
  if (!Number.isFinite(remaining)) return;
  const previous = budgets.get(model) || {};
  budgets.set(model, { ...previous, remaining, resetAt: Date.now() + (reset ?? 60000) });
}

function coolDown(model, ms) {
  const previous = budgets.get(model) || {};
  budgets.set(model, { ...previous, remaining: 0, coolUntil: Date.now() + Math.max(ms, 1000), resetAt: Date.now() + Math.max(ms, 1000) });
}

/** Milliseconds until this model can probably take a request of this size. */
function waitFor(model, estimatedTokens) {
  const budget = budgets.get(model);
  if (!budget) return 0;
  const now = Date.now();
  if (budget.coolUntil && budget.coolUntil > now) return budget.coolUntil - now;
  if (budget.resetAt && budget.resetAt <= now) return 0;
  if (budget.remaining >= estimatedTokens) return 0;
  return Math.max((budget.resetAt || now) - now, 0);
}

function estimateTokens(body) {
  // ~3.5 characters per token for English plus JSON, plus room for the reply.
  return Math.ceil(JSON.stringify(body.messages || []).length / 3.5)
    + Math.ceil(JSON.stringify(body.tools || []).length / 3.5)
    + (body.max_tokens || 0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function availableModels(config) {
  if (discovery.provider === config.name && Date.now() - discovery.at < DISCOVERY_TTL_MS) {
    return discovery.available;
  }
  try {
    const response = await fetch(`${config.baseUrl}/models`, {
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(String(response.status));
    const body = await response.json();
    const ids = new Set((body.data || []).filter((m) => m.active !== false).map((m) => m.id));
    discovery = { provider: config.name, at: Date.now(), available: ids };
  } catch {
    // Discovery is an optimisation. If it fails, try the preference list blind
    // and let the per-request fallback sort it out.
    discovery = { provider: config.name, at: Date.now(), available: null };
  }
  return discovery.available;
}

async function candidateModels(config) {
  const available = await availableModels(config);
  let models = config.models;
  if (available) {
    const usable = models.filter((m) => available.has(m));
    // Keep the preference order; if nothing in it exists any more, don't give
    // up - let the request fail loudly with the provider's own message.
    if (usable.length) models = usable;
  }
  if (workingModel && models.includes(workingModel)) {
    models = [workingModel, ...models.filter((m) => m !== workingModel)];
  }
  return models;
}

function isModelMissing(status, detail) {
  return (status === 404 || status === 400) && /model.*(not exist|not found|decommission|access)/i.test(detail);
}

// ---- requests ---------------------------------------------------------------

async function postChat(config, model, body, signal) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({ ...body, model }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new LlmError('The AI took too long to answer. Try again.', { status: 504, retryable: true });
    }
    throw new LlmError(`Could not reach ${config.label}. Check the internet connection.`, { retryable: true });
  }

  recordBudget(model, response.headers);
  const raw = await response.text();
  if (response.ok) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new LlmError(`${config.label} sent a response that wasn't valid JSON.`, { retryable: true });
    }
  }

  let detail = '';
  try {
    detail = JSON.parse(raw)?.error?.message || '';
  } catch {
    detail = raw.slice(0, 200);
  }

  if (isModelMissing(response.status, detail)) {
    throw new LlmError(detail, { status: 502, code: 'model_missing' });
  }
  if (response.status === 401 || response.status === 403) {
    throw new LlmError(`${config.label} rejected the API key. Check ${config.keyVar} in server/.env.`, {
      status: 502,
      code: 'bad_key',
    });
  }
  if (response.status === 429) {
    const waitMs = parseDuration(response.headers.get('retry-after'))
      ?? parseDuration(response.headers.get('x-ratelimit-reset-tokens'))
      ?? 20000;
    // A daily cap is not worth waiting on; a per-minute one is.
    const daily = /per day|RPD|TPD/i.test(detail);
    const err = new LlmError(
      daily
        ? `Today's free AI allowance on ${config.label} is used up. It resets within 24 hours.`
        : `The free AI allowance is busy right now. Try again in a few seconds.`,
      { status: 429, retryable: !daily, code: daily ? 'daily_limit' : 'rate_limited' }
    );
    err.waitMs = daily ? 24 * 3600000 : waitMs;
    throw err;
  }
  // A model that emitted a malformed tool call comes back as a 400; worth one
  // more attempt on the next model rather than a dead end.
  if (response.status === 400 && /tool/i.test(detail)) {
    throw new LlmError(detail, { status: 502, code: 'tool_error' });
  }
  throw new LlmError(`${config.label} returned an error: ${detail || response.status}`, {
    retryable: response.status >= 500,
  });
}

/**
 * One chat completion, with automatic model fallback.
 * Returns the raw assistant message plus timing and the model that answered.
 */
async function chat({ messages, tools, toolChoice, temperature = 0.2, maxTokens = 1200, json = false, timeoutMs = 30000 }) {
  const config = providerConfig();
  if (!config || !isConfigured()) {
    throw new LlmError('No AI provider is configured. Add GROQ_API_KEY to server/.env.', { status: 503, code: 'not_configured' });
  }

  const body = { temperature, max_tokens: maxTokens, messages };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || 'auto';
  }
  if (json && config.supportsJsonMode && !tools?.length) body.response_format = { type: 'json_object' };

  const models = await candidateModels(config);
  const estimated = estimateTokens(body);
  const MAX_WAIT_MS = 12000;
  let lastError = null;
  const unusable = new Set();

  // Up to two passes: the first skips models known to be out of budget, the
  // second waits (briefly) for whichever frees up soonest.
  for (let pass = 0; pass < 3; pass++) {
    const ordered = models
      .filter((m) => !unusable.has(m))
      .map((m) => ({ model: m, wait: waitFor(m, estimated) }))
      .sort((a, b) => (a.wait === 0 && b.wait === 0 ? 0 : a.wait - b.wait));

    if (!ordered.length) break;

    const ready = ordered.filter((o) => o.wait === 0);
    const attempt = ready.length ? ready : [ordered[0]];

    if (!ready.length) {
      if (ordered[0].wait > MAX_WAIT_MS) break;
      await sleep(ordered[0].wait + 250);
    }

    for (const { model } of attempt) {
      const startedAt = Date.now();
      try {
        const parsed = await postChat(config, model, body, AbortSignal.timeout(timeoutMs));
        const message = parsed?.choices?.[0]?.message;
        if (!message) throw new LlmError(`${config.label} sent an empty response.`, { retryable: true, code: 'empty' });
        workingModel = model;
        return {
          message,
          latencyMs: Date.now() - startedAt,
          model,
          provider: config.name,
          usage: parsed.usage || null,
        };
      } catch (err) {
        lastError = err;
        if (err.code === 'rate_limited') {
          coolDown(model, err.waitMs);
          console.warn(`[llm] ${model} rate limited for ${Math.round(err.waitMs / 1000)}s, trying another model`);
          continue;
        }
        if (['model_missing', 'tool_error', 'empty', 'daily_limit'].includes(err.code)) {
          unusable.add(model);
          if (workingModel === model) workingModel = null;
          console.warn(`[llm] ${model} unavailable (${err.code}), trying next model`);
          continue;
        }
        throw err;
      }
    }
  }

  if (lastError?.code === 'rate_limited' || lastError?.code === 'daily_limit') throw lastError;

  if (lastError?.code === 'model_missing') {
    throw new LlmError(
      `None of the configured ${config.label} models are available to this key. Set LLM_MODEL in server/.env to one listed at ${config.console || config.baseUrl}.`,
      { status: 502, code: 'no_models' }
    );
  }
  throw lastError || new LlmError('The AI could not answer.');
}

/** Single-shot text completion, used by the table-operation interpreter. */
async function complete({ system, user, temperature = 0, maxTokens = 700, json = true, signal }) {
  const result = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    maxTokens,
    json,
    timeoutMs: signal ? 30000 : 15000,
  });
  return {
    text: result.message.content || '',
    latencyMs: result.latencyMs,
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

async function status({ probe = false } = {}) {
  const config = providerConfig();
  const configured = isConfigured();
  let model = workingModel || config?.models?.[0] || null;
  let reachable = null;

  if (probe && configured) {
    const models = await candidateModels(config);
    model = models[0] || model;
    reachable = discovery.available !== null;
  }

  return {
    configured,
    reachable,
    provider: config?.name ?? null,
    label: config?.label ?? null,
    model,
    keyVar: config?.keyVar ?? 'GROQ_API_KEY',
    console: config?.console ?? PROVIDERS.groq.console,
    providers: Object.entries(PROVIDERS)
      .filter(([name]) => name !== 'custom')
      .map(([name, c]) => ({ name, label: c.label, keyVar: c.keyVar, console: c.console })),
  };
}

module.exports = { chat, complete, isConfigured, providerConfig, activeProviderName, status, LlmError, PROVIDERS };
