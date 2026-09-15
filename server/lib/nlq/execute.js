const db = require('../../db');
const { listRows, invalidateSchemaCache, badRequest } = require('../tables');
const { OPERATORS, COLUMN_TYPES, AGGREGATES, describe, changesSchema } = require('./operations');

/**
 * Builds SQL from an already-validated operation.
 *
 * Every identifier reaching an interpolated position has been checked against
 * the live schema by operations.js; every literal is bound. Nothing here is
 * constructed from raw model output.
 */

function buildWhere(conditions, match = 'all', params = []) {
  if (!conditions?.length) return { sql: '', params };
  const parts = conditions.map((c) => {
    const operator = OPERATORS[c.operator];
    if (c.operator === 'is_empty') return `(t.${c.column} IS NULL OR t.${c.column} = '')`;
    if (c.operator === 'is_not_empty') return `(t.${c.column} IS NOT NULL AND t.${c.column} <> '')`;
    if (c.operator === 'contains') {
      params.push(`%${String(c.value).toLowerCase()}%`);
      return `LOWER(COALESCE(t.${c.column}, '')) LIKE $${params.length}`;
    }
    if (c.operator === 'starts_with') {
      params.push(`${String(c.value).toLowerCase()}%`);
      return `LOWER(COALESCE(t.${c.column}, '')) LIKE $${params.length}`;
    }
    params.push(c.value);
    return `t.${c.column} ${operator} $${params.length}`;
  });
  return { sql: ` WHERE ${parts.join(match === 'any' ? ' OR ' : ' AND ')}`, params };
}

/**
 * Runs the operation without changing anything, so the user can see what it
 * would do before agreeing to it.
 */
async function preview(table, op) {
  switch (op.type) {
    case 'sort': {
      const result = await listRows(table, { sort: op.column, dir: op.direction, pageSize: 8 });
      return { kind: 'rows', rows: result.rows, total: result.total };
    }

    case 'filter': {
      const params = [];
      const where = buildWhere(op.conditions, op.match, params);
      const { rows } = await db.query(
        `SELECT * FROM ${table} t${where.sql} LIMIT 8`,
        params
      );
      const { rows: counted } = await db.query(
        `SELECT COUNT(*) AS count FROM ${table} t${where.sql}`,
        params
      );
      return { kind: 'rows', rows, total: Number(counted[0].count) };
    }

    case 'summarize': {
      const select = op.metrics
        .map((m) => `${AGGREGATES[m.fn]}(${m.column === '*' ? '*' : `t.${m.column}`}) AS ${m.fn}_${m.column === '*' ? 'rows' : m.column}`)
        .join(', ');
      const groupSql = op.groupBy ? ` GROUP BY t.${op.groupBy}` : '';
      const groupSelect = op.groupBy ? `t.${op.groupBy} AS ${op.groupBy}, ` : '';
      const { rows } = await db.query(
        `SELECT ${groupSelect}${select} FROM ${table} t${groupSql} ORDER BY 1 LIMIT 50`
      );
      return { kind: 'summary', rows };
    }

    case 'set_values': {
      const params = [];
      const where = buildWhere(op.conditions, 'all', params);
      const { rows: counted } = await db.query(
        `SELECT COUNT(*) AS count FROM ${table} t${where.sql}`,
        params
      );
      const { rows } = await db.query(`SELECT * FROM ${table} t${where.sql} LIMIT 8`, params);
      return { kind: 'rows', rows, total: Number(counted[0].count), affected: Number(counted[0].count) };
    }

    case 'add_column':
    case 'rename_column':
    case 'drop_column': {
      const { rows: counted } = await db.query(`SELECT COUNT(*) AS count FROM ${table} t`);
      return { kind: 'schema', total: Number(counted[0].count), affected: Number(counted[0].count) };
    }

    default:
      throw badRequest('That is not something I can preview.');
  }
}

/**
 * Applies an operation. Read-only shapes (sort, filter, summarize) are returned
 * for the caller to display rather than written anywhere - they describe a view,
 * not a change.
 */
async function apply(table, op) {
  switch (op.type) {
    case 'sort':
    case 'filter':
    case 'summarize':
      return { applied: false, view: op, message: describe(op) };

    case 'add_column': {
      const columnType = COLUMN_TYPES[op.columnType][db.name];
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${op.name} ${columnType}`);
      invalidateSchemaCache(table);
      return { applied: true, message: `Added the "${op.name}" column.` };
    }

    case 'rename_column': {
      // Supported by SQLite 3.25+ and every Postgres we target.
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
      const where = buildWhere(op.conditions, 'all', params);
      // buildWhere qualifies columns as t.<col>, which UPDATE ... SET does not
      // accept in either dialect; the alias is stripped for this statement only.
      const whereSql = where.sql.replace(/\bt\./g, '');
      const { rowCount } = await db.query(`UPDATE ${table} SET ${assignments.join(', ')}${whereSql}`, params);
      return { applied: true, affected: rowCount, message: `Updated ${rowCount} row${rowCount === 1 ? '' : 's'}.` };
    }

    default:
      throw badRequest('That is not something I can do.');
  }
}

module.exports = { preview, apply, buildWhere };
