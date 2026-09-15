const db = require('../db');
const { listRows } = require('../lib/tables');
const { fail, text, number, oneOf, id, money } = require('../lib/validate');
const { checkStockLevels } = require('../lib/messaging');

const STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'];

async function loadOrder(orderId, runner = db) {
  const { rows } = await runner.query(
    `SELECT po.*, s.name AS supplier_name
     FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id
     WHERE po.id = $1`,
    [orderId]
  );
  if (!rows.length) throw fail('Purchase order not found', 404);
  const { rows: items } = await runner.query(
    'SELECT * FROM purchase_order_items WHERE purchase_order_id = $1 ORDER BY id',
    [orderId]
  );
  return { ...rows[0], items };
}

exports.list = async (req, res, next) => {
  try {
    const { search, sort, dir, limit, offset, status } = req.query;
    const result = await listRows('purchase_orders', {
      search,
      sort,
      dir,
      limit,
      offset,
      where: status ? { status } : {},
    });

    const { rows: suppliers } = await db.query('SELECT id, name FROM suppliers');
    const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
    const rows = result.rows.map((order) => ({
      ...order,
      supplier_name: order.supplier_id ? nameById.get(order.supplier_id) || null : null,
    }));

    res.json({ rows, total: result.total });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    next(err);
  }
};

