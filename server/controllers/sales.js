const db = require('../db');
const { listRows, readListQuery } = require('../lib/tables');
const { fail, text, number, oneOf, id, money, paymentMethod } = require('../lib/validate');
const { queueSaleConfirmation } = require('../lib/messaging');
const { lineTotalCents, taxCents, toCents, fromCents } = require('../lib/money');
const { readAll: readSettings } = require('./settings');
const { resolveTimezone } = require('../lib/timezone');

const PAYMENT_STATUSES = ['unpaid', 'partial', 'paid', 'refunded'];

async function loadSale(saleId, runner = db) {
  const { rows } = await runner.query(
    `SELECT s.*, s.total - s.amount_paid AS balance_due,
            c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE s.id = $1`,
    [saleId]
  );
  if (!rows.length) throw fail('Sale not found', 404);
  const [{ rows: items }, { rows: payments }] = await Promise.all([
    runner.query('SELECT * FROM sale_items WHERE sale_id = $1 ORDER BY id', [saleId]),
    runner.query('SELECT * FROM payments WHERE sale_id = $1 ORDER BY paid_at, id', [saleId]),
  ]);
  return { ...rows[0], items, payments };
}

exports.list = async (req, res, next) => {
  try {
    const { payment_status, from, to } = req.query;
    const dateOnly = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? value : undefined);
    res.json(
      await listRows('sales', {
        ...readListQuery(req.query),
        where: payment_status ? { payment_status } : {},
        // Whole days in the shop's timezone: "to 15 Sep" includes all of the 15th.
        ranges: [{ column: 'created_at', from: dateOnly(from), to: dateOnly(to), timezone: await resolveTimezone(req) }],
      })
    );
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
 * Records a sale in one transaction: the receipt, its lines, any payment.
 * The database moves the stock (and refuses to oversell), writes the ledger,
 * queues low-stock alerts and derives the payment status - so a sale can never
 * be half-recorded, whoever or whatever records it.
 */
exports.create = async (req, res, next) => {
  try {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (!rawItems.length) throw fail('Add at least one item to the sale');

    const customerId = id(body.customer_id, 'Customer');
    const discount = money(number(body.discount, 'Discount', { min: 0, fallback: 0 }));
    const taxRate = number(body.tax_rate, 'Tax rate', { min: 0, max: 100, fallback: 0, decimals: 2 });
    const paymentStatus = oneOf(body.payment_status, 'Payment status', ['paid', 'unpaid', 'partial'], { fallback: 'paid' });
    const method = paymentMethod(body.payment_method, 'Payment method', { fallback: 'cash' });
    const notes = text(body.notes, 'Notes', { max: 2000 });

    const newSaleId = await db.transaction(async (tx) => {
      let customer = null;
      if (customerId) {
        const { rows } = await tx.query('SELECT * FROM customers WHERE id = $1', [customerId]);
        if (!rows.length) throw fail('That customer no longer exists', 404);
        customer = rows[0];
      }

      const lines = [];
      for (const [index, raw] of rawItems.entries()) {
        const position = `Item ${index + 1}`;
        const quantity = number(raw.quantity, `${position} quantity`, { required: true, min: 0.001, decimals: 3 });
        const productId = id(raw.product_id, `${position} product`);
        let description = text(raw.description, `${position} description`, { max: 250 });
        let unitPrice = raw.unit_price;
        let unitCost = 0;

        if (productId) {
          const { rows } = await tx.query('SELECT id, name, sale_price, cost_price, stock_quantity FROM products WHERE id = $1', [productId]);
          const product = rows[0];
          if (!product) throw fail(`${position}: that product no longer exists`, 404);
          // Friendly early check; the database enforces it regardless.
          if (Number(product.stock_quantity) < quantity) {
            throw fail(`Not enough ${product.name} in stock. You asked for ${quantity} but only ${Number(product.stock_quantity)} remain.`);
          }
          description = description || product.name;
          if (unitPrice === undefined || unitPrice === null || unitPrice === '') unitPrice = product.sale_price;
          unitCost = Number(product.cost_price);
        } else if (!description) {
          // A line with no product must at least say what was sold, or the
          // receipt is meaningless.
          throw fail(`${position} needs either a product or a description`);
        }

        const price = money(number(unitPrice, `${position} price`, { min: 0, fallback: 0 }));
        lines.push({ productId, description, quantity, unitPrice: price, unitCost: money(unitCost), cents: lineTotalCents(quantity, price) });
      }

      // Integer cents throughout, so the totals match the database's exact arithmetic.
      const subtotalCents = lines.reduce((sum, l) => sum + l.cents, 0n);
      const discountCents = toCents(discount);
      if (discountCents > subtotalCents) throw fail('The discount is larger than the sale total');
      const taxable = subtotalCents - discountCents;
      const taxAmount = taxCents(taxable, taxRate);
      const totalCents = taxable + taxAmount;
      const total = fromCents(totalCents);

      let amountPaid = 0;
      if (paymentStatus === 'paid') amountPaid = total;
      if (paymentStatus === 'partial') {
        amountPaid = money(number(body.amount_paid, 'Amount paid', { required: true, min: 0.01 }));
        if (amountPaid >= total) throw fail('That covers the whole sale - choose "Paid" instead');
      }

      const { rows: saleRows } = await tx.query(
        `INSERT INTO sales (customer_id, subtotal, discount, tax_rate, tax, total, payment_status, payment_method, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [customerId, fromCents(subtotalCents), discount, taxRate, fromCents(taxAmount), total, total === 0 ? 'paid' : 'unpaid', method, notes]
      );
      const sale = saleRows[0];

      for (const line of lines) {
        await tx.query(
          `INSERT INTO sale_items (sale_id, product_id, description, quantity, unit_price, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [sale.id, line.productId, line.description, line.quantity, line.unitPrice, line.unitCost]
        );
      }

      if (amountPaid > 0) {
        await tx.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, $2, $3)', [sale.id, amountPaid, method]);
      }

      if (customer) await queueSaleConfirmation(tx, sale, customer);
      return sale.id;
    });

    res.status(201).json(await loadSale(newSaleId));
  } catch (err) {
    next(err);
  }
};

