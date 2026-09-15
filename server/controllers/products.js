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

// One product's trading history: how it has sold, what is on order, and what
// is attached to it. The question a shopkeeper asks before reordering.
exports.history = async (req, res, next) => {
  try {
    const product = await findOrFail(req.params.id);
    const day = db.name === 'postgres'
      ? "TO_CHAR(s.created_at, 'YYYY-MM-DD')"
      : 'SUBSTR(s.created_at, 1, 10)';

    const { rows: sales } = await db.query(
      `SELECT s.id, s.reference, s.created_at, si.quantity, si.unit_price, si.line_total
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id = $1 ORDER BY s.created_at DESC LIMIT 20`,
      [product.id]
    );

    const { rows: totals } = await db.query(
      `SELECT COALESCE(SUM(si.quantity), 0) AS units,
              COALESCE(SUM(si.line_total), 0) AS revenue,
              COUNT(DISTINCT si.sale_id) AS sale_count
       FROM sale_items si WHERE si.product_id = $1`,
      [product.id]
    );

    const { rows: trend } = await db.query(
      `SELECT ${day} AS day, SUM(si.quantity) AS units
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.product_id = $1
       GROUP BY ${day} ORDER BY day DESC LIMIT 30`,
      [product.id]
    );

    const { rows: incoming } = await db.query(
      `SELECT po.reference, po.status, po.expected_date,
              poi.quantity, poi.quantity_received
       FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
       WHERE poi.product_id = $1 AND po.status NOT IN ('received', 'cancelled')
       ORDER BY po.created_at DESC`,
      [product.id]
    );

    const { rows: files } = await db.query(
      `SELECT id, original_name, mime_type, size_bytes FROM files
       WHERE related_type = 'product' AND related_id = $1 ORDER BY created_at DESC`,
      [product.id]
    );

    res.json({
      product,
      unitsSold: Number(totals[0].units),
      revenue: money(totals[0].revenue),
      saleCount: Number(totals[0].sale_count),
      trend: trend.reverse().map((t) => ({ day: t.day, units: Number(t.units) })),
      sales,
      incoming,
      files,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Everything at or below its reorder level, with a suggested quantity and the
 * supplier to buy it from - enough to build a purchase order in one click.
 *
 * Suggested quantity tops the item back up to twice its reorder level, which is
 * a crude but honest default; the user edits it before ordering anyway.
 */
exports.restockSuggestion = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT p.id, p.sku, p.name, p.stock_quantity, p.reorder_level, p.cost_price,
              p.supplier_id, s.name AS supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.reorder_level > 0 AND p.stock_quantity <= p.reorder_level
       ORDER BY (p.stock_quantity - p.reorder_level) ASC, p.name ASC`
    );

    const items = rows.map((r) => {
      const target = Number(r.reorder_level) * 2;
      return {
        productId: r.id,
        sku: r.sku,
        name: r.name,
        stockQuantity: Number(r.stock_quantity),
        reorderLevel: Number(r.reorder_level),
        suggestedQuantity: Math.max(target - Number(r.stock_quantity), 1),
        unitCost: money(r.cost_price),
        supplierId: r.supplier_id,
        supplierName: r.supplier_name,
      };
    });

    // Grouped by supplier, because you place one order per supplier.
    const bySupplier = [];
    for (const item of items) {
      const key = item.supplierId ?? 'none';
      let group = bySupplier.find((g) => String(g.supplierId ?? 'none') === String(key));
      if (!group) {
        group = { supplierId: item.supplierId, supplierName: item.supplierName, items: [], total: 0 };
        bySupplier.push(group);
      }
      group.items.push(item);
      group.total = money(group.total + item.suggestedQuantity * item.unitCost);
    }

    res.json({ count: items.length, items, bySupplier });
  } catch (err) {
    next(err);
  }
};
