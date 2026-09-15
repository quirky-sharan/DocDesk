const { assertTable, describeTable, listColumns, badRequest } = require('../tables');

/**
 * The vocabulary of things a natural-language request is allowed to become.
 *
 * The model NEVER emits SQL. It picks one of these operations and fills in its
 * fields; this module then validates every identifier against the live schema
 * and the executor builds the statement itself. That is the whole safety story:
 * a hallucinated or hostile model response can at worst be a rejected
 * operation, never an executed statement.
 */

const OPERATIONS = {
  sort: {
    label: 'Sort rows',
    destructive: false,
    // Wording follows the column type: "lowest first" is meaningless for a
    // name, and "A to Z" is meaningless for a price.
    describe: (op) => {
      const order = op.isText
        ? op.direction === 'desc' ? 'Z to A' : 'A to Z'
        : op.direction === 'desc' ? 'highest first' : 'lowest first';
      return `Sort by ${op.column}, ${order}`;
    },
  },
  filter: {
    label: 'Show only matching rows',
    destructive: false,
    describe: (op) =>
      `Show only rows where ${op.match === 'any' ? 'any' : 'all'} of: ` +
      op.conditions.map((c) => `${c.column} ${c.operator} ${c.value}`).join(', '),
  },
  add_column: {
    label: 'Add a column',
    destructive: false,
    changesSchema: true,
    describe: (op) => `Add a new ${op.columnType} column called "${op.name}"`,
  },
  rename_column: {
    label: 'Rename a column',
    destructive: false,
    changesSchema: true,
    describe: (op) => `Rename "${op.from}" to "${op.to}"`,
  },
  drop_column: {
    label: 'Delete a column',
    destructive: true,
    changesSchema: true,
    describe: (op) => `Permanently delete the "${op.name}" column and everything in it`,
  },
  set_values: {
    label: 'Change values',
    destructive: true,
    describe: (op) => {
      const target = op.conditions?.length
        ? `rows where ${op.conditions.map((c) => `${c.column} ${c.operator} ${c.value}`).join(' and ')}`
        : 'every row';
      return `Set ${op.assignments.map((a) => `${a.column} to ${a.value}`).join(', ')} on ${target}`;
    },
  },
  summarize: {
    label: 'Summarise',
    destructive: false,
    describe: (op) =>
      `${op.metrics.map((m) => `${m.fn} of ${m.column === '*' ? 'rows' : m.column}`).join(', ')}` +
      (op.groupBy ? `, grouped by ${op.groupBy}` : ''),
  },
};

const OPERATORS = {
  '=': '=',
  '!=': '!=',
  '>': '>',
  '>=': '>=',
  '<': '<',
  '<=': '<=',
  contains: 'LIKE',
  starts_with: 'LIKE',
  is_empty: 'IS NULL',
  is_not_empty: 'IS NOT NULL',
};

// The column types a person can ask for, as PostgreSQL types.
const COLUMN_TYPES = {
  text: 'text',
  number: 'numeric(14,2)',
  integer: 'integer',
  date: 'date',
  boolean: 'boolean',
};

const AGGREGATES = { count: 'COUNT', sum: 'SUM', avg: 'AVG', min: 'MIN', max: 'MAX' };

// Columns the app's own logic or the database's rules depend on. They can be
// read, but not overwritten in bulk - money totals and payment status follow
// from their lines and payments, keys hold records together.
const PROTECTED_COLUMNS = new Set([
  'id', 'created_at', 'updated_at', 'row_version', 'reference', 'sale_id', 'purchase_order_id', 'product_id',
  'category_id', 'supplier_id', 'customer_id', 'subtotal', 'discount', 'tax', 'tax_rate', 'total', 'amount_paid',
  'payment_status', 'line_total', 'quantity_received', 'stored_name', 'kind',
]);

