const crypto = require('crypto');
const multer = require('multer');
const { translate } = require('../lib/dbErrors');
const { pathOnly } = require('../lib/redact');

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

  // Anything given a status was raised on purpose and its message was written
  // for the person reading it. Anything else is a fault nobody anticipated,
  // and its message was written for a developer: it can name a file, a table
  // or a line of SQL. That goes to the log, under a reference the person can
  // quote, and the reply says only that something went wrong.
  const expected = Boolean(database || err.status || err.statusCode);
  const reference = expected ? null : crypto.randomBytes(4).toString('hex');
  const message = expected
    ? database?.message || err.message || 'That did not work.'
    : `Something went wrong on our side. If it keeps happening, quote reference ${reference}.`;

  // A 4xx is an expected, handled outcome - log it as one line. Only a 5xx is
  // an actual fault worth a stack trace. Either way the query string is left
  // out: it is where search text, names and phone numbers travel.
  if (status >= 500) {
    console.error(`${status} ${req.method} ${pathOnly(req.originalUrl)}${reference ? ` [${reference}]` : ''}`);
    console.error(err);
  } else {
    console.warn(`${status} ${req.method} ${pathOnly(req.originalUrl)} - ${message}`);
  }

  const body = { error: message };
  // Lets the app tell "signed out" from "not allowed" from "slow down" without
  // reading the sentence.
  if (err.kind) body.code = err.kind;
  if (reference) body.reference = reference;
  if (err.conflict) body.conflict = err.conflict;
  if (database?.position) body.position = database.position;
  res.status(status).json(body);
}

module.exports = errorHandler;
