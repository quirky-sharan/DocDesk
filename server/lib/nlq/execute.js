const db = require('../../db');
const { TABLES, listRows, invalidateSchemaCache, badRequest, escapeLike } = require('../tables');
const { OPERATORS, COLUMN_TYPES, AGGREGATES, describe } = require('./operations');

/**
 * Builds SQL from an already-validated operation.
 *
 * Every identifier reaching an interpolated position has been checked against
 * the live schema by operations.js; every literal is bound. Nothing here is
 * constructed from raw model output.
 */

/** The FROM clause with the table's joins, and a resolver for column expressions. */
function source(table) {
  const config = TABLES[table];
  const joins = (config.joins || []).map((j) => ` LEFT JOIN ${j.table} ${j.alias} ON ${j.on}`).join('');
  const virtual = {};
  for (const join of config.joins || []) Object.assign(virtual, join.columns);
  Object.assign(virtual, config.computed || {});
  const select = [
    't.*',
    ...Object.entries(virtual).map(([alias, expression]) => `${expression} AS ${alias}`),
  ].join(', ');
  return {
    from: `${table} t${joins}`,
    select,
    column: (name) => virtual[name] || `t.${name}`,
  };
}

function buildWhere(table, conditions, match = 'all', params = []) {
  if (!conditions?.length) return { sql: '', params };
  const { column } = source(table);
  const parts = conditions.map((c) => {
    const expression = column(c.column);
    const operator = OPERATORS[c.operator];
    if (c.operator === 'is_empty') return `(${expression} IS NULL OR ${expression}::text = '')`;
    if (c.operator === 'is_not_empty') return `(${expression} IS NOT NULL AND ${expression}::text <> '')`;
    if (c.operator === 'contains') {
      params.push(`%${escapeLike(c.value)}%`);
      return `${expression}::text ILIKE $${params.length}`;
    }
    if (c.operator === 'starts_with') {
      params.push(`${escapeLike(c.value)}%`);
      return `${expression}::text ILIKE $${params.length}`;
    }
    params.push(c.value);
    // Text compares without regard to letter case, the way people mean it.
    if (typeof c.value === 'string' && (c.operator === '=' || c.operator === '!=') && Number.isNaN(Number(c.value))) {
      return `lower(${expression}::text) ${operator} lower($${params.length})`;
    }
    return `${expression} ${operator} $${params.length}`;
  });
  return { sql: ` WHERE ${parts.join(match === 'any' ? ' OR ' : ' AND ')}`, params };
}

/**
 * Runs the operation without changing anything, so the person can see what it
 * would do before agreeing to it.
 */
async function preview(table, op) {
  const { from, select, column } = source(table);
  switch (op.type) {
    case 'sort': {
      const result = await listRows(table, { sort: op.column, dir: op.direction, pageSize: 8 });
      return { kind: 'rows', rows: result.rows, total: result.total };
    }

    case 'filter': {
      const params = [];
      const where = buildWhere(table, op.conditions, op.match, params);
      const { rows } = await db.query(`SELECT ${select}, count(*) OVER () AS __total FROM ${from}${where.sql} LIMIT 8`, params);
      const total = rows.length ? Number(rows[0].__total) : 0;
      for (const row of rows) delete row.__total;
      return { kind: 'rows', rows, total };
    }

    case 'summarize': {
      const metrics = op.metrics
        .map((m) => `${AGGREGATES[m.fn]}(${m.column === '*' ? '*' : column(m.column)}) AS ${m.fn}_${m.column === '*' ? 'rows' : m.column}`)
        .join(', ');
      const groupSelect = op.groupBy ? `${column(op.groupBy)} AS ${op.groupBy}, ` : '';
      const groupSql = op.groupBy ? ` GROUP BY ${column(op.groupBy)}` : '';
      const { rows } = await db.query(`SELECT ${groupSelect}${metrics} FROM ${from}${groupSql} ORDER BY 1 LIMIT 50`);
      return { kind: 'summary', rows };
    }

    case 'set_values': {
      const params = [];
      const where = buildWhere(table, op.conditions, 'all', params);
      const { rows } = await db.query(`SELECT ${select}, count(*) OVER () AS __total FROM ${from}${where.sql} LIMIT 8`, params);
      const total = rows.length ? Number(rows[0].__total) : 0;
      for (const row of rows) delete row.__total;
      return { kind: 'rows', rows, total, affected: total };
    }

    case 'add_column':
    case 'rename_column':
    case 'drop_column': {
      const { rows } = await db.query(`SELECT count(*) AS count FROM ${table}`);
      return { kind: 'schema', total: Number(rows[0].count), affected: Number(rows[0].count) };
    }

    default:
      throw badRequest('That is not something I can preview.');
  }
}

/**
 * Applies an operation. Read-only shapes (sort, filter, summarize) are returned
 * for the caller to display rather than written anywhere - they describe a view,
 * not a change. Schema changes run in a transaction: PostgreSQL DDL is
 * transactional, so a failed change leaves the table exactly as it was.
 */
async function apply(table, op) {
  switch (op.type) {
    case 'sort':
    case 'filter':
    case 'summarize':
      return { applied: false, view: op, message: describe(op) };

    case 'add_column': {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${op.name} ${COLUMN_TYPES[op.columnType]}`);
      invalidateSchemaCache(table);
      return { applied: true, message: `Added the "${op.name}" column.` };
    }

    case 'rename_column': {
      await db.query(`ALTER TABLE ${table} RENAME COLUMN ${op.from} TO ${op.to}`);
      invalidateSchemaCache(table);
      return { applied: true, message: `Renamed "${op.from}" to "${op.to}".` };
    }

    case 'drop_column': {
      await db.query(`ALTER TABLE ${table} DROP COLUMN ${op.name}`);
      invalidateSchemaCache(table);
      return { applied: true, message: `Deleted the "${op.name}" column.` };
    }

    case 'set_values': {
      const params = [];
      const assignments = op.assignments.map((a) => {
        params.push(a.value);
        return `${a.column} = $${params.length}`;
      });
      // Conditions may mention joined columns (a product's category), so the
      // rows are chosen by a subquery over the same joined source the preview used.
      const { from } = source(table);
      const where = buildWhere(table, op.conditions, 'all', params);
      const target = where.sql ? ` WHERE id IN (SELECT t.id FROM ${from}${where.sql})` : '';
      const { rowCount } = await db.query(`UPDATE ${table} SET ${assignments.join(', ')}${target}`, params);
      return { applied: true, affected: rowCount, message: `Updated ${rowCount} row${rowCount === 1 ? '' : 's'}.` };
    }

    default:
      throw badRequest('That is not something I can do.');
  }
}

module.exports = { preview, apply, buildWhere };
