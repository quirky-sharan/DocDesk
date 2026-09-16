const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail, text, oneOf } = require('../lib/validate');
const { sendQueued, queueMessage } = require('../lib/messaging');

exports.list = async (req, res, next) => {
  try {
    const { status } = req.query;
    res.json(
      await listRows('message_log', {
        ...readListQuery(req.query),
        where: status ? { status } : {},
      })
    );
  } catch (err) {
    next(err);
  }
};

// Runs the mock sender. Nothing leaves the machine - it flips queued rows to
// sent and logs what would have gone out. See REQUIREMENTS.md for the real
// provider, which lands in Phase 6.
exports.send = async (req, res, next) => {
  try {
    const sent = await sendQueued({ limit: 100 });
    res.json({
      ok: true,
      sent: sent.length,
      simulated: true,
      note: 'Sending is mocked until a provider is configured in Phase 6.',
    });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT id FROM message_log WHERE id = $1', [req.params.id]);
    if (!rows.length) throw fail('Message not found', 404);
    await db.query('DELETE FROM message_log WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// Queues a message the front desk took. It goes into the same message_log the
// rest of DocDesk uses rather than a second table, so one page shows everything
// waiting to go out and sendQueued() picks it up with the rest.
exports.create = async (req, res, next) => {
  try {
    const message = await queueMessage(null, {
      channel: oneOf(req.body?.channel, 'Channel', ['email', 'sms', 'call', 'note'], { fallback: 'note' }),
      recipient: text(req.body?.recipient, 'Contact', { max: 150 }),
      subject: text(req.body?.subject, 'Subject', { max: 200 }),
      body: text(req.body?.body, 'Message', { required: true, max: 4000 }),
      triggerType: text(req.body?.trigger_type, 'Kind', { max: 60 }) || 'reception_message',
      relatedType: text(req.body?.related_type, 'Related to', { max: 40 }),
      relatedId: req.body?.related_id ? Number(req.body.related_id) : null,
    });
    res.status(201).json(message);
  } catch (err) {
    next(err);
  }
};
