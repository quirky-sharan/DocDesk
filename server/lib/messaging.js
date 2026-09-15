const db = require('../db');

// Nothing here sends anything. Messages are written to message_log as 'queued'
// and the mock sender marks them 'sent', so what would go out is visible and
// testable before a real provider exists. Real delivery lands in Phase 6 - see
// REQUIREMENTS.md.
//
// Low-stock alerts are not raised here any more: the database queues and
// withdraws them itself when stock crosses a reorder level (see
// db/migrations/004_business_rules.sql), so they fire no matter what moved the
// stock.

async function queueMessage(tx, { channel = 'email', recipient, subject, body, triggerType, relatedType, relatedId }) {
  const runner = tx || db;
  const { rows } = await runner.query(
    `INSERT INTO message_log (channel, recipient, subject, body, trigger_type, status, related_type, related_id)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7) RETURNING *`,
    [channel, recipient || null, subject || null, body || null, triggerType || null, relatedType || null, relatedId || null]
  );
  return rows[0];
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
  return db.transaction(async (tx) => {
    const { rows: pending } = await tx.query(
      `SELECT * FROM message_log WHERE status = 'queued' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const sent = [];
    for (const message of pending) {
      console.log(`[messaging:mock] would send via ${message.channel} to ${message.recipient || '(no recipient)'}: ${message.subject}`);
      const { rows } = await tx.query(
        `UPDATE message_log SET status = 'sent', sent_at = now() WHERE id = $1 RETURNING *`,
        [message.id]
      );
      sent.push(rows[0]);
    }
    return sent;
  });
}

module.exports = { queueMessage, queueSaleConfirmation, sendQueued };
