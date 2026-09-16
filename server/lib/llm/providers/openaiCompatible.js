const { LlmError, classifyHttp, retryAfterMs } = require('../errors');

/**
 * Most free providers speak the OpenAI chat-completions shape, so an adapter is
 * usually a base URL plus a key. What each one actually needs writing by hand is
 * `mapError` and `quotaFromHeaders`, because that is where free tiers differ
 * most - the wire format is standard, the way they say "no" is not.
 *
 * An adapter is an object:
 *   { id, label, baseUrl, keyVar, consoleUrl, listModels, chat, mapError,
 *     quotaFromHeaders, classify }
 */

/** Non-chat models that must never end up in a chat tier, whatever they are called. */
const NOT_CHAT = /whisper|tts|speech|embed|rerank|moderation|guard|orpheus|distil-whisper/i;
const VISION = /vision|-vl\b|multimodal|omni/i;
const AUDIO = /whisper|tts|speech|orpheus|audio/i;

/**
 * Rough size from a model's name. Providers almost never report parameter count
 * or tool support, so tiers start as a guess from the id and are corrected by
 * the benchmark, which measures rather than assumes.
 */
function tierFromName(id) {
  const name = String(id).toLowerCase();
  const billions = [...name.matchAll(/(\d+(?:\.\d+)?)\s*b\b/g)].map((m) => Number(m[1]));
  const biggest = billions.length ? Math.max(...billions) : null;

  if (/nano|tiny|guard|-1b|-2b|0\.5b/.test(name)) return 'nano';
  if (biggest !== null) {
    if (biggest <= 4) return 'nano';
    if (biggest <= 35) return 'small';
    return 'mid';
  }
  if (/flash|mini|small|lite|haiku/.test(name)) return 'small';
  if (/pro|large|ultra|opus|sonnet|max/.test(name)) return 'mid';
  return 'small';
}

function capabilitiesFromName(id) {
  const name = String(id).toLowerCase();
  const capabilities = [];
  if (AUDIO.test(name)) capabilities.push('audio');
  if (NOT_CHAT.test(name)) return capabilities;
  capabilities.push('chat', 'json');
  // Assumed rather than known. A model that turns out not to call tools fails
  // the benchmark and is marked then - which is the honest order, because no
  // provider's /models tells us.
  capabilities.push('tools');
  if (VISION.test(name)) capabilities.push('vision');
  return capabilities;
}

/** Builds an adapter for a provider that speaks the standard shape. */
function openaiCompatible(config) {
  const {
    id,
    label,
    baseUrl,
    keyVar,
    consoleUrl = null,
    needsKey = true,
    modelsPath = '/models',
    chatPath = '/chat/completions',
    extraHeaders = () => ({}),
    mapError: overrideMapError,
    quotaFromHeaders: overrideQuota,
    classify: overrideClassify,
    parseModels,
    supportsJsonMode = true,
  } = config;

  const headersFor = (apiKey) => ({
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...extraHeaders(apiKey),
  });

  async function readError(response) {
    const raw = await response.text();
    try {
      const body = JSON.parse(raw);
      return body?.error?.message || body?.message || body?.detail || raw.slice(0, 300);
    } catch {
      return raw.slice(0, 300);
    }
  }

  const adapter = {
    id,
    label,
    baseUrl,
    keyVar,
    consoleUrl,
    needsKey,
    supportsJsonMode,

    /** Asks the provider what this key can actually use. */
    async listModels({ apiKey, timeoutMs = 12000 } = {}) {
      const response = await fetch(`${adapter.baseUrl}${modelsPath}`, {
        headers: headersFor(apiKey),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        const detail = await readError(response);
        throw adapter.mapError(response.status, detail, response.headers);
      }
      const body = await response.json();
      return (parseModels ? parseModels(body) : defaultParseModels(body)).map((m) => ({
        ...m,
        tier: m.tier || adapter.classify(m).tier,
        capabilities: m.capabilities || adapter.classify(m).capabilities,
      }));
    },

    async chat({ apiKey, model, body, signal }) {
      let response;
      try {
        response = await fetch(`${adapter.baseUrl}${chatPath}`, {
          method: 'POST',
          headers: headersFor(apiKey),
          body: JSON.stringify({ ...body, model }),
          signal,
        });
      } catch (err) {
        const timedOut = err.name === 'AbortError' || err.name === 'TimeoutError';
        throw new LlmError(
          timedOut ? `${label} took too long to answer.` : `Could not reach ${label}.`,
          { errorClass: 'transient', status: timedOut ? 504 : 502, provider: id, model }
        );
      }

      const quota = adapter.quotaFromHeaders(response.headers);

      if (!response.ok) {
        const detail = await readError(response);
        const error = adapter.mapError(response.status, detail, response.headers);
        error.provider = id;
        error.model = model;
        error.quota = quota;
        throw error;
      }

      const raw = await response.text();
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new LlmError(`${label} sent a reply that was not valid JSON.`, {
          errorClass: 'transient', provider: id, model,
        });
      }

      const message = parsed?.choices?.[0]?.message;
      if (!message) {
        throw new LlmError(`${label} sent an empty reply.`, { errorClass: 'transient', provider: id, model });
      }
      return { message, usage: parsed.usage || null, quota, raw: parsed };
    },

    mapError(status, detail, headers) {
      if (overrideMapError) {
        const custom = overrideMapError(status, detail, headers);
        if (custom) return custom;
      }
      const errorClass = classifyHttp(status, detail, headers);
      return new LlmError(sentenceFor(errorClass, label, keyVar, detail), {
        errorClass,
        status: status >= 400 ? status : 502,
        provider: id,
        waitMs: retryAfterMs(headers) || 0,
        detail,
      });
    },

    /**
     * What the provider says is left, read from response headers. Headers are
     * ground truth; our own accounting is an estimate that drifts.
     */
    quotaFromHeaders(headers) {
      if (overrideQuota) return overrideQuota(headers);
      return defaultQuota(headers);
    },

    classify(model) {
      if (overrideClassify) {
        const custom = overrideClassify(model);
        if (custom) return custom;
      }
      return {
        tier: tierFromName(model.id),
        capabilities: capabilitiesFromName(model.id),
        family: familyOf(model.id),
      };
    },
  };

  return adapter;
}

