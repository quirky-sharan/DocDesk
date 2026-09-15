const api = require('./internalApi');
const {
  TABLE_META, ToolError, meta, normaliseSort, resolveRecord, compact, tableBlock,
} = require('./records');
const { describeTable } = require('../tables');
const { validateOperation, normaliseShape, describe: describeOperation, isDestructive } = require('../nlq/operations');
const { preview: previewOperation, apply: applyOperation } = require('../nlq/execute');

/**
 * Tool kinds:
 *   read  - runs immediately; returns data for the model and optionally a card
 *   ui    - runs immediately; tells the browser to do something (navigate, download)
 *   write - never runs immediately. prepare() resolves and validates everything,
 *           returns a plain description, and the change only happens after the
 *           person clicks Confirm. That is the guard against both model mistakes
 *           and instructions hidden inside stored data.
 */

const PAGES = {
  dashboard: '/', reports: '/reports', inventory: '/inventory', products: '/inventory', sales: '/sales',
  orders: '/orders', purchase_orders: '/orders', 'incoming stock': '/orders', customers: '/customers',
  suppliers: '/suppliers', files: '/files', messages: '/messages', settings: '/settings',
};

const WRITABLE_TABLES = ['products', 'customers', 'suppliers'];

const FIELDS = {
  products: ['name', 'sku', 'category', 'unit', 'cost_price', 'sale_price', 'stock_quantity', 'reorder_level', 'description', 'supplier_id'],
  customers: ['name', 'phone', 'email', 'address', 'notes'],
  suppliers: ['name', 'contact_name', 'phone', 'email', 'address', 'notes'],
};

const LABELS = {
  name: 'Name', sku: 'Code', category: 'Category', unit: 'Unit', cost_price: 'Cost price',
  sale_price: 'Sale price', stock_quantity: 'Stock', reorder_level: 'Reorder level',
  description: 'Description', supplier_id: 'Supplier', phone: 'Phone', email: 'Email',
  address: 'Address', notes: 'Notes', contact_name: 'Contact',
};

function label(key) {
  return LABELS[key] || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function money(value, currency = '') {
  return `${currency}${Number(value || 0).toFixed(2)}`;
}

function obj(properties, required = []) {
  return { type: 'object', properties, required };
}

const TABLE_ENUM = { type: 'string', enum: Object.keys(TABLE_META) };

function listFilters(table, filters = {}) {
  const allowed = TABLE_META[table].filters;
  const out = {};
  for (const [key, value] of Object.entries(filters || {})) {
    if (!allowed.includes(key)) {
      throw new ToolError(`"${key}" isn't a filter for ${table}. Available: ${allowed.join(', ') || 'none - use search'}.`);
    }
    out[key] = value;
  }
  return out;
}

async function fetchList(table, { search, sort, dir, filters, limit }) {
  const m = meta(table);
  const params = {
    search,
    sort: normaliseSort(table, sort),
    dir,
    pageSize: Math.min(Math.max(Number(limit) || 10, 1), 50),
    ...listFilters(table, filters),
  };
  // A supplier filter by name is friendlier than by id.
  if (table === 'products' && params.supplier_id && !/^\d+$/.test(String(params.supplier_id))) {
    params.supplier_id = (await resolveRecord('suppliers', params.supplier_id)).id;
  }
  const result = await api.get(m.path, params);
  return { ...result, params };
}

async function extraColumns(table) {
  const standard = new Set([...(FIELDS[table] || []), 'id', 'created_at', 'updated_at', 'is_active']);
  return (await describeTable(table)).map((c) => c.name).filter((c) => !standard.has(c));
}

/** Splits values into fields the API understands and columns the user added. */
async function splitValues(table, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ToolError('values must be an object of field: value pairs.');
  }
  const extras = await extraColumns(table);
  const known = {};
  const custom = {};
  for (const [rawKey, value] of Object.entries(values)) {
    const key = rawKey === 'supplier' ? 'supplier_id' : rawKey;
    if (FIELDS[table].includes(key)) known[key] = value;
    else if (extras.includes(key)) custom[key] = value;
    else {
      throw new ToolError(
        `${table} has no field "${rawKey}". Fields: ${[...FIELDS[table], ...extras].join(', ')}. ` +
          'If the user wants a new field, use change_table_structure to add a column first.'
      );
    }
  }
  if (known.supplier_id && !/^\d+$/.test(String(known.supplier_id))) {
    known.supplier_id = (await resolveRecord('suppliers', known.supplier_id)).id;
  }
  return { known, custom };
}