// Creating an order does not move stock. Stock only changes when the goods are
// actually marked as received, which is what `receive` below does.
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw fail('Add at least one item to the order');

    const supplierId = id(body.supplier_id, 'Supplier');
    const status = oneOf(body.status, 'Status', STATUSES, { fallback: 'draft' });
    const expectedDate = text(body.expected_date, 'Expected date', { max: 40 });
    const notes = text(body.notes, 'Notes', { max: 2000 });

    const newOrderId = await db.transaction(async (tx) => {
      if (supplierId) {
        const { rows } = await tx.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
        if (!rows.length) throw fail('That supplier no longer exists', 404);
      }

      const lines = [];
      for (const [index, raw] of rawItems.entries()) {
        const position = `Item ${index + 1}`;
        const quantity = number(raw.quantity, `${position} quantity`, { required: true, min: 0.001 });
        const productId = id(raw.product_id, `${position} product`);
        let description = text(raw.description, `${position} description`, { max: 250 });
        let unitCost = raw.unit_cost;

        if (productId) {
          const { rows } = await tx.query('SELECT * FROM products WHERE id = $1', [productId]);
          const product = rows[0];
          if (!product) throw fail(`${position}: that product no longer exists`, 404);
          description = description || product.name;
          if (unitCost === undefined || unitCost === null || unitCost === '') {
            unitCost = product.cost_price;
          }
        } else if (!description) {
          throw fail(`${position} needs either a product or a description`);
        }

        lines.push({
          productId,
          description,
          quantity,
          unitCost: money(number(unitCost, `${position} cost`, { min: 0, fallback: 0 })),
        });
      }

      const total = money(lines.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));

      const { rows: orderRows } = await tx.query(
        `INSERT INTO purchase_orders (supplier_id, status, expected_date, total, notes)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [supplierId, status, expectedDate, total, notes]
      );
      let order = orderRows[0];

      const { rows: updated } = await tx.query(
        'UPDATE purchase_orders SET reference = $1 WHERE id = $2 RETURNING *',
        [`PO-${1000 + order.id}`, order.id]
      );
      order = updated[0];

      for (const line of lines) {
        await tx.query(
          `INSERT INTO purchase_order_items (purchase_order_id, product_id, description, quantity, unit_cost)
           VALUES ($1,$2,$3,$4,$5)`,
          [order.id, line.productId, line.description, line.quantity, line.unitCost]
        );
      }

      return order.id;
    });

    res.status(201).json(await loadOrder(newOrderId));
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    await loadOrder(req.params.id);
    const status = oneOf(req.body.status, 'Status', STATUSES);
    const expectedDate = text(req.body.expected_date, 'Expected date', { max: 40 });
    const notes = text(req.body.notes, 'Notes', { max: 2000 });

    await db.query(
      `UPDATE purchase_orders SET status = COALESCE($1, status),
         expected_date = COALESCE($2, expected_date), notes = COALESCE($3, notes)
       WHERE id = $4`,
      [status, expectedDate, notes, req.params.id]
    );
    res.json(await loadOrder(req.params.id));
  } catch (err) {
    next(err);
  }
};

/**
 * Marks quantities as delivered and adds them to stock.
 *
 * Accepts a partial delivery: the body may name only some lines, and a quantity
 * smaller than ordered. Receiving is incremental, so calling this twice for the
 * same line adds to what was already received rather than replacing it.
 */
exports.receive = async (req, res, next) => {
  try {
    const order = await loadOrder(req.params.id);
    if (order.status === 'cancelled') throw fail('This order was cancelled');
    if (order.status === 'received') throw fail('This order is already fully received');

    const requested = Array.isArray(req.body?.items) ? req.body.items : null;

    const updatedId = await db.transaction(async (tx) => {
      const touchedProducts = [];

      for (const item of order.items) {
        const outstanding = Number(item.quantity) - Number(item.quantity_received);
        if (outstanding <= 0) continue;

        // No explicit list means "receive everything still outstanding".
        let receiving = outstanding;
        if (requested) {
          const match = requested.find((r) => Number(r.id) === item.id);
          if (!match) continue;
          receiving = number(match.quantity, `Item ${item.id} quantity`, { required: true, min: 0.001 });
          if (receiving > outstanding) {
            throw fail(
              `Cannot receive ${receiving} of ${item.description}. Only ${outstanding} are still outstanding.`
            );
          }
        }

        await tx.query(
          'UPDATE purchase_order_items SET quantity_received = quantity_received + $1 WHERE id = $2',
          [receiving, item.id]
        );

        if (item.product_id) {
          await tx.query(
            'UPDATE products SET stock_quantity = stock_quantity + $1, updated_at = $2 WHERE id = $3',
            [receiving, new Date().toISOString(), item.product_id]
          );
          touchedProducts.push(item.product_id);
        }
      }

      // Status is derived from what actually arrived rather than set by hand.
      const { rows: after } = await tx.query(
        'SELECT quantity, quantity_received FROM purchase_order_items WHERE purchase_order_id = $1',
        [order.id]
      );
      const fullyReceived = after.every((i) => Number(i.quantity_received) >= Number(i.quantity));
      const anyReceived = after.some((i) => Number(i.quantity_received) > 0);
      const status = fullyReceived ? 'received' : anyReceived ? 'partial' : order.status;

      await tx.query(
        'UPDATE purchase_orders SET status = $1, received_date = $2 WHERE id = $3',
        [status, fullyReceived ? new Date().toISOString().slice(0, 10) : null, order.id]
      );

      // Restocking can lift a product back above its reorder level, which
      // clears any alert that was queued for it.
      if (touchedProducts.length) {
        const placeholders = touchedProducts.map((_, i) => `$${i + 1}`).join(',');
        await tx.query(
          `DELETE FROM message_log
           WHERE trigger_type = 'low_stock' AND status = 'queued' AND related_type = 'product'
             AND related_id IN (${placeholders})
             AND related_id IN (
               SELECT id FROM products WHERE reorder_level <= 0 OR stock_quantity > reorder_level
             )`,
          touchedProducts
        );
        await checkStockLevels(tx, touchedProducts);
      }

      return order.id;
    });

    res.json(await loadOrder(updatedId));
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    const order = await loadOrder(req.params.id);
    const received = order.items.some((i) => Number(i.quantity_received) > 0);
    if (received) {
      throw fail(
        'Some of this order has already been received, so deleting it would leave stock wrong. Cancel it instead.'
      );
    }
    await db.query('DELETE FROM purchase_orders WHERE id = $1', [order.id]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};
