const multer = require('multer');
const db = require('../db');
const catalog = require('../lib/dbconsole/catalog');
const sqlRunner = require('../lib/dbconsole/sqlRunner');
const integrity = require('../lib/dbconsole/integrity');
const backup = require('../lib/dbconsole/backup');
const monitor = require('../db/monitor');
const { listRows, readListQuery, invalidateSchemaCache } = require('../lib/tables');
const { fail, text } = require('../lib/validate');

/**
 * The Database page's API: overview, schema browser, ER diagram, SQL console,
 * query plans, activity log, performance, integrity checks, backups.
 *
 * Operations that can change or replace data (running changes in the console,
 * restoring a backup, maintenance) are on by default for the embedded database
 * on this computer, and off for a hosted database unless DB_ADMIN=on - a
 * deployed DocDesk has no sign-in yet, so it should not offer them to anyone
 * who finds the address.
 */
function adminEnabled() {
  if (process.env.DB_ADMIN === 'on') return true;
  if (process.env.DB_ADMIN === 'off') return false;
  return db.mode === 'embedded';
}

function requireAdmin() {
  if (!adminEnabled()) {
    throw fail('Changing the database from here is switched off for this installation (set DB_ADMIN=on to allow it).', 403);
  }
}

const restoreUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024, files: 1 },
});

const wrap = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (err) {
    next(err);
  }
};

exports.capabilities = () => ({
  admin: adminEnabled(),
  mode: db.mode,
  maxRows: sqlRunner.MAX_ROWS,
  timeoutMs: sqlRunner.TIMEOUT_MS,
});

exports.overview = wrap(async (req, res) => {
  const data = await catalog.overview();
  res.json({ ...data, capabilities: exports.capabilities(), performance: monitor.snapshot() });
});

exports.tables = wrap(async (req, res) => {
  res.json(await catalog.tableSummaries());
});

exports.table = wrap(async (req, res) => {
  res.json(await catalog.tableDetail(req.params.name));
});

exports.rows = wrap(async (req, res) => {
  res.json(await catalog.browse(req.params.name, req.query));
});

exports.row = wrap(async (req, res) => {
  res.json(await catalog.inspectRow(req.params.name, req.params.id));
});

exports.tableStats = wrap(async (req, res) => {
  res.json(await catalog.tableStats());
});

// --- The console's saved queries -------------------------------------------
//
// Reading the library is always allowed; adding to it is a change to the
// database, so it follows the same admin switch as everything else.

