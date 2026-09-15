const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('../../db');
const { fail } = require('../validate');
const { invalidateSchemaCache } = require('../tables');
const { appliedMigrations } = require('../../db/migrate');

/**
 * Backups and restore.
 *
 * A backup is every business table's rows as compressed JSON, with the schema
 * version it came from. JSON rather than a SQL script so that restoring never
 * executes text from a file: rows go back in through parameterised inserts, in
 * foreign-key order, inside one transaction - it all lands or none of it does -
 * with the triggers' side effects switched off so history is loaded exactly as
 * it was saved. A copy of the current data is taken automatically first.
 *
 * On the embedded database, a backup is also taken once a day (the last 14 are
 * kept). For moving to a hosted PostgreSQL there is a plain SQL export too.
 */

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', '..', 'backups');
const FORMAT = 'docdesk-backup';
const FORMAT_VERSION = 1;
const KEEP_AUTOMATIC = 14;

// Parents before children, so every foreign key already has its target.
const TABLE_ORDER = [
  'settings', 'users', 'categories', 'suppliers', 'customers', 'products', 'sales', 'sale_items',
  'payments', 'purchase_orders', 'purchase_order_items', 'stock_movements', 'message_log', 'files', 'audit_log',
];
const REFERENCE_SEQUENCES = [
  ['sale_number_seq', 'sales', '^S-(\\d+)$'],
  ['purchase_order_number_seq', 'purchase_orders', '^PO-(\\d+)$'],
];
const SAFE_TYPES = /^(text|integer|bigint|smallint|boolean|date|numeric(\(\d+,\s*\d+\))?|timestamp with time zone|timestamp without time zone|double precision|real|jsonb?|character varying(\(\d+\))?)$/;

fs.mkdirSync(BACKUP_DIR, { recursive: true });

function stamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function schemaVersion() {
  const migrations = await appliedMigrations();
  return migrations.length ? migrations[migrations.length - 1].version : '000';
}

async function tableColumns(table) {
  const { rows } = await db.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attgenerated <> '' AS generated
       FROM pg_attribute a
      WHERE a.attrelid = ('public.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [table]
  );
  return rows;
}

function encodeValue(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Reads everything into a backup document. One read-only transaction, so it is a consistent snapshot. */
async function snapshot({ reason = 'manual' } = {}) {
  const version = await schemaVersion();
  const tables = {};
  await db.transaction(
    async (tx) => {
      for (const table of TABLE_ORDER) {
        const columns = (await tableColumns(table)).filter((c) => !c.generated);
        const names = columns.map((c) => `"${c.name}"`).join(', ');
        const order = columns.some((c) => c.name === 'id') ? ' ORDER BY id' : '';
        const { rows } = await tx.query(`SELECT ${names} FROM "${table}"${order}`, [], { rowMode: 'array' });
        tables[table] = { columns: columns.map((c) => ({ name: c.name, type: c.type })), rows: rows.map((r) => r.map(encodeValue)) };
      }
    },
    { readOnly: true, actor: 'backup' }
  );
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    schemaVersion: version,
    createdAt: new Date().toISOString(),
    reason,
    engine: db.describe().engine,
    counts: Object.fromEntries(Object.entries(tables).map(([t, v]) => [t, v.rows.length])),
    tables,
  };
}

async function createBackup({ reason = 'manual' } = {}) {
  const document = await snapshot({ reason });
  const name = `docdesk-${reason === 'automatic' ? 'auto' : reason === 'before-restore' ? 'pre-restore' : 'backup'}-${stamp()}.json.gz`;
  const file = path.join(BACKUP_DIR, name);
  const body = zlib.gzipSync(Buffer.from(JSON.stringify(document)), { level: 9 });
  fs.writeFileSync(file, body);
  if (reason === 'automatic') pruneAutomatic();
  return describeFile(name);
}

function describeFile(name) {
  const stat = fs.statSync(path.join(BACKUP_DIR, name));
  const kind = name.includes('-auto-') ? 'automatic' : name.includes('-pre-restore-') ? 'before restore' : 'manual';
  return { name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString(), kind };
}

