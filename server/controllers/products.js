const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail, text, number, id, money, version } = require('../lib/validate');
const { categoryIdFor } = require('../lib/categories');
const { resolveTimezone, todayIn } = require('../lib/timezone');

function parseProduct(body) {
  return {
    sku: text(body.sku, 'SKU', { max: 80 }),
    name: text(body.name, 'Name', { required: true, max: 200 }),
    description: text(body.description, 'Description', { max: 2000 }),
    category: text(body.category, 'Category', { max: 100 }),
    unit: text(body.unit, 'Unit', { max: 40 }) || 'unit',
    cost_price: money(number(body.cost_price, 'Cost price', { min: 0, fallback: 0 })),
    sale_price: money(number(body.sale_price, 'Sale price', { min: 0, fallback: 0 })),
    stock_quantity: number(body.stock_quantity, 'Stock quantity', { min: 0, fallback: 0, decimals: 3 }),
    reorder_level: number(body.reorder_level, 'Reorder level', { min: 0, fallback: 0, decimals: 3 }),
    supplier_id: id(body.supplier_id, 'Supplier'),
  };
}

/** A product row as the app sees it: with its category and supplier names. */
async function loadProduct(productId) {
  const { rows } = await db.query(
    `SELECT p.*, c.name AS category, s.name AS supplier_name
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1`,
    [productId]
  );
  if (!rows.length) throw fail('Product not found', 404);
  return rows[0];
}