async function applyCustomColumns(table, id, custom) {
  if (!Object.keys(custom).length) return;
  const operation = await validateOperation(table, {
    type: 'set_values',
    assignments: Object.entries(custom).map(([column, value]) => ({ column, value })),
    conditions: [{ column: 'id', operator: '=', value: id }],
  });
  await applyOperation(table, operation);
}

// ---------------------------------------------------------------------------

const TOOLS = {
  // ============================== READ ======================================

  search_records: {
    kind: 'read',
    description: 'Look up records without changing the screen. filters: products{category,stock:in|low|out,supplier_id}, sales{payment_status,from,to (YYYY-MM-DD)}, purchase_orders{status}, message_log{status}, files{kind:image|pdf|document|data}.',
    parameters: obj({
      table: TABLE_ENUM,
      search: { type: 'string', description: 'Free text matched against names, codes, references, customer/supplier names.' },
      sort: { type: 'string', description: 'Column, e.g. sale_price, stock_quantity, name, total, created_at.' },
      dir: { type: 'string', enum: ['asc', 'desc'] },
      filters: { type: 'object' },
      limit: { type: 'integer', description: 'Max rows, default 10, max 50.' },
    }, ['table']),
    async run(args) {
      const { rows, total } = await fetchList(args.table, args);
      return {
        data: { total, showing: rows.length, rows: rows.map(compact) },
        block: rows.length ? tableBlock(args.table, rows, { total }) : null,
      };
    },
  },

  get_details: {
    kind: 'read',
    description: 'Full details of one record by name/code/reference/id; includes line items or history.',
    parameters: obj({ table: TABLE_ENUM, record: { type: 'string' } }, ['table', 'record']),
    async run({ table, record }) {
      const row = await resolveRecord(table, record);
      const data = { record: compact(row) };
      if (table === 'products') {
        data.history = compact(await api.get(`/products/${row.id}/history`).catch(() => ({})));
      }
      if (table === 'customers') {
        data.history = compact(await api.get(`/customers/${row.id}/history`).catch(() => ({})));
      }
      return { data };
    },
  },

  business_overview: {
    kind: 'read',
    description: 'Today/week sales vs previous, stock value, low/out of stock, reorder needs, unpaid, waiting messages.',
    parameters: obj({}),
    async run() {
      const [stock, pulse, month, restock, queued] = await Promise.all([
        api.get('/products/summary'),
        api.get('/reports/pulse'),
        api.get('/reports/summary', { days: 30 }),
        api.get('/products/restock-suggestion'),
        api.get('/messages', { status: 'queued', pageSize: 1 }),
      ]);
      const data = {
        today: pulse.today,
        yesterday: pulse.yesterday,
        thisWeek: pulse.thisWeek,
        lastWeek: pulse.lastWeek,
        weekChangePercent: pulse.weekChangePercent,
        last30Days: { revenue: month.revenue, sales: month.saleCount, estimatedProfit: month.estimatedProfit },
        stock: { products: stock.total, lowStock: stock.lowStock, outOfStock: stock.outOfStock, stockValue: stock.stockValue },
        needsReordering: restock.items.slice(0, 10).map((i) => ({ name: i.name, stock: i.stockQuantity, reorderAt: i.reorderLevel, suggestedOrder: i.suggestedQuantity, supplier: i.supplierName })),
        unpaid: month.outstanding,
        messagesWaiting: queued.total,
      };
      return {
        data,
        block: {
          type: 'stats',
          items: [
            { label: 'Today', value: pulse.today.revenue, money: true, note: `${pulse.today.saleCount} sales` },
            { label: 'This week', value: pulse.thisWeek.revenue, money: true, note: `${pulse.weekChangePercent >= 0 ? '+' : ''}${pulse.weekChangePercent}% vs last week` },
            { label: 'Low / out of stock', value: `${stock.lowStock} / ${stock.outOfStock}` },
            { label: 'Unpaid', value: month.outstanding.amount, money: true, note: `${month.outstanding.count} sales` },
          ],
        },
      };
    },
  },

  sales_report: {
    kind: 'read',
    description: 'Revenue, profit, top products and customers, category and payment splits for a period.',
    parameters: obj({
      days: { type: 'integer', description: 'Last N days (default 30). Ignored if from/to given.' },
      from: { type: 'string', description: 'YYYY-MM-DD' },
      to: { type: 'string', description: 'YYYY-MM-DD' },
    }),
    async run(args) {
      const params = { days: args.days, from: args.from, to: args.to };
      const [summary, products, customers, categories, methods] = await Promise.all([
        api.get('/reports/summary', params),
        api.get('/reports/top-products', { ...params, limit: 5 }),
        api.get('/reports/top-customers', { ...params, limit: 5 }),
        api.get('/reports/by-category', params),
        api.get('/reports/by-payment-method', params),
      ]);
      return {
        data: {
          period: `${summary.from} to ${summary.to}`,
          revenue: summary.revenue,
          sales: summary.saleCount,
          averageSale: summary.averageSale,
          estimatedProfit: summary.estimatedProfit,
          unpaid: summary.outstanding,
          topProducts: products.map((p) => ({ name: p.name, sold: p.quantity, revenue: p.revenue })),
          topCustomers: customers.map((c) => ({ name: c.name, sales: c.saleCount, spent: c.revenue })),
          byCategory: categories.map((c) => ({ category: c.category, revenue: c.revenue })),
          byPaymentMethod: methods.map((m) => ({ method: m.method, revenue: m.revenue })),
        },
        block: {
          type: 'stats',
          title: `${summary.from} to ${summary.to}`,
          items: [
            { label: 'Revenue', value: summary.revenue, money: true },
            { label: 'Sales', value: summary.saleCount },
            { label: 'Average sale', value: summary.averageSale, money: true },
            { label: 'Est. profit', value: summary.estimatedProfit, money: true },
          ],
        },
      };
    },
  },

  restock_suggestions: {
    kind: 'read',
    description: 'Products needing reorder with suggested quantities, grouped by supplier.',
    parameters: obj({}),
    async run() {
      const data = await api.get('/products/restock-suggestion');
      return { data: { count: data.count, bySupplier: data.bySupplier } };
    },
  },

  get_settings: {
    kind: 'read',
    description: 'Business name, address, phone, email, currency, default tax, receipt footer.',
    parameters: obj({}),
    async run() {
      const data = await api.get('/settings');
      return { data: data.values };
    },
  },

  // =============================== UI =======================================

  navigate: {
    kind: 'ui',
    description: 'Open a page.',
    parameters: obj({ page: { type: 'string', enum: Object.keys(PAGES) } }, ['page']),
    async run({ page }) {
      const path = PAGES[String(page).toLowerCase()];
      if (!path) throw new ToolError(`Unknown page "${page}".`);
      return { data: { opened: path }, clientAction: { type: 'navigate', path } };
    },
  },

  show_on_page: {
    kind: 'ui',
    description: 'Open the page and apply search/sort/filters so the user SEES the list. Same filters as search_records.',
    parameters: obj({
      table: TABLE_ENUM,
      search: { type: 'string' },
      sort: { type: 'string' },
      dir: { type: 'string', enum: ['asc', 'desc'] },
      filters: { type: 'object' },
    }, ['table']),
    async run(args) {
      const { rows, total, params } = await fetchList(args.table, { ...args, limit: 10 });
      const m = meta(args.table);
      return {
        data: { total, firstRows: rows.map(compact) },
        block: rows.length ? tableBlock(args.table, rows, { total }) : null,
        clientAction: {
          type: 'view',
          path: m.page,
          table: args.table,
          view: {
            search: params.search || '',
            sort: params.sort,
            dir: params.dir,
            filters: listFilters(args.table, args.filters),
          },
        },
      };
    },
  },

  export_table: {
    kind: 'ui',
    description: 'Download a table as csv/xlsx/json/pdf.',
    parameters: obj({
      table: TABLE_ENUM,
      format: { type: 'string', enum: ['csv', 'xlsx', 'json', 'pdf'] },
      search: { type: 'string' },
      sort: { type: 'string' },
      dir: { type: 'string', enum: ['asc', 'desc'] },
    }, ['table', 'format']),
    async run({ table, format, search, sort, dir }) {
      meta(table);
      const params = new URLSearchParams();
      params.set('format', format);
      if (search) params.set('search', search);
      if (sort) params.set('sort', normaliseSort(table, sort));
      if (dir) params.set('dir', dir);
      const url = `/api/export/${table}?${params}`;
      // Check it renders before telling the user it's ready.
      const check = await fetch(`http://127.0.0.1:${Number(process.env.PORT) || 5000}${url}`, { method: 'GET' });
      if (!check.ok) {
        const body = await check.json().catch(() => ({}));
        throw new ToolError(body.error || 'That export could not be created.');
      }
      const labelText = `${TABLE_META[table].plural} as ${format.toUpperCase()}`;
      return {
        data: { downloading: labelText },
        block: { type: 'download', label: `Download ${labelText}`, url },
        clientAction: { type: 'download', url },
      };
    },
  },

  download_receipt: {
    kind: 'ui',
    description: 'Download a sale\'s PDF receipt.',
    parameters: obj({ sale: { type: 'string', description: 'Receipt reference like S-1003, or id.' } }, ['sale']),
    async run({ sale }) {
      const row = await resolveRecord('sales', sale);
      const url = `/api/sales/${row.id}/receipt.pdf`;
      return {
        data: { receipt: row.reference, total: row.total },
        block: { type: 'download', label: `Receipt ${row.reference} (PDF)`, url },
        clientAction: { type: 'download', url },
      };
    },
  },

  // ============================== WRITE =====================================

  create_record: {
    kind: 'write',
    description: 'Add a product/customer/supplier. products: name*,sku,category,unit,cost_price,sale_price,stock_quantity,reorder_level,description,supplier. customers: name*,phone,email,address,notes. suppliers: name*,contact_name,phone,email,address,notes. User-added columns allowed.',
    parameters: obj({
      table: { type: 'string', enum: WRITABLE_TABLES },
      values: { type: 'object' },
    }, ['table', 'values']),
    async prepare({ table, values }) {
      const { known, custom } = await splitValues(table, values);
      if (!known.name) throw new ToolError(`A ${table.slice(0, -1)} needs a name. Ask the user.`);
      const supplierName = known.supplier_id ? (await api.get(`/suppliers/${known.supplier_id}`)).name : null;
      const lines = Object.entries({ ...known, ...custom }).map(([k, v]) => [
        label(k), k === 'supplier_id' ? supplierName : v,
      ]);
      return {
        title: `Add ${TABLE_META[table].label}`,
        summary: `Add ${TABLE_META[table].label} "${known.name}"`,
        lines,
        async run() {
          const created = await api.post(TABLE_META[table].path, known);
          await applyCustomColumns(table, created.id, custom);
          return {
            message: `Added ${TABLE_META[table].label} "${created.name}".`,
            data: compact(created),
            refresh: [table],
          };
        },
      };
    },
  },

  update_record: {
    kind: 'write',
    description: 'Change fields on a product/customer/supplier. Pass only changed fields.',
    parameters: obj({
      table: { type: 'string', enum: WRITABLE_TABLES },
      record: { type: 'string', description: 'Name, code, phone or id of the record.' },
      values: { type: 'object' },
    }, ['table', 'record', 'values']),
    async prepare({ table, record, values }) {
      const existing = await resolveRecord(table, record);
      const { known, custom } = await splitValues(table, values);
      const changes = [];
      for (const [k, v] of Object.entries({ ...known, ...custom })) {
        if (String(existing[k] ?? '') !== String(v ?? '')) changes.push([label(k), `${existing[k] ?? '—'} → ${v ?? '—'}`]);
      }
      if (!changes.length) throw new ToolError('Those values are already set. Nothing to change.');
      const m = TABLE_META[table];
      return {
        title: `Update ${m.label}`,
        summary: `Update ${m.label} "${m.display(existing)}"`,
        lines: changes,
        async run() {
          // The API replaces the whole record, so merge onto what's there.
          const merged = {};
          for (const field of FIELDS[table]) merged[field] = existing[field];
          Object.assign(merged, known);
          const updated = await api.put(`${m.path}/${existing.id}`, merged);
          await applyCustomColumns(table, existing.id, custom);
          return { message: `Updated ${m.label} "${m.display(updated)}".`, data: compact(updated), refresh: [table] };
        },
      };
    },
  },

  delete_record: {
    kind: 'write',
    destructive: true,
    description: 'Permanently delete one record. Deleting a sale restores its stock.',
    parameters: obj({
      table: TABLE_ENUM,
      record: { type: 'string', description: 'Name, reference, code or id.' },
    }, ['table', 'record']),
    async prepare({ table, record }) {
      const m = meta(table);
      const row = await resolveRecord(table, record);
      const lines = [[m.label[0].toUpperCase() + m.label.slice(1), m.display(row)]];
      if (table === 'sales') lines.push(['Total', row.total], ['Effect', 'Items go back into stock']);
      if (table === 'products') lines.push(['Stock', row.stock_quantity], ['Effect', 'Old receipts still show it']);
      if (table === 'customers') lines.push(['Effect', 'Their past sales stay, as walk-ins']);
      return {
        title: `Delete ${m.label}`,
        summary: `Delete ${m.label} "${m.display(row)}"`,
        destructive: true,
        lines,
        async run() {
          await api.del(`${m.path}/${row.id}`);
          return {
            message: `Deleted ${m.label} "${m.display(row)}".`,
            refresh: table === 'sales' ? ['sales', 'products'] : [table],
          };
        },
      };
    },
  },

  adjust_stock: {
    kind: 'write',
    description: 'Add (+) or remove (-) stock outside a sale.',
    parameters: obj({
      product: { type: 'string' },
      change: { type: 'integer' },
      reason: { type: 'string' },
    }, ['product', 'change']),
    async prepare({ product, change, reason }) {
      const row = await resolveRecord('products', product);
      const delta = Number(change);
      if (!Number.isInteger(delta) || delta === 0) throw new ToolError('change must be a non-zero whole number.');
      const next = row.stock_quantity + delta;
      if (next < 0) throw new ToolError(`${row.name} only has ${row.stock_quantity} in stock, so ${Math.abs(delta)} can't be removed.`);
      return {
        title: delta > 0 ? 'Add stock' : 'Remove stock',
        summary: `${delta > 0 ? 'Add' : 'Remove'} ${Math.abs(delta)} ${row.name}`,
        lines: [['Product', row.name], ['Stock', `${row.stock_quantity} → ${next}`], ...(reason ? [['Reason', reason]] : [])],
        async run() {
          const result = await api.post(`/products/${row.id}/stock`, { change: delta, reason });
          return {
            message: `${row.name} is now at ${result.product.stock_quantity}.`,
            data: { stock: result.product.stock_quantity, alertsQueued: result.alertsQueued },
            refresh: ['products', 'message_log'],
          };
        },
      };
    },
  },

  record_sale: {
    kind: 'write',
    description: 'Record a sale; stock moves and a receipt is made. Items: product+quantity, or description+quantity+unit_price. Omit tax_rate for shop default. customer optional.',
    parameters: obj({
      customer: { type: 'string' },
      items: {
        type: 'array',
        items: obj({
          product: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit_price: { type: 'number' },
        }, ['quantity']),
      },
      discount: { type: 'number' },
      tax_rate: { type: 'number' },
      payment_status: { type: 'string', enum: ['paid', 'unpaid', 'partial'] },
      payment_method: { type: 'string', enum: ['cash', 'card', 'upi', 'bank'] },
      notes: { type: 'string' },
    }, ['items']),
    async prepare(args) {
      if (!Array.isArray(args.items) || !args.items.length) throw new ToolError('A sale needs at least one item.');
      const settings = (await api.get('/settings')).values;
      const currency = settings.currency_symbol || '';
      const customer = args.customer ? await resolveRecord('customers', args.customer) : null;

      const items = [];
      const lines = [['Customer', customer ? customer.name : 'Walk-in']];
      let subtotal = 0;
      for (const item of args.items) {
        const quantity = Number(item.quantity);
        if (!(quantity > 0)) throw new ToolError('Every item needs a quantity above zero.');
        if (item.product) {
          const product = await resolveRecord('products', item.product);
          if (product.stock_quantity < quantity) {
            throw new ToolError(`Only ${product.stock_quantity} ${product.name} in stock, but the sale asks for ${quantity}. Tell the user.`);
          }
          const price = item.unit_price ?? Number(product.sale_price);
          subtotal += quantity * price;
          items.push({ product_id: product.id, quantity, unit_price: price });
          lines.push([`${quantity} × ${product.name}`, money(quantity * price, currency)]);
        } else if (item.description) {
          if (item.unit_price === undefined) throw new ToolError(`What does "${item.description}" cost? Ask the user.`);
          subtotal += quantity * Number(item.unit_price);
          items.push({ description: item.description, quantity, unit_price: item.unit_price });
          lines.push([`${quantity} × ${item.description}`, money(quantity * item.unit_price, currency)]);
        } else {
          throw new ToolError('Each item needs a product or a description.');
        }
      }

      const discount = Number(args.discount || 0);
      const taxRate = args.tax_rate ?? Number(settings.default_tax_rate || 0);
      const tax = ((subtotal - discount) * taxRate) / 100;
      if (discount) lines.push(['Discount', `−${money(discount, currency)}`]);
      if (taxRate) lines.push([`Tax (${taxRate}%)`, money(tax, currency)]);
      lines.push(['Total', money(subtotal - discount + tax, currency)]);
      lines.push(['Payment', `${args.payment_status || 'paid'}${args.payment_method ? `, ${args.payment_method}` : ''}`]);

      return {
        title: 'Record sale',
        summary: `Record a sale of ${money(subtotal - discount + tax, currency)}${customer ? ` to ${customer.name}` : ''}`,
        lines,
        async run() {
          const sale = await api.post('/sales', {
            customer_id: customer?.id ?? null,
            items,
            discount,
            tax_rate: taxRate,
            payment_status: args.payment_status || 'paid',
            payment_method: args.payment_method || 'cash',
            notes: args.notes,
          });
          return {
            message: `Recorded ${sale.reference} for ${money(sale.total, currency)}.`,
            data: { reference: sale.reference, total: sale.total },
            block: { type: 'download', label: `Receipt ${sale.reference} (PDF)`, url: `/api/sales/${sale.id}/receipt.pdf` },
            refresh: ['sales', 'products', 'message_log'],
          };
        },
      };
    },
  },

  update_sale_payment: {
    kind: 'write',
    description: 'Change a sale\'s payment status or method.',
    parameters: obj({
      sale: { type: 'string' },
      payment_status: { type: 'string', enum: ['paid', 'unpaid', 'partial', 'refunded'] },
      payment_method: { type: 'string', enum: ['cash', 'card', 'upi', 'bank'] },
    }, ['sale']),
    async prepare({ sale, payment_status, payment_method }) {
      const row = await resolveRecord('sales', sale);
      const lines = [['Sale', `${row.reference} (${row.total})`]];
      if (payment_status) lines.push(['Payment', `${row.payment_status} → ${payment_status}`]);
      if (payment_method) lines.push(['Method', `${row.payment_method || '—'} → ${payment_method}`]);
      if (lines.length === 1) throw new ToolError('Nothing to change - give a payment_status or payment_method.');
      return {
        title: 'Update payment',
        summary: `Update payment on ${row.reference}`,
        lines,
        async run() {
          const updated = await api.put(`/sales/${row.id}`, { payment_status, payment_method });
          return { message: `${updated.reference} is now ${updated.payment_status}.`, refresh: ['sales'] };
        },
      };
    },
  },

  create_purchase_order: {
    kind: 'write',
    description: 'Order stock from a supplier (stock changes only when received).',
    parameters: obj({
      supplier: { type: 'string' },
      items: {
        type: 'array',
        items: obj({
          product: { type: 'string' },
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit_cost: { type: 'number' },
        }, ['quantity']),
      },
      expected_date: { type: 'string', description: 'YYYY-MM-DD' },
      notes: { type: 'string' },
    }, ['items']),
    async prepare(args) {
      if (!Array.isArray(args.items) || !args.items.length) throw new ToolError('An order needs at least one item.');
      const supplier = args.supplier ? await resolveRecord('suppliers', args.supplier) : null;
      const items = [];
      const lines = [['Supplier', supplier ? supplier.name : 'Not specified']];
      let total = 0;
      for (const item of args.items) {
        const quantity = Number(item.quantity);
        if (!(quantity > 0)) throw new ToolError('Every item needs a quantity above zero.');
        if (item.product) {
          const product = await resolveRecord('products', item.product);
          const cost = item.unit_cost ?? Number(product.cost_price);
          total += quantity * cost;
          items.push({ product_id: product.id, quantity, unit_cost: cost });
          lines.push([`${quantity} × ${product.name}`, money(quantity * cost)]);
        } else if (item.description) {
          total += quantity * Number(item.unit_cost || 0);
          items.push({ description: item.description, quantity, unit_cost: item.unit_cost });
          lines.push([`${quantity} × ${item.description}`, money(quantity * (item.unit_cost || 0))]);
        } else {
          throw new ToolError('Each item needs a product or a description.');
        }
      }
      if (args.expected_date) lines.push(['Expected', args.expected_date]);
      lines.push(['Total cost', money(total)]);
      return {
        title: 'Create purchase order',
        summary: `Order ${items.length} item${items.length === 1 ? '' : 's'}${supplier ? ` from ${supplier.name}` : ''}`,
        lines,
        async run() {
          const order = await api.post('/purchase-orders', {
            supplier_id: supplier?.id ?? null,
            status: 'ordered',
            expected_date: args.expected_date,
            notes: args.notes,
            items,
          });
          return { message: `Created ${order.reference} for ${money(order.total)}.`, data: { reference: order.reference }, refresh: ['purchase_orders'] };
        },
      };
    },
  },

  receive_purchase_order: {
    kind: 'write',
    description: 'Receive a delivery into stock; omit items to receive everything outstanding.',
    parameters: obj({
      order: { type: 'string', description: 'Reference like PO-1002, or id.' },
      items: { type: 'array', items: obj({ product: { type: 'string' }, quantity: { type: 'number' } }, ['product', 'quantity']) },
    }, ['order']),
    async prepare({ order, items }) {
      const row = await resolveRecord('purchase_orders', order);
      if (['received', 'cancelled'].includes(row.status)) throw new ToolError(`${row.reference} is already ${row.status}.`);
      const outstanding = row.items.filter((i) => Number(i.quantity) > Number(i.quantity_received));
      let payload = null;
      const lines = [['Order', `${row.reference}${row.supplier_name ? ` from ${row.supplier_name}` : ''}`]];

      if (items?.length) {
        payload = [];
        for (const wanted of items) {
          const needle = String(wanted.product).toLowerCase();
          const line = outstanding.find((i) => i.description.toLowerCase() === needle)
            || outstanding.find((i) => i.description.toLowerCase().includes(needle));
          if (!line) throw new ToolError(`${row.reference} has nothing outstanding matching "${wanted.product}".`);
          const left = Number(line.quantity) - Number(line.quantity_received);
          if (wanted.quantity > left) throw new ToolError(`Only ${left} of ${line.description} are still due on ${row.reference}.`);
          payload.push({ id: line.id, quantity: wanted.quantity });
          lines.push([line.description, `+${wanted.quantity}`]);
        }
      } else {
        for (const line of outstanding) lines.push([line.description, `+${Number(line.quantity) - Number(line.quantity_received)}`]);
      }

      return {
        title: 'Receive delivery',
        summary: `Receive ${payload ? 'part of ' : ''}${row.reference} into stock`,
        lines,
        async run() {
          const updated = await api.post(`/purchase-orders/${row.id}/receive`, payload ? { items: payload } : {});
          return { message: `${updated.reference} is now ${updated.status}; stock updated.`, refresh: ['purchase_orders', 'products', 'message_log'] };
        },
      };
    },
  },

  send_messages: {
    kind: 'write',
    description: 'Send queued messages (delivery simulated).',
    parameters: obj({}),
    async prepare() {
      const queued = await api.get('/messages', { status: 'queued', pageSize: 5 });
      if (!queued.total) throw new ToolError('There are no messages waiting.');
      return {
        title: 'Send messages',
        summary: `Send ${queued.total} waiting message${queued.total === 1 ? '' : 's'}`,
        lines: queued.rows.map((m) => [m.recipient || 'Shop', m.subject]),
        async run() {
          const result = await api.post('/messages/send', {});
          return { message: `Marked ${result.sent} as sent (delivery is simulated for now).`, refresh: ['message_log'] };
        },
      };
    },
  },

  update_settings: {
    kind: 'write',
    description: 'Change settings: business_name, business_address, business_phone, business_email, currency_symbol, default_tax_rate, receipt_footer.',
    parameters: obj({ values: { type: 'object' } }, ['values']),
    async prepare({ values }) {
      const current = await api.get('/settings');
      const allowed = current.fields.map((f) => f.key);
      const changes = [];
      for (const [k, v] of Object.entries(values || {})) {
        if (!allowed.includes(k)) throw new ToolError(`"${k}" isn't a setting. Settings: ${allowed.join(', ')}.`);
        if (String(current.values[k] ?? '') !== String(v ?? '')) changes.push([current.fields.find((f) => f.key === k).label, `${current.values[k] || '—'} → ${v || '—'}`]);
      }
      if (!changes.length) throw new ToolError('Those settings already have those values.');
      return {
        title: 'Update settings',
        summary: 'Update business settings',
        lines: changes,
        async run() {
          await api.put('/settings', values);
          return { message: 'Settings saved.', refresh: ['settings'] };
        },
      };
    },
  },

  change_table_structure: {
    kind: 'write',
    description: 'operation.type: add_column{name,type_hint:text|number|integer|date|boolean} | rename_column{from,to} | drop_column{name} | set_values{assignments:[{column,value}],conditions:[{column,operator,value}]}. operators: = != > >= < <= contains starts_with is_empty is_not_empty.',
    parameters: obj({
      table: { type: 'string', enum: ['products', 'customers', 'suppliers', 'sales', 'purchase_orders'] },
      operation: { type: 'object' },
    }, ['table', 'operation']),
    async prepare({ table, operation: rawOperation }) {
      const operation = normaliseShape(rawOperation);
      if (!['add_column', 'rename_column', 'drop_column', 'set_values'].includes(operation?.type)) {
        throw new ToolError('operation.type must be add_column, rename_column, drop_column or set_values.');
      }
      let validated;
      try {
        validated = await validateOperation(table, operation);
      } catch (err) {
        throw new ToolError(err.message);
      }
      const preview = await previewOperation(table, validated);
      const lines = [['Table', table]];
      if (preview.affected !== undefined) lines.push(['Rows affected', preview.affected]);
      return {
        title: 'Change table',
        summary: describeOperation(validated),
        destructive: isDestructive(validated),
        lines,
        async run() {
          const result = await applyOperation(table, validated);
          return { message: result.message, refresh: [table] };
        },
      };
    },
  },
};

function toolDefinitions() {
  return Object.entries(TOOLS).map(([name, tool]) => ({
    type: 'function',
    function: { name, description: tool.description, parameters: tool.parameters },
  }));
}

module.exports = { TOOLS, toolDefinitions, ToolError, PAGES };
