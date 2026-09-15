const db = require('../db');

// Nothing here sends anything. Triggers write a row into message_log with
// status 'queued' and the mock sender marks it 'sent', so the trigger logic is
// fully observable and testable before a real provider exists.
// Real delivery lands in Phase 6 - see REQUIREMENTS.md.

async function queueMessage(tx, { channel = 'email', recipient, subject, body, triggerType, relatedType, relatedId }) {
  const runner = tx || db;
  const { rows } = await runner.query(
    `INSERT INTO message_log (channel, recipient, subject, body, trigger_type, status, related_type, related_id)
     VALUES ($1,$2,$3,$4,$5,'queued',$6,$7) RETURNING *`,
    [channel, recipient || null, subject || null, body || null, triggerType || null, relatedType || null, relatedId || null]
  );
  return rows[0];
}

/**
 * Called after any change that can move stock. Queues one alert per product
 * that has fallen to or below its reorder level.
 *
 * Re-alerting is suppressed: if an unsent alert already exists for a product we
 * skip it, otherwise every sale of an already-low item would queue another copy.
 */
async function checkStockLevels(tx, productIds = []) {
  const runner = tx || db;
  if (!productIds.length) return [];

  const placeholders = productIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows: lowStock } = await runner.query(
    `SELECT id, name, sku, stock_quantity, reorder_level
     FROM products
     WHERE id IN (${placeholders})
       AND reorder_level > 0
       AND stock_quantity <= reorder_level`,
    productIds
  );

  const queued = [];
  for (const product of lowStock) {
    const { rows: existing } = await runner.query(
      `SELECT id FROM message_log
       WHERE related_type = 'product' AND related_id = $1
         AND trigger_type = 'low_stock' AND status = 'queued'`,
      [product.id]
    );
    if (existing.length) continue;

    const outOfStock = Number(product.stock_quantity) <= 0;
    queued.push(
      await queueMessage(runner, {
        triggerType: 'low_stock',
        relatedType: 'product',
        relatedId: product.id,
        subject: outOfStock
          ? `Out of stock: ${product.name}`
          : `Running low: ${product.name}`,
        body: outOfStock
          ? `${product.name} (${product.sku || 'no SKU'}) has sold out. Reorder level is ${product.reorder_level}.`
          : `${product.name} (${product.sku || 'no SKU'}) is down to ${product.stock_quantity}, at or below its reorder level of ${product.reorder_level}.`,
      })
    );
  }
  return queued;
}

async function queueSaleConfirmation(tx, sale, customer) {
  if (!customer?.email && !customer?.phone) return null;
  return queueMessage(tx, {
    channel: customer.email ? 'email' : 'sms',
    recipient: customer.email || customer.phone,
    triggerType: 'sale_confirmation',
    relatedType: 'sale',
    relatedId: sale.id,
    subject: `Receipt ${sale.reference}`,
    body: `Thanks ${customer.name}. Your total was ${Number(sale.total).toFixed(2)}.`,
  });
}

/**
 * Stand-in for a real provider. Flips queued rows to 'sent' and records when.
 * Swapping this for a real client in Phase 6 should not require touching any
 * caller.
 */
async function sendQueued({ limit = 50 } = {}) {
  const { rows: pending } = await db.query(
    `SELECT * FROM message_log WHERE status = 'queued' ORDER BY created_at LIMIT $1`,
    [limit]
  );

  const sent = [];
  for (const message of pending) {
    console.log(`[messaging:mock] would send via ${message.channel} to ${message.recipient || '(no recipient)'}: ${message.subject}`);
    const { rows } = await db.query(
      `UPDATE message_log SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
      [message.id]
    );
    sent.push(rows[0]);
  }
  return sent;
}

module.exports = { queueMessage, checkStockLevels, queueSaleConfirmation, sendQueued };
