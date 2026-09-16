const knowledge = require('../lib/knowledge');
const { regenerate } = require('../lib/knowledge/generate');
const { status: embeddingStatus } = require('../lib/knowledge/embed');
const { text, id, fail } = require('../lib/validate');

/** The knowledge base: what the receptionist is allowed to say. */

exports.list = async (req, res, next) => {
  try {
    res.json({
      items: await knowledge.list(),
      capabilities: await knowledge.capabilities(),
      embeddings: await embeddingStatus(),
    });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    const db = require('../db');
    const documentId = id(req.params.id, 'Document');
    const { rows } = await db.query('SELECT * FROM kb_documents WHERE id = $1', [documentId]);
    if (!rows.length) throw fail('That note is not there', 404);
    const { rows: chunks } = await db.query(
      'SELECT id, ordinal, content, embedding IS NOT NULL AS embedded FROM kb_chunks WHERE document_id = $1 ORDER BY ordinal',
      [documentId]
    );
    res.json({ ...rows[0], chunks });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const saved = await knowledge.save({
      title: text(req.body?.title, 'Title', { required: true, max: 200 }),
      body: text(req.body?.body, 'Text', { required: true, max: 20000 }),
      source: 'manual',
    });
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const db = require('../db');
    const documentId = id(req.params.id, 'Document');
    const { rows } = await db.query('SELECT is_generated FROM kb_documents WHERE id = $1', [documentId]);
    if (!rows.length) throw fail('That note is not there', 404);
    if (rows[0].is_generated) {
      // Editing it would work until the next rebuild wiped it, which is worse
      // than refusing: the change would appear to stick and then vanish.
      throw fail('This one is built from your opening hours and services. Change those and it updates itself.');
    }

    const saved = await knowledge.save({
      id: documentId,
      title: text(req.body?.title, 'Title', { required: true, max: 200 }),
      body: text(req.body?.body, 'Text', { required: true, max: 20000 }),
      source: 'manual',
      isActive: req.body?.is_active === undefined ? true : Boolean(req.body.is_active),
    });
    res.json(saved);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const removed = await knowledge.remove(id(req.params.id, 'Document'));
    if (!removed) throw fail('That note is either not there or is built automatically', 404);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/** What the receptionist would find for a question - the gate, made visible. */
exports.search = async (req, res, next) => {
  try {
    const question = text(req.query.q, 'Question', { required: true, max: 500 });
    const result = await knowledge.retrieve(question);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

/** Questions nobody could answer. The list worth working through. */
exports.gaps = async (req, res, next) => {
  try {
    res.json({ items: await knowledge.gaps({ limit: Number(req.query.limit) || 20 }) });
  } catch (err) {
    next(err);
  }
};

exports.rebuild = async (req, res, next) => {
  try {
    res.json({ ok: true, rebuilt: await regenerate() });
  } catch (err) {
    next(err);
  }
};
