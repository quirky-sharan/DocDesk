const db = require('../db');

// Only these tables are reachable through the generic list/export layer.
// Table and column names cannot be bound as SQL parameters, so everything that
// reaches an identifier position is checked against this map and against the
// live schema before it is interpolated.
const TABLES = {
  products: {
    label: 'Products',
    defaultSort: 'name',
    searchable: ['name', 'sku', 'category', 'description'],
  },
  customers: {
    label: 'Customers',
    defaultSort: 'name',
    searchable: ['name', 'phone', 'email', 'address'],
  },
  suppliers: {
    label: 'Suppliers',
    defaultSort: 'name',
    searchable: ['name', 'contact_name', 'phone', 'email'],
  },
  sales: {
    label: 'Sales',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['reference', 'payment_status', 'payment_method'],
  },
  sale_items: { label: 'Sale line items', defaultSort: 'id', searchable: ['description'] },
  purchase_orders: {
    label: 'Purchase orders',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['reference', 'status'],
  },
  purchase_order_items: {
    label: 'Purchase order items',
    defaultSort: 'id',
    searchable: ['description'],
  },
  message_log: {
    label: 'Messages',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['recipient', 'subject', 'trigger_type', 'status'],
  },
};

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function assertTable(table) {
  if (!Object.prototype.hasOwnProperty.call(TABLES, table)) {
    throw badRequest(`Unknown table "${table}"`);
  }
  return TABLES[table];
}

const columnCache = new Map();

async function describeTable(table) {
  assertTable(table);
  if (columnCache.has(table)) return columnCache.get(table);

  let columns;
  if (db.name === 'postgres') {
    const { rows } = await db.query(
      `SELECT column_name AS name, data_type AS type, is_nullable AS nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    columns = rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.nullable === 'YES',
    }));
  } else {
    // PRAGMA takes no bound parameters, but `table` is already constrained to
    // the TABLES whitelist by assertTable above.
    const { rows } = await db.query(`PRAGMA table_info(${table})`);
    columns = rows.map((r) => ({
      name: r.name,
      type: r.type,
      nullable: r.notnull === 0,
    }));
  }

  columnCache.set(table, columns);
  return columns;
}

async function assertColumn(table, column) {
  const columns = await describeTable(table);
  if (!columns.some((c) => c.name === column)) {
    throw badRequest(`Unknown column "${column}" on ${table}`);
  }
  return column;
}

/**
 * Generic read used by both the list endpoints and the exporters.
 * Every identifier is validated; every value is bound.
 */
async function listRows(table, options = {}) {
  const config = assertTable(table);
  const { search, sort, dir, limit, offset, where = {} } = options;

  const params = [];
  const conditions = [];

  for (const [column, value] of Object.entries(where)) {
    if (value === undefined || value === '') continue;
    await assertColumn(table, column);
    params.push(value);
    conditions.push(`${column} = $${params.length}`);
  }

  if (search && config.searchable?.length) {
    // LIKE is case-insensitive for ASCII in SQLite by default; Postgres needs
    // an explicit lower() on both sides to behave the same way.
    const parts = config.searchable.map((column) => {
      params.push(`%${String(search).toLowerCase()}%`);
      return `LOWER(COALESCE(${column}, '')) LIKE $${params.length}`;
    });
    conditions.push(`(${parts.join(' OR ')})`);
  }

  const whereSql = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  // Paging params are appended after this point, so the count query reuses
  // exactly the filter params and nothing else.
  const whereParams = [...params];

  const sortColumn = sort ? await assertColumn(table, sort) : config.defaultSort;
  const sortDir = String(dir || config.defaultDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  let sql = `SELECT * FROM ${table}${whereSql} ORDER BY ${sortColumn} ${sortDir}`;

  if (limit !== undefined) {
    params.push(Number(limit));
    sql += ` LIMIT $${params.length}`;
    if (offset) {
      params.push(Number(offset));
      sql += ` OFFSET $${params.length}`;
    }
  }

  const { rows } = await db.query(sql, params);
  const countResult = await db.query(
    `SELECT COUNT(*) AS count FROM ${table}${whereSql}`,
    whereParams
  );

  return { rows, total: Number(countResult.rows[0].count) };
}

module.exports = { TABLES, assertTable, assertColumn, describeTable, listRows, badRequest };
