const db = require('../../db');
const { appliedMigrations } = require('../../db/migrate');
const { fail } = require('../validate');

// Everything here reads PostgreSQL's own catalog (pg_class, pg_attribute,
// pg_constraint, pg_index, pg_trigger, pg_proc), so the Database page always
// describes the schema as it really is - including columns people added.

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

// Functions installed by extensions (pg_trgm's dozens) are not ours to show.
const NOT_EXTENSION = (oidColumn) =>
  `NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = ${oidColumn} AND d.deptype = 'e')`;

async function tableNames() {
  const { rows } = await db.query(
    `SELECT c.relname AS name FROM pg_class c
      WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
      ORDER BY c.relname`
  );
  return rows.map((r) => r.name);
}

/** Refuses anything that is not an existing table in the public schema. */
async function assertTableName(name) {
  const tables = await tableNames();
  if (!IDENTIFIER.test(String(name || '')) || !tables.includes(name)) throw fail(`There is no table called "${name}"`, 404);
  return name;
}

async function overview() {
  const [{ rows: [stats] }, migrations, { rows: [activity] }] = await Promise.all([
    db.query(`
      SELECT current_database() AS name,
             pg_database_size(current_database()) AS size_bytes,
             current_setting('server_version') AS version,
             current_setting('server_encoding') AS encoding,
             (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r') AS tables,
             (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v') AS views,
             (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'i' AND ${NOT_EXTENSION('c.oid')}) AS indexes,
             (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
               WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal) AS triggers,
             (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND ${NOT_EXTENSION('p.oid')}) AS functions,
             (SELECT count(*) FROM pg_constraint co WHERE co.connamespace = 'public'::regnamespace AND co.contype IN ('p', 'f', 'u', 'c', 'x')) AS constraints,
             (SELECT count(*) FROM pg_constraint co WHERE co.connamespace = 'public'::regnamespace AND co.contype = 'f') AS foreign_keys,
             (SELECT COALESCE(json_agg(json_build_object('name', extname, 'version', extversion) ORDER BY extname), '[]') FROM pg_extension) AS extensions,
             (SELECT sum(pg_indexes_size(c.oid)) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r') AS index_bytes
    `),
    appliedMigrations(),
    db.query(`
      SELECT (SELECT count(*) FROM audit_log WHERE created_at > now() - interval '24 hours') AS changes_today,
             (SELECT count(*) FROM stock_movements WHERE created_at > now() - interval '24 hours') AS stock_moves_today,
             (SELECT max(created_at) FROM audit_log) AS last_change_at
    `),
  ]);

  const rowCounts = await tableSummaries();
  return {
    engine: db.describe(),
    database: {
      name: stats.name,
      version: stats.version,
      encoding: stats.encoding,
      sizeBytes: Number(stats.size_bytes),
      indexBytes: Number(stats.index_bytes || 0),
    },
    objects: {
      tables: Number(stats.tables),
      views: Number(stats.views),
      indexes: Number(stats.indexes),
      triggers: Number(stats.triggers),
      functions: Number(stats.functions),
      constraints: Number(stats.constraints),
      foreignKeys: Number(stats.foreign_keys),
    },
    extensions: stats.extensions,
    totalRows: rowCounts.reduce((sum, t) => sum + t.rows, 0),
    tables: rowCounts,
    migrations,
    activity: {
      changesToday: Number(activity.changes_today),
      stockMovesToday: Number(activity.stock_moves_today),
      lastChangeAt: activity.last_change_at,
    },
  };
}

/** Every table with exact row count, size on disk and what hangs off it. */
async function tableSummaries() {
  const names = (await tableNames()).filter((n) => IDENTIFIER.test(n));
  if (!names.length) return [];
  const counts = await db.query(`SELECT ${names.map((n) => `(SELECT count(*) FROM "${n}") AS "${n}"`).join(', ')}`);
  const { rows } = await db.query(`
    SELECT c.relname AS name,
           pg_total_relation_size(c.oid) AS total_bytes,
           pg_relation_size(c.oid) AS table_bytes,
           pg_indexes_size(c.oid) AS index_bytes,
           obj_description(c.oid, 'pg_class') AS comment,
           (SELECT count(*) FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
           (SELECT count(*) FROM pg_index ix WHERE ix.indrelid = c.oid) AS indexes,
           (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS triggers,
           (SELECT count(*) FROM pg_constraint co WHERE co.conrelid = c.oid AND co.contype = 'f') AS foreign_keys
      FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     ORDER BY c.relname
  `);
  const exact = counts.rows[0];
  return rows.map((r) => ({
    name: r.name,
    rows: Number(exact[r.name] ?? 0),
    totalBytes: Number(r.total_bytes),
    tableBytes: Number(r.table_bytes),
    indexBytes: Number(r.index_bytes),
    columns: Number(r.columns),
    indexes: Number(r.indexes),
    triggers: Number(r.triggers),
    foreignKeys: Number(r.foreign_keys),
    comment: r.comment,
  }));
}

