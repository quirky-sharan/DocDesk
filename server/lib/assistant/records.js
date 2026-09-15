const api = require('./internalApi');

class ToolError extends Error {}

/**
 * Everything the assistant needs to know about each table: where its API lives,
 * which page shows it, and which fields a person would use to name a row.
 */
const TABLE_META = {
  products: {
    path: '/products',
    page: '/inventory',
    label: 'product',
    plural: 'products',
    nameFields: ['name', 'sku'],
    display: (r) => r.name,
    columns: [
      ['name', 'Product'], ['category', 'Category'], ['stock_quantity', 'Stock'], ['sale_price', 'Price'],
    ],
    filters: ['category', 'stock', 'supplier_id'],
  },
  customers: {
    path: '/customers',
    page: '/customers',
    label: 'customer',
    plural: 'customers',
    nameFields: ['name', 'phone', 'email'],
    display: (r) => r.name,
    columns: [['name', 'Name'], ['phone', 'Phone'], ['email', 'Email']],
    filters: [],
  },
  suppliers: {
    path: '/suppliers',
    page: '/suppliers',
    label: 'supplier',
    plural: 'suppliers',
    nameFields: ['name', 'contact_name', 'email', 'phone'],
    display: (r) => r.name,
    columns: [['name', 'Name'], ['contact_name', 'Contact'], ['phone', 'Phone']],
    filters: [],
  },
  sales: {
    path: '/sales',
    page: '/sales',
    label: 'sale',
    plural: 'sales',
    nameFields: ['reference'],
    display: (r) => r.reference,
    columns: [['reference', 'Receipt'], ['customer_name', 'Customer'], ['payment_status', 'Payment'], ['total', 'Total']],
    filters: ['payment_status', 'from', 'to'],
  },
  purchase_orders: {
    path: '/purchase-orders',
    page: '/orders',
    label: 'purchase order',
    plural: 'purchase orders',
    nameFields: ['reference'],
    display: (r) => r.reference,
    columns: [['reference', 'Order'], ['supplier_name', 'Supplier'], ['status', 'Status'], ['total', 'Cost']],
    filters: ['status'],
  },
  files: {
    path: '/files',
    page: '/files',
    label: 'file',
    plural: 'files',
    nameFields: ['original_name'],
    display: (r) => r.original_name,
    columns: [['original_name', 'File'], ['mime_type', 'Type'], ['size_bytes', 'Size']],
    filters: ['kind'],
  },
  message_log: {
    path: '/messages',
    page: '/messages',
    label: 'message',
    plural: 'messages',
    nameFields: ['subject'],
    display: (r) => r.subject,
    columns: [['subject', 'Message'], ['status', 'Status'], ['trigger_type', 'Trigger']],
    filters: ['status'],
    noSingleGet: true,
  },
};

// What people say, mapped to real sort columns. The API rejects unknown
// columns anyway; this just saves a failed round trip on the common words.
const SORT_ALIASES = {
  products: {
    price: 'sale_price', cost: 'cost_price', stock: 'stock_quantity', quantity: 'stock_quantity',
    qty: 'stock_quantity', date: 'created_at', added: 'created_at', newest: 'created_at',
    supplier: 'supplier_name', code: 'sku',
  },
  sales: {
    date: 'created_at', when: 'created_at', newest: 'created_at', amount: 'total', price: 'total',
    customer: 'customer_name', status: 'payment_status', payment: 'payment_status', receipt: 'reference',
  },
  purchase_orders: {
    date: 'created_at', expected: 'expected_date', supplier: 'supplier_name', cost: 'total', amount: 'total',
  },
  files: { name: 'original_name', size: 'size_bytes', date: 'created_at', type: 'mime_type' },
  message_log: { date: 'created_at', newest: 'created_at' },
  customers: { date: 'created_at', added: 'created_at' },
  suppliers: { date: 'created_at', added: 'created_at', contact: 'contact_name' },
};

function meta(table) {
  const found = TABLE_META[table];
  if (!found) {
    throw new ToolError(`Unknown table "${table}". Use one of: ${Object.keys(TABLE_META).join(', ')}.`);
  }
  return found;
}

function normaliseSort(table, sort) {
  if (!sort) return undefined;
  const key = String(sort).trim().toLowerCase().replace(/\s+/g, '_');
  return SORT_ALIASES[table]?.[key] || key;
}

async function fetchFull(table, row) {
  const m = meta(table);
  if (m.noSingleGet) return row;
  return api.get(`${m.path}/${row.id}`);
}

function describeCandidates(table, rows) {
  const m = meta(table);
  return rows
    .slice(0, 6)
    .map((r) => {
      const extra = m.nameFields.slice(1).map((f) => r[f]).filter(Boolean).join(', ');
      return `${m.display(r)}${extra ? ` (${extra})` : ''}`;
    })
    .join('; ');
}

/**
 * Turns whatever the model called a record ("Priya", "S-1003", "A4 paper", 12)
 * into exactly one row, or explains why it can't - so the model asks the user
 * instead of acting on a guess.
 */
async function resolveRecord(table, ref) {
  const m = meta(table);
  if (ref === undefined || ref === null || String(ref).trim() === '') {
    throw new ToolError(`Which ${m.label}? Ask the user.`);
  }
  const text = String(ref).trim();

  if (/^\d+$/.test(text) && !m.noSingleGet) {
    try {
      return await api.get(`${m.path}/${text}`);
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  const { rows } = await api.get(m.path, { search: text, pageSize: 25 });
  const lower = text.toLowerCase();
  const exact = rows.filter((r) =>
    m.nameFields.some((f) => String(r[f] ?? '').trim().toLowerCase() === lower)
  );

  if (exact.length === 1) return fetchFull(table, exact[0]);
  if (exact.length > 1) {
    throw new ToolError(
      `More than one ${m.label} is called "${text}": ${describeCandidates(table, exact)}. Ask the user which one.`
    );
  }
  if (rows.length === 1) return fetchFull(table, rows[0]);
  if (!rows.length) {
    throw new ToolError(`No ${m.label} matches "${text}". Tell the user, and offer to look for something similar or create it.`);
  }
  throw new ToolError(
    `"${text}" matches ${rows.length} ${m.plural}: ${describeCandidates(table, rows)}. Ask the user which one.`
  );
}

// Keeps tool results small: the model reads them on every later step, and long
// descriptions or empty fields cost tokens without adding meaning.
const NOISE = new Set(['is_active', 'updated_at', 'stored_name', 'password_hash']);

function compact(row) {
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (NOISE.has(key) || value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map((v) => (typeof v === 'object' ? compact(v) : v));
    } else if (typeof value === 'string' && value.length > 160) {
      out[key] = `${value.slice(0, 157)}...`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function tableBlock(table, rows, { title, total } = {}) {
  const m = meta(table);
  return {
    type: 'table',
    table,
    title: title || `${m.plural[0].toUpperCase()}${m.plural.slice(1)}`,
    columns: m.columns.map(([key, label]) => ({ key, label })),
    rows: rows.slice(0, 10).map((r) => {
      const out = { id: r.id };
      for (const [key] of m.columns) out[key] = r[key] ?? null;
      return out;
    }),
    total: total ?? rows.length,
    page: m.page,
  };
}

module.exports = { TABLE_META, SORT_ALIASES, ToolError, meta, normaliseSort, resolveRecord, compact, tableBlock };
