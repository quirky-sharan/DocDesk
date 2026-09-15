const db = require('../db');
const { listRows } = require('../lib/tables');
const { fail, text, number, oneOf, id, money } = require('../lib/validate');
const { checkStockLevels, queueSaleConfirmation } = require('../lib/messaging');

const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'];

async function loadSale(saleId, runner = db) {
  const { rows } = await runner.query(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.id = $1`,
    [saleId]
  );
  if (!rows.length) throw fail('Sale not found', 404);
  const { rows: items } = await runner.query(
    'SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id',
    [saleId]
  );
  return { ...rows[0], items };
}

exports.list = async (req, res, next) => {
  try {
    const { search, sort, dir, limit, offset, payment_status } = req.query;
    const result = await listRows('sales', {
      search,
      sort,
      dir,
      limit,
      offset,
      where: payment_status ? { payment_status } : {},
    });

    // Attach the customer name so the list is readable without a second call.
    const { rows: customers } = await db.query('SELECT id, name FROM customers');
    const nameById = new Map(customers.map((c) => [c.id, c.name]));
    const rows = result.rows.map((sale) => ({
      ...sale,
      customer_name: sale.customer_id ? nameById.get(sale.customer_id) || null : null,
    }));

    res.json({ rows, total: result.total });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await loadSale(req.params.id));
  } catch (err) {
    next(err);
  }
};

/**
 * Records a sale and moves stock in one transaction, so a sale can never be
 * half-recorded: either the sale, its lines and the stock changes all land, or
 * none of them do.
 */
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw fail('Add at least one item to the sale');

    const customerId = id(body.customer_id, 'Customer');
    const discount = money(number(body.discount, 'Discount', { min: 0, fallback: 0 }));
    const taxRate = number(body.tax_rate, 'Tax rate', { min: 0, max: 100, fallback: 0 });
    const paymentStatus = oneOf(body.payment_status, 'Payment status', PAYMENT_STATUSES, {
      fallback: 'paid',
    });
    const paymentMethod = text(body.payment_method, 'Payment method', { max: 40 });
    const notes = text(body.notes, 'Notes', { max: 2000 });

    const newSaleId = await db.transaction(async (tx) => {
      if (customerId) {
        const { rows } = await tx.query('SELECT id FROM customers WHERE id = $1', [customerId]);
        if (!rows.length) throw fail('That customer no longer exists', 404);
      }

      const lines = [];
      for (const [index, raw] of rawItems.entries()) {
        const position = `Item ${index + 1}`;
        const quantity = number(raw.quantity, `${position} quantity`, { required: true, min: 0.001 });
        const productId = id(raw.product_id, `${position} product`);

        let description = text(raw.description, `${position} description`, { max: 250 });
        let unitPrice = raw.unit_price;

        if (productId) {
          const { rows } = await tx.query('SELECT * FROM products WHERE id = $1', [productId]);
          const product = rows[0];
          if (!product) throw fail(`${position}: that product no longer exists`, 404);
          if (product.stock_quantity < quantity) {
            throw fail(
              `Not enough ${product.name} in stock. You asked for ${quantity} but only ${product.stock_quantity} remain.`
            );
          }
          description = description || product.name;
          if (unitPrice === undefined || unitPrice === null || unitPrice === '') {
            unitPrice = product.sale_price;
          }
        } else if (!description) {
          // A line with no product must at least say what was sold, or the
          // receipt is meaningless.
          throw fail(`${position} needs either a product or a description`);
        }

        const price = money(number(unitPrice, `${position} price`, { min: 0, fallback: 0 }));
        lines.push({
          productId,
          description,
          quantity,
          unitPrice: price,
          lineTotal: money(quantity * price),
        });
      }

      const subtotal = money(lines.reduce((sum, l) => sum + l.lineTotal, 0));
      if (discount > subtotal) throw fail('The discount is larger than the sale total');
      const taxable = subtotal - discount;
      const tax = money((taxable * taxRate) / 100);
      const total = money(taxable + tax);

      const { rows: saleRows } = await tx.query(
        `INSERT INTO sales (customer_id, subtotal, tax, discount, total, payment_status, payment_method, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [customerId, subtotal, tax, discount, total, paymentStatus, paymentMethod, notes]
      );
      let sale = saleRows[0];

      // Reference is derived from the id so it is guaranteed unique and
      // human-readable, which needs the row to exist first.
      const { rows: updated } = await tx.query(
        'UPDATE sales SET reference = $1 WHERE id = $2 RETURNING *',
        [`S-${1000 + sale.id}`, sale.id]
      );
      sale = updated[0];

      const touchedProducts = [];
      for (const line of lines) {
        await tx.query(
          `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, line_total)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [sale.id, line.productId, line.description, line.quantity, line.unitPrice, line.lineTotal]
        );
        if (line.productId) {
          await tx.query(
            'UPDATE products SET stock_quantity = stock_quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [line.quantity, line.productId]
          );
          touchedProducts.push(line.productId);
        }
      }

      await checkStockLevels(tx, touchedProducts);

      if (customerId) {
        const { rows: customer } = await tx.query('SELECT * FROM customers WHERE id = $1', [customerId]);
        await queueSaleConfirmation(tx, sale, customer[0]);
      }

      return sale.id;
    });

    res.status(201).json(await loadSale(newSaleId));
  } catch (err) {
    next(err);
  }
};

// Only payment details are editable. Changing the lines of a recorded sale would
// desynchronise stock; the correct action there is to delete it and re-enter.
exports.update = async (req, res, next) => {
  try {
    await loadSale(req.params.id);
    const paymentStatus = oneOf(req.body.payment_status, 'Payment status', PAYMENT_STATUSES);
    const paymentMethod = text(req.body.payment_method, 'Payment method', { max: 40 });
    const notes = text(req.body.notes, 'Notes', { max: 2000 });

    await db.query(
      `UPDATE sales SET payment_status = COALESCE($1, payment_status),
         payment_method = COALESCE($2, payment_method), notes = COALESCE($3, notes)
       WHERE id = $4`,
      [paymentStatus, paymentMethod, notes, req.params.id]
    );
    res.json(await loadSale(req.params.id));
  } catch (err) {
    next(err);
  }
};

// Deleting a sale returns its stock, otherwise the numbers stop matching reality.
exports.remove = async (req, res, next) => {
  try {
    const sale = await loadSale(req.params.id);
    await db.transaction(async (tx) => {
      for (const item of sale.items) {
        if (!item.product_id) continue;
        await tx.query('UPDATE products SET stock_quantity = stock_quantity + $1 WHERE id = $2', [
          item.quantity,
          item.product_id,
        ]);
      }
      await tx.query('DELETE FROM sales WHERE id = $1', [sale.id]);
    });
    res.json({ ok: true, stockRestored: true });
  } catch (err) {
    next(err);
  }
};

exports.receipt = async (req, res, next) => {
  try {
    res.json(await buildReceipt(req.params.id));
  } catch (err) {
    next(err);
  }
};

async function buildReceipt(saleId) {
  const sale = await loadSale(saleId);
  return {
    reference: sale.reference,
    issuedAt: sale.created_at,
    customer: sale.customer_id
      ? { name: sale.customer_name, phone: sale.customer_phone, email: sale.customer_email }
      : null,
    items: sale.items.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity),
      unitPrice: Number(i.unit_price),
      lineTotal: Number(i.line_total),
    })),
    totals: {
      subtotal: Number(sale.subtotal),
      discount: Number(sale.discount),
      tax: Number(sale.tax),
      total: Number(sale.total),
    },
    payment: { status: sale.payment_status, method: sale.payment_method },
    notes: sale.notes,
  };
}

exports.loadSale = loadSale;
exports.buildReceipt = buildReceipt;