exports.savedQueries = wrap(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, description, sql, pinned, run_count, last_run_at, created_at, updated_at
       FROM saved_queries ORDER BY pinned DESC, last_run_at DESC NULLS LAST, name`
  );
  res.json({ queries: rows.map((r) => ({ ...r, runCount: Number(r.run_count) })), admin: adminEnabled() });
});

function readQuery(body = {}) {
  const name = text(body.name, 'Name', { required: true, max: 120 });
  const sql = String(body.sql || '').trim();
  if (!sql) throw fail('There is no query to save.');
  if (sql.length > 20000) throw fail('That query is too long to save.');
  return { name, sql, description: text(body.description, 'Description', { max: 500 }), pinned: Boolean(body.pinned) };
}

exports.saveQuery = wrap(async (req, res) => {
  requireAdmin();
  const { name, sql, description, pinned } = readQuery(req.body);
  const { rows } = await db.query(
    `INSERT INTO saved_queries (name, description, sql, pinned) VALUES ($1, $2, $3, $4)
     ON CONFLICT (lower(btrim(name))) DO UPDATE
       SET description = EXCLUDED.description, sql = EXCLUDED.sql, pinned = EXCLUDED.pinned
     RETURNING id, name, description, sql, pinned, run_count, last_run_at`,
    [name, description, sql, pinned]
  );
  res.status(201).json(rows[0]);
});

exports.updateQuery = wrap(async (req, res) => {
  requireAdmin();
  const body = req.body || {};
  // Marking a query as run is the common case and needs no other fields.
  if (body.ran) {
    const { rows } = await db.query(
      'UPDATE saved_queries SET run_count = run_count + 1, last_run_at = now() WHERE id = $1 RETURNING id, run_count, last_run_at',
      [req.params.id]
    );
    if (!rows.length) throw fail('That saved query no longer exists.', 404);
    return res.json(rows[0]);
  }
  const { name, sql, description, pinned } = readQuery(body);
  const { rows } = await db.query(
    'UPDATE saved_queries SET name = $2, description = $3, sql = $4, pinned = $5 WHERE id = $1 RETURNING *',
    [req.params.id, name, description, sql, pinned]
  );
  if (!rows.length) throw fail('That saved query no longer exists.', 404);
  res.json(rows[0]);
});

exports.deleteQuery = wrap(async (req, res) => {
  requireAdmin();
  const { rowCount } = await db.query('DELETE FROM saved_queries WHERE id = $1', [req.params.id]);
  if (!rowCount) throw fail('That saved query no longer exists.', 404);
  res.json({ ok: true });
});

exports.relationships = wrap(async (req, res) => {
  res.json(await catalog.relationships());
});

exports.routines = wrap(async (req, res) => {
  res.json(await catalog.routines());
});

exports.samples = wrap(async (req, res) => {
  res.json(sqlRunner.SAMPLES);
});

exports.query = wrap(async (req, res) => {
  const allowWrite = Boolean(req.body?.allowWrite);
  if (allowWrite) requireAdmin();
  const result = await db.runAs('sql-console', () => sqlRunner.run(req.body?.sql, { allowWrite }));
  res.json(result);
});

exports.explain = wrap(async (req, res) => {
  const allowWrite = Boolean(req.body?.allowWrite);
  if (allowWrite) requireAdmin();
  res.json(await sqlRunner.explain(req.body?.sql, { analyze: req.body?.analyze !== false, allowWrite }));
});

// The audit trail, newest first, filterable by table, action and who did it.
exports.activity = wrap(async (req, res) => {
  const { table, action, actor, record_id } = req.query;
  const where = {};
  if (table) where.table_name = table;
  if (action) where.action = String(action).toUpperCase();
  if (actor) where.actor = actor;
  if (record_id) where.record_id = record_id;
  const result = await listRows('audit_log', { ...readListQuery(req.query), where });
  const { rows: actors } = await db.query('SELECT actor, count(*) AS n FROM audit_log GROUP BY actor ORDER BY n DESC');
  const { rows: tables } = await db.query('SELECT table_name, count(*) AS n FROM audit_log GROUP BY table_name ORDER BY table_name');
  res.json({ ...result, facets: { actors, tables } });
});

// Everything that ever happened to one record.
exports.history = wrap(async (req, res) => {
  const { table, id } = req.params;
  if (!/^[a-z_]+$/.test(table)) throw fail('Unknown table', 400);
  const { rows } = await db.query(
    `SELECT id, action, actor, changed_fields, old_data, new_data, created_at
       FROM audit_log WHERE table_name = $1 AND record_id = $2
      ORDER BY created_at DESC, id DESC LIMIT 200`,
    [table, id]
  );
  res.json(rows);
});

exports.performance = wrap(async (req, res) => {
  const { rows } = await db.query(`
    SELECT xact_commit, xact_rollback, blks_read, blks_hit, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted, deadlocks,
           CASE WHEN blks_hit + blks_read > 0 THEN round(100.0 * blks_hit / (blks_hit + blks_read), 2) END AS cache_hit_percent
      FROM pg_stat_database WHERE datname = current_database()`);
  const { rows: indexUsage } = await db.query(`
    SELECT s.relname AS table_name, s.indexrelname AS index_name, s.idx_scan AS scans, pg_relation_size(s.indexrelid) AS size_bytes
      FROM pg_stat_user_indexes s ORDER BY s.idx_scan DESC, s.relname LIMIT 40`);
  res.json({ engine: db.describe(), queries: monitor.snapshot(), database: rows[0] || null, indexUsage });
});

exports.integrity = wrap(async (req, res) => {
  res.json(await integrity.runChecks());
});

exports.fix = wrap(async (req, res) => {
  requireAdmin();
  res.json(await integrity.fixCheck(req.params.id));
});

exports.backups = wrap(async (req, res) => {
  res.json({ backups: backup.listBackups(), directory: backup.BACKUP_DIR, admin: adminEnabled() });
});

exports.createBackup = wrap(async (req, res) => {
  res.status(201).json(await backup.createBackup({ reason: 'manual' }));
});

exports.downloadBackup = wrap(async (req, res) => {
  const file = backup.backupPath(req.params.name);
  res.download(file, req.params.name);
});

exports.deleteBackup = wrap(async (req, res) => {
  requireAdmin();
  backup.deleteBackup(req.params.name);
  res.json({ ok: true });
});

exports.restore = [
  restoreUpload.single('file'),
  wrap(async (req, res) => {
    requireAdmin();
    if (String(req.body?.confirm || '').trim().toUpperCase() !== 'RESTORE') {
      throw fail('Type RESTORE to confirm - restoring replaces all current data.', 400);
    }
    let buffer;
    if (req.file) buffer = req.file.buffer;
    else if (req.body?.name) buffer = require('fs').readFileSync(backup.backupPath(req.body.name));
    else throw fail('Choose a backup file to restore.');
    const result = await backup.restore(buffer);
    res.json({ ok: true, ...result });
  }),
];

exports.exportSql = wrap(async (req, res) => {
  const sql = await backup.sqlDump();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/sql; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="docdesk-data-${stamp}.sql"`);
  res.send(sql);
});

exports.maintenance = wrap(async (req, res) => {
  requireAdmin();
  const action = String(req.body?.action || '');
  const started = Date.now();
  let detail;
  if (action === 'analyze') {
    await db.query('ANALYZE');
    detail = 'Planner statistics refreshed for every table.';
  } else if (action === 'vacuum') {
    await db.query('VACUUM (ANALYZE)');
    detail = 'Dead rows cleaned up and statistics refreshed.';
  } else if (action === 'prune_activity') {
    const days = Math.min(Math.max(Number(req.body?.days) || 180, 7), 3650);
    const { rowCount } = await db.query(`DELETE FROM audit_log WHERE created_at < now() - make_interval(days => $1)`, [days]);
    detail = `Removed ${rowCount} activity entr${rowCount === 1 ? 'y' : 'ies'} older than ${days} days.`;
  } else {
    throw fail('Unknown maintenance action');
  }
  invalidateSchemaCache();
  res.json({ ok: true, action, detail, durationMs: Date.now() - started });
});
