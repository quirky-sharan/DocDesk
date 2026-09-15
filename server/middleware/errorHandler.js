const multer = require('multer');
const { translate } = require('../lib/dbErrors');

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'That file is too large.',
  LIMIT_FILE_COUNT: 'Too many files at once.',
  LIMIT_UNEXPECTED_FILE: 'Unexpected file field.',
};

/**
 * Global Express error handler. Attached last in index.js.
 */
function errorHandler(err, req, res, next) {
  // Multer throws its own error type before our handlers ever run, so translate
  // it into the same JSON shape and plain wording as everything else.
  if (err instanceof multer.MulterError) {
    const limitMb = Math.round(Number(process.env.MAX_UPLOAD_MB || 25));
    const base = MULTER_MESSAGES[err.code] || 'That upload could not be accepted.';
    const detail = err.code === 'LIMIT_FILE_SIZE' ? ` The limit is ${limitMb} MB per file.` : '';
    return res.status(400).json({ error: base + detail });
  }

  // A rule the database enforced (a constraint, a trigger) becomes a sentence.
  const database = err.status ? null : translate(err);
  const status = database?.status || err.status || err.statusCode || 500;
  const message = database?.message || err.message || 'Internal server error';

  // A 4xx is an expected, handled outcome - log it as one line. Only a 5xx is
  // an actual fault worth a stack trace.
  if (status >= 500) {
    console.error(err);
  } else {
    console.warn(`${status} ${req.method} ${req.originalUrl} - ${message}`);
  }

  const body = { error: message };
  if (err.conflict) body.conflict = err.conflict;
  if (database?.position) body.position = database.position;
  res.status(status).json(body);
}

module.exports = errorHandler;
