const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Allow-list rather than a block-list: anything not named here is refused.
// Deliberately excludes executables, scripts and archives - this is a document
// and image store, not general file hosting.
const ALLOWED = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

const ALLOWED_LABEL = 'images, PDFs, Office documents, and plain text or CSV files';

function extensionFor(file) {
  const fromMime = ALLOWED[file.mimetype];
  if (fromMime) return fromMime;
  return path.extname(file.originalname || '').toLowerCase() || '';
}

/**
 * Names on disk are generated, never derived from what the user uploaded, so a
 * crafted filename cannot escape the upload directory or overwrite anything.
 * The original name is kept in the database for display only.
 */
function generateStoredName(file) {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extensionFor(file)}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, generateStoredName(file)),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 10 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    const err = new Error(
      `${file.originalname} is a type DocDesk can't store. Allowed: ${ALLOWED_LABEL}.`
    );
    err.status = 400;
    cb(err);
  },
});

/**
 * Uploader for the spreadsheet importer.
 *
 * Browsers disagree wildly about what a .csv is - text/csv, application/vnd.ms-excel
 * and application/octet-stream are all common depending on OS and whether Excel
 * is installed - so this one trusts the extension instead. That is safe here in
 * a way it would not be for the general file store: the importer only ever
 * reads the bytes as text and deletes the file before it responds.
 */
const importUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, generateStoredName({ ...file, mimetype: 'text/csv' })),
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) return cb(null, true);
    const err = new Error('Please choose a .csv file. Export one from Excel or Google Sheets first.');
    err.status = 400;
    cb(err);
  },
});

// --- checking that a file is what it says it is ------------------------------
//
// The type an upload arrives with is whatever the sender typed: it is a label,
// not a fact. So the allow-list above decides which labels are acceptable, and
// this decides whether the bytes agree with the label - by the "magic number"
// each format starts with. Something renamed to invoice.pdf that is not a PDF
// is turned away here, before a row is written for it.

const startsWith = (head, bytes, offset = 0) => bytes.every((byte, i) => head[offset + i] === byte);
const ZIP = [0x50, 0x4b]; // docx, xlsx and pptx are zip archives
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // doc, xls, ppt

// Text has no signature, so it is recognised by what it is not: it has no NUL
// bytes (every binary format does, early) and does not open like a program.
function looksLikeText(head) {
  if (head.includes(0)) return false;
  const opening = head.subarray(0, 4);
  return !startsWith(opening, [0x4d, 0x5a]) && !startsWith(opening, [0x7f, 0x45, 0x4c, 0x46]) && !startsWith(opening, ZIP);
}

const SIGNATURES = {
  'image/jpeg': (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  'image/png': (head) => startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/gif': (head) => ['GIF87a', 'GIF89a'].includes(head.toString('latin1', 0, 6)),
  'image/webp': (head) => head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP',
  'image/svg+xml': (head) => looksLikeText(head) && /<svg[\s>]/i.test(head.toString('utf8')),
  // Readers accept a little junk before the marker, so this does too.
  'application/pdf': (head) => head.subarray(0, 1024).includes('%PDF-'),
  'text/plain': looksLikeText,
  'text/csv': looksLikeText,
  'application/json': looksLikeText,
  'application/msword': (head) => startsWith(head, OLE),
  'application/vnd.ms-excel': (head) => startsWith(head, OLE),
  'application/vnd.ms-powerpoint': (head) => startsWith(head, OLE),
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (head) => startsWith(head, ZIP),
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (head) => startsWith(head, ZIP),
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': (head) => startsWith(head, ZIP),
};

async function readHead(filePath, length = 8192) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** What to keep of the name somebody's file arrived with: it is shown, never used as a path. */
function cleanOriginalName(name) {
  const cleaned = String(name || '')
    // Whatever folder it sat in on their machine is not part of its name.
    .replace(/^.*[\\/]/, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'file';
}

function uploadsOf(req) {
  return req.files || (req.file ? [req.file] : []);
}

function checkUploads(matches, describe) {
  return async (req, res, next) => {
    const uploaded = uploadsOf(req);
    try {
      for (const file of uploaded) {
        file.originalname = cleanOriginalName(file.originalname);
        if (!file.size) {
          const err = new Error(`${file.originalname} is empty.`);
          err.status = 400;
          throw err;
        }
        if (!matches(file, await readHead(file.path))) {
          const err = new Error(describe(file));
          err.status = 400;
          throw err;
        }
      }
      next();
    } catch (err) {
      // Nothing from a refused upload is left behind, including the files in
      // the same batch that were fine.
      for (const file of uploaded) await deleteStored(file.filename).catch(() => {});
      next(err);
    }
  };
}

const verifyUploads = checkUploads(
  (file, head) => Boolean(SIGNATURES[file.mimetype]?.(head)),
  (file) => `${file.originalname} is not what its name says it is, so it was not stored. Allowed: ${ALLOWED_LABEL}.`
);

// The importer goes by extension (see above), so the only question is whether
// the file is text at all.
const verifyTextUpload = checkUploads(
  (file, head) => looksLikeText(head),
  () => 'That file is not a CSV. Export one from Excel or Google Sheets (Save as → CSV) and try again.'
);

/**
 * A Content-Disposition header for a name a person chose. The plain filename
 * is ASCII only, because a header may not carry anything else; the real name
 * rides alongside in the encoded form browsers prefer when it is there.
 */
function contentDisposition(kind, name) {
  const clean = cleanOriginalName(name);
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Resolves a stored name to a path, refusing anything that escapes UPLOAD_DIR. */
function resolveStoredPath(storedName) {
  const full = path.resolve(UPLOAD_DIR, storedName);
  const root = path.resolve(UPLOAD_DIR);
  // Defence in depth: stored names are generated, but this is the boundary
  // where a database value becomes a filesystem path.
  if (full !== root && !full.startsWith(root + path.sep)) {
    const err = new Error('Invalid file path');
    err.status = 400;
    throw err;
  }
  return full;
}

async function deleteStored(storedName) {
  try {
    await fs.promises.unlink(resolveStoredPath(storedName));
  } catch (err) {
    // Already gone is fine - the database row is what we actually care about.
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  upload, importUpload, UPLOAD_DIR, MAX_FILE_BYTES, ALLOWED, ALLOWED_LABEL,
  resolveStoredPath, deleteStored, verifyUploads, verifyTextUpload, contentDisposition, cleanOriginalName,
  SIGNATURES, looksLikeText,
};
