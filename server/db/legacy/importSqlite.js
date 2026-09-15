const fs = require('fs');
const path = require('path');
const db = require('../index');

/**
 * One-time carry-over from the SQLite database earlier versions of DocDesk used.
 *
 * Runs at startup when an old `db/docdesk.sqlite` exists and the PostgreSQL
 * database is still empty. Everything is copied in one transaction - either all
 * of it arrives or none does - and the old file is then renamed, not deleted,
 * so nothing is ever lost:
 *
 *   db/docdesk.sqlite  ->  db/docdesk.sqlite.imported-2026-09-15T18-04-05
 *
 * The old schema was looser than the new one, so values are tidied on the way
 * in: categories become their own table, totals are recomputed from their lines
 * so they add up exactly, email addresses that aren't addresses move to notes,
 * and each paid sale gets a matching payment record. Sales that were marked
 * part-paid never recorded how much, so they keep that status with no amount
 * and the integrity check lists them for someone to fill in.
 */

const LEGACY_FILE = process.env.SQLITE_PATH
  ? path.resolve(__dirname, '..', '..', process.env.SQLITE_PATH)
  : path.join(__dirname, '..', 'docdesk.sqlite');

const PART_PAID_NOTE = 'Imported as part-paid: the earlier version did not record how much was paid.';
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const METHODS = { cash: 'cash', card: 'card', upi: 'upi', bank: 'bank', 'bank transfer': 'bank' };

function toInstant(value) {
  if (!value) return null;
  const text = String(value).trim();
  // SQLite's datetime('now') is UTC without a zone marker.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDate(value) {
  const text = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text)) ? text : null;
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function clean(value, max) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

async function needsImport() {
  if (!fs.existsSync(LEGACY_FILE)) return false;
  const { rows } = await db.query(
    'SELECT (SELECT count(*) FROM products) + (SELECT count(*) FROM customers) + (SELECT count(*) FROM suppliers) + (SELECT count(*) FROM sales) AS n'
  );
  return Number(rows[0].n) === 0;
}

