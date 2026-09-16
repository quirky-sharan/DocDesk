const { openaiCompatible, defaultParseModels } = require('./openaiCompatible');
const { LlmError, retryAfterMs } = require('../errors');

/**
 * Every provider DocDesk knows how to talk to.
 *
 * Adding one is a file (or an entry here) exporting the adapter contract. Most
 * are twenty lines, because the wire format is the same everywhere; the parts
 * worth reading are mapError and quotaFromHeaders, which is where free tiers
 * actually differ.
 *
 * Nothing here names a model. Models are discovered from the provider and
 * matched against a preference expression in registry.js. This file was written
 * the day both OpenRouter model names hardcoded in the previous version turned
 * out to have been dropped from its free list.
 */

// Groq. Fastest of the free options by a wide margin, which matters when the
// owner is standing at a counter waiting for an answer. Its per-minute token
// bucket refills continuously rather than all at once at the reset time - a
// detail the previous version got wrong and gave up far too early because of.
const groq = openaiCompatible({
  id: 'groq',
  label: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyVar: 'GROQ_API_KEY',
  consoleUrl: 'https://console.groq.com/keys',
  mapError(status, detail, headers) {
    if (status === 429 && /tokens per day|TPD|requests per day|RPD/i.test(detail)) {
      const error = new LlmError("Today's free allowance on Groq is used up. It resets within 24 hours.", {
        errorClass: 'quota_daily', status: 429, provider: 'groq',
      });
      error.waitMs = retryAfterMs(headers) || 6 * 3600000;
      return error;
    }
    return null;
  },
});