/**
 * Settling up. Kept compatible with "set the payment status" callers (the
 * list's Mark paid, the assistant) by translating a status into the payment
 * that makes it true: paid records the balance, part-paid records `amount`,
 * refunded records a refund of what was paid, unpaid clears the payments.
 */
exports.update = async (req, res, next) => {
  try {
    const sale = await loadSale(req.params.id);
    const body = req.body || {};
    const status = oneOf(body.payment_status, 'Payment status', PAYMENT_STATUSES);
    const method = paymentMethod(body.payment_method);
    const notes = text(body.notes, 'Notes', { max: 2000 });
    const amount = body.amount === undefined || body.amount === null || body.amount === ''
      ? null
      : money(number(body.amount, 'Amount', { min: 0.01 }));
    const balance = money(sale.total - sale.amount_paid);

    await db.transaction(async (tx) => {
      if (notes !== null) await tx.query('UPDATE sales SET notes = $1 WHERE id = $2', [notes, sale.id]);

      const useMethod = method || sale.payment_method || 'cash';
      if (status === 'paid') {
        if (balance > 0) {
          await tx.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, $2, $3)', [sale.id, balance, useMethod]);
        } else if (sale.payment_status !== 'paid') {
          await tx.query("UPDATE sales SET payment_status = 'paid' WHERE id = $1 AND total = amount_paid", [sale.id]);
        }
      } else if (status === 'partial') {
        if (amount === null) throw fail('Enter how much was paid');
        if (amount > balance) throw fail(`Only ${balance.toFixed(2)} is still owed on ${sale.reference}`);
        await tx.query('INSERT INTO payments (sale_id, amount, method) VALUES ($1, $2, $3)', [sale.id, amount, useMethod]);
      } else if (status === 'refunded') {
        const refund = amount ?? money(sale.amount_paid);
        if (!(sale.amount_paid > 0)) throw fail(`Nothing has been paid on ${sale.reference}, so there is nothing to refund`);
        if (refund > sale.amount_paid) throw fail(`Only ${Number(sale.amount_paid).toFixed(2)} was paid on ${sale.reference}`);
        await tx.query('INSERT INTO payments (sale_id, amount, method, note) VALUES ($1, $2, $3, $4)', [sale.id, -refund, useMethod, 'Refund']);
      } else if (status === 'unpaid') {
        const { rowCount } = await tx.query('DELETE FROM payments WHERE sale_id = $1', [sale.id]);
        // A sale with no payment rows (e.g. imported as part-paid) is set directly.
        if (!rowCount) await tx.query("UPDATE sales SET payment_status = 'unpaid' WHERE id = $1", [sale.id]);
      } else if (method) {
        await tx.query('UPDATE sales SET payment_method = $1 WHERE id = $2', [method, sale.id]);
      }
    });

    res.json(await loadSale(req.params.id));
  } catch (err) {
    next(err);
  }
};

/** Records one payment (or a refund, with a negative amount) against a sale. */
exports.addPayment = async (req, res, next) => {
  try {
    const sale = await loadSale(req.params.id);
    const amount = money(number(req.body?.amount, 'Amount', { required: true }));
    if (amount === 0) throw fail('Enter an amount');
    const method = paymentMethod(req.body?.method, 'Payment method', { fallback: sale.payment_method || 'cash' });
    const note = text(req.body?.note, 'Note', { max: 250 });
    await db.query('INSERT INTO payments (sale_id, amount, method, note) VALUES ($1, $2, $3, $4)', [sale.id, amount, method, note]);
    res.status(201).json(await loadSale(sale.id));
  } catch (err) {
    next(err);
  }
};

exports.removePayment = async (req, res, next) => {
  try {
    const sale = await loadSale(req.params.id);
    const { rowCount } = await db.query('DELETE FROM payments WHERE id = $1 AND sale_id = $2', [req.params.paymentId, sale.id]);
    if (!rowCount) throw fail('Payment not found', 404);
    res.json(await loadSale(sale.id));
  } catch (err) {
    next(err);
  }
};

// Deleting a sale returns its stock - the database does it as the lines go.
exports.remove = async (req, res, next) => {
  try {
    const sale = await loadSale(req.params.id);
    await db.query('DELETE FROM sales WHERE id = $1', [sale.id]);
    res.json({ ok: true, stockRestored: sale.items.some((i) => i.product_id) });
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
  const settings = await readSettings();
  return {
    business: {
      name: settings.business_name,
      address: settings.business_address,
      phone: settings.business_phone,
      email: settings.business_email,
      footer: settings.receipt_footer,
    },
    currency: settings.currency_symbol,
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
      taxRate: Number(sale.tax_rate),
      tax: Number(sale.tax),
      total: Number(sale.total),
      paid: Number(sale.amount_paid),
      balance: Number(sale.balance_due),
    },
    payment: { status: sale.payment_status, method: sale.payment_method },
    payments: sale.payments.map((p) => ({ amount: Number(p.amount), method: p.method, kind: p.kind, paidAt: p.paid_at })),
    notes: sale.notes,
  };
}

exports.loadSale = loadSale;
exports.buildReceipt = buildReceipt;
