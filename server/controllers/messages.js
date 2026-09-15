const db = require('../db');
const { listRows } = require('../lib/tables');
const { fail } = require('../lib/validate');
const { sendQueued } = require('../lib/messaging');

exports.list = async (req, res, next) => {
  try {
    const { search, sort, dir, limit, offset, status } = req.query;
    const result = await listRows('message_log', {
      search,
      sort,
      dir,
      limit,
      offset,
      where: status ? { status } : {},
    });
    res.json(result);
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
