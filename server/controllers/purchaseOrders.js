const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail, text, number, oneOf, id, money } = require('../lib/validate');
const { lineTotalCents, fromCents } = require('../lib/money');

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
    const { status, supplier_id } = req.query;
    const where = {};
    if (status) where.status = status;
    if (supplier_id) where.supplier_id = supplier_id;
    res.json(await listRows('purchase_orders', { ...readListQuery(req.query), where }));
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

function parseDate(value, label) {
  const raw = text(value, label, { max: 40 });
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) throw fail(`${label} must be a date like 2026-09-30`);
  return raw;
}

// Creating an order does not move stock. Stock only changes when the goods are
// actually marked as received.
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw fail('Add at least one item to the order');

    const supplierId = id(body.supplier_id, 'Supplier');
    const status = oneOf(body.status, 'Status', ['draft', 'ordered'], { fallback: 'draft' });
    const expectedDate = parseDate(body.expected_date, 'Expected date');
    const notes = text(body.notes, 'Notes', { max: 2000 });

    const newOrderId = await db.transaction(async (tx) => {
      if (supplierId) {
        const { rows } = await tx.query('SELECT id FROM suppliers WHERE id = $1', [supplierId]);
        if (!rows.length) throw fail('That supplier no longer exists', 404);
      }

      const lines = [];
      for (const [index, raw] of rawItems.entries()) {
        const position = `Item ${index + 1}`;
        const quantity = number(raw.quantity, `${position} quantity`, { required: true, min: 0.001, decimals: 3 });
        const productId = id(raw.product_id, `${position} product`);
        let description = text(raw.description, `${position} description`, { max: 250 });
        let unitCost = raw.unit_cost;

        if (productId) {
          const { rows } = await tx.query('SELECT id, name, cost_price FROM products WHERE id = $1', [productId]);
          const product = rows[0];
          if (!product) throw fail(`${position}: that product no longer exists`, 404);
          description = description || product.name;
          if (unitCost === undefined || unitCost === null || unitCost === '') unitCost = product.cost_price;
        } else if (!description) {
          throw fail(`${position} needs either a product or a description`);
        }

        const cost = money(number(unitCost, `${position} cost`, { min: 0, fallback: 0 }));
        lines.push({ productId, description, quantity, unitCost: cost, cents: lineTotalCents(quantity, cost) });
      }

      const total = fromCents(lines.reduce((sum, l) => sum + l.cents, 0n));
      const { rows: orderRows } = await tx.query(
        `INSERT INTO purchase_orders (supplier_id, status, expected_date, total, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [supplierId, status, expectedDate, total, notes]
      );
      const orderId = orderRows[0].id;

      for (const line of lines) {
        await tx.query(
          `INSERT INTO purchase_order_items (purchase_order_id, product_id, description, quantity, unit_cost)
           VALUES ($1, $2, $3, $4, $5)`,
          [orderId, line.productId, line.description, line.quantity, line.unitCost]
        );
      }
      return orderId;
    });

    res.status(201).json(await loadOrder(newOrderId));
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const order = await loadOrder(req.params.id);
    const body = req.body || {};
    const status = oneOf(body.status, 'Status', STATUSES);
    const expectedDate = body.expected_date === undefined ? undefined : parseDate(body.expected_date, 'Expected date');
    const notes = text(body.notes, 'Notes', { max: 2000 });

    // Received and part-received are facts about deliveries, set by receiving -
    // not something to pick from a menu.
    if (status && ['partial', 'received'].includes(status) && status !== order.status) {
      throw fail('Mark goods as received to change that - the status follows what has actually arrived');
    }
    if (status === 'cancelled' && order.status === 'received') {
      throw fail('This order has already been fully received, so it cannot be cancelled');
    }

    await db.query(
      `UPDATE purchase_orders
          SET status = COALESCE($1, status),
              expected_date = CASE WHEN $2::boolean THEN $3::date ELSE expected_date END,
              notes = COALESCE($4, notes)
        WHERE id = $5`,
      [status, expectedDate !== undefined, expectedDate ?? null, notes, order.id]
    );
    res.json(await loadOrder(order.id));
  } catch (err) {
    next(err);
  }
};

/**
 * Books a delivery in. Accepts a partial delivery: the body may name only some
 * lines, and a quantity smaller than ordered. Receiving adds to what arrived
 * before. The database moves the stock, writes the ledger and works out the
 * order's status from what has arrived.
 */
exports.receive = async (req, res, next) => {
  try {
    const order = await loadOrder(req.params.id);
    if (order.status === 'cancelled') throw fail('This order was cancelled');
    if (order.status === 'received') throw fail('This order is already fully received');

    const requested = Array.isArray(req.body?.items) ? req.body.items : null;

    await db.transaction(async (tx) => {
      let received = 0;
      for (const item of order.items) {
        const outstanding = Number(item.quantity) - Number(item.quantity_received);
        if (outstanding <= 0) continue;

        // No explicit list means "receive everything still outstanding".
        let receiving = outstanding;
        if (requested) {
          const match = requested.find((r) => Number(r.id) === Number(item.id));
          if (!match) continue;
          receiving = number(match.quantity, `${item.description} quantity`, { required: true, min: 0, decimals: 3 });
          if (receiving === 0) continue;
          if (receiving > outstanding) {
            throw fail(`Cannot receive ${receiving} of ${item.description}. Only ${outstanding} are still outstanding.`);
          }
        }

        await tx.query(
          'UPDATE purchase_order_items SET quantity_received = quantity_received + $1 WHERE id = $2',
          [receiving, item.id]
        );
        received += 1;
      }
      if (!received) throw fail('Enter how many of at least one item arrived');
    });

    res.json(await loadOrder(order.id));
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

exports.loadOrder = loadOrder;