async function importLegacySqlite({ log = console.log } = {}) {
  if (!(await needsImport())) return null;

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    log('[import] Found an old docdesk.sqlite, but the SQLite reader is not installed; skipping the carry-over.');
    return null;
  }

  const sqlite = new Database(LEGACY_FILE, { fileMustExist: true });
  const read = (sql) => {
    try {
      return sqlite.prepare(sql).all();
    } catch {
      return []; // a table that never existed in that version
    }
  };

  let data;
  try {
    sqlite.pragma('wal_checkpoint(TRUNCATE)');
    data = {
      settings: read('SELECT key, value FROM settings'),
      suppliers: read('SELECT * FROM suppliers ORDER BY id'),
      customers: read('SELECT * FROM customers ORDER BY id'),
      products: read('SELECT * FROM products ORDER BY id'),
      sales: read('SELECT * FROM sales ORDER BY id'),
      saleItems: read('SELECT * FROM sale_items ORDER BY id'),
      orders: read('SELECT * FROM purchase_orders ORDER BY id'),
      orderItems: read('SELECT * FROM purchase_order_items ORDER BY id'),
      messages: read('SELECT * FROM message_log ORDER BY id'),
      files: read('SELECT * FROM files ORDER BY id'),
      productColumns: read('PRAGMA table_info(products)').map((c) => ({ name: c.name, type: String(c.type || '').toUpperCase() })),
    };
  } finally {
    sqlite.close();
  }

  const started = Date.now();
  const summary = await db.transaction(
    async (tx) => {
      // Side-effect triggers are off while the history is loaded as-is.
      const KNOWN_PRODUCT_COLUMNS = new Set([
        'id', 'sku', 'name', 'description', 'category', 'unit', 'cost_price', 'sale_price', 'stock_quantity',
        'reorder_level', 'supplier_id', 'is_active', 'created_at', 'updated_at',
      ]);

      // Columns someone added with "add a column for ..." come along too.
      const custom = [];
      for (const column of data.productColumns) {
        if (KNOWN_PRODUCT_COLUMNS.has(column.name) || !/^[a-z][a-z0-9_]{0,40}$/.test(column.name)) continue;
        const type = /INT/.test(column.type) ? 'integer' : /REAL|NUM|DOUB|FLOA/.test(column.type) ? 'numeric' : 'text';
        await tx.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ${column.name} ${type}`);
        custom.push(column.name);
      }

      for (const { key, value } of data.settings) {
        if (!/^[a-z][a-z0-9_]{0,79}$/.test(key)) continue;
        await tx.query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
      }

      const emailOrNote = (row) => {
        const email = clean(row.email, 150);
        if (!email || EMAIL.test(email)) return { email, notes: clean(row.notes, 2000) };
        return { email: null, notes: [clean(row.notes, 1900), `Email as entered: ${email}`].filter(Boolean).join('\n') };
      };

      const supplierIds = new Set();
      for (const s of data.suppliers) {
        const { email, notes } = emailOrNote(s);
        await tx.query(
          `INSERT INTO suppliers (id, name, contact_name, phone, email, address, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()), COALESCE($8::timestamptz, now()))`,
          [s.id, clean(s.name, 150) || `Supplier ${s.id}`, clean(s.contact_name, 150), clean(s.phone, 40), email, clean(s.address, 500), notes, toInstant(s.created_at)]
        );
        supplierIds.add(s.id);
      }

      const customerIds = new Set();
      for (const c of data.customers) {
        const { email, notes } = emailOrNote(c);
        await tx.query(
          `INSERT INTO customers (id, name, phone, email, address, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), COALESCE($8::timestamptz, now()))`,
          [c.id, clean(c.name, 150) || `Customer ${c.id}`, clean(c.phone, 40), email, clean(c.address, 500), notes, toInstant(c.created_at), toInstant(c.updated_at)]
        );
        customerIds.add(c.id);
      }

      const categoryIds = new Map();
      for (const p of data.products) {
        const name = clean(p.category, 100);
        if (!name || categoryIds.has(name.toLowerCase())) continue;
        const { rows } = await tx.query('INSERT INTO categories (name) VALUES ($1) RETURNING id', [name]);
        categoryIds.set(name.toLowerCase(), rows[0].id);
      }

      const products = new Map();
      const usedSkus = new Set();
      for (const p of data.products) {
        let sku = clean(p.sku, 80);
        if (sku && usedSkus.has(sku.toLowerCase())) sku = `${sku}-${p.id}`.slice(0, 80);
        if (sku) usedSkus.add(sku.toLowerCase());
        const stock = Math.max(Number(p.stock_quantity) || 0, 0);
        const values = [
          p.id, sku, clean(p.name, 200) || `Product ${p.id}`, clean(p.description, 2000),
          categoryIds.get(String(clean(p.category, 100) || '').toLowerCase()) ?? null,
          clean(p.unit, 40) || 'unit', Math.max(Number(p.cost_price) || 0, 0), Math.max(Number(p.sale_price) || 0, 0),
          stock, Math.max(Number(p.reorder_level) || 0, 0), supplierIds.has(p.supplier_id) ? p.supplier_id : null,
          p.is_active === 0 ? false : true, toInstant(p.created_at), toInstant(p.updated_at),
          ...custom.map((column) => p[column] ?? null),
        ];
        await tx.query(
          `INSERT INTO products (id, sku, name, description, category_id, unit, cost_price, sale_price, stock_quantity, reorder_level, supplier_id, is_active, created_at, updated_at${custom.map((c) => `, ${c}`).join('')})
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13::timestamptz, now()), COALESCE($14::timestamptz, now())${custom.map((_, i) => `, $${15 + i}`).join('')})`,
          values
        );
        products.set(p.id, { cost: Math.max(Number(p.cost_price) || 0, 0), stock });
        if (stock > 0) {
          await tx.query(
            `INSERT INTO stock_movements (product_id, change, balance_after, kind, note, actor)
             VALUES ($1, $2, $2, 'import', 'Stock carried over from the previous version of DocDesk', 'import')`,
            [p.id, stock]
          );
        }
      }

      const itemsBySale = new Map();
      for (const item of data.saleItems) {
        if (!itemsBySale.has(item.sale_id)) itemsBySale.set(item.sale_id, []);
        itemsBySale.get(item.sale_id).push(item);
      }

      let partial = 0;
      for (const s of data.sales) {
        const lines = (itemsBySale.get(s.id) || [])
          .map((item) => ({
            ...item,
            quantity: Math.round((Number(item.quantity) || 0) * 1000) / 1000,
            unitPrice: Math.max(Math.round((Number(item.unit_price) || 0) * 100) / 100, 0),
          }))
          .filter((item) => item.quantity > 0);
        // round(quantity * price, 2) in integer arithmetic, as the database computes it.
        const lineCents = (line) => Math.round((Math.round(line.quantity * 1000) * Math.round(line.unitPrice * 100)) / 1000);
        const subtotal = lines.reduce((sum, line) => sum + lineCents(line), 0);
        const discount = Math.min(Math.max(cents(s.discount), 0), subtotal);
        const tax = Math.max(cents(s.tax), 0);
        const total = subtotal - discount + tax;
        const taxable = subtotal - discount;
        const taxRate = taxable > 0 ? Math.min(Math.round((tax / taxable) * 10000) / 100, 100) : 0;
        const method = METHODS[String(s.payment_method || '').toLowerCase()] || (s.payment_method ? 'other' : null);
        let status = ['unpaid', 'partial', 'paid', 'refunded'].includes(s.payment_status) ? s.payment_status : 'unpaid';
        let notes = clean(s.notes, 1800);
        if (status === 'partial') {
          partial += 1;
          notes = [notes, PART_PAID_NOTE].filter(Boolean).join('\n');
        }
        if (status === 'refunded') status = 'unpaid';
        const createdAt = toInstant(s.created_at);

        await tx.query(
          `INSERT INTO sales (id, reference, customer_id, subtotal, discount, tax_rate, tax, total, amount_paid, payment_status, payment_method, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11, COALESCE($12::timestamptz, now()), COALESCE($12::timestamptz, now()))`,
          [s.id, clean(s.reference, 40) || `S-${1000 + s.id}`, customerIds.has(s.customer_id) ? s.customer_id : null,
           subtotal / 100, discount / 100, taxRate, tax / 100, total / 100, status === 'paid' ? 'unpaid' : status, method, notes, createdAt]
        );

        for (const line of lines) {
          const product = products.get(line.product_id);
          await tx.query(
            `INSERT INTO sale_items (id, sale_id, product_id, description, quantity, unit_price, unit_cost)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [line.id, s.id, product ? line.product_id : null, clean(line.description, 250) || 'Item', line.quantity, line.unitPrice, product ? product.cost : 0]
          );
        }

        if (status === 'paid' && total > 0) {
          await tx.query(
            'INSERT INTO payments (sale_id, amount, method, note, paid_at, created_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()), COALESCE($5::timestamptz, now()))',
            [s.id, total / 100, method || 'other', 'Imported', createdAt]
          );
          await tx.query("UPDATE sales SET amount_paid = total, payment_status = 'paid' WHERE id = $1", [s.id]);
        } else if (status === 'paid') {
          await tx.query("UPDATE sales SET payment_status = 'paid' WHERE id = $1", [s.id]);
        }
      }

      const itemsByOrder = new Map();
      for (const item of data.orderItems) {
        if (!itemsByOrder.has(item.purchase_order_id)) itemsByOrder.set(item.purchase_order_id, []);
        itemsByOrder.get(item.purchase_order_id).push(item);
      }
      for (const o of data.orders) {
        const lines = (itemsByOrder.get(o.id) || []).filter((item) => Number(item.quantity) > 0);
        const total = lines.reduce((sum, line) => sum + Math.round(Math.round(Number(line.quantity) * 1000) * Math.round(Number(line.unit_cost || 0) * 100) / 1000), 0);
        const status = ['draft', 'ordered', 'partial', 'received', 'cancelled'].includes(o.status) ? o.status : 'draft';
        await tx.query(
          `INSERT INTO purchase_orders (id, reference, supplier_id, status, expected_date, received_date, total, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()), COALESCE($9::timestamptz, now()))`,
          [o.id, clean(o.reference, 40) || `PO-${1000 + o.id}`, supplierIds.has(o.supplier_id) ? o.supplier_id : null, status,
           toDate(o.expected_date), toDate(o.received_date), total / 100, clean(o.notes, 2000), toInstant(o.created_at)]
        );
        for (const line of lines) {
          const quantity = Math.round(Number(line.quantity) * 1000) / 1000;
          await tx.query(
            `INSERT INTO purchase_order_items (id, purchase_order_id, product_id, description, quantity, quantity_received, unit_cost)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [line.id, o.id, products.has(line.product_id) ? line.product_id : null, clean(line.description, 250) || 'Item',
             quantity, Math.min(Math.max(Math.round(Number(line.quantity_received || 0) * 1000) / 1000, 0), quantity),
             Math.max(Math.round(Number(line.unit_cost || 0) * 100) / 100, 0)]
          );
        }
      }

      const queuedAlerts = new Set();
      for (const m of [...data.messages].reverse()) {
        const status = ['queued', 'sent', 'failed'].includes(m.status) ? m.status : 'queued';
        const alertKey = `${m.related_type}:${m.related_id}`;
        if (m.trigger_type === 'low_stock' && status === 'queued') {
          if (queuedAlerts.has(alertKey)) continue; // only one waiting alert per product now
          queuedAlerts.add(alertKey);
        }
        await tx.query(
          `INSERT INTO message_log (id, channel, recipient, subject, body, trigger_type, status, related_type, related_id, error, created_at, sent_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, now()), $12::timestamptz)`,
          [m.id, ['email', 'sms', 'whatsapp'].includes(m.channel) ? m.channel : 'email', clean(m.recipient, 200), clean(m.subject, 250),
           m.body, clean(m.trigger_type, 50), status, clean(m.related_type, 40), m.related_id ?? null, m.error, toInstant(m.created_at), toInstant(m.sent_at)]
        );
      }

      const attachable = ['product', 'sale', 'customer', 'supplier', 'purchase_order'];
      for (const f of data.files) {
        const related = attachable.includes(f.related_type) && f.related_id ? [f.related_type, f.related_id] : [null, null];
        await tx.query(
          `INSERT INTO files (id, stored_name, original_name, mime_type, size_bytes, description, related_type, related_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, now()))`,
          [f.id, f.stored_name, clean(f.original_name, 255) || f.stored_name, f.mime_type || 'application/octet-stream',
           Math.max(Number(f.size_bytes) || 0, 0), clean(f.description, 500), related[0], related[1], toInstant(f.created_at)]
        );
      }

      // Identity columns and document numbers continue after the imported rows.
      for (const table of ['suppliers', 'customers', 'categories', 'products', 'sales', 'sale_items', 'payments', 'purchase_orders', 'purchase_order_items', 'stock_movements', 'message_log', 'files']) {
        await tx.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM ${table}), 1), (SELECT count(*) > 0 FROM ${table}))`);
      }
      await tx.query(`SELECT setval('sale_number_seq', GREATEST(1001, COALESCE((SELECT max(substring(reference FROM '^S-(\\d+)$')::bigint) FROM sales), 1000) + 1), false)`);
      await tx.query(`SELECT setval('purchase_order_number_seq', GREATEST(1001, COALESCE((SELECT max(substring(reference FROM '^PO-(\\d+)$')::bigint) FROM purchase_orders), 1000) + 1), false)`);

      return {
        suppliers: data.suppliers.length,
        customers: data.customers.length,
        categories: categoryIds.size,
        products: data.products.length,
        sales: data.sales.length,
        partPaidWithoutAmount: partial,
        purchaseOrders: data.orders.length,
        messages: data.messages.length,
        files: data.files.length,
        customColumns: custom,
      };
    },
    { actor: 'import', settings: { 'docdesk.restoring': 'on' } }
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${LEGACY_FILE}${suffix}`;
    if (fs.existsSync(from)) {
      try {
        fs.renameSync(from, `${LEGACY_FILE}.imported-${stamp}${suffix}`);
      } catch (err) {
        log(`[import] Imported, but could not rename ${path.basename(from)}: ${err.message}`);
      }
    }
  }

  log(`[import] Carried over the previous SQLite database in ${Date.now() - started} ms: ${JSON.stringify(summary)}`);
  return summary;
}

module.exports = { importLegacySqlite, LEGACY_FILE, PART_PAID_NOTE };