async function columnsOf(table) {
  const { rows } = await db.query(
    `SELECT a.attnum AS position, a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS expression,
            a.attidentity AS identity, a.attgenerated AS generated,
            col_description(a.attrelid, a.attnum) AS comment,
            EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conrelid = a.attrelid AND co.contype = 'p' AND a.attnum = ANY (co.conkey)) AS primary_key,
            (SELECT fc.relname FROM pg_constraint co JOIN pg_class fc ON fc.oid = co.confrelid
              WHERE co.conrelid = a.attrelid AND co.contype = 'f' AND a.attnum = ANY (co.conkey) LIMIT 1) AS references_table,
            EXISTS (SELECT 1 FROM pg_index ix WHERE ix.indrelid = a.attrelid AND ix.indisunique AND ix.indnkeyatts = 1 AND ix.indkey[0] = a.attnum) AS unique_key
       FROM pg_attribute a
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = ('public.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [table]
  );
  return rows.map((r) => ({
    position: r.position,
    name: r.name,
    type: r.type,
    nullable: r.nullable,
    default: r.generated ? null : r.expression,
    generatedAs: r.generated === 's' ? r.expression : null,
    identity: r.identity === 'a' ? 'always' : r.identity === 'd' ? 'by default' : null,
    comment: r.comment,
    primaryKey: r.primary_key,
    references: r.references_table,
    unique: r.unique_key,
  }));
}

const CONSTRAINT_KIND = { p: 'primary key', f: 'foreign key', u: 'unique', c: 'check', x: 'exclusion', n: 'not null', t: 'trigger' };
const FK_ACTION = { a: 'no action', r: 'restrict', c: 'cascade', n: 'set null', d: 'set default' };

async function tableDetail(name) {
  const table = await assertTableName(name);
  const [columns, constraints, indexes, triggers, referencedBy, summary] = await Promise.all([
    columnsOf(table),
    db.query(
      `SELECT co.conname AS name, co.contype AS kind, pg_get_constraintdef(co.oid) AS definition,
              co.condeferrable AS deferrable, co.condeferred AS deferred, fc.relname AS foreign_table,
              co.confdeltype AS on_delete
         FROM pg_constraint co LEFT JOIN pg_class fc ON fc.oid = co.confrelid
        WHERE co.conrelid = ('public.' || $1)::regclass AND co.contype <> 'n'
        ORDER BY array_position(ARRAY['p', 'f', 'u', 'c', 'x', 't'], co.contype::text), co.conname`,
      [table]
    ),
    db.query(
      `SELECT i.relname AS name, pg_get_indexdef(ix.indexrelid) AS definition, ix.indisunique AS is_unique,
              ix.indisprimary AS is_primary, am.amname AS method, pg_relation_size(ix.indexrelid) AS size_bytes,
              pg_get_expr(ix.indpred, ix.indrelid) AS predicate, COALESCE(s.idx_scan, 0) AS scans
         FROM pg_index ix
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_am am ON am.oid = i.relam
         LEFT JOIN pg_stat_user_indexes s ON s.indexrelid = ix.indexrelid
        WHERE ix.indrelid = ('public.' || $1)::regclass
        ORDER BY ix.indisprimary DESC, ix.indisunique DESC, i.relname`,
      [table]
    ),
    db.query(
      `SELECT t.tgname AS name, pg_get_triggerdef(t.oid, true) AS definition, p.proname AS function,
              t.tgenabled <> 'D' AS enabled, t.tgconstraint <> 0 AS is_constraint,
              obj_description(p.oid, 'pg_proc') AS function_comment
         FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = ('public.' || $1)::regclass AND NOT t.tgisinternal
        ORDER BY t.tgname`,
      [table]
    ),
    db.query(
      `SELECT c.relname AS table_name, co.conname AS name, pg_get_constraintdef(co.oid) AS definition, co.confdeltype AS on_delete
         FROM pg_constraint co JOIN pg_class c ON c.oid = co.conrelid
        WHERE co.confrelid = ('public.' || $1)::regclass AND co.contype = 'f'
        ORDER BY c.relname`,
      [table]
    ),
    tableSummaries(),
  ]);

  const stats = summary.find((t) => t.name === table) || {};
  const detail = {
    name: table,
    ...stats,
    columns,
    constraints: constraints.rows.map((c) => ({
      name: c.name,
      kind: CONSTRAINT_KIND[c.kind] || c.kind,
      definition: c.definition,
      deferrable: c.deferrable,
      deferred: c.deferred,
      foreignTable: c.foreign_table,
      onDelete: c.kind === 'f' ? FK_ACTION[c.on_delete] : null,
    })),
    indexes: indexes.rows.map((i) => ({
      name: i.name,
      definition: i.definition,
      unique: i.is_unique,
      primary: i.is_primary,
      method: i.method,
      sizeBytes: Number(i.size_bytes),
      partial: i.predicate,
      scans: Number(i.scans),
    })),
    triggers: triggers.rows.map((t) => ({
      name: t.name,
      definition: t.definition,
      function: t.function,
      enabled: t.enabled,
      constraint: t.is_constraint,
      description: t.function_comment,
    })),
    referencedBy: referencedBy.rows.map((r) => ({ table: r.table_name, name: r.name, definition: r.definition, onDelete: FK_ACTION[r.on_delete] })),
  };
  detail.ddl = buildDdl(detail);
  return detail;
}

/** A readable CREATE TABLE for the table as it is now, rebuilt from the catalog. */
function buildDdl(detail) {
  const lines = detail.columns.map((c) => {
    let line = `  ${c.name} ${c.type}`;
    if (c.identity) line += ` GENERATED ${c.identity.toUpperCase()} AS IDENTITY`;
    if (c.generatedAs) line += ` GENERATED ALWAYS AS (${c.generatedAs}) STORED`;
    if (c.default && !c.identity) line += ` DEFAULT ${c.default}`;
    if (!c.nullable && !c.identity) line += ' NOT NULL';
    return line;
  });
  for (const c of detail.constraints) {
    if (c.kind === 'trigger') continue;
    lines.push(`  CONSTRAINT ${c.name} ${c.definition}`);
  }
  let sql = `CREATE TABLE ${detail.name} (\n${lines.join(',\n')}\n);`;
  const constraintNames = new Set(detail.constraints.map((c) => c.name));
  for (const index of detail.indexes) {
    if (!constraintNames.has(index.name)) sql += `\n\n${index.definition};`;
  }
  for (const trigger of detail.triggers) sql += `\n\n${trigger.definition};`;
  if (detail.comment) sql += `\n\nCOMMENT ON TABLE ${detail.name} IS '${detail.comment.replace(/'/g, "''")}';`;
  return sql;
}

