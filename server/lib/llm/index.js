const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const db = require('../../db');
const { LlmError } = require('./errors');
const { allAdapters, isConfigured: adapterConfigured, keyFor } = require('./providers');
const gateway = require('./gateway');
const registry = require('./registry');
const budget = require('./budget');
const usage = require('./usage');

/**
 * The one way into the model layer.
 *
 * Everything underneath - discovery, the error taxonomy, budgets, pooling
 * across providers - is an implementation detail. Callers ask for a completion
 * at a tier and either get one or get an LlmError whose `errorClass` says what
 * kind of "no" it was.
 *
 * What changed in Phase 7, and why:
 *   - a provider is an adapter file, not an entry in a constant
 *   - models are discovered, never named in code
 *   - allowances are per provider AND per model, pooled, and survive a restart
 *   - "out of credits" and "busy for a second" are different states with
 *     different sentences, because telling someone to top up an account that is
 *     merely rate limited wastes their evening
 */

const chat = gateway.chat;

/** Single-shot completion. Used by the table-operation interpreter. */
async function complete({ system, user, temperature = 0, maxTokens = 700, json = true, tier = 'small', purpose = 'nlq' } = {}) {
  const result = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    maxTokens,
    json,
    tier,
    purpose,
    timeoutMs: 20000,
  });
  return {
    text: result.message.content || '',
    latencyMs: result.latencyMs,
    model: result.model,
    provider: result.provider,
    usage: result.usage,
  };
}

/** Whether any provider is set up at all. */
function isConfigured() {
  return gateway.isConfiguredAnywhere();
}

/**
 * What the owner sees on the AI status page: every provider, what state it is
 * in, and the next useful thing to do about it.
 *
 * The sentences matter as much as the states. "Daily free allowance used,
 * resets 05:30" tells someone they need do nothing; "Key invalid" tells them
 * exactly which line of which file to change.
 */
async function status({ probe = false } = {}) {
  if (probe) await registry.discover({ force: true }).catch(() => {});
  await budget.hydrate();

  let stored = [];
  try {
    const { rows } = await db.query(
      `SELECT p.key, p.label, p.status, p.status_reason, p.status_until, p.health, p.latency_ms,
              p.console_url, p.key_var, p.is_enabled,
              count(m.id) FILTER (WHERE m.is_enabled) AS model_count
         FROM ai_providers p
         LEFT JOIN ai_models m ON m.provider_key = p.key
        GROUP BY p.key
        ORDER BY p.key`
    );
    stored = rows;
  } catch {
    // Before the migration has run, or with the database still opening, report
    // what can be known from the environment alone rather than failing.
    stored = [];
  }

  const byKey = new Map(stored.map((row) => [row.key, row]));
  const providers = allAdapters().map((adapter) => {
    const row = byKey.get(adapter.id);
    const configured = adapterConfigured(adapter);
    const state = !configured ? 'not_configured' : row?.status || 'unknown';
    return {
      key: adapter.id,
      // The Settings panel keys its list on `name`; kept so the rename of this
      // field does not blank the "where to get a key" links.
      name: adapter.id,
      label: adapter.label,
      keyVar: adapter.keyVar,
      console: adapter.consoleUrl,
      configured,
      status: state,
      ...describe(state, row, adapter),
      models: Number(row?.model_count || 0),
      health: row ? Number(row.health) : null,
      latencyMs: row?.latency_ms ?? null,
      budgets: budget.snapshot(adapter.id),
    };
  });

  const ready = providers.filter((p) => p.configured && ['ready', 'unknown', 'busy'].includes(p.status));
  const overrides = gateway.getOverrides();

  return {
    // Kept for the existing panel, which shows a warning when this is false.
    configured: providers.some((p) => p.configured),
    reachable: ready.length > 0 ? true : null,
    provider: ready[0]?.key ?? null,
    label: ready[0]?.label ?? null,
    model: null,
    keyVar: 'GROQ_API_KEY',
    console: 'https://console.groq.com/keys',
    providers,
    overrides,
    events: await usage.recentEvents({ limit: 10 }).catch(() => []),
    // With no provider at all, the receptionist still works from its rules.
    deterministicOnly: overrides.deterministicOnly || !providers.some((p) => p.configured),
  };
}

/** One sentence of state, and the next useful action, per provider. */
function describe(state, row, adapter) {
  const until = row?.status_until ? new Date(row.status_until) : null;
  const time = until
    ? until.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  switch (state) {
    case 'ready':
      return { summary: 'Ready', action: null };
    case 'busy':
      return { summary: 'Busy for a moment', action: 'Nothing to do - this clears in a few seconds.' };
    case 'quota_daily':
      return {
        summary: time ? `Daily free allowance used, back around ${time}` : 'Daily free allowance used',
        action: 'Nothing to do. Another provider is being used until it resets.',
      };
    case 'credits_exhausted':
      return {
        summary: 'Out of credit',
        action: `Top up the account, or use a different provider. ${adapter.consoleUrl || ''}`.trim(),
      };
    case 'auth':
      return {
        summary: 'Key refused',
        action: `Put a new key in ${adapter.keyVar} in server/.env and restart DocDesk. Get one at ${adapter.consoleUrl || 'the provider'}.`,
      };
    case 'down':
      return { summary: 'Not answering', action: row?.status_reason || 'The provider could not be reached.' };
    case 'not_configured':
      return {
        summary: 'Not set up',
        action: adapter.keyVar
          ? `Add ${adapter.keyVar} to server/.env. Free, no card: ${adapter.consoleUrl || ''}`.trim()
          : 'Start it on this computer and DocDesk will find it.',
      };
    case 'disabled':
      return { summary: 'Turned off', action: 'Switch it back on in Settings.' };
    default:
      return { summary: 'Not checked yet', action: 'Press Test to check it now.' };
  }
}

/** Runs at start-up. Never allowed to stop the server coming up. */
async function warmUp() {
  try {
    await registry.syncProviders();
    await budget.hydrate();
    await registry.discover({ force: false });
  } catch (err) {
    console.warn(`[llm] start-up discovery skipped: ${err.message}`);
  }
}

module.exports = {
  chat,
  complete,
  isConfigured,
  status,
  warmUp,
  LlmError,
  // The pieces, for the AI page, the benchmark and the tests.
  registry,
  budget,
  usage,
  gateway,
  providers: require('./providers'),
};
