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
  resolveStoredPath, deleteStored,
};
