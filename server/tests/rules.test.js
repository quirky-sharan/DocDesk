// The rules the database enforces, tested against a real PostgreSQL.
//
//   npm test            (a throwaway embedded database under db/test-pgdata)
//   DATABASE_URL=...    (a hosted one - the same tests, so a deployment can be
//                        checked before it carries real data)
//
// It never touches the database DocDesk normally uses: with no DATABASE_URL it
// makes its own data folder, and empties every table between tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  process.env.PGDATA_DIR = process.env.TEST_PGDATA_DIR || path.join(__dirname, '..', 'db', 'test-pgdata');
  fs.rmSync(process.env.PGDATA_DIR, { recursive: true, force: true });
  fs.rmSync(`${process.env.PGDATA_DIR}.lock`, { force: true });
}

const db = require('../db');
const { migrate } = require('../db/migrate');

const TABLES = [
  'audit_log', 'stock_movements', 'payments', 'sale_items', 'sales', 'purchase_order_items',
  'purchase_orders', 'message_log', 'files', 'products', 'categories', 'customers', 'suppliers', 'saved_queries',
];

/** Empties the business tables so each test starts from nothing. */
async function reset() {
  await db.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await db.query('ALTER SEQUENCE sale_number_seq RESTART WITH 1001');
  await db.query('ALTER SEQUENCE purchase_order_number_seq RESTART WITH 1001');
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

/** Runs `fn` and returns the error it threw, failing the test if it succeeded. */
async function rejects(fn, expected) {
  let error = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'expected that to be refused, but it went through');
  if (expected) assert.match(error.message, expected);
  return error;
}

async function makeProduct(values = {}) {
  const { name = 'Test product', sku = null, cost = 10, price = 15, stock = 0, reorder = 0 } = values;
  return one(
    `INSERT INTO products (name, sku, cost_price, sale_price, stock_quantity, reorder_level)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, sku, cost, price, stock, reorder]
  );
}

/** A sale with one line, written the way the API writes it: in one transaction. */
async function makeSale({ product, quantity = 1, price = 15, paid = 0, method = 'cash' } = {}) {
  return db.transaction(async (tx) => {
    const line = Number((quantity * price).toFixed(2));
    const { rows } = await tx.query(
      `INSERT INTO sales (customer_id, subtotal, discount, tax, total, amount_paid, payment_status)
       VALUES (NULL, $1, 0, 0, $1, 0, 'unpaid') RETURNING *`,
      [line]
    );
    const sale = rows[0];
    await tx.query(
      `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, unit_cost)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sale.id, product?.id ?? null, product?.name ?? 'Service', quantity, price, product?.cost_price ?? 0]
    );
    if (paid > 0) {
      await tx.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, $2, $3)', [sale.id, paid, method]);
    }
    const { rows: fresh } = await tx.query('SELECT * FROM sales WHERE id = $1', [sale.id]);
    return fresh[0];
  });
}

test.before(async () => {
  await migrate();
});

test.after(async () => {
  await db.close();
});

test.beforeEach(reset);

// ---------------------------------------------------------------------------
// Constraints: values the database will not accept at all
// ---------------------------------------------------------------------------

test('stock can never go below zero', async () => {
  const product = await makeProduct({ stock: 3 });
  await rejects(
    () => db.query('UPDATE products SET stock_quantity = -1 WHERE id = $1', [product.id]),
    /stock/i
  );
  const after = await one('SELECT stock_quantity FROM products WHERE id = $1', [product.id]);
  assert.equal(Number(after.stock_quantity), 3);
});

test('selling more than there is is refused, with a sentence a person can read', async () => {
  const product = await makeProduct({ stock: 2 });
  const error = await rejects(() => makeSale({ product, quantity: 5 }));
  assert.match(error.message, /Not enough Test product in stock: 2 left, 5 needed\./);
  assert.equal(error.hint, 'docdesk');
});

test('a product code is unique however it is capitalised', async () => {
  await makeProduct({ name: 'One', sku: 'abc-1' });
  await rejects(() => makeProduct({ name: 'Two', sku: 'ABC-1' }), /already|unique|duplicate/i);
});

test('an email address that is not one is refused', async () => {
  await rejects(() => db.query("INSERT INTO customers (name, email) VALUES ('Nope', 'not-an-email')"), /email|check/i);
});