/** Tables, their columns and every foreign key - the data for the ER diagram. */
async function relationships() {
  const names = await tableNames();
  const [columns, keys, summaries] = await Promise.all([
    db.query(
      `SELECT c.relname AS table_name, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnum AS position,
              NOT a.attnotnull AS nullable,
              EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conrelid = c.oid AND co.contype = 'p' AND a.attnum = ANY (co.conkey)) AS primary_key,
              EXISTS (SELECT 1 FROM pg_constraint co WHERE co.conrelid = c.oid AND co.contype = 'f' AND a.attnum = ANY (co.conkey)) AS foreign_key
         FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum`
    ),
    db.query(
      `SELECT co.conname AS name, c.relname AS from_table, fc.relname AS to_table, co.confdeltype AS on_delete,
              (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(co.conkey) WITH ORDINALITY AS k(num, ord)
                 JOIN pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.num) AS from_columns,
              (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(co.confkey) WITH ORDINALITY AS k(num, ord)
                 JOIN pg_attribute a ON a.attrelid = co.confrelid AND a.attnum = k.num) AS to_columns,
              EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = co.conrelid AND a.attnum = ANY (co.conkey) AND a.attnotnull) AS required
         FROM pg_constraint co
         JOIN pg_class c ON c.oid = co.conrelid
         JOIN pg_class fc ON fc.oid = co.confrelid
        WHERE co.contype = 'f' AND co.connamespace = 'public'::regnamespace
        ORDER BY c.relname, co.conname`
    ),
    tableSummaries(),
  ]);

  return {
    tables: names.map((name) => ({
      name,
      rows: summaries.find((s) => s.name === name)?.rows ?? 0,
      comment: summaries.find((s) => s.name === name)?.comment ?? null,
      columns: columns.rows
        .filter((c) => c.table_name === name)
        .map((c) => ({ name: c.name, type: c.type, nullable: c.nullable, primaryKey: c.primary_key, foreignKey: c.foreign_key })),
    })),
    relationships: keys.rows.map((k) => ({
      name: k.name,
      from: { table: k.from_table, columns: k.from_columns },
      to: { table: k.to_table, columns: k.to_columns },
      onDelete: FK_ACTION[k.on_delete],
      // Crow's foot: many rows here to one there; optional when the key may be null.
      cardinality: k.required ? 'many-to-one' : 'many-to-zero-or-one',
    })),
  };
}

