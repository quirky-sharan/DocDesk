const db = require('../../db');
const { fail } = require('../validate');
const { invalidateSchemaCache } = require('../tables');

/**
 * The SQL console. Safe by construction rather than by trust:
 *
 *  - exactly one statement per run (a tokenizer that understands quotes,
 *    comments and dollar-quoting counts them)
 *  - read queries run in a READ ONLY transaction that is always rolled back,
 *    through a cursor that stops after MAX_ROWS
 *  - changes are a separate, explicit mode, limited to data changes and a few
 *    harmless schema objects (indexes, views, comments) - no dropping tables,
 *    no altering the schema the app depends on, no session settings
 *  - every run has a time limit; changes are recorded in the audit trail as
 *    made by the SQL console
 */

const MAX_ROWS = 1000;
const TIMEOUT_MS = Number(process.env.SQL_CONSOLE_TIMEOUT_MS) || 15_000;

const READ = new Set(['select', 'with', 'values', 'table', 'show', 'explain']);
const WRITE_DML = new Set(['insert', 'update', 'delete', 'merge']);

// Functions that reach outside the query: session settings, other connections,
// the server's files. Not allowed in either mode.
const DENIED_FUNCTIONS = [
  'set_config', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf', 'pg_rotate_logfile',
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'lo_import', 'lo_export',
  'dblink', 'dblink_exec', 'pg_advisory_lock', 'pg_advisory_xact_lock', 'pg_promote', 'txid_current_snapshot',
];

/** Splits SQL into tokens we care about, skipping strings and comments. */
function scan(sql) {
  const words = [];
  let statements = 0;
  let sawContent = false;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      sawContent = true;
      i++;
      while (i < n) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      if (ch === '"') words.push('"quoted"');
      continue;
    }
    if (ch === '$') {
      const tag = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tag) {
        sawContent = true;
        const close = sql.indexOf(tag[0], i + tag[0].length);
        i = close === -1 ? n : close + tag[0].length;
        continue;
      }
    }
    if (ch === ';') {
      if (sawContent) statements++;
      sawContent = false;
      words.push(';');
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      words.push(sql.slice(i, j).toLowerCase());
      sawContent = true;
      i = j;
      continue;
    }
    if (!/\s/.test(ch)) sawContent = true;
    i++;
  }
  if (sawContent) statements++;
  return { words, statements };
}

/** What a statement is: read, write, or something the console won't run. */
function classify(sql) {
  const text = String(sql || '');
  if (!text.trim()) throw fail('Type a query first.');
  if (text.length > 100_000) throw fail('That query is too long.');

  const { words, statements } = scan(text);
  if (statements === 0) throw fail('Type a query first.');
  if (statements > 1) throw fail('Run one statement at a time - remove the extra semicolon-separated statements.');

  const tokens = words.filter((w) => w !== ';');
  const first = tokens[0] || '';
  const second = tokens[1] || '';

  for (let k = 0; k < tokens.length; k++) {
    if (DENIED_FUNCTIONS.includes(tokens[k])) {
      throw fail(`"${tokens[k]}" is not available in the SQL console.`);
    }
  }

  if (first === 'explain') {
    const rest = tokens.slice(1).filter((t) => !['analyze', 'analyse', 'verbose', 'costs', 'buffers', 'format', 'json', 'text', 'yaml', 'xml', 'settings', 'timing', 'summary', 'wal', 'on', 'off', 'true', 'false', 'memory', 'serialize', 'generic_plan'].includes(t));
    const inner = rest[0] || '';
    const analyze = tokens.includes('analyze') || tokens.includes('analyse');
    return { kind: READ.has(inner) || WRITE_DML.has(inner) ? 'explain' : 'blocked', command: 'explain', analyze, innerWrites: WRITE_DML.has(inner) };
  }
  if (first === 'with') {
    const writes = tokens.some((t) => WRITE_DML.has(t));
    return { kind: writes ? 'write' : 'read', command: writes ? 'with (changes data)' : 'select' };
  }
  if (READ.has(first)) {
    // SELECT ... INTO creates a table; FOR UPDATE takes locks.
    if (first === 'select' && tokens.includes('into') && !tokens.includes('from')) return { kind: 'blocked', command: 'select into' };
    return { kind: 'read', command: first };
  }
  if (WRITE_DML.has(first)) return { kind: 'write', command: first };

  const phrase = `${first} ${second}`;
  if (phrase === 'create index' || phrase === 'create unique' || (phrase === 'create or' && tokens.includes('view'))) {
    return { kind: 'write', command: tokens.includes('view') ? 'create view' : 'create index', ddl: true };
  }
  if (phrase === 'create view' || phrase === 'create materialized') return { kind: 'write', command: 'create view', ddl: true };
  if (phrase === 'drop index' || phrase === 'drop view' || (phrase === 'drop materialized' && tokens[2] === 'view')) {
    return { kind: 'write', command: phrase, ddl: true };
  }
  if (phrase === 'refresh materialized') return { kind: 'write', command: 'refresh materialized view' };
  if (first === 'comment') return { kind: 'write', command: 'comment', ddl: true };
  if (first === 'analyze' || first === 'analyse') return { kind: 'maintenance', command: 'analyze' };
  if (first === 'vacuum') return { kind: 'maintenance', command: 'vacuum' };

  return { kind: 'blocked', command: first };
}