test('a payment method outside the list is refused', async () => {
  const sale = await makeSale({ product: await makeProduct({ stock: 5 }) });
  await rejects(() => db.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, 5, $2)', [sale.id, 'bitcoin']));
});

test('a sale whose lines do not add up is refused at commit', async () => {
  const product = await makeProduct({ stock: 10 });
  await rejects(
    () =>
      db.transaction(async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO sales (subtotal, discount, tax, total, amount_paid, payment_status)
           VALUES (100, 0, 0, 100, 0, 'unpaid') RETURNING id`
        );
        // One line worth 15, on a sale that claims 100.
        await tx.query(
          `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, unit_cost)
           VALUES ($1, $2, 'x', 1, 15, 10)`,
          [rows[0].id, product.id]
        );
      }),
    /does not add up/
  );
  const { rows } = await db.query('SELECT count(*) AS n FROM sales');
  assert.equal(Number(rows[0].n), 0, 'nothing should have been written');
});

// ---------------------------------------------------------------------------
// Triggers: totals the database keeps in step by itself
// ---------------------------------------------------------------------------

test('every stock change lands in the ledger, and the balance follows it', async () => {
  const product = await makeProduct({ stock: 10 });
  await db.query('SELECT apply_stock_change($1, -4, $2, NULL, NULL, $3)', [product.id, 'sale', 'sold four']);
  await db.query('SELECT apply_stock_change($1, 6, $2, NULL, NULL, $3)', [product.id, 'purchase_receipt', 'six in']);

  const after = await one('SELECT stock_quantity FROM products WHERE id = $1', [product.id]);
  assert.equal(Number(after.stock_quantity), 12);

  const ledger = await one(
    `SELECT count(*) AS moves, sum(change) AS total, max(balance_after) FILTER (WHERE kind = 'purchase_receipt') AS last_balance
       FROM stock_movements WHERE product_id = $1`,
    [product.id]
  );
  assert.equal(Number(ledger.moves), 3, 'opening stock, the sale and the purchase');
  assert.equal(Number(ledger.total), 12, 'the ledger sums to the balance');
  assert.equal(Number(ledger.last_balance), 12);
});

test('editing a stock level directly is recorded as a correction', async () => {
  const product = await makeProduct({ stock: 5 });
  await db.query('UPDATE products SET stock_quantity = 8 WHERE id = $1', [product.id]);
  const move = await one("SELECT change, kind FROM stock_movements WHERE product_id = $1 AND kind = 'correction'", [product.id]);
  assert.equal(Number(move.change), 3);
});

test('selling moves stock, and deleting the sale puts it back', async () => {
  const product = await makeProduct({ stock: 10 });
  const sale = await makeSale({ product, quantity: 3 });
  assert.equal(Number((await one('SELECT stock_quantity FROM products WHERE id = $1', [product.id])).stock_quantity), 7);

  await db.query('DELETE FROM sales WHERE id = $1', [sale.id]);
  assert.equal(Number((await one('SELECT stock_quantity FROM products WHERE id = $1', [product.id])).stock_quantity), 10);
  const kinds = await one("SELECT count(*) FILTER (WHERE kind = 'sale') AS sold, count(*) FILTER (WHERE kind = 'sale_void') AS returned FROM stock_movements");
  assert.equal(Number(kinds.sold), 1);
  assert.equal(Number(kinds.returned), 1);
});

test('payments decide whether a sale is unpaid, part paid or paid', async () => {
  const product = await makeProduct({ stock: 10 });
  const sale = await makeSale({ product, quantity: 2, price: 50 }); // 100
  assert.equal(sale.payment_status, 'unpaid');

  await db.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, 40, $2)', [sale.id, 'cash']);
  let current = await one('SELECT payment_status, amount_paid FROM sales WHERE id = $1', [sale.id]);
  assert.equal(current.payment_status, 'partial');
  assert.equal(Number(current.amount_paid), 40);

  await db.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, 60, $2)', [sale.id, 'upi']);
  current = await one('SELECT payment_status, amount_paid FROM sales WHERE id = $1', [sale.id]);
  assert.equal(current.payment_status, 'paid');
  assert.equal(Number(current.amount_paid), 100);

  // A refund of everything taken leaves it refunded, not paid.
  await db.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, -100, $2)', [sale.id, 'cash']);
  current = await one('SELECT payment_status, amount_paid FROM sales WHERE id = $1', [sale.id]);
  assert.equal(Number(current.amount_paid), 0);
  assert.equal(current.payment_status, 'refunded');
});

test('a sale cannot be paid more than its total', async () => {
  const product = await makeProduct({ stock: 5 });
  const sale = await makeSale({ product, quantity: 1, price: 20 });
  await rejects(() => db.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, 25, $2)', [sale.id, 'cash']));
});

test('running low raises one alert, and restocking withdraws it', async () => {
  const product = await makeProduct({ stock: 10, reorder: 5, name: 'Pens' });
  const queued = () => one("SELECT count(*) AS n FROM message_log WHERE trigger_type = 'low_stock' AND status = 'queued' AND related_id = $1", [product.id]);

  assert.equal(Number((await queued()).n), 0);
  await db.query('SELECT apply_stock_change($1, -6, $2, NULL, NULL, NULL)', [product.id, 'sale']);
  assert.equal(Number((await queued()).n), 1, 'one alert at or below the reorder level');

  await db.query('SELECT apply_stock_change($1, -1, $2, NULL, NULL, NULL)', [product.id, 'sale']);
  assert.equal(Number((await queued()).n), 1, 'still only one, not one per sale');

  await db.query('SELECT apply_stock_change($1, 20, $2, NULL, NULL, NULL)', [product.id, 'purchase_receipt']);
  assert.equal(Number((await queued()).n), 0, 'withdrawn once there is stock again');
});

test('receiving a purchase order adds stock and moves the order along', async () => {
  const supplier = await one("INSERT INTO suppliers (name) VALUES ('Metro') RETURNING *");
  const product = await makeProduct({ stock: 1 });
  const order = await one(
    "INSERT INTO purchase_orders (supplier_id, status) VALUES ($1, 'ordered') RETURNING *",
    [supplier.id]
  );
  const item = await one(
    `INSERT INTO purchase_order_items (purchase_order_id, product_id, description, quantity, unit_cost)
     VALUES ($1, $2, 'Test product', 10, 9) RETURNING *`,
    [order.id, product.id]
  );

  await db.query('UPDATE purchase_order_items SET quantity_received = 4 WHERE id = $1', [item.id]);
  let current = await one('SELECT status FROM purchase_orders WHERE id = $1', [order.id]);
  assert.equal(current.status, 'partial');
  assert.equal(Number((await one('SELECT stock_quantity FROM products WHERE id = $1', [product.id])).stock_quantity), 5);

  await db.query('UPDATE purchase_order_items SET quantity_received = 10 WHERE id = $1', [item.id]);
  current = await one('SELECT status FROM purchase_orders WHERE id = $1', [order.id]);
  assert.equal(current.status, 'received');
  assert.equal(Number((await one('SELECT stock_quantity FROM products WHERE id = $1', [product.id])).stock_quantity), 11);

  await rejects(() => db.query('UPDATE purchase_order_items SET quantity_received = 99 WHERE id = $1', [item.id]));
});

test('receipt and order numbers come from sequences', async () => {
  const product = await makeProduct({ stock: 10 });
  const first = await makeSale({ product });
  const second = await makeSale({ product });
  assert.equal(first.reference, 'S-1001');
  assert.equal(second.reference, 'S-1002');

  const supplier = await one("INSERT INTO suppliers (name) VALUES ('Metro') RETURNING id");
  const order = await one("INSERT INTO purchase_orders (supplier_id) VALUES ($1) RETURNING reference", [supplier.id]);
  assert.equal(order.reference, 'PO-1001');
});

test('every edit bumps the row version, so two people cannot overwrite each other', async () => {
  const product = await makeProduct({ stock: 1 });
  assert.equal(product.row_version, 1);
  await db.query('UPDATE products SET name = $2 WHERE id = $1', [product.id, 'Renamed']);
  const after = await one('SELECT row_version, updated_at > created_at AS touched FROM products WHERE id = $1', [product.id]);
  assert.equal(after.row_version, 2);
  assert.equal(after.touched, true);

  // What the API does: write only if nobody else has since.
  const stale = await db.query('UPDATE products SET name = $2 WHERE id = $1 AND row_version = 1', [product.id, 'Too late']);
  assert.equal(stale.rowCount, 0);
});

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

test('inserts, updates and deletes are all recorded, with who did them', async () => {
  const product = await db.runAs('tester', () => makeProduct({ name: 'Audited', stock: 0 }));
  await db.runAs('assistant', () => db.query('UPDATE products SET sale_price = 99 WHERE id = $1', [product.id]));
  await db.runAs('web', () => db.query('DELETE FROM products WHERE id = $1', [product.id]));

  const { rows } = await db.query(
    "SELECT action, actor, changed_fields, old_data, new_data FROM audit_log WHERE table_name = 'products' ORDER BY id"
  );
  assert.deepEqual(rows.map((r) => r.action), ['INSERT', 'UPDATE', 'DELETE']);
  assert.deepEqual(rows.map((r) => r.actor), ['tester', 'assistant', 'web']);
  assert.ok(rows[1].changed_fields.includes('sale_price'));
  assert.equal(Number(rows[1].old_data.sale_price), 15);
  assert.equal(Number(rows[1].new_data.sale_price), 99);
  assert.equal(rows[2].new_data, null);
});

// ---------------------------------------------------------------------------
// Reading: views, reports and search
// ---------------------------------------------------------------------------

test('the stock view says what is out, low and fine', async () => {
  await makeProduct({ name: 'Out', stock: 0, reorder: 2 });
  await makeProduct({ name: 'Low', stock: 2, reorder: 2 });
  await makeProduct({ name: 'Fine', stock: 20, reorder: 2, cost: 10, price: 20 });

  const { rows } = await db.query('SELECT name, stock_status, stock_value_cost, margin_percent FROM v_product_stock ORDER BY name');
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.Out.stock_status, 'out');
  assert.equal(byName.Low.stock_status, 'low');
  assert.equal(byName.Fine.stock_status, 'ok');
  assert.equal(Number(byName.Fine.stock_value_cost), 200);
  assert.equal(Number(byName.Fine.margin_percent), 50);
});

test('a sale at 11pm belongs to that day in the shop, not the next one in UTC', async () => {
  const product = await makeProduct({ stock: 10 });
  // 2026-03-01 23:30 in Asia/Kolkata is 18:00 UTC; in UTC terms the same instant
  // is still the 1st, so use a later one: 20:00 UTC on the 1st is 01:30 on the
  // 2nd in Kolkata.
  const sale = await makeSale({ product, quantity: 1, price: 100 });
  await db.query("UPDATE sales SET created_at = '2026-03-01 20:00:00+00' WHERE id = $1", [sale.id]);

  const kolkata = await db.query("SELECT day, revenue FROM report_sales_by_day('2026-03-01', '2026-03-03', 'Asia/Kolkata') WHERE revenue > 0");
  const utc = await db.query("SELECT day, revenue FROM report_sales_by_day('2026-03-01', '2026-03-03', 'UTC') WHERE revenue > 0");
  assert.equal(String(kolkata.rows[0].day).slice(0, 10), '2026-03-02');
  assert.equal(String(utc.rows[0].day).slice(0, 10), '2026-03-01');
});

test('search finds a product through a typo', async () => {
  const { rows: extension } = await db.query("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'");
  if (!extension.length) return; // Without pg_trgm, search falls back to plain matching.
  await makeProduct({ name: 'Ballpoint Pen (Blue)' });
  const { rows } = await db.query(
    'SELECT name, similarity(name, $1) AS score FROM products WHERE name % $1 ORDER BY score DESC',
    ['balpoint pen']
  );
  assert.equal(rows.length, 1);
  assert.ok(Number(rows[0].score) > 0.3);
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

test('a failure part way through leaves nothing behind', async () => {
  const product = await makeProduct({ stock: 5 });
  await rejects(() =>
    db.transaction(async (tx) => {
      await tx.query("INSERT INTO customers (name) VALUES ('Halfway')");
      await tx.query('SELECT apply_stock_change($1, -100, $2, NULL, NULL, NULL)', [product.id, 'sale']);
    })
  );
  const counts = await one('SELECT (SELECT count(*) FROM customers) AS customers, (SELECT stock_quantity FROM products WHERE id = $1) AS stock', [product.id]);
  assert.equal(Number(counts.customers), 0, 'the customer was rolled back with the stock change');
  assert.equal(Number(counts.stock), 5);
});

test('a read-only transaction cannot write', async () => {
  await rejects(() => db.transaction((tx) => tx.query("INSERT INTO customers (name) VALUES ('Nope')"), { readOnly: true }));
});