async function routines() {
  const [views, functions] = await Promise.all([
    db.query(
      `SELECT c.relname AS name, pg_get_viewdef(c.oid, true) AS definition, obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm') ORDER BY c.relname`
    ),
    db.query(
      `SELECT p.proname AS name, pg_get_function_identity_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS returns,
              l.lanname AS language, obj_description(p.oid, 'pg_proc') AS comment, pg_get_functiondef(p.oid) AS definition,
              p.prorettype = 'trigger'::regtype AS is_trigger,
              (SELECT count(*) FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal) AS used_by
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND ${NOT_EXTENSION('p.oid')}
        ORDER BY is_trigger, p.proname`
    ),
  ]);
  return {
    views: views.rows,
    functions: functions.rows.map((f) => ({ ...f, usedBy: Number(f.used_by) })),
  };
}

/** Raw rows of any table, read-only, for the table browser. */
async function browse(name, { page = 1, pageSize = 50, sort, dir, search } = {}) {
  const table = await assertTableName(name);
  const columns = await columnsOf(table);
  const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const sortColumn = columns.find((c) => c.name === sort)?.name || (columns.some((c) => c.name === 'id') ? 'id' : columns[0].name);
  const direction = String(dir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const params = [];
  let where = '';
  const needle = String(search || '').trim();
  if (needle) {
    params.push(`%${needle.replace(/[\\%_]/g, '\\$&')}%`);
    where = ` WHERE ${columns.map((c) => `"${c.name}"::text ILIKE $1`).join(' OR ')}`;
  }
  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT *, count(*) OVER () AS __total FROM "${table}"${where} ORDER BY "${sortColumn}" ${direction} NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const total = rows.length ? Number(rows[0].__total) : 0;
  for (const row of rows) delete row.__total;
  return { table, columns, rows, total, page: Math.max(Number(page) || 1, 1), pageSize: limit, pageCount: Math.max(Math.ceil(total / limit), 1), sort: sortColumn, dir: direction.toLowerCase() };
}

// The column worth showing when a row is referred to from somewhere else.
const LABEL_COLUMNS = ['name', 'reference', 'original_name', 'subject', 'key', 'username', 'description'];

/**
 * One row, with everything around it: the records it points at, how many point
 * back at it, and its whole history from the audit trail. This is what the row
 * inspector shows when you click a row in the table browser.
 */
async function inspectRow(name, id) {
  const table = await assertTableName(name);
  const columns = await columnsOf(table);
  const key = columns.find((c) => c.primaryKey) || columns[0];

  const { rows } = await db.query(`SELECT * FROM "${table}" WHERE "${key.name}"::text = $1`, [String(id)]);
  if (!rows.length) throw fail(`No row with ${key.name} ${id} in ${table}`, 404);
  const row = rows[0];

  // Parent rows: follow each foreign key and read a name for it.
  const references = [];
  for (const column of columns.filter((c) => c.references && row[c.name] !== null && row[c.name] !== undefined)) {
    const parentColumns = await columnsOf(column.references);
    const label = LABEL_COLUMNS.find((c) => parentColumns.some((p) => p.name === c));
    const { rows: parent } = await db.query(
      `SELECT ${label ? `"${label}"` : 'id'} AS label, id FROM "${column.references}" WHERE id = $1`,
      [row[column.name]]
    );
    references.push({ column: column.name, table: column.references, id: row[column.name], label: parent[0]?.label ?? null });
  }

  // Child rows: how many rows in other tables point at this one.
  const { rows: incoming } = await db.query(
    `SELECT c.conname AS name, fc.relname AS table_name, (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS column_name
       FROM pg_constraint c JOIN pg_class fc ON fc.oid = c.conrelid
      WHERE c.contype = 'f' AND c.confrelid = ('public.' || $1)::regclass`,
    [table]
  );
  const referencedBy = [];
  for (const link of incoming) {
    const { rows: counted } = await db.query(
      `SELECT count(*) AS n FROM "${link.table_name}" WHERE "${link.column_name}" = $1`,
      [row[key.name]]
    );
    referencedBy.push({ table: link.table_name, column: link.column_name, count: Number(counted[0].n) });
  }

  const { rows: history } = await db.query(
    `SELECT id, action, actor, changed_fields, old_data, new_data, created_at
       FROM audit_log WHERE table_name = $1 AND record_id::text = $2
      ORDER BY created_at DESC, id DESC LIMIT 50`,
    [table, String(row[key.name])]
  );

  return { table, key: key.name, columns, row, references, referencedBy, history };
}

/**
 * Per-table statistics PostgreSQL keeps itself: how rows are being read, how
 * much dead weight is waiting for a vacuum, and when it was last measured.
 * The advice is worked out here rather than in the page, so the same rules
 * apply wherever it is shown.
 */
async function tableStats() {
  const { rows } = await db.query(`
    SELECT s.relname AS table_name,
           s.seq_scan, s.seq_tup_read, s.idx_scan, s.n_live_tup, s.n_dead_tup, s.n_mod_since_analyze,
           s.n_tup_ins, s.n_tup_upd, s.n_tup_del,
           GREATEST(s.last_vacuum, s.last_autovacuum) AS last_vacuum,
           GREATEST(s.last_analyze, s.last_autoanalyze) AS last_analyze,
           pg_total_relation_size(s.relid) AS total_bytes
      FROM pg_stat_user_tables s
     ORDER BY s.relname`);

  return rows.map((r) => {
    const live = Number(r.n_live_tup) || 0;
    const dead = Number(r.n_dead_tup) || 0;
    const seq = Number(r.seq_scan) || 0;
    const idx = Number(r.idx_scan) || 0;
    const readPerScan = seq > 0 ? Number(r.seq_tup_read) / seq : 0;
    const notes = [];
    // A full scan of a small table is cheaper than an index; only speak up once
    // the table is big enough for it to matter.
    if (live >= 500 && readPerScan >= 500 && seq > idx) {
      notes.push({ level: 'warning', text: `Read end to end ${seq} times, ${Math.round(readPerScan)} rows each. An index on whatever is being filtered would pay for itself.` });
    }
    if (live >= 1000 && dead / Math.max(live, 1) > 0.2) {
      notes.push({ level: 'warning', text: `${dead} dead rows waiting to be reclaimed - run Vacuum on the Health tab.` });
    }
    if (live >= 1000 && Number(r.n_mod_since_analyze) > live * 0.3) {
      notes.push({ level: 'info', text: 'Changed a lot since it was last measured; refresh statistics so the planner keeps choosing well.' });
    }
    if (!notes.length) notes.push({ level: 'ok', text: seq + idx === 0 ? 'Not read yet since statistics were reset.' : 'Healthy.' });
    return {
      table: r.table_name,
      seqScans: seq,
      indexScans: idx,
      indexShare: seq + idx > 0 ? Math.round((idx / (seq + idx)) * 100) : null,
      liveRows: live,
      deadRows: dead,
      rowsPerSeqScan: Math.round(readPerScan),
      inserted: Number(r.n_tup_ins) || 0,
      updated: Number(r.n_tup_upd) || 0,
      deleted: Number(r.n_tup_del) || 0,
      lastVacuum: r.last_vacuum,
      lastAnalyze: r.last_analyze,
      totalBytes: Number(r.total_bytes) || 0,
      notes,
    };
  });
}

module.exports = { overview, tableSummaries, tableDetail, relationships, routines, browse, inspectRow, tableStats, assertTableName, tableNames, columnsOf };