// The columns DocDesk itself is built on (db/migrations/002_tables.sql). Only
// columns someone added can be renamed or deleted - removing "phone" would
// break every form that saves one.
const BASE_COLUMNS = {
  products: ['id', 'sku', 'name', 'description', 'category_id', 'unit', 'cost_price', 'sale_price', 'stock_quantity', 'reorder_level', 'supplier_id', 'is_active', 'created_at', 'updated_at', 'row_version'],
  customers: ['id', 'name', 'phone', 'email', 'address', 'notes', 'created_at', 'updated_at', 'row_version'],
  suppliers: ['id', 'name', 'contact_name', 'phone', 'email', 'address', 'notes', 'created_at', 'updated_at', 'row_version'],
  sales: ['id', 'reference', 'customer_id', 'subtotal', 'discount', 'tax_rate', 'tax', 'total', 'amount_paid', 'payment_status', 'payment_method', 'notes', 'created_at', 'updated_at'],
  purchase_orders: ['id', 'reference', 'supplier_id', 'status', 'expected_date', 'received_date', 'total', 'notes', 'created_at', 'updated_at'],
  sale_items: ['id', 'sale_id', 'product_id', 'description', 'quantity', 'unit_price', 'unit_cost', 'line_total'],
  purchase_order_items: ['id', 'purchase_order_id', 'product_id', 'description', 'quantity', 'quantity_received', 'unit_cost', 'line_total'],
  message_log: ['id', 'channel', 'recipient', 'subject', 'body', 'trigger_type', 'status', 'related_type', 'related_id', 'error', 'created_at', 'sent_at'],
  files: ['id', 'stored_name', 'original_name', 'mime_type', 'size_bytes', 'description', 'related_type', 'related_id', 'created_at'],
};

function normaliseColumnName(raw) {
  const name = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(name)) {
    throw badRequest(
      `"${raw}" is not a usable column name. Use letters, numbers and spaces, starting with a letter.`
    );
  }
  return name;
}

async function columnNames(table) {
  return (await describeTable(table)).map((c) => c.name);
}

/**
 * Finds a column by name. Reads (sort, filter, summarise) may also use the
 * joined display columns such as a product's category; changes may only name
 * real columns.
 */
async function assertExisting(table, column, label = 'column', { virtual = false } = {}) {
  const columns = virtual ? await listColumns(table) : await describeTable(table);
  const names = columns.filter((c) => c.name !== 'row_version').map((c) => c.name);
  const wanted = String(column || '').trim().toLowerCase();
  const match = names.find((n) => n.toLowerCase() === wanted);
  if (!match) {
    throw badRequest(
      `There is no ${label} called "${column}". Available: ${names.filter((n) => !n.startsWith('_') && !n.endsWith('_id')).join(', ')}`
    );
  }
  return match;
}

function assertUnprotected(column, verb) {
  if (PROTECTED_COLUMNS.has(column)) {
    throw badRequest(`"${column}" is used by DocDesk itself and can't be ${verb}.`);
  }
}

function assertCustomColumn(table, column, verb) {
  assertUnprotected(column, verb);
  if ((BASE_COLUMNS[table] || []).includes(column)) {
    throw badRequest(`"${column}" is one of DocDesk's own columns, so it can't be ${verb}. Only columns you added can be.`);
  }
}

async function validateConditions(table, rawConditions) {
  const conditions = [];
  for (const raw of rawConditions || []) {
    const column = await assertExisting(table, raw.column, 'column', { virtual: true });
    const operator = String(raw.operator || '=').toLowerCase();
    if (!OPERATORS[operator]) {
      throw badRequest(`"${raw.operator}" isn't a comparison I understand.`);
    }
    const needsValue = operator !== 'is_empty' && operator !== 'is_not_empty';
    if (needsValue && (raw.value === undefined || raw.value === null || raw.value === '')) {
      throw badRequest(`The comparison on "${column}" is missing a value.`);
    }
    conditions.push({ column, operator, value: needsValue ? raw.value : null });
  }
  return conditions;
}

/**
 * Models phrase the same operation in a few shapes. All of these mean one thing:
 *   {"type":"add_column","name":"x"}
 *   {"type":"add_column","add_column":{"name":"x"}}
 *   {"add_column":{"name":"x"}}
 * Collapse them to the first before validating, rather than rejecting a correct
 * answer over punctuation and making the model retry.
 */
function normaliseShape(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  let out = { ...raw };
  if (!out.type) {
    const keys = Object.keys(out).filter((k) => OPERATIONS[k.toLowerCase()]);
    if (keys.length === 1) out = { type: keys[0].toLowerCase(), ...out };
  }
  const type = String(out.type || '').toLowerCase();
  const nested = out[type];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    out = { ...nested, ...out, type };
    delete out[type];
  }
  return out;
}

