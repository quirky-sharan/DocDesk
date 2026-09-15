const { runTurn, confirmAction, cancelAction } = require('../lib/assistant/agent');
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