function defaultParseModels(body) {
  const rows = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return rows
    .filter((m) => m && (m.id || m.name) && m.active !== false)
    .map((m) => ({
      id: String(m.id || m.name),
      contextWindow: Number(m.context_window || m.context_length || m.max_context_length || 0) || null,
      ownedBy: m.owned_by || m.organization || null,
    }));
}

function defaultQuota(headers) {
  if (!headers?.get) return null;
  const num = (name) => {
    const value = Number(headers.get(name));
    return Number.isFinite(value) ? value : null;
  };
  const windows = [];
  const tokenLimit = num('x-ratelimit-limit-tokens');
  const tokenRemaining = num('x-ratelimit-remaining-tokens');
  if (tokenLimit !== null && tokenRemaining !== null) {
    windows.push({ kind: 'tpm', limit: tokenLimit, remaining: tokenRemaining, refillMode: 'continuous' });
  }
  const requestLimit = num('x-ratelimit-limit-requests');
  const requestRemaining = num('x-ratelimit-remaining-requests');
  if (requestLimit !== null && requestRemaining !== null) {
    // A limit in the thousands is a daily allowance; a small one is per minute.
    const daily = requestLimit >= 200;
    windows.push({
      kind: daily ? 'rpd' : 'rpm',
      limit: requestLimit,
      remaining: requestRemaining,
      refillMode: daily ? 'fixed' : 'continuous',
    });
  }
  return windows.length ? windows : null;
}

function familyOf(id) {
  const name = String(id).toLowerCase();
  for (const family of ['gpt-oss', 'llama', 'gemma', 'gemini', 'qwen', 'mistral', 'ministral', 'nemotron', 'phi', 'deepseek', 'whisper']) {
    if (name.includes(family)) return family;
  }
  return name.split(/[/:-]/)[0] || 'other';
}

function sentenceFor(errorClass, label, keyVar, detail) {
  switch (errorClass) {
    case 'auth':
      return `${label} refused the API key. Check ${keyVar || 'the key'} in server/.env.`;
    case 'credits_exhausted':
      return `The free credit on your ${label} account has run out.`;
    case 'quota_daily':
      return `Today's free allowance on ${label} is used up.`;
    case 'rate_limited':
      return `${label} is busy for a moment.`;
    case 'model_missing':
      return `That ${label} model is no longer available.`;
    case 'context_overflow':
      return 'The conversation got too long to send.';
    case 'content_filter':
      return `${label} declined to answer that.`;
    case 'bad_request':
      return `${label} could not read the request: ${String(detail).slice(0, 160)}`;
    default:
      return `${label} returned an error: ${String(detail).slice(0, 160)}`;
  }
}

module.exports = { openaiCompatible, tierFromName, capabilitiesFromName, familyOf, defaultParseModels, NOT_CHAT };