/**
 * Takes whatever the model produced and returns a validated operation, or
 * throws with a message a non-technical user can act on.
 */
async function validateOperation(table, raw) {
  assertTable(table);
  if (!raw || typeof raw !== 'object') throw badRequest('I could not work out what to do with that.');

  raw = normaliseShape(raw);
  const type = String(raw.type || '').toLowerCase();
  if (raw[type] && typeof raw[type] === 'object' && !Array.isArray(raw[type])) {
    raw = { ...raw[type], ...raw, type };
    delete raw[type];
  }
  if (!OPERATIONS[type]) {
    throw badRequest(
      `I can sort, filter, add or rename a column, change values, or summarise. I couldn't map that request onto one of those.`
    );
  }

  switch (type) {
    case 'sort': {
      const column = await assertExisting(table, raw.column, 'column', { virtual: true });
      const meta = (await listColumns(table)).find((c) => c.name === column);
      return {
        type,
        column,
        direction: String(raw.direction || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc',
        isText: /char|text/i.test(meta?.type || ''),
      };
    }

    case 'filter': {
      const conditions = await validateConditions(table, raw.conditions);
      if (!conditions.length) throw badRequest('That filter had no conditions in it.');
      return { type, conditions, match: raw.match === 'any' ? 'any' : 'all' };
    }

    case 'add_column': {
      const name = normaliseColumnName(raw.name);
      const existing = (await listColumns(table)).map((c) => c.name);
      if (existing.some((n) => n.toLowerCase() === name)) {
        throw badRequest(`There is already a column called "${name}".`);
      }
      const columnType = String(raw.type_hint || raw.column_type || 'text').toLowerCase();
      if (!COLUMN_TYPES[columnType]) {
        throw badRequest(`"${columnType}" isn't a column type I can create.`);
      }
      return { type, name, columnType, label: String(raw.name).trim() };
    }

    case 'rename_column': {
      const from = await assertExisting(table, raw.from);
      assertCustomColumn(table, from, 'renamed');
      const to = normaliseColumnName(raw.to);
      const existing = await columnNames(table);
      if (existing.some((n) => n.toLowerCase() === to)) {
        throw badRequest(`There is already a column called "${to}".`);
      }
      return { type, from, to };
    }

    case 'drop_column': {
      const name = await assertExisting(table, raw.name);
      assertCustomColumn(table, name, 'deleted');
      return { type, name };
    }

    case 'set_values': {
      const assignments = [];
      for (const raw_ of raw.assignments || []) {
        const column = await assertExisting(table, raw_.column);
        assertUnprotected(column, 'changed this way');
        assignments.push({ column, value: raw_.value ?? null });
      }
      if (!assignments.length) throw badRequest('That change had no new values in it.');
      return { type, assignments, conditions: await validateConditions(table, raw.conditions) };
    }

    case 'summarize': {
      const metrics = [];
      for (const metric of raw.metrics || []) {
        const fn = String(metric.fn || 'count').toLowerCase();
        if (!AGGREGATES[fn]) throw badRequest(`"${metric.fn}" isn't a summary I can calculate.`);
        const column = metric.column === '*' || fn === 'count' && !metric.column
          ? '*'
          : await assertExisting(table, metric.column, 'column', { virtual: true });
        metrics.push({ fn, column });
      }
      if (!metrics.length) metrics.push({ fn: 'count', column: '*' });
      return {
        type,
        metrics,
        groupBy: raw.group_by || raw.groupBy ? await assertExisting(table, raw.group_by || raw.groupBy, 'column', { virtual: true }) : null,
      };
    }

    default:
      throw badRequest('That is not something I can do.');
  }
}

function describe(op) {
  return OPERATIONS[op.type].describe(op);
}

function isDestructive(op) {
  return Boolean(OPERATIONS[op.type]?.destructive);
}

function changesSchema(op) {
  return Boolean(OPERATIONS[op.type]?.changesSchema);
}

module.exports = {
  OPERATIONS, OPERATORS, COLUMN_TYPES, AGGREGATES, PROTECTED_COLUMNS, BASE_COLUMNS,
  validateOperation, normaliseShape, describe, isDestructive, changesSchema, normaliseColumnName,
};