// SKUs are optional, but must be unique when given (ignoring case). Checked up
// front so the person gets a sentence; the unique index is the backstop.
async function assertSkuFree(sku, excludeId) {
  if (!sku) return;
  const params = [sku];
  let sql = 'SELECT id, name FROM products WHERE lower(sku) = lower($1)';
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $${params.length}`;
  }
  const { rows } = await db.query(sql, params);
  if (rows.length) throw fail(`SKU "${sku}" is already used by ${rows[0].name}`, 409);
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
        extraConditions: STOCK_FILTERS[stock] ? [STOCK_FILTERS[stock]] : [],
      })
    );
  } catch (err) {
    next(err);
  }
};

// Categories in use, for the filter dropdown.
exports.categories = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.name FROM categories c
        WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id)
        ORDER BY lower(c.name)`
    );
    res.json(rows.map((r) => r.name));
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await loadProduct(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const { category, ...fields } = parseProduct(req.body || {});
    await assertSkuFree(fields.sku);

    const productId = await db.transaction(async (tx) => {
      fields.category_id = await categoryIdFor(category);
      const names = Object.keys(fields);
      const { rows } = await tx.query(
        `INSERT INTO products (${names.join(', ')})
         VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        Object.values(fields)
      );
      return rows[0].id;
    });
    res.status(201).json(await loadProduct(productId));
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const current = await loadProduct(req.params.id);
    const { category, ...fields } = parseProduct(req.body || {});
    await assertSkuFree(fields.sku, Number(req.params.id));

    await db.transaction(async (tx) => {
      fields.category_id = await categoryIdFor(category);
      const names = Object.keys(fields);
      const values = Object.values(fields);
      values.push(req.params.id);
      let sql = `UPDATE products SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')} WHERE id = $${values.length}`;
      const expected = version(req.body?.row_version);
      if (expected) {
        values.push(expected);
        sql += ` AND row_version = $${values.length}`;
      }
      // A stock level typed into the form lands in the ledger as a correction.
      await tx.query("SELECT set_config('docdesk.stock_note', $1, true)", ['Stock level edited on the product form']);
      const { rowCount } = await tx.query(sql, values);
      if (!rowCount) {
        const latest = await loadProduct(req.params.id);
        const err = fail(
          `${current.name} was changed after you opened it (stock is now ${Number(latest.stock_quantity)}). Your edits were not saved - reload to see the latest.`,
          409
        );
        err.conflict = latest;
        throw err;
      }
    });
    res.json(await loadProduct(req.params.id));
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await loadProduct(req.params.id);
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
 * Takes a change rather than a new total so two people adjusting at once cannot
 * silently overwrite each other; the database refuses to go below zero.
 */
exports.adjustStock = async (req, res, next) => {
  try {
    const product = await loadProduct(req.params.id);
    const change = number(req.body?.change, 'Change', { required: true, decimals: 3 });
    if (change === 0) throw fail('Enter how many to add or remove');
    const reason = text(req.body?.reason, 'Reason', { max: 250 });

    const alerts = await db.transaction(async (tx) => {
      const before = await tx.query("SELECT count(*) AS n FROM message_log WHERE status = 'queued' AND trigger_type = 'low_stock'");
      await tx.query("SELECT apply_stock_change($1, $2, 'adjustment', 'manual', NULL, $3)", [
        product.id, change, reason || (change > 0 ? 'Stock added' : 'Stock removed'),
      ]);
      const after = await tx.query("SELECT count(*) AS n FROM message_log WHERE status = 'queued' AND trigger_type = 'low_stock'");
      return Math.max(Number(after.rows[0].n) - Number(before.rows[0].n), 0);
    });

    res.json({ product: await loadProduct(product.id), reason: reason || null, alertsQueued: alerts });
  } catch (err) {
    next(err);
  }
};

// Everything the front desk needs to see at a glance.
exports.summary = async (req, res, next) => {
  try {
    const { rows } = await db.query(`
      SELECT count(*) AS total,
             count(*) FILTER (WHERE stock_status = 'out') AS out_of_stock,
             count(*) FILTER (WHERE stock_status = 'low') AS low_stock,
             COALESCE(sum(stock_value_cost), 0) AS stock_value,
             COALESCE(sum(stock_value_retail), 0) AS retail_value,
             COALESCE(sum(stock_quantity), 0) AS units
        FROM v_product_stock
    `);
    const { rows: attention } = await db.query(`
      SELECT id, sku, name, category, stock_quantity, reorder_level, stock_status
        FROM v_product_stock
       WHERE stock_status IN ('out', 'low')
       ORDER BY stock_quantity ASC, name ASC
       LIMIT 20
    `);
    const s = rows[0];
    res.json({
      total: Number(s.total || 0),
      outOfStock: Number(s.out_of_stock || 0),
      lowStock: Number(s.low_stock || 0),
      inStock: Number(s.total || 0) - Number(s.out_of_stock || 0),
      stockValue: money(s.stock_value),
      retailValue: money(s.retail_value),
      units: Number(s.units || 0),
      needsAttention: attention,
    });
  } catch (err) {
    next(err);
  }
};

// One product's trading history: how it has sold, its stock ledger, what is on
// order and what is attached to it. The question a shopkeeper asks before reordering.
exports.history = async (req, res, next) => {
  try {
    const product = await loadProduct(req.params.id);
    const tz = await resolveTimezone(req);

    const [sales, totals, trend, incoming, files, movements] = await Promise.all([
      db.query(
        `SELECT s.id, s.reference, s.created_at, si.quantity, si.unit_price, si.line_total
           FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id = $1 ORDER BY s.created_at DESC LIMIT 20`,
        [product.id]
      ),
      db.query(
        `SELECT COALESCE(sum(si.quantity), 0) AS units,
                COALESCE(sum(si.line_total), 0) AS revenue,
                COALESCE(sum(si.line_total - si.quantity * si.unit_cost), 0) AS profit,
                count(DISTINCT si.sale_id) AS sale_count
           FROM sale_items si WHERE si.product_id = $1`,
        [product.id]
      ),
      db.query(
        `SELECT d::date AS day, COALESCE(t.units, 0) AS units
           FROM generate_series(($2::date - 29)::timestamp, $2::date::timestamp, interval '1 day') AS d
           LEFT JOIN (
             SELECT (s.created_at AT TIME ZONE $3)::date AS day, sum(si.quantity) AS units
               FROM sale_items si JOIN sales s ON s.id = si.sale_id
              WHERE si.product_id = $1
              GROUP BY 1
           ) t ON t.day = d::date
          ORDER BY 1`,
        [product.id, todayIn(tz), tz]
      ),
      db.query(
        `SELECT po.id, po.reference, po.status, po.expected_date, poi.quantity, poi.quantity_received
           FROM purchase_order_items poi JOIN purchase_orders po ON po.id = poi.purchase_order_id
          WHERE poi.product_id = $1 AND po.status NOT IN ('received', 'cancelled')
          ORDER BY po.created_at DESC`,
        [product.id]
      ),
      db.query(
        `SELECT id, original_name, mime_type, size_bytes FROM files
          WHERE related_type = 'product' AND related_id = $1 ORDER BY created_at DESC`,
        [product.id]
      ),
      db.query(
        `SELECT id, change, balance_after, kind, reference_type, reference_id, note, actor, created_at
           FROM stock_movements WHERE product_id = $1 ORDER BY created_at DESC, id DESC LIMIT 40`,
        [product.id]
      ),
    ]);

    res.json({
      product,
      unitsSold: Number(totals.rows[0].units),
      revenue: money(totals.rows[0].revenue),
      profit: money(totals.rows[0].profit),
      saleCount: Number(totals.rows[0].sale_count),
      trend: trend.rows.map((t) => ({ day: t.day, units: Number(t.units) })),
      sales: sales.rows,
      incoming: incoming.rows,
      files: files.rows,
      movements: movements.rows,
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
      `SELECT v.id, v.sku, v.name, v.stock_quantity, v.reorder_level, v.cost_price, v.supplier_id, v.supplier_name
         FROM v_product_stock v
        WHERE v.reorder_level > 0 AND v.stock_quantity <= v.reorder_level
        ORDER BY (v.stock_quantity - v.reorder_level) ASC, v.name ASC`
    );

    const items = rows.map((r) => {
      const target = Number(r.reorder_level) * 2;
      return {
        productId: r.id,
        sku: r.sku,
        name: r.name,
        stockQuantity: Number(r.stock_quantity),
        reorderLevel: Number(r.reorder_level),
        suggestedQuantity: Math.max(Math.ceil(target - Number(r.stock_quantity)), 1),
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

/** The stock ledger for one product, paged. */
exports.movements = async (req, res, next) => {
  try {
    await loadProduct(req.params.id);
    res.json(
      await listRows('stock_movements', {
        ...readListQuery(req.query),
        where: { product_id: req.params.id },
      })
    );
  } catch (err) {
    next(err);
  }
};

exports.loadProduct = loadProduct;
