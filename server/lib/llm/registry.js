const db = require('../../db');
const { allAdapters, keyFor, isConfigured, isWorthTrying, markSeen } = require('./providers');
const { note } = require('./usage');

/**
 * Which models exist, what they are good for, and which may be used.
 *
 * Nothing in DocDesk names a model as configuration. Models are DISCOVERED from
 * each provider, written to ai_models, and matched against a preference
 * EXPRESSION rather than a name:
 *
 *   { tier: 'mid', prefer: [/gpt-oss-120b/, /gemini/], require: ['tools'] }
 *
 * The difference matters. Phase 5 broke when Groq retired a hardcoded model, and
 * while writing this phase both OpenRouter names in the old file had already
 * gone from its free list. A preference list degrades - the next match wins. A
 * hardcoded name just stops working.
 */

const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * What each tier is for, and what it will settle for.
 *
 * `prefer` is an ordered wish list, not a requirement: anything in the tier can
 * serve, but a match earlier in the list is chosen first. `require` is the hard
 * part - a tier that needs tool calling must never be handed a model that
 * cannot do it.
 */
const TIERS = {
  // Intent, language, yes/no, a short extraction. Small and cheap, and the
  // floor that makes "works with no key" true rather than aspirational.
  nano: {
    prefer: [/gemma.*(1b|2b|4b)/i, /nano/i, /lfm/i, /tiny/i, /mini/i, /8b/i, /20b/i],
    require: ['chat'],
    avoid: [/vision/i],
    maxTokens: 400,
  },
  // Most turns land here: rephrasing, summarising, one-shot answers with
  // retrieved context. No tool schema unless one is actually needed.
  small: {
    prefer: [/gpt-oss-20b/i, /gemma/i, /ministral/i, /flash/i, /mini/i, /small/i, /8b/i, /27b/i],
    require: ['chat'],
    avoid: [/vision/i],
    maxTokens: 900,
  },
  // Multi-step work and anything that will propose a change.
  mid: {
    prefer: [/gpt-oss-120b/i, /gemini.*pro/i, /70b/i, /120b/i, /large/i, /qwen/i],
    require: ['chat', 'tools'],
    avoid: [],
    maxTokens: 1200,
  },
};

let lastDiscovery = 0;
let discovering = null;

/**
 * Providers worth asking. Deliberately looser than isConfigured(): a keyless
 * provider like Ollama has to be tried before anyone can know it is there.
 */
function discoverable() {
  return allAdapters()
    .filter((adapter) => isWorthTrying(adapter))
    .map((adapter) => ({ adapter, apiKey: keyFor(adapter) }));
}

/** Providers that can actually serve a request right now. */
function activeAdapters() {
  return allAdapters()
    .filter((adapter) => isConfigured(adapter))
    .map((adapter) => ({ adapter, apiKey: keyFor(adapter) }));
}

/** Makes sure every configured provider has a row, so the status page lists it. */
async function syncProviders() {
  const rows = allAdapters().map((adapter) => ({
    key: adapter.id,
    label: adapter.label,
    baseUrl: adapter.baseUrl,
    keyVar: adapter.keyVar,
    consoleUrl: adapter.consoleUrl,
    configured: isConfigured(adapter),
  }));

  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx.query(
        `INSERT INTO ai_providers (key, label, base_url, key_var, console_url, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (key) DO UPDATE SET
           label = EXCLUDED.label,
           base_url = EXCLUDED.base_url,
           key_var = EXCLUDED.key_var,
           console_url = EXCLUDED.console_url,
           status = CASE
             WHEN NOT $7 THEN 'not_configured'
             WHEN ai_providers.status = 'not_configured' THEN 'unknown'
             ELSE ai_providers.status
           END`,
        [row.key, row.label, row.baseUrl, row.keyVar, row.consoleUrl, row.configured ? 'unknown' : 'not_configured', row.configured]
      );
    }
  }, { actor: 'system' });
}

/**
 * Asks every configured provider what it has and records the answer.
 * A provider that fails is recorded as failing and does not stop the others.
 */