function listBackups() {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => /^docdesk-[a-z-]+-[\dT-]+\.json\.gz$/.test(name))
    .map(describeFile)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneAutomatic() {
  const automatic = listBackups().filter((b) => b.kind === 'automatic');
  for (const old of automatic.slice(KEEP_AUTOMATIC)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
}

function backupPath(name) {
  if (!/^docdesk-[a-z-]+-[\dT-]+\.json\.gz$/.test(String(name))) throw fail('Not a backup file name', 400);
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) throw fail('That backup no longer exists', 404);
  return file;
}

function deleteBackup(name) {
  fs.rmSync(backupPath(name), { force: true });
}

function parseBackup(buffer) {
  let text;
  try {
    text = buffer[0] === 0x1f && buffer[1] === 0x8b ? zlib.gunzipSync(buffer).toString('utf8') : buffer.toString('utf8');
  } catch {
    throw fail('That file could not be decompressed. Choose a DocDesk backup (.json.gz).');
  }
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw fail("That isn't a DocDesk backup - it isn't valid JSON.");
  }
  if (document?.format !== FORMAT || typeof document.tables !== 'object') throw fail("That isn't a DocDesk backup.");
  if (Number(document.formatVersion) > FORMAT_VERSION) throw fail('That backup was made by a newer version of DocDesk. Update DocDesk first.');
  return document;
}

/**
 * Replaces all business data with the backup's. Refuses a backup from a newer
 * schema; an older one restores fine because migrations only ever add.
 */
async function restore(buffer) {
  const document = parseBackup(buffer);
  const current = await schemaVersion();
  if (String(document.schemaVersion) > String(current)) {
    throw fail(`That backup comes from a newer database version (${document.schemaVersion}). Update DocDesk before restoring it.`);
  }

  const safety = await createBackup({ reason: 'before-restore' });
  const started = Date.now();
  const restored = {};

  await db.transaction(
    async (tx) => {
      await tx.query(`TRUNCATE ${TABLE_ORDER.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

      for (const table of TABLE_ORDER) {
        const data = document.tables[table];
        if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) {
          restored[table] = 0;
          continue;
        }
        const existing = await tableColumns(table);
        const writable = new Map(existing.filter((c) => !c.generated).map((c) => [c.name, c]));

        // Columns someone had added (e.g. "expiry date") come back too.
        for (const column of data.columns) {
          if (writable.has(column.name) || existing.some((c) => c.name === column.name)) continue;
          if (!/^[a-z][a-z0-9_]{0,40}$/.test(column.name) || !SAFE_TYPES.test(column.type)) continue;
          await tx.query(`ALTER TABLE "${table}" ADD COLUMN "${column.name}" ${column.type}`);
          writable.set(column.name, column);
        }

        const indexes = data.columns.map((c, i) => [c.name, i, c.type]).filter(([name]) => writable.has(name));
        if (!indexes.length || !data.rows.length) {
          restored[table] = 0;
          continue;
        }
        const names = indexes.map(([name]) => `"${name}"`).join(', ');
        // Keep each statement well under PostgreSQL's 65,535 parameter limit.
        const batch = Math.max(1, Math.floor(20_000 / indexes.length));
        for (let offset = 0; offset < data.rows.length; offset += batch) {
          const chunk = data.rows.slice(offset, offset + batch);
          const params = [];
          const tuples = chunk.map((row) => {
            const placeholders = indexes.map(([, i, type]) => {
              const value = row[i];
              // Postgres arrays go in as arrays; JSON documents as JSON text.
              const isArrayColumn = /\[\]$/.test(String(type || ''));
              params.push(value !== null && typeof value === 'object' && !(isArrayColumn && Array.isArray(value)) ? JSON.stringify(value) : value);
              return `$${params.length}`;
            });
            return `(${placeholders.join(', ')})`;
          });
          await tx.query(`INSERT INTO "${table}" (${names}) OVERRIDING SYSTEM VALUE VALUES ${tuples.join(', ')}`, params);
        }
        restored[table] = data.rows.length;
      }

      for (const table of TABLE_ORDER) {
        const hasIdentity = (await tableColumns(table)).some((c) => c.name === 'id');
        if (!hasIdentity) continue;
        await tx.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM "${table}"), 1), (SELECT count(*) > 0 FROM "${table}"))`,
          [table]
        );
      }
      for (const [sequence, table, pattern] of REFERENCE_SEQUENCES) {
        await tx.query(
          `SELECT setval($1::regclass, GREATEST(1001, COALESCE((SELECT max(substring(reference FROM $2)::bigint) FROM "${table}"), 1000) + 1), false)`,
          [sequence, pattern]
        );
      }
    },
    { actor: 'restore', settings: { 'docdesk.restoring': 'on' } }
  );

  invalidateSchemaCache();
  return { restored, safetyBackup: safety.name, durationMs: Date.now() - started, backupCreatedAt: document.createdAt };
}

