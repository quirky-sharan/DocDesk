require('dotenv').config();

/**
 * Model providers, behind one interface so swapping is a config change.
 *
 * Every candidate worth using speaks the OpenAI chat-completions shape, so one
 * client covers all of them and a new provider is a base URL plus a model name.
 */
const PROVIDERS = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    keyVar: 'GROQ_API_KEY',
    console: 'https://console.groq.com/keys',
    supportsJsonMode: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    keyVar: 'OPENROUTER_API_KEY',
    console: 'https://openrouter.ai/keys',
    supportsJsonMode: true,
  },
  together: {
    label: 'Together',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    keyVar: 'TOGETHER_API_KEY',
    console: 'https://api.together.ai/settings/api-keys',
    supportsJsonMode: true,
  },
  // Anything else OpenAI-compatible, including a local Ollama or llama.cpp
  // server. Set LLM_BASE_URL and LLM_MODEL; the key may be blank for local.
  custom: {
    label: 'Custom (OpenAI-compatible)',
    baseUrl: process.env.LLM_BASE_URL || '',
    defaultModel: process.env.LLM_MODEL || '',
    keyVar: 'LLM_API_KEY',
    console: null,
    supportsJsonMode: false,
  },
};

function activeProviderName() {
  const explicit = String(process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit && PROVIDERS[explicit]) return explicit;
  // No explicit choice: use whichever key is actually present.
  for (const [name, config] of Object.entries(PROVIDERS)) {
    if (name === 'custom') continue;
    if (process.env[config.keyVar]) return name;
  }
  if (process.env.LLM_BASE_URL) return 'custom';
  return null;
}

function providerConfig(name = activeProviderName()) {
  if (!name) return null;
  const config = PROVIDERS[name];
  if (!config) return null;
  return {
    name,
    ...config,
    baseUrl: process.env.LLM_BASE_URL || config.baseUrl,
    model: process.env.LLM_MODEL || config.defaultModel,
    apiKey: process.env[config.keyVar] || process.env.LLM_API_KEY || '',
  };
}

function isConfigured() {
  const config = providerConfig();
  if (!config) return false;
  // A local server legitimately needs no key.
  return Boolean(config.apiKey) || config.name === 'custom';
}

class LlmError extends Error {
  constructor(message, { status = 502, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

/**
 * One chat completion. Returns the raw assistant text plus timing, so callers
 * can report latency without a second clock.
 */
async function complete({ system, user, temperature = 0, maxTokens = 700, json = true, signal }) {
  const config = providerConfig();
  if (!config) {
    throw new LlmError('No AI provider is configured.', { status: 503 });
  }

  const body = {
    model: config.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
  // JSON mode removes a whole class of "here is your JSON:" preamble failures.
  if (json && config.supportsJsonMode) body.response_format = { type: 'json_object' };

  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new LlmError('The AI provider took too long to answer.', { status: 504, retryable: true });
    }
    throw new LlmError(`Could not reach ${config.label}. Check the machine is online.`, { retryable: true });
  }

  const raw = await response.text();

  if (!response.ok) {
    // Surface the provider's own reason where it is useful, because "invalid
    // key" and "rate limited" need completely different actions from the user.
    let detail = '';
    try {
      detail = JSON.parse(raw)?.error?.message || '';
    } catch {
      detail = raw.slice(0, 200);
    }
    if (response.status === 401 || response.status === 403) {
      throw new LlmError(
        `${config.label} rejected the API key. Check ${config.keyVar} in server/.env.`,
        { status: 502 }
      );
    }
    if (response.status === 429) {
      throw new LlmError(
        `${config.label} is rate limiting us. Wait a moment and try again.`,
        { status: 429, retryable: true }
      );
    }
    throw new LlmError(`${config.label} returned an error: ${detail || response.status}`, {
      retryable: response.status >= 500,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LlmError(`${config.label} sent a response that wasn't valid JSON.`);
  }

  const text = parsed?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new LlmError(`${config.label} sent an empty response.`, { retryable: true });
  }

  return {
    text,
    latencyMs: Date.now() - startedAt,
    model: config.model,
    provider: config.name,
    usage: parsed.usage || null,
  };
}

function status() {
  const config = providerConfig();
  return {
    configured: isConfigured(),
    provider: config?.name ?? null,
    label: config?.label ?? null,
    model: config?.model ?? null,
    keyVar: config?.keyVar ?? 'GROQ_API_KEY',
    console: config?.console ?? PROVIDERS.groq.console,
    providers: Object.entries(PROVIDERS)
      .filter(([name]) => name !== 'custom')
      .map(([name, c]) => ({ name, label: c.label, keyVar: c.keyVar, console: c.console })),
  };
}

module.exports = { complete, isConfigured, providerConfig, activeProviderName, status, LlmError, PROVIDERS };
