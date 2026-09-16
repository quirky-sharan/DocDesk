const { runTurn, confirmAction, cancelAction } = require('../lib/receptionist/agent');
const { status } = require('../lib/llm');
const { badRequest } = require('../lib/tables');

exports.status = async (req, res, next) => {
  try {
    res.json(await status({ probe: req.query.probe === '1' }));
  } catch (err) {
    next(err);
  }
};

exports.message = async (req, res, next) => {
  try {
    const { text, messages, page } = req.body || {};
    if (!text || !String(text).trim()) throw badRequest('Type a message first.');
    res.json(await runTurn({ userText: text, messages, page }));
  } catch (err) {
    next(err);
  }
};

exports.confirm = async (req, res, next) => {
  try {
    const { id, messages, page, openIds } = req.body || {};
    if (!id) throw badRequest('Nothing to confirm.');
    res.json(await confirmAction({ id, messages, page, openIds }));
  } catch (err) {
    next(err);
  }
};

exports.cancel = async (req, res, next) => {
  try {
    const { id } = req.body || {};
    if (!id) throw badRequest('Nothing to cancel.');
    res.json(cancelAction({ id }));
  } catch (err) {
    next(err);
  }
};

// --- the Front Desk inbox ----------------------------------------------------

const conversations = require('../lib/receptionist/conversation');
const knowledge = require('../lib/knowledge');

exports.conversations = async (req, res, next) => {
  try {
    res.json({
      items: await conversations.list({
        limit: Math.min(Number(req.query.limit) || 40, 200),
        status: req.query.status || null,
      }),
    });
  } catch (err) {
    next(err);
  }
};

exports.transcript = async (req, res, next) => {
  try {
    const result = await conversations.transcript(Number(req.params.id));
    if (!result) throw badRequest('That conversation is not there');
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/**
 * Everything the front desk needs in one call: what is on today, what is
 * waiting for a person, and the questions nobody could answer.
 *
 * One request rather than four because this is the page a shop leaves open all
 * day, and four polling timers is how a laptop fan starts up.
 */
exports.frontDesk = async (req, res, next) => {
  try {
    const db = require('../db');
    const [open, recent, gaps, counts] = await Promise.all([
      conversations.list({ limit: 25, status: 'waiting_human' }),
      conversations.list({ limit: 25 }),
      knowledge.gaps({ limit: 8 }),
      db.query(
        `SELECT
           (SELECT count(*) FROM conversations WHERE status = 'waiting_human')::int AS waiting,
           (SELECT count(*) FROM conversations WHERE started_at > now() - interval '1 day')::int AS today,
           (SELECT count(*) FROM message_log WHERE status = 'queued' AND channel IN ('note','call'))::int AS notes,
           (SELECT count(*) FROM leads WHERE converted_customer_id IS NULL)::int AS new_contacts`
      ).then((r) => r.rows[0]),
    ]);
    res.json({ open, recent, gaps, counts });
  } catch (err) {
    next(err);
  }
};
