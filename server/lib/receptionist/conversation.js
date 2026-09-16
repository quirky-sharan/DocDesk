const db = require('../../db');
const { redact, looksLikeInjection } = require('./untrusted');

/**
 * The record of what was said.
 *
 * Kept for three reasons that each justify it on their own: the front desk
 * needs a history rather than a chat window that forgets, the evaluation suite
 * replays real conversations after a prompt change, and when something goes
 * wrong the only useful question is "what actually happened" - which needs the
 * turns, the tools, the model and the timings, not a summary written after.
 *
 * Writing here never fails a turn. An answer the person asked for matters more
 * than the record of it, so every write is best-effort and logged on failure.
 */

async function start({ channel = 'app', customerId = null, leadId = null, mode = 'live', language = 'en' } = {}) {
  const { rows } = await db.query(
    `INSERT INTO conversations (channel, customer_id, lead_id, ai_mode_at_start, language)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [channel, customerId, leadId, mode, language]
  );
  return rows[0];
}

/** Finds the conversation, or opens one. Returns null if the database is unhappy. */
async function ensure(conversationId, options = {}) {
  try {
    if (conversationId) {
      const { rows } = await db.query('SELECT * FROM conversations WHERE id = $1', [conversationId]);
      if (rows.length) return rows[0];
    }
    return await start(options);
  } catch (err) {
    console.warn(`[receptionist] could not open a conversation record: ${err.message}`);
    return null;
  }
}

/**
 * Records one line.
 *
 * `origin` defaults to 'public' for anything that did not come from the owner,
 * which is the safe way round: a line nobody classified should be treated as
 * untrusted, not as trusted.
 */
async function addMessage(conversationId, {
  role, content, origin = 'public', language = null, model = null,
  tokensIn = null, tokensOut = null, latencyMs = null, confidence = null, toolCalls = null,
}) {
  if (!conversationId) return null;
  const cleaned = redact(content);
  try {
    const { rows } = await db.query(
      `INSERT INTO conversation_messages
         (conversation_id, role, content, origin, language, model_used, tokens_in, tokens_out,
          latency_ms, confidence, tool_calls, redacted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       RETURNING id`,
      [
        conversationId, role, cleaned.text.slice(0, 8000), origin, language, model,
        tokensIn, tokensOut, latencyMs, confidence,
        toolCalls ? JSON.stringify(toolCalls) : null, cleaned.redacted,
      ]
    );
    return rows[0];
  } catch (err) {
    console.warn(`[receptionist] could not record a message: ${err.message}`);
    return null;
  }
}

async function addEvent(conversationId, kind, detail = {}) {
  if (!conversationId) return null;
  try {
    const { rows } = await db.query(
      'INSERT INTO conversation_events (conversation_id, kind, detail) VALUES ($1, $2, $3::jsonb) RETURNING id',
      [conversationId, kind, JSON.stringify(detail)]
    );
    return rows[0];
  } catch (err) {
    console.warn(`[receptionist] could not record an event: ${err.message}`);
    return null;
  }
}

/** Marks a conversation as needing a person, with why. */
async function escalate(conversationId, reason) {
  if (!conversationId) return;
  await db.query(
    `UPDATE conversations SET status = 'waiting_human', escalated_at = now(), escalation_reason = $2
      WHERE id = $1 AND status = 'active'`,
    [conversationId, String(reason).slice(0, 300)]
  ).catch(() => {});
  await addEvent(conversationId, 'escalation', { reason });
}

async function finish(conversationId, { outcome = null, summary = null } = {}) {
  if (!conversationId) return;
  await db.query(
    `UPDATE conversations SET status = 'handled', ended_at = now(), outcome = $2, summary = $3 WHERE id = $1`,
    [conversationId, outcome, summary ? String(summary).slice(0, 2000) : null]
  ).catch(() => {});
}

/**
 * Notes that a stored record looked like it was trying to give instructions.
 * Logged rather than blocked: a note is still a note the owner may want to see,
 * and dropping records because they contain suspicious words would be worse
 * than the attack.
 */
async function noteInjectionAttempt(conversationId, text, where) {
  const check = looksLikeInjection(text);
  if (!check.suspicious) return false;
  await addEvent(conversationId, 'guardrail', {
    kind: 'injection_attempt', where, pattern: check.pattern,
    sample: String(text).slice(0, 200),
  });
  return true;
}

/** One conversation with everything that happened in it, for the Front Desk. */
async function transcript(conversationId) {
  const [conversation, messages, events] = await Promise.all([
    db.query('SELECT * FROM v_conversations WHERE id = $1', [conversationId]).then((r) => r.rows[0]),
    db.query(
      `SELECT id, role, content, origin, model_used, latency_ms, confidence, tool_calls, redacted, created_at
         FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at, id`,
      [conversationId]
    ).then((r) => r.rows),
    db.query(
      'SELECT kind, detail, created_at FROM conversation_events WHERE conversation_id = $1 ORDER BY created_at, id',
      [conversationId]
    ).then((r) => r.rows),
  ]);
  if (!conversation) return null;
  return { ...conversation, messages, events };
}

async function list({ limit = 40, status = null } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM v_conversations ${status ? 'WHERE status = $2' : ''} ORDER BY started_at DESC LIMIT $1`,
    status ? [limit, status] : [limit]
  );
  return rows;
}

module.exports = {
  start, ensure, addMessage, addEvent, escalate, finish,
  noteInjectionAttempt, transcript, list,
};