async function discover({ force = false } = {}) {
  if (!force && Date.now() - lastDiscovery < DISCOVERY_TTL_MS) return { skipped: true };
  if (discovering) return discovering;

  discovering = (async () => {
    await syncProviders();
    const summary = [];

    for (const { adapter, apiKey } of discoverable()) {
      const startedAt = Date.now();
      try {
        const models = await adapter.listModels({ apiKey });
        const chatModels = models.filter((m) => (m.capabilities || []).includes('chat'));

        await db.transaction(async (tx) => {
          for (const model of models) {
            await tx.query(
              `INSERT INTO ai_models (provider_key, model, family, tier, context_window, capabilities, last_seen_at)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
               ON CONFLICT (provider_key, model) DO UPDATE SET
                 family = EXCLUDED.family,
                 tier = EXCLUDED.tier,
                 context_window = EXCLUDED.context_window,
                 capabilities = EXCLUDED.capabilities,
                 last_seen_at = now(),
                 -- A model that has been away for a while and is listed again
                 -- is usable again. One that failed minutes ago stays out: a
                 -- provider's listing can be stale, and re-enabling a model
                 -- that just 404'd would undo the retirement in the same turn
                 -- that noticed it.
                 is_enabled = ai_models.last_error IS NULL
                              OR ai_models.last_error_at < now() - interval '30 minutes',
                 last_error = CASE
                   WHEN ai_models.last_error_at < now() - interval '30 minutes' THEN NULL
                   ELSE ai_models.last_error
                 END`,
              [
                adapter.id, model.id, model.family || null,
                (model.capabilities || []).includes('chat') ? model.tier : null,
                model.contextWindow || null,
                JSON.stringify(model.capabilities || []),
              ]
            );
          }
          // Anything the provider no longer lists has been retired.
          await tx.query(
            `UPDATE ai_models SET is_enabled = false, last_error = 'no longer listed by the provider', last_error_at = now()
              WHERE provider_key = $1 AND last_seen_at < now() - interval '1 minute' AND is_enabled`,
            [adapter.id]
          );
          await tx.query(
            `UPDATE ai_providers SET status = 'ready', status_reason = NULL, status_until = NULL, latency_ms = $2, checked_at = now()
              WHERE key = $1`,
            [adapter.id, Date.now() - startedAt]
          );
        }, { actor: 'system' });

        markSeen(adapter.id, true);
        summary.push({ provider: adapter.id, models: models.length, chat: chatModels.length });
      } catch (err) {
        markSeen(adapter.id, false);
        const errorClass = err.errorClass || 'transient';
        await db.query(
          `UPDATE ai_providers SET status = $2, status_reason = $3, checked_at = now() WHERE key = $1`,
          [adapter.id, statusForClass(errorClass), err.message.slice(0, 300)]
        ).catch(() => {});
        await note({
          kind: errorClass === 'auth' ? 'auth_failed' : 'provider_down',
          provider: adapter.id,
          message: err.message,
        });
        summary.push({ provider: adapter.id, error: err.message });
      }
    }

    lastDiscovery = Date.now();
    discovering = null;
    return { providers: summary };
  })();

  return discovering;
}

function statusForClass(errorClass) {
  switch (errorClass) {
    case 'auth': return 'auth';
    case 'quota_daily': return 'quota_daily';
    case 'credits_exhausted': return 'credits_exhausted';
    case 'rate_limited': return 'busy';
    default: return 'down';
  }
}

/**
 * Models that could serve a tier, best first.
 *
 * Ordering, in order of importance:
 *   1. never a model that failed a must-pass evaluation case
 *   2. never a model missing a capability the tier requires
 *   3. a benchmark score, when there is one
 *   4. position in the tier's preference list
 *   5. how fast its provider has been
 */
