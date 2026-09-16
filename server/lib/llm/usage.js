const db = require('../../db');

/**
 * The cost ledger and the plain-English event log.
 *
 * ai_usage is one row per model call - what it cost in tokens, how long it
 * took, and if it failed, which class of failure. It is what the AI page charts
 * and what you read when a turn was slow.
 *
 * ai_events is different in kind: it is for the owner, not for debugging. Each
 * row is a sentence a non-technical person can act on. "Groq's free allowance
 * for today is used up. Receptionist AI switched to Gemini." - not a stack
 * trace, not a log line, and never shown to anybody but the owner.
 *
 * Neither is ever allowed to break a turn. A failure to write bookkeeping is
 * logged and swallowed: the answer the person asked for matters more than the
 * record of it.
 */

/** Records one model call. Fire and forget. */
function record({
  conversationId = null, purpose = 'chat', provider = null, model = null, tier = null,
  tokensIn = 0, tokensOut = 0, latencyMs = null, outcome = 'ok', errorClass = null, retriedFrom = null,
} = {}) {
  return db.query(
    `INSERT INTO ai_usage
       (conversation_id, purpose, provider_key, model, tier, tokens_in, tokens_out, latency_ms, outcome, error_class, retried_from)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      conversationId, purpose, provider, model, tier,
      Math.max(0, Math.round(tokensIn || 0)), Math.max(0, Math.round(tokensOut || 0)),
      latencyMs === null ? null : Math.round(latencyMs),
      outcome, errorClass, retriedFrom,
    ]
  ).catch((err) => {
    console.warn(`[llm] could not record usage: ${err.message}`);
  });
}

/**
 * Raises something worth telling the owner.
 *
 * Deduplicated within a window so a provider that is down for an hour produces
 * one line rather than a hundred - an event log nobody can bear to read is the
 * same as no event log.
 */
async function note({ kind, provider = null, model = null, message, detail = {}, dedupeMinutes = 30 }) {
  try {
    const { rows } = await db.query(
      `SELECT id FROM ai_events
        WHERE kind = $1
          AND provider_key IS NOT DISTINCT FROM $2
          AND model IS NOT DISTINCT FROM $3
          AND created_at > now() - make_interval(mins => $4)
        LIMIT 1`,
      [kind, provider, model, dedupeMinutes]
    );
    if (rows.length) return null;

    const { rows: created } = await db.query(
      `INSERT INTO ai_events (kind, provider_key, model, message, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [kind, provider, model, String(message).slice(0, 500), JSON.stringify(detail || {})]
    );
    return created[0];
  } catch (err) {
    console.warn(`[llm] could not record AI event: ${err.message}`);
    return null;
  }
}

/** Recent events for the AI page, newest first. */
async function recentEvents({ limit = 25, unseenOnly = false } = {}) {
  const { rows } = await db.query(
    `SELECT id, kind, provider_key, model, message, detail, seen, created_at
       FROM ai_events
      ${unseenOnly ? 'WHERE NOT seen' : ''}
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 25, 1), 200)]
  );
  return rows;
}

async function markEventsSeen(ids = []) {
  if (!ids.length) return 0;
  const { rowCount } = await db.query('UPDATE ai_events SET seen = true WHERE id = ANY($1)', [ids]);
  return rowCount;
}

/** Tokens spent today, for the daily cap the owner can set. */
async function tokensToday() {
  const { rows } = await db.query(
    `SELECT COALESCE(sum(tokens_in + tokens_out), 0)::bigint AS total
       FROM ai_usage
      WHERE created_at >= date_trunc('day', now() AT TIME ZONE business_timezone()) AT TIME ZONE business_timezone()`
  );
  return Number(rows[0]?.total || 0);
}

/** A rolled-up picture for the AI page. */
async function summary({ days = 7 } = {}) {
  const { rows } = await db.query(
    `SELECT provider_key, model,
            count(*)::int AS calls,
            COALESCE(sum(tokens_in), 0)::bigint AS tokens_in,
            COALESCE(sum(tokens_out), 0)::bigint AS tokens_out,
            count(*) FILTER (WHERE outcome = 'error')::int AS errors,
            count(*) FILTER (WHERE outcome = 'cached')::int AS cached,
            percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms)::int AS p50_ms,
            percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS p95_ms
       FROM ai_usage
      WHERE created_at > now() - make_interval(days => $1)
      GROUP BY 1, 2
      ORDER BY calls DESC`,
    [Math.min(Math.max(Number(days) || 7, 1), 90)]
  );
  return rows;
}

module.exports = { record, note, recentEvents, markEventsSeen, tokensToday, summary };
