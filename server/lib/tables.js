const db = require('../db');

// Only these tables are reachable through the generic list/export layer.
// Table and column names cannot be bound as SQL parameters, so everything that
// reaches an identifier position is checked against this map and against the
// live schema before it is interpolated.
//
// `joins` pull related display names in the same query rather than making the
// caller fetch the whole related table and stitch names on in JavaScript.
const TABLES = {
  products: {
    label: 'Products',
    defaultSort: 'name',
    searchable: ['name', 'sku', 'category', 'description'],
    joins: [
      { table: 'suppliers', alias: 'sup', on: 'sup.id = t.supplier_id', columns: { supplier_name: 'sup.name' } },
    ],
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
    searchable: ['reference', 'payment_status', 'payment_method', 'notes'],
    joins: [
      { table: 'customers', alias: 'c', on: 'c.id = t.customer_id', columns: { customer_name: 'c.name' } },
    ],
  },
  sale_items: { label: 'Sale line items', defaultSort: 'id', searchable: ['description'] },
  purchase_orders: {
    label: 'Purchase orders',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['reference', 'status', 'notes'],
    joins: [
      { table: 'suppliers', alias: 'sup', on: 'sup.id = t.supplier_id', columns: { supplier_name: 'sup.name' } },
    ],
  },
  purchase_order_items: { label: 'Purchase order items', defaultSort: 'id', searchable: ['description'] },
  message_log: {
    label: 'Messages',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['recipient', 'subject', 'trigger_type', 'status', 'body'],
  },
  files: {
    label: 'Files',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['original_name', 'description', 'mime_type', 'related_type'],
  },
};

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

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
    columns = rows.map((r) => ({ name: r.name, type: r.type, nullable: r.nullable === 'YES' }));
  } else {
    // PRAGMA takes no bound parameters, but `table` is already constrained to
    // the TABLES whitelist by assertTable above.
    const { rows } = await db.query(`PRAGMA table_info(${table})`);
    columns = rows.map((r) => ({ name: r.name, type: r.type, nullable: r.notnull === 0 }));
  }

  columnCache.set(table, columns);
  return columns;
}

/**
 * Schema is cached per table, so anything that alters a table must clear it or
 * later requests validate against a shape that no longer exists.
 */
function invalidateSchemaCache(table) {
  if (table) columnCache.delete(table);
  else columnCache.clear();
}

async function assertColumn(table, column) {
  const columns = await describeTable(table);
  if (!columns.some((c) => c.name === column)) {
    throw badRequest(`Unknown column "${column}" on ${table}`);
  }
  return column;
}

/**
 * Resolves a sort key to a qualified, validated SQL identifier.
 * Accepts either a real column on the table or the alias of a joined column,
 * so the UI can sort by "customer_name" without knowing about the join.
 */
async function resolveSort(table, config, sort) {
  if (!sort) return `t.${config.defaultSort}`;

  for (const join of config.joins || []) {
    if (Object.prototype.hasOwnProperty.call(join.columns, sort)) return join.columns[sort];
  }
  return `t.${await assertColumn(table, sort)}`;
}

/**
 * Generic read used by the list endpoints and the exporters.
 * Every identifier is validated or comes from this file; every value is bound.
 */
async function listRows(table, options = {}) {
  const config = assertTable(table);
  const { search, sort, dir, where = {}, ranges = [], paginate = true, extraConditions = [] } = options;

  const params = [];
  // extraConditions are fixed SQL fragments written in the controllers, for
  // filters that compare two columns and so cannot be expressed as a bound
  // equality. They must never be built from request input.
  const conditions = [...extraConditions];

  for (const [column, value] of Object.entries(where)) {
    if (value === undefined || value === null || value === '') continue;
    await assertColumn(table, column);
    params.push(value);
    conditions.push(`t.${column} = $${params.length}`);
  }

  // [{ column, from, to }] - used for date windows and numeric bounds.
  for (const range of ranges) {
    if (!range?.column) continue;
    await assertColumn(table, range.column);
    if (range.from !== undefined && range.from !== null && range.from !== '') {
      params.push(range.from);
      conditions.push(`t.${range.column} >= $${params.length}`);
    }
    if (range.to !== undefined && range.to !== null && range.to !== '') {
      params.push(range.to);
      conditions.push(`t.${range.column} <= $${params.length}`);
    }
  }

  if (search && config.searchable?.length) {
    const needle = `%${String(search).toLowerCase().trim()}%`;
    // LIKE is case-insensitive for ASCII in SQLite by default; Postgres needs an
    // explicit lower() on both sides to behave the same way.
    const parts = config.searchable.map((column) => {
      params.push(needle);
      return `LOWER(COALESCE(t.${column}, '')) LIKE $${params.length}`;
    });
    // Joined display names are searchable too, so typing a customer's name
    // finds their sales.
    for (const join of config.joins || []) {
      for (const expression of Object.values(join.columns)) {
        params.push(needle);
        parts.push(`LOWER(COALESCE(${expression}, '')) LIKE $${params.length}`);
      }
    }
    conditions.push(`(${parts.join(' OR ')})`);
  }

  const joinSql = (config.joins || [])
    .map((j) => ` LEFT JOIN ${j.table} ${j.alias} ON ${j.on}`)
    .join('');

  const selectSql = ['t.*', ...(config.joins || []).flatMap((j) =>
    Object.entries(j.columns).map(([alias, expression]) => `${expression} AS ${alias}`)
  )].join(', ');

  const whereSql = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  // Paging params are appended after this point, so the count query reuses
  // exactly the filter params and nothing else.
  const whereParams = [...params];

  const sortSql = await resolveSort(table, config, sort);
  const sortDir = String(dir || config.defaultDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  let sql = `SELECT ${selectSql} FROM ${table} t${joinSql}${whereSql} ORDER BY ${sortSql} ${sortDir}`;

  let page = 1;
  let pageSize = null;
  if (paginate) {
    pageSize = Math.min(Math.max(Number(options.pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    page = Math.max(Number(options.page) || 1, 1);
    params.push(pageSize, (page - 1) * pageSize);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }

  const { rows } = await db.query(sql, params);
  const countResult = await db.query(
    `SELECT COUNT(*) AS count FROM ${table} t${joinSql}${whereSql}`,
    whereParams
  );
  const total = Number(countResult.rows[0].count);

  return {
    rows,
    total,
    page,
    pageSize: pageSize ?? total,
    pageCount: pageSize ? Math.max(Math.ceil(total / pageSize), 1) : 1,
  };
}

/** Parses the paging/sorting/search query string every list endpoint accepts. */
function readListQuery(query = {}) {
  return {
    search: query.search,
    sort: query.sort,
    dir: query.dir,
    page: query.page,
    pageSize: query.pageSize ?? query.limit,
  };
}

module.exports = {
  TABLES, assertTable, assertColumn, describeTable, listRows, readListQuery, badRequest,
  invalidateSchemaCache, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE,
};
