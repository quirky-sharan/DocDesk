const db = require('./index');

const SUPPLIERS = [
  ['Northwind Trading', 'Asha Mehta', '+91 98200 11223', 'orders@northwind.example'],
  ['Kapoor Wholesale', 'Ravi Kapoor', '+91 98110 44556', 'sales@kapoor.example'],
];

// [sku, name, category, unit, cost, price, stock, reorder_level]
// Deliberately includes stock below reorder level and a zero-stock item so the
// low-stock and out-of-stock paths have something to show.
const PRODUCTS = [
  ['SKU-001', 'A4 Paper Ream', 'Stationery', 'ream', 210, 285, 48, 10],
  ['SKU-002', 'Ballpoint Pen (Blue)', 'Stationery', 'box', 90, 140, 6, 12],
  ['SKU-003', 'Hand Sanitiser 500ml', 'Hygiene', 'bottle', 115, 180, 0, 8],
  ['SKU-004', 'Nitrile Gloves (M)', 'Hygiene', 'box', 340, 460, 22, 10],
  ['SKU-005', 'Thermal Till Roll', 'Consumables', 'roll', 18, 30, 150, 40],
];

const CUSTOMERS = [
  ['Priya Sharma', '+91 99300 12345', 'priya@example.com'],
  ['Arun Desai', '+91 99300 67890', 'arun@example.com'],
];

async function seed() {
  // Sample rows use fixed SKUs, which are UNIQUE, so a second run would collide.
  // Refuse before touching anything rather than failing partway through, and
  // never silently overwrite records the user may have entered themselves.
  const { rows } = await db.query('SELECT COUNT(*) AS count FROM products');
  if (Number(rows[0].count) > 0) {
    const err = new Error(
      'There are already records in the database. Use "Clear all" first if you want to reload the sample data.'
    );
    err.status = 409;
    throw err;
  }

  return db.transaction(async (tx) => {
    const supplierIds = [];
    for (const [name, contact, phone, email] of SUPPLIERS) {
      const { rows } = await tx.query(
        `INSERT INTO suppliers (name, contact_name, phone, email)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [name, contact, phone, email]
      );
      supplierIds.push(rows[0].id);
    }

    const products = [];
    for (const [i, p] of PRODUCTS.entries()) {
      const { rows } = await tx.query(
        `INSERT INTO products
           (sku, name, category, unit, cost_price, sale_price, stock_quantity, reorder_level, supplier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, name, sale_price`,
        [...p, supplierIds[i % supplierIds.length]]
      );
      products.push(rows[0]);
    }

    const customerIds = [];
    for (const [name, phone, email] of CUSTOMERS) {
      const { rows } = await tx.query(
        `INSERT INTO customers (name, phone, email) VALUES ($1,$2,$3) RETURNING id`,
        [name, phone, email]
      );
      customerIds.push(rows[0].id);
    }

    // One completed sale of two line items, so receipts have real data to read.
    const line = [
      { product: products[0], quantity: 2 },
      { product: products[4], quantity: 3 },
    ];
    const subtotal = line.reduce((sum, l) => sum + l.quantity * Number(l.product.sale_price), 0);
    const tax = Math.round(subtotal * 0.05 * 100) / 100;

    const { rows: saleRows } = await tx.query(
      `INSERT INTO sales (reference, customer_id, subtotal, tax, discount, total, payment_status, payment_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      ['S-1001', customerIds[0], subtotal, tax, 0, subtotal + tax, 'paid', 'cash']
    );
    const saleId = saleRows[0].id;

    for (const l of line) {
      await tx.query(
        `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, line_total)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [saleId, l.product.id, l.product.name, l.quantity, l.product.sale_price,
         l.quantity * Number(l.product.sale_price)]
      );
      await tx.query(
        `UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2`,
        [l.quantity, l.product.id]
      );
    }

    return {
      suppliers: supplierIds.length,
      products: products.length,
      customers: customerIds.length,
      sales: 1,
    };
  });
}

// Order matters: children before parents, so foreign keys stay satisfied.
const CLEAR_ORDER = [
  'sale_items', 'sales', 'purchase_order_items', 'purchase_orders',
  'message_log', 'products', 'customers', 'suppliers',
];

async function clear() {
  return db.transaction(async (tx) => {
    for (const table of CLEAR_ORDER) {
      await tx.query(`DELETE FROM ${table}`);
    }
    return { cleared: CLEAR_ORDER.length };
  });
}

module.exports = { seed, clear };

if (require.main === module) {
  const action = process.argv[2] === 'clear' ? clear : seed;
  action()
    .then(async (result) => {
      console.log(process.argv[2] === 'clear' ? 'cleared' : 'seeded', result);
      await db.close();
    })
    .catch(async (err) => {
      console.error('failed:', err.message);
      await db.close();
      process.exit(1);
    });
}
