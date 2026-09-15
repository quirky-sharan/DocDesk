const fs = require('fs');
const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail, text, id } = require('../lib/validate');
const { resolveStoredPath, deleteStored, MAX_FILE_BYTES, ALLOWED_LABEL } = require('../lib/storage');

const ATTACHABLE = ['product', 'sale', 'customer', 'supplier', 'purchase_order'];

// Previewing in the browser is only safe for types the browser renders inertly.
// Everything else downloads, so an uploaded document can never execute in the
// app's origin.
const INLINE_SAFE = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain',
]);

async function findOrFail(fileId) {
  const { rows } = await db.query('SELECT * FROM files WHERE id = $1', [fileId]);
  if (!rows.length) throw fail('File not found', 404);
  return rows[0];
}

exports.list = async (req, res, next) => {
  try {
    const { related_type, related_id, kind } = req.query;
    const where = {};
    if (related_type) where.related_type = related_type;
    if (related_id) where.related_id = related_id;

    // Broad type buckets, so the UI can offer "images" without listing MIME types.
    const KIND_FILTERS = {
      image: "t.mime_type LIKE 'image/%'",
      pdf: "t.mime_type = 'application/pdf'",
      document: "t.mime_type LIKE 'application/vnd%' OR t.mime_type = 'application/msword'",
      data: "t.mime_type IN ('text/csv', 'application/json', 'text/plain')",
    };

    res.json(
      await listRows('files', {
        ...readListQuery(req.query),
        where,
        extraConditions: KIND_FILTERS[kind] ? [`(${KIND_FILTERS[kind]})`] : [],
      })
    );
  } catch (err) {
    next(err);
  }
};

exports.upload = async (req, res, next) => {
  try {
    const uploaded = req.files || [];
    if (!uploaded.length) {
      throw fail(`Choose at least one file to upload. Allowed: ${ALLOWED_LABEL}.`);
    }

    const relatedType = req.body.related_type
      ? text(req.body.related_type, 'Attached to', { max: 40 })
      : null;
    if (relatedType && !ATTACHABLE.includes(relatedType)) {
      throw fail(`Files can only be attached to: ${ATTACHABLE.join(', ')}`);
    }
    const relatedId = relatedType ? id(req.body.related_id, 'Attached record') : null;
    const description = text(req.body.description, 'Description', { max: 500 });

    const saved = [];
    for (const file of uploaded) {
      const { rows } = await db.query(
        `INSERT INTO files (stored_name, original_name, mime_type, size_bytes, description, related_type, related_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [file.filename, file.originalname, file.mimetype, file.size, description, relatedType, relatedId]
      );
      saved.push(rows[0]);
    }

    res.status(201).json({ ok: true, files: saved });
  } catch (err) {
    // The bytes are already on disk by the time this runs, so clean them up
    // rather than leaving orphans with no database row.
    for (const file of req.files || []) {
      await deleteStored(file.filename).catch(() => {});
    }
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await findOrFail(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    await findOrFail(req.params.id);
    const description = text(req.body.description, 'Description', { max: 500 });
    const { rows } = await db.query(
      'UPDATE files SET description = $1 WHERE id = $2 RETURNING *',
      [description, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

/** Streams the file. ?download=1 forces a save instead of a preview. */
exports.download = async (req, res, next) => {
  try {
    const file = await findOrFail(req.params.id);
    const fullPath = resolveStoredPath(file.stored_name);

    if (!fs.existsSync(fullPath)) {
      throw fail('That file is recorded but missing from disk. It may have been deleted outside DocDesk.', 410);
    }

    const inline = INLINE_SAFE.has(file.mime_type) && req.query.download !== '1';
    res.setHeader('Content-Type', file.mime_type);
    res.setHeader('Content-Length', file.size_bytes);
    // Quotes are escaped so a filename containing one cannot break the header.
    const safeName = file.original_name.replace(/"/g, "'");
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`);
    // Uploaded content is user-supplied; stop the browser guessing a different
    // type than we declared, and sandbox anything it does render.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");

    fs.createReadStream(fullPath).pipe(res);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const file = await findOrFail(req.params.id);
    await deleteStored(file.stored_name);
    await db.query('DELETE FROM files WHERE id = $1', [file.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

exports.info = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS bytes FROM files'
    );
    res.json({
      count: Number(rows[0].count),
      totalBytes: Number(rows[0].bytes),
      maxFileBytes: MAX_FILE_BYTES,
      allowed: ALLOWED_LABEL,
      attachableTo: ATTACHABLE,
    });
  } catch (err) {
    next(err);
  }
};