function sqlLiteral(value, type) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (Array.isArray(value) && /\[\]$/.test(type)) {
    return `ARRAY[${value.map((v) => sqlLiteral(v, type.replace(/\[\]$/, ''))).join(', ')}]::${type}`;
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/**
 * A plain SQL data export - INSERT statements in dependency order - for loading
 * into another PostgreSQL with psql (e.g. moving to a hosted database). Start
 * DocDesk against the new database once first so its schema exists.
 */
async function sqlDump() {
  const document = await snapshot({ reason: 'export' });
  const lines = [
    `-- DocDesk data export`,
    `-- Created ${document.createdAt} from ${document.engine}, schema version ${document.schemaVersion}`,
    `-- Load into a database DocDesk has already set up (its migrations create the schema):`,
    `--   psql "$DATABASE_URL" -f this-file.sql`,
    '',
    'BEGIN;',
    "SELECT set_config('docdesk.restoring', 'on', true);",
    `TRUNCATE ${TABLE_ORDER.join(', ')} RESTART IDENTITY CASCADE;`,
    '',
  ];
  for (const table of TABLE_ORDER) {
    const data = document.tables[table];
    if (!data.rows.length) continue;
    const columns = data.columns.map((c) => c.name);
    lines.push(`-- ${table}: ${data.rows.length} row${data.rows.length === 1 ? '' : 's'}`);
    for (let offset = 0; offset < data.rows.length; offset += 200) {
      const chunk = data.rows.slice(offset, offset + 200);
      lines.push(`INSERT INTO ${table} (${columns.join(', ')}) OVERRIDING SYSTEM VALUE VALUES`);
      lines.push(chunk.map((row) => `  (${row.map((value, i) => sqlLiteral(value, data.columns[i].type)).join(', ')})`).join(',\n') + ';');
    }
    if (columns.includes('id')) {
      lines.push(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM ${table}), 1));`);
    }
    lines.push('');
  }
  for (const [sequence, table, pattern] of REFERENCE_SEQUENCES) {
    lines.push(`SELECT setval('${sequence}', GREATEST(1001, COALESCE((SELECT max(substring(reference FROM '${pattern}')::bigint) FROM ${table}), 1000) + 1), false);`);
  }
  lines.push('COMMIT;', '');
  return lines.join('\n');
}

let timer = null;

/** Once a day on the embedded database (AUTO_BACKUP=off to disable). */
function scheduleBackups() {
  if (timer || process.env.AUTO_BACKUP === 'off' || (db.mode !== 'embedded' && process.env.AUTO_BACKUP !== 'on')) return;
  const tick = async () => {
    try {
      const last = listBackups().find((b) => b.kind === 'automatic');
      if (last && Date.now() - Date.parse(last.createdAt) < 23 * 3_600_000) return;
      const { rows } = await db.query('SELECT (SELECT count(*) FROM products) + (SELECT count(*) FROM sales) AS n');
      if (Number(rows[0].n) === 0) return; // nothing worth keeping yet
      const backup = await createBackup({ reason: 'automatic' });
      console.log(`[backup] daily backup written: ${backup.name}`);
    } catch (err) {
      console.warn(`[backup] daily backup failed: ${err.message}`);
    }
  };
  setTimeout(tick, 60_000).unref();
  timer = setInterval(tick, 3_600_000);
  timer.unref();
}

module.exports = { createBackup, listBackups, deleteBackup, backupPath, restore, sqlDump, scheduleBackups, BACKUP_DIR };
