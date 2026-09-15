const db = require('../db');

// Only these tables are reachable through the generic list/export layer.
// Table and column names cannot be bound as SQL parameters, so everything that
// reaches an identifier position is checked against this map and against the
// live schema before it is interpolated.
//
// `joins` pull related display names (a product's category, a sale's customer)
// in the same query. They are exposed as read-only "virtual" columns: you can
// search, sort and filter by them, but they are never written.
const TABLES = {
  products: {
    label: 'Products',
    defaultSort: 'name',
    searchable: ['name', 'sku', 'description'],
    joins: [
      { table: 'categories', alias: 'cat', on: 'cat.id = t.category_id', columns: { category: 'cat.name' } },
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
  categories: {
    label: 'Categories',
    defaultSort: 'name',
    searchable: ['name', 'description'],
  },
  sales: {
    label: 'Sales',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['reference', 'payment_status', 'payment_method', 'notes'],
    joins: [
      { table: 'customers', alias: 'c', on: 'c.id = t.customer_id', columns: { customer_name: 'c.name' } },
    ],
    computed: { balance_due: '(t.total - t.amount_paid)' },
  },
  sale_items: {
    label: 'Sale line items',
    defaultSort: 'id',
    searchable: ['description'],
    joins: [{ table: 'sales', alias: 's', on: 's.id = t.sale_id', columns: { sale_reference: 's.reference' } }],
  },
  payments: {
    label: 'Payments',
    defaultSort: 'paid_at',
    defaultDir: 'desc',
    searchable: ['method', 'note'],
    joins: [{ table: 'sales', alias: 's', on: 's.id = t.sale_id', columns: { sale_reference: 's.reference' } }],
  },
  purchase_orders: {
    label: 'Purchase orders',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['reference', 'status', 'notes'],
    joins: [
      { table: 'suppliers', alias: 'sup', on: 'sup.id = t.supplier_id', columns: { supplier_name: 'sup.name' } },
    ],
  },
  purchase_order_items: {
    label: 'Purchase order items',
    defaultSort: 'id',
    searchable: ['description'],
    joins: [{ table: 'purchase_orders', alias: 'po', on: 'po.id = t.purchase_order_id', columns: { order_reference: 'po.reference' } }],
  },
  stock_movements: {
    label: 'Stock movements',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['kind', 'note', 'actor'],
    joins: [{ table: 'products', alias: 'p', on: 'p.id = t.product_id', columns: { product_name: 'p.name' } }],
  },
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
  audit_log: {
    label: 'Activity log',
    defaultSort: 'created_at',
    defaultDir: 'desc',
    searchable: ['table_name', 'action', 'actor', 'record_key'],
  },
};

// Columns that are bookkeeping rather than information, left out of exports.
const INTERNAL_COLUMNS = new Set(['row_version', 'stored_name', 'password_hash']);

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

/**
 * The real columns of a table, read from the catalog: name, type, whether it
 * may be null, its default, and whether the database computes it (generated or
 * identity) - which the write paths use to leave those alone.
 */
async function describeTable(table) {
  assertTable(table);
  if (columnCache.has(table)) return columnCache.get(table);

  const { rows } = await db.query(
    `SELECT column_name AS name,
            CASE WHEN domain_name IS NOT NULL THEN domain_name
                 WHEN data_type = 'USER-DEFINED' THEN udt_name
                 ELSE data_type END AS type,
            udt_name,
            is_nullable = 'YES' AS nullable,
            column_default,
            is_generated = 'ALWAYS' AS generated,
            is_identity = 'YES' AS identity,
            numeric_precision, numeric_scale, character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  const columns = rows.map((r) => ({
    name: r.name,
    type: r.type,
    udt: r.udt_name,
    nullable: r.nullable,
    default: r.column_default,
    generated: r.generated,
    identity: r.identity,
    precision: r.numeric_precision,
    scale: r.numeric_scale,
    maxLength: r.character_maximum_length,
  }));

  columnCache.set(table, columns);
  return columns;
}

/** Real columns plus the joined display columns (marked virtual). */
async function listColumns(table) {
  const config = assertTable(table);
  const real = await describeTable(table);
  const virtual = [];
  for (const join of config.joins || []) {
    for (const alias of Object.keys(join.columns)) virtual.push({ name: alias, type: 'text', virtual: true });
  }
  for (const alias of Object.keys(config.computed || {})) virtual.push({ name: alias, type: 'numeric', virtual: true });
  return [...real, ...virtual];
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

/** A column or a joined/computed alias, as a qualified SQL expression. */
async function resolveExpression(table, config, name) {
  for (const join of config.joins || []) {
    if (Object.prototype.hasOwnProperty.call(join.columns, name)) return { sql: join.columns[name], virtual: true };
  }
  if (config.computed && Object.prototype.hasOwnProperty.call(config.computed, name)) {
    return { sql: config.computed[name], virtual: true };
  }
  return { sql: `t.${await assertColumn(table, name)}`, virtual: false };
}

function escapeLike(text) {
  return String(text).replace(/[\\%_]/g, '\\$&');
}

/**
 * Generic read used by the list endpoints and the exporters.
 * Every identifier is validated or comes from this file; every value is bound.
 * Rows and the total come back from one statement (count(*) OVER ()).
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
    const expression = await resolveExpression(table, config, column);
    params.push(value);
    // Joined names (a category, a customer) match regardless of letter case.
    conditions.push(
      expression.virtual && typeof value === 'string'
        ? `lower(${expression.sql}) = lower($${params.length})`
        : `${expression.sql} = $${params.length}`
    );
  }

  // [{ column, from, to }] - used for date windows and numeric bounds.
  // With `timezone`, from/to are calendar dates in that zone and `to` is
  // inclusive of the whole day.
  for (const range of ranges) {
    if (!range?.column) continue;
    await assertColumn(table, range.column);
    if (range.timezone) {
      params.push(range.timezone);
      const zone = `$${params.length}`;
      if (range.from) {
        params.push(range.from);
        conditions.push(`t.${range.column} >= ($${params.length}::date::timestamp AT TIME ZONE ${zone})`);
      }
      if (range.to) {
        params.push(range.to);
        conditions.push(`t.${range.column} < (($${params.length}::date + 1)::timestamp AT TIME ZONE ${zone})`);
      }
      continue;
    }
    if (range.from !== undefined && range.from !== null && range.from !== '') {
      params.push(range.from);
      conditions.push(`t.${range.column} >= $${params.length}`);
    }
    if (range.to !== undefined && range.to !== null && range.to !== '') {
      params.push(range.to);
      conditions.push(`t.${range.column} ${range.exclusiveTo ? '<' : '<='} $${params.length}`);
    }
  }

  const needle = String(search ?? '').trim();
  if (needle && config.searchable?.length) {
    params.push(`%${escapeLike(needle)}%`);
    const placeholder = `$${params.length}`;
    // ILIKE is served by the trigram GIN indexes on the main name columns.
    const parts = config.searchable.map((column) => `t.${column} ILIKE ${placeholder}`);
    // Joined display names are searchable too, so typing a customer's name
    // finds their sales.
    for (const join of config.joins || []) {
      for (const expression of Object.values(join.columns)) parts.push(`${expression} ILIKE ${placeholder}`);
    }
    conditions.push(`(${parts.join(' OR ')})`);
  }

  const joinSql = (config.joins || []).map((j) => ` LEFT JOIN ${j.table} ${j.alias} ON ${j.on}`).join('');

  const selectSql = [
    't.*',
    ...(config.joins || []).flatMap((j) => Object.entries(j.columns).map(([alias, expression]) => `${expression} AS ${alias}`)),
    ...Object.entries(config.computed || {}).map(([alias, expression]) => `${expression} AS ${alias}`),
  ].join(', ');

  const whereSql = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  const whereParams = [...params];

  const sortExpression = (await resolveExpression(table, config, sort || config.defaultSort)).sql;
  const sortDir = String(dir || config.defaultDir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  // NULLS LAST so blanks never crowd the top of a list; id as a tiebreak so
  // paging is stable when many rows share a value.
  const orderSql = ` ORDER BY ${sortExpression} ${sortDir} NULLS LAST, t.id ${sortDir}`;

  let sql = `SELECT ${selectSql}, count(*) OVER () AS __total FROM ${table} t${joinSql}${whereSql}${orderSql}`;

  let page = 1;
  let pageSize = null;
  if (paginate) {
    pageSize = Math.min(Math.max(Number(options.pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    page = Math.max(Number(options.page) || 1, 1);
    params.push(pageSize, (page - 1) * pageSize);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;
  }

  const { rows } = await db.query(sql, params);
  let total;
  if (rows.length) {
    total = Number(rows[0].__total);
  } else if (page > 1) {
    // Past the end: count separately so the pager can still show the real total.
    const counted = await db.query(`SELECT count(*) AS count FROM ${table} t${joinSql}${whereSql}`, whereParams);
    total = Number(counted.rows[0].count);
  } else {
    total = 0;
  }
  for (const row of rows) delete row.__total;

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
  TABLES, INTERNAL_COLUMNS, assertTable, assertColumn, describeTable, listColumns, listRows, readListQuery,
  badRequest, invalidateSchemaCache, escapeLike, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE,
};