const typeNames = new Map();

async function describeTypes(fields) {
  const missing = [...new Set(fields.map((f) => f.dataTypeID))].filter((oid) => !typeNames.has(oid));
  if (missing.length) {
    const { rows } = await db.query('SELECT oid::int AS oid, format_type(oid, NULL) AS name FROM pg_type WHERE oid = ANY($1::oid[])', [missing]);
    for (const row of rows) typeNames.set(row.oid, row.name);
  }
  return fields.map((f) => ({ name: f.name, type: typeNames.get(f.dataTypeID) || String(f.dataTypeID) }));
}

function serialiseCell(value) {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return `\\x${Buffer.from(value).toString('hex')}`;
  return value;
}

class Rollback extends Error {}

/**
 * Runs `fn` inside a transaction and always rolls it back afterwards, handing
 * back whatever `fn` produced. Used for reads (so nothing - not even a session
 * setting - survives) and for EXPLAIN ANALYZE of a change.
 */
async function withRollback(fn, { readOnly }) {
  let result;
  try {
    await db.transaction(
      async (tx) => {
        result = await fn(tx);
        throw new Rollback();
      },
      { readOnly, timeoutMs: TIMEOUT_MS, actor: 'sql-console' }
    );
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return result;
}

async function run(sql, { allowWrite = false } = {}) {
  const statement = classify(sql);
  const text = String(sql).trim().replace(/;\s*$/, '');
  const started = performance.now();

  if (statement.kind === 'blocked') {
    throw fail(
      statement.command === 'explain'
        ? 'EXPLAIN works with SELECT, INSERT, UPDATE and DELETE.'
        : `"${statement.command.toUpperCase()}" can't be run from the console. Reading data, changing rows, and creating indexes or views are supported; the table structure is managed by DocDesk's migrations.`,
      403
    );
  }

  if (statement.kind === 'write' || statement.kind === 'maintenance') {
    if (!allowWrite) {
      throw fail('That query changes the database. Switch the console to "Allow changes" to run it.', 403);
    }
    if (statement.kind === 'maintenance') {
      // VACUUM refuses to run inside a transaction block.
      const result = await db.query(text);
      return { kind: statement.kind, command: statement.command, columns: [], rows: [], rowCount: result.rowCount, durationMs: Math.round(performance.now() - started) };
    }
    const result = await db.transaction((tx) => tx.query(text, [], { rowMode: 'array' }), { timeoutMs: TIMEOUT_MS, actor: 'sql-console' });
    if (statement.ddl) invalidateSchemaCache();
    const columns = await describeTypes(result.fields || []);
    return {
      kind: 'write',
      command: statement.command,
      columns,
      rows: (result.rows || []).slice(0, MAX_ROWS).map((r) => r.map(serialiseCell)),
      rowCount: result.rowCount,
      truncated: (result.rows || []).length > MAX_ROWS,
      durationMs: Math.round(performance.now() - started),
    };
  }

  if (statement.kind === 'explain') {
    if (statement.analyze && statement.innerWrites && !allowWrite) {
      throw fail('EXPLAIN ANALYZE runs the change to measure it. Switch to "Allow changes" first - it is rolled back afterwards.', 403);
    }
    const result = await withRollback((tx) => tx.query(text, [], { rowMode: 'array' }), { readOnly: !statement.innerWrites });
    const columns = await describeTypes(result.fields || []);
    return { kind: 'read', command: 'explain', columns, rows: result.rows.map((r) => r.map(serialiseCell)), rowCount: result.rows.length, durationMs: Math.round(performance.now() - started) };
  }

  // Read: a cursor fetches at most MAX_ROWS + 1, so a huge result never has to
  // be built in full just to show the first page of it.
  const result = await withRollback(async (tx) => {
    if (statement.command === 'show') return tx.query(text, [], { rowMode: 'array' });
    await tx.query(`DECLARE docdesk_console NO SCROLL CURSOR FOR ${text}`);
    return tx.query(`FETCH ${MAX_ROWS + 1} FROM docdesk_console`, [], { rowMode: 'array' });
  }, { readOnly: true });

  const rows = result.rows || [];
  const columns = await describeTypes(result.fields || []);
  return {
    kind: 'read',
    command: statement.command,
    columns,
    rows: rows.slice(0, MAX_ROWS).map((r) => r.map(serialiseCell)),
    rowCount: Math.min(rows.length, MAX_ROWS),
    truncated: rows.length > MAX_ROWS,
    durationMs: Math.round(performance.now() - started),
  };
}

/**
 * The query plan as JSON, for the visual plan view. ANALYZE actually runs the
 * query (inside a transaction that is rolled back), giving real timings and
 * row counts next to the planner's estimates.
 */
async function explain(sql, { analyze = true, allowWrite = false } = {}) {
  const statement = classify(sql);
  if (statement.kind === 'explain') throw fail('Leave out EXPLAIN - the plan view adds it.');
  if (!['read', 'write'].includes(statement.kind) || (statement.kind === 'write' && !['insert', 'update', 'delete', 'merge', 'with (changes data)'].includes(statement.command))) {
    throw fail('Plans are available for SELECT, INSERT, UPDATE and DELETE.', 403);
  }
  if (statement.command === 'show') throw fail('SHOW has no query plan.');
  const writes = statement.kind === 'write';
  if (writes && analyze && !allowWrite) {
    throw fail('Measuring a change runs it (then rolls it back). Switch to "Allow changes" to analyse it, or turn off "Measure".', 403);
  }

  const text = String(sql).trim().replace(/;\s*$/, '');
  const options = analyze ? 'ANALYZE, BUFFERS, FORMAT JSON' : 'FORMAT JSON';
  const started = performance.now();
  const result = await withRollback((tx) => tx.query(`EXPLAIN (${options}) ${text}`), { readOnly: !writes });
  const raw = result.rows[0]?.['QUERY PLAN'];
  const plan = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return { analyze, durationMs: Math.round(performance.now() - started), plan: plan?.[0] || null };
}

const SAMPLES = [
  {
    title: 'Best customers by lifetime value',
    concept: 'View + ORDER BY',
    sql: `SELECT name, visits, lifetime_value, average_sale, outstanding, last_purchase_at
FROM v_customer_stats
WHERE visits > 0
ORDER BY lifetime_value DESC
LIMIT 10;`,
  },
  {
    title: 'Stock ledger with a running balance',
    concept: 'Window function',
    sql: `SELECT p.name, m.created_at, m.kind, m.change,
       sum(m.change) OVER (PARTITION BY m.product_id ORDER BY m.created_at, m.id) AS running_balance,
       m.balance_after, m.note
FROM stock_movements m
JOIN products p ON p.id = m.product_id
WHERE p.sku = 'SKU-001'
ORDER BY m.created_at DESC, m.id DESC
LIMIT 50;`,
  },
  {
    title: 'Revenue and profit by category, with totals',
    concept: 'GROUP BY ROLLUP',
    sql: `SELECT COALESCE(c.name, 'All categories') AS category,
       sum(si.line_total) AS revenue,
       sum(si.line_total - si.quantity * si.unit_cost) AS gross_profit,
       round(100 * sum(si.line_total - si.quantity * si.unit_cost) / NULLIF(sum(si.line_total), 0), 1) AS margin_pct
FROM sale_items si
JOIN products p ON p.id = si.product_id
LEFT JOIN categories c ON c.id = p.category_id
GROUP BY ROLLUP (c.name)
ORDER BY c.name NULLS LAST;`,
  },
  {
    title: 'Products that have never sold',
    concept: 'Anti-join (NOT EXISTS)',
    sql: `SELECT p.sku, p.name, p.stock_quantity, p.created_at
FROM products p
WHERE NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.product_id = p.id)
ORDER BY p.created_at;`,
  },
  {
    title: 'Busiest hours of the week',
    concept: 'Set-returning function',
    sql: `SELECT to_char(make_date(2024, 1, 7) + dow, 'Dy') AS day, hour, sale_count, revenue
FROM report_sales_heatmap(current_date - 90, current_date, 'Asia/Kolkata')
ORDER BY sale_count DESC
LIMIT 10;`,
  },
  {
    title: 'Month-by-month revenue and growth',
    concept: 'CTE + LAG()',
    sql: `WITH monthly AS (
  SELECT date_trunc('month', created_at) AS month, sum(total) AS revenue, count(*) AS sales
  FROM sales
  GROUP BY 1
)
SELECT to_char(month, 'Mon YYYY') AS month, sales, revenue,
       round(100 * (revenue - lag(revenue) OVER (ORDER BY month)) / NULLIF(lag(revenue) OVER (ORDER BY month), 0), 1) AS growth_pct
FROM monthly
ORDER BY month;`,
  },
  {
    title: 'Money still owed, oldest first',
    concept: 'Partial index in action',
    sql: `SELECT reference, customer_name, created_at, total, amount_paid, balance_due
FROM v_sales
WHERE payment_status IN ('unpaid', 'partial')
ORDER BY created_at;`,
  },
  {
    title: 'Fuzzy search with trigrams',
    concept: 'pg_trgm similarity',
    sql: `SELECT name, similarity(name, 'balpoint pens') AS score
FROM products
WHERE name % 'balpoint pens'
ORDER BY score DESC;`,
  },
  {
    title: 'Who changed what today',
    concept: 'Audit trail (JSONB)',
    sql: `SELECT created_at, actor, table_name, record_id, action, changed_fields,
       new_data ->> 'name' AS name
FROM audit_log
WHERE created_at > now() - interval '1 day'
ORDER BY created_at DESC
LIMIT 50;`,
  },
  {
    title: 'How the schema is enforced',
    concept: 'System catalog',
    sql: `SELECT conrelid::regclass AS table_name, conname AS rule,
       CASE contype WHEN 'c' THEN 'check' WHEN 'f' THEN 'foreign key' WHEN 'u' THEN 'unique' WHEN 'p' THEN 'primary key' END AS kind,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace AND contype IN ('c', 'f', 'u', 'p')
ORDER BY conrelid::regclass::text, contype, conname;`,
  },
];

module.exports = { run, explain, classify, SAMPLES, MAX_ROWS, TIMEOUT_MS };