async function candidates(tier, { requireTools = null } = {}) {
  const spec = TIERS[tier] || TIERS.small;
  const providerKeys = activeAdapters().map(({ adapter }) => adapter.id);
  if (!providerKeys.length) return [];

  const { rows } = await db.query(
    `SELECT m.provider_key, m.model, m.tier, m.capabilities, m.context_window, m.bench_score,
            m.tokenizer_factor, p.label, p.status, p.status_until, p.health, p.latency_ms
       FROM ai_models m
       JOIN ai_providers p ON p.key = m.provider_key
      WHERE m.is_enabled
        AND p.is_enabled
        AND m.provider_key = ANY($1)
        AND m.capabilities ? 'chat'
        AND NOT EXISTS (
          SELECT 1 FROM v_eval_scoreboard s
           WHERE s.model = m.model AND s.provider_key = m.provider_key AND s.blocked AND s.mode = 'normal'
        )`,
    [providerKeys]
  );

  const needsTools = requireTools ?? spec.require.includes('tools');

  return rows
    .filter((row) => {
      const capabilities = row.capabilities || [];
      if (needsTools && !capabilities.includes('tools')) return false;
      if (spec.avoid.some((pattern) => pattern.test(row.model))) return false;
      // A provider parked for the day is not a candidate until it lifts.
      if (['auth', 'credits_exhausted', 'not_configured', 'disabled'].includes(row.status)) return false;
      if (row.status === 'quota_daily' && row.status_until && new Date(row.status_until) > new Date()) return false;
      return true;
    })
    .map((row) => ({
      provider: row.provider_key,
      providerLabel: row.label,
      model: row.model,
      tier: row.tier,
      capabilities: row.capabilities || [],
      contextWindow: row.context_window,
      benchScore: row.bench_score === null ? null : Number(row.bench_score),
      tokenizerFactor: Number(row.tokenizer_factor || 1),
      health: Number(row.health ?? 1),
      latencyMs: row.latency_ms,
      preference: preferenceIndex(spec, row.model, row.tier, tier),
    }))
    .sort((a, b) => {
      if (a.preference !== b.preference) return a.preference - b.preference;
      if ((b.benchScore ?? -1) !== (a.benchScore ?? -1)) return (b.benchScore ?? -1) - (a.benchScore ?? -1);
      if (b.health !== a.health) return b.health - a.health;
      return (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999);
    });
}

/**
 * Where a model sits in a tier's wish list. A model of the right size that is
 * not named at all still ranks ahead of one from another tier, so an unfamiliar
 * model released next month is usable without anybody editing this file.
 */
function preferenceIndex(spec, model, modelTier, wantedTier) {
  const matched = spec.prefer.findIndex((pattern) => pattern.test(model));
  if (matched >= 0) return matched;
  if (modelTier === wantedTier) return spec.prefer.length;
  // A bigger model can always do a smaller model's job, just less cheaply.
  const order = ['nano', 'small', 'mid'];
  const distance = Math.abs(order.indexOf(modelTier) - order.indexOf(wantedTier));
  return spec.prefer.length + 1 + distance;
}

/** Records that a model could not be used, so routing stops offering it. */
async function disableModel(providerKey, model, reason) {
  await db.query(
    `UPDATE ai_models SET is_enabled = false, last_error = $3, last_error_at = now()
      WHERE provider_key = $1 AND model = $2`,
    [providerKey, model, String(reason).slice(0, 300)]
  ).catch(() => {});
}

/** Parks a whole provider: a bad key or spent credit affects every model behind it. */
async function parkProvider(providerKey, status, reason, untilMs = null) {
  await db.query(
    `UPDATE ai_providers SET status = $2, status_reason = $3, status_until = $4 WHERE key = $1`,
    [providerKey, status, String(reason).slice(0, 300), untilMs ? new Date(untilMs).toISOString() : null]
  ).catch(() => {});
}

/** Moves a provider's health score after a call. Slow, steady, bounded. */
async function recordHealth(providerKey, { ok, latencyMs }) {
  await db.query(
    `UPDATE ai_providers
        SET health = GREATEST(0, LEAST(1, health * 0.8 + $2 * 0.2)),
            latency_ms = COALESCE($3, latency_ms),
            checked_at = now(),
            status = CASE WHEN $4 AND status IN ('down', 'busy', 'unknown') THEN 'ready' ELSE status END
      WHERE key = $1`,
    [providerKey, ok ? 1 : 0, latencyMs ?? null, Boolean(ok)]
  ).catch(() => {});
}

module.exports = {
  TIERS, discover, candidates, syncProviders, activeAdapters, discoverable,
  disableModel, parkProvider, recordHealth, preferenceIndex,
};