// Google AI Studio. The most capable free option and no card required, so it is
// the natural default for the mid tier.
//
// Two endpoints on purpose: discovery uses Google's own /models because the
// OpenAI-compatible layer does not answer a listing request, while chat uses
// the OpenAI-compatible path so the same client code works. Both are wired but
// UNVERIFIED against a live key - there is no Google key in this project yet.
// See REQUIREMENTS-RECEPTIONIST.md.
const google = openaiCompatible({
  id: 'google',
  label: 'Google AI Studio',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  keyVar: 'GOOGLE_API_KEY',
  consoleUrl: 'https://aistudio.google.com/apikey',
  parseModels(body) {
    // Google's native listing calls them "models/gemini-..." and reports
    // supportedGenerationMethods rather than a type.
    const rows = Array.isArray(body?.models) ? body.models : [];
    return rows
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({
        id: String(m.name || '').replace(/^models\//, ''),
        contextWindow: Number(m.inputTokenLimit || 0) || null,
        ownedBy: 'Google',
      }));
  },
  mapError(status, detail) {
    if (status === 403 && /quota|billing/i.test(detail)) {
      return new LlmError("Today's free allowance on Google AI Studio is used up.", {
        errorClass: 'quota_daily', status: 429, provider: 'google',
      });
    }
    return null;
  },
});
// Discovery talks to the native endpoint with the key in the query string,
// which is the one shape Google does not accept as a bearer token.
google.listModels = async ({ apiKey, timeoutMs = 12000 } = {}) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey || '')}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw google.mapError(response.status, detail, response.headers);
  }
  const body = await response.json();
  const rows = (Array.isArray(body?.models) ? body.models : [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({
      id: String(m.name || '').replace(/^models\//, ''),
      contextWindow: Number(m.inputTokenLimit || 0) || null,
      ownedBy: 'Google',
    }));
  return rows.map((m) => ({ ...m, ...google.classify(m) }));
};

// OpenRouter. Best treated as an escape hatch: its free list churns constantly,
// which is exactly why nothing may hardcode a name from it.
const openrouter = openaiCompatible({
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  keyVar: 'OPENROUTER_API_KEY',
  consoleUrl: 'https://openrouter.ai/keys',
  extraHeaders: () => ({
    'HTTP-Referer': 'https://docdesk.local',
    'X-Title': 'DocDesk',
  }),
  parseModels(body) {
    // Only the ":free" ones. A paid model quietly entering the pool would put a
    // charge on somebody's card, and this whole phase is meant to cost nothing.
    const supported = new Map(
      (Array.isArray(body?.data) ? body.data : []).map((m) => [String(m.id), m.supported_parameters || []])
    );
    return defaultParseModels(body)
      .filter((m) => m.id.endsWith(':free'))
      .map((m) => ({ ...m, free: true, supportedParameters: supported.get(m.id) || [] }));
  },
  classify(model) {
    // OpenRouter is the one provider that actually reports whether a model
    // takes tools, so believe it rather than guessing from the name.
    if (!model.supportedParameters?.length) return null;
    const { tierFromName, capabilitiesFromName, familyOf } = require('./openaiCompatible');
    const capabilities = capabilitiesFromName(model.id).filter((c) => c !== 'tools');
    if (model.supportedParameters.includes('tools')) capabilities.push('tools');
    return { tier: tierFromName(model.id), capabilities, family: familyOf(model.id) };
  },
});

const mistral = openaiCompatible({
  id: 'mistral',
  label: 'Mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  keyVar: 'MISTRAL_API_KEY',
  consoleUrl: 'https://console.mistral.ai/api-keys',
});

// Cloudflare Workers AI. A daily neuron allowance, useful as a third leg. The
// account id is part of the URL, so this one only appears when both are set.
function cloudflare() {
  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
  if (!account) return null;
  return openaiCompatible({
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    baseUrl: `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`,
    keyVar: 'CLOUDFLARE_API_TOKEN',
    consoleUrl: 'https://dash.cloudflare.com/profile/api-tokens',
  });
}

// Ollama, if the shop's own machine happens to be running it: unlimited, private
// and free, with no account anywhere. Detected rather than configured.
const ollama = openaiCompatible({
  id: 'ollama',
  label: 'Ollama (on this computer)',
  baseUrl: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434') + '/v1',
  keyVar: null,
  needsKey: false,
  consoleUrl: 'https://ollama.com/download',
  supportsJsonMode: false,
});
// Found rather than configured, so it only counts once it has actually replied.
ollama.autoDetected = true;

// Anything else that speaks the same shape, pointed at by LLM_BASE_URL.
function custom() {
  const baseUrl = String(process.env.LLM_BASE_URL || '').trim();
  if (!baseUrl) return null;
  return openaiCompatible({
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    baseUrl: baseUrl.replace(/\/$/, ''),
    keyVar: 'LLM_API_KEY',
    needsKey: false,
    supportsJsonMode: false,
  });
}

/** Every adapter that could exist in this installation, configured or not. */
function allAdapters() {
  return [groq, google, openrouter, mistral, cloudflare(), ollama, custom()].filter(Boolean);
}

/** The API key for an adapter, or '' when it needs none. */
function keyFor(adapter) {
  if (!adapter.keyVar) return '';
  return String(process.env[adapter.keyVar] || '').trim();
}

// Whether a keyless provider has actually answered. Ollama needs no key, which
// is not the same as being installed - without this, DocDesk would report that
// AI was set up on every machine in the world and then fail on the first call.
const seen = new Map();
function markSeen(id, ok) {
  seen.set(id, Boolean(ok));
}

/** Worth asking what models it has: it has a key, or it needs none. */
function isWorthTrying(adapter) {
  return adapter.needsKey ? Boolean(keyFor(adapter)) : true;
}

/**
 * Actually usable. A keyed provider needs its key. An AUTO-DETECTED one - only
 * Ollama - has to have answered at least once, because its default URL exists
 * on every machine whether or not anything is listening there. A custom base
 * URL somebody typed into .env is explicit configuration and is taken at face
 * value.
 */
function isConfigured(adapter) {
  if (adapter.needsKey) return Boolean(keyFor(adapter));
  if (!adapter.autoDetected) return true;
  return seen.get(adapter.id) === true;
}

module.exports = {
  allAdapters, keyFor, isConfigured, isWorthTrying, markSeen,
  groq, google, openrouter, mistral, ollama,
};
