const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail, text, number, id, money } = require('../lib/validate');
const { checkStockLevels } = require('../lib/messaging');

function parseProduct(body) {
  return {
    sku: text(body.sku, 'SKU', { max: 80 }),
    name: text(body.name, 'Name', { required: true, max: 200 }),
    description: text(body.description, 'Description', { max: 2000 }),
    category: text(body.category, 'Category', { max: 100 }),
    unit: text(body.unit, 'Unit', { max: 40 }) || 'unit',
    cost_price: money(number(body.cost_price, 'Cost price', { min: 0, fallback: 0 })),
    sale_price: money(number(body.sale_price, 'Sale price', { min: 0, fallback: 0 })),
    stock_quantity: number(body.stock_quantity, 'Stock quantity', { integer: true, fallback: 0 }),
    reorder_level: number(body.reorder_level, 'Reorder level', { min: 0, integer: true, fallback: 0 }),
    supplier_id: id(body.supplier_id, 'Supplier'),
  };
}

async function findOrFail(productId) {
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
  if (!rows.length) throw fail('Product not found', 404);
  return rows[0];
}

// SKUs are optional, but must be unique when given. Checked up front so the
// user gets a sentence instead of a database constraint error.
async function assertSkuFree(sku, excludeId) {
  if (!sku) return;
  const params = [sku];
  let sql = 'SELECT id FROM products WHERE sku = $1';
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $${params.length}`;
  }
  const { rows } = await db.query(sql, params);
  if (rows.length) throw fail(`SKU "${sku}" is already used by another product`, 409);
}

// Stock status compares two columns, so it can't be a bound equality filter.
// These are fixed fragments, never built from request input.
const STOCK_FILTERS = {
  low: 't.reorder_level > 0 AND t.stock_quantity > 0 AND t.stock_quantity <= t.reorder_level',
  out: 't.stock_quantity <= 0',
  in: 't.stock_quantity > 0',
};

exports.list = async (req, res, next) => {
  try {
    const { category, stock, supplier_id } = req.query;
    const where = {};
    if (category) where.category = category;
    if (supplier_id) where.supplier_id = supplier_id;

    res.json(
      await listRows('products', {
        ...readListQuery(req.query),
        where,
        // Filtering in SQL means the row count and paging stay correct; doing it
        // in JS after the fact only filtered the current page.
        extraConditions: STOCK_FILTERS[stock] ? [STOCK_FILTERS[stock]] : [],
      })
    );
  } catch (err) {
    next(err);
  }
};

// Distinct categories, for the filter dropdown.
exports.categories = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT DISTINCT category FROM products
       WHERE category IS NOT NULL AND category <> '' ORDER BY category`
    );
    res.json(rows.map((r) => r.category));
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await findOrFail(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const fields = parseProduct(req.body);
    await assertSkuFree(fields.sku);

    const names = Object.keys(fields);
    const { rows } = await db.query(
      `INSERT INTO products (${names.join(', ')})
       VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
      Object.values(fields)
    );
    await checkStockLevels(null, [rows[0].id]);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    await findOrFail(req.params.id);
    const fields = parseProduct(req.body);
    await assertSkuFree(fields.sku, Number(req.params.id));

    const names = Object.keys(fields);
    const values = Object.values(fields);
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE products SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')},
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} RETURNING *`,
      values
    );
    await checkStockLevels(null, [rows[0].id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await findOrFail(req.params.id);
    // sale_items.product_id is ON DELETE SET NULL and keeps its own description,
    // so past receipts survive the product being removed.
    await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

/**
 * Stock movements that are not sales: deliveries, corrections, breakage.
 * Takes a delta rather than a new total so two people adjusting at once cannot
 * silently overwrite each other.
 */
exports.adjustStock = async (req, res, next) => {
  try {
    const product = await findOrFail(req.params.id);
    const change = number(req.body.change, 'Change', { required: true, integer: true });
    const reason = text(req.body.reason, 'Reason', { max: 250 });

    const next_ = product.stock_quantity + change;
    if (next_ < 0) {
      throw fail(
        `That would leave ${product.name} at ${next_}. There are only ${product.stock_quantity} in stock.`
      );
    }

    const { rows } = await db.query(
      `UPDATE products SET stock_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [next_, product.id]
    );
    const alerts = await checkStockLevels(null, [product.id]);
    res.json({ product: rows[0], reason: reason || null, alertsQueued: alerts.length });
  } catch (err) {
    next(err);
  }
};

// Everything the front desk needs to see at a glance.
exports.summary = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN stock_quantity <= 0 THEN 1 ELSE 0 END) AS out_of_stock,
        SUM(CASE WHEN reorder_level > 0 AND stock_quantity > 0
                  AND stock_quantity <= reorder_level THEN 1 ELSE 0 END) AS low_stock,
        SUM(stock_quantity * cost_price) AS stock_value
      FROM products
    `);
    const { rows: attention } = await db.query(`
      SELECT id, sku, name, stock_quantity, reorder_level
      FROM products
      WHERE stock_quantity <= 0 OR (reorder_level > 0 AND stock_quantity <= reorder_level)
      ORDER BY stock_quantity ASC, name ASC
      LIMIT 20
    `);
    const s = rows[0];
    res.json({
      total: Number(s.total || 0),
      outOfStock: Number(s.out_of_stock || 0),
      lowStock: Number(s.low_stock || 0),
      stockValue: money(s.stock_value || 0),
      needsAttention: attention,
    });
  } catch (err) {
    next(err);
  }
};
