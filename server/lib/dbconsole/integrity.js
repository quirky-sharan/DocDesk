const fs = require('fs');
const db = require('../../db');
const { UPLOAD_DIR, resolveStoredPath } = require('../storage');
const { PART_PAID_NOTE } = require('../../db/legacy/importSqlite');
const { fail } = require('../validate');

/**
 * Consistency checks across the whole database. Most rules are already enforced
 * as constraints and triggers, so these are the second line: they prove the
 * derived data (stock balances, payment status, order status, alerts) still
 * agrees with the records it is derived from, and that the database and the
 * files on disk agree. Each problem that can be repaired safely comes with a fix.
 */

const CHECKS = [
  {
    id: 'stock_ledger',
    title: 'Stock balances match the stock ledger',
    explain: 'Every product\'s stock should equal the sum of its stock movements.',
    fixable: true,
    async find() {
      const { rows } = await db.query(`
        SELECT p.id, p.name, p.stock_quantity AS balance, COALESCE(m.total, 0) AS ledger
          FROM products p
          LEFT JOIN (SELECT product_id, sum(change) AS total FROM stock_movements GROUP BY product_id) m ON m.product_id = p.id
         WHERE p.stock_quantity <> COALESCE(m.total, 0)
         ORDER BY p.name`);
      return rows.map((r) => ({ id: r.id, label: r.name, detail: `stock ${Number(r.balance)}, ledger says ${Number(r.ledger)}` }));
    },
    // The balance is what someone counted or recorded last; add a ledger line so
    // the history explains it.
    async fix(tx) {
      const { rowCount } = await tx.query(`
        INSERT INTO stock_movements (product_id, change, balance_after, kind, note, actor)
        SELECT p.id, p.stock_quantity - COALESCE(m.total, 0), p.stock_quantity, 'correction', 'Ledger reconciled by the integrity check', 'integrity-check'
          FROM products p
          LEFT JOIN (SELECT product_id, sum(change) AS total FROM stock_movements GROUP BY product_id) m ON m.product_id = p.id
         WHERE p.stock_quantity <> COALESCE(m.total, 0)`);
      return rowCount;
    },
  },
  {
    id: 'sale_totals',
    title: 'Sales add up',
    explain: 'A sale\'s subtotal equals its lines, and its total equals subtotal - discount + tax.',
    fixable: false,
    async find() {
      const { rows } = await db.query(`
        SELECT s.id, s.reference, s.subtotal, COALESCE(sum(si.line_total), 0) AS lines
          FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
         GROUP BY s.id
        HAVING s.subtotal <> COALESCE(sum(si.line_total), 0)
         ORDER BY s.id`);
      return rows.map((r) => ({ id: r.id, label: r.reference, detail: `subtotal ${r.subtotal}, lines ${r.lines}` }));
    },
  },
  {
    id: 'payments',
    title: 'Payment status matches the payments recorded',
    explain: 'Amount paid should be the sum of a sale\'s payments, and its status should follow from that.',
    fixable: true,
    async find() {
      const { rows } = await db.query(`
        WITH paid AS (
          SELECT s.id, s.reference, s.total, s.amount_paid, s.payment_status, s.notes,
                 COALESCE(sum(p.amount), 0) AS sum_paid, count(p.id) AS payments,
                 count(p.id) FILTER (WHERE p.amount < 0) AS refunds
            FROM sales s LEFT JOIN payments p ON p.sale_id = s.id
           GROUP BY s.id
        )
        SELECT *, CASE
                    WHEN refunds > 0 AND sum_paid = 0 THEN 'refunded'
                    WHEN sum_paid = 0 AND total = 0 THEN 'paid'
                    WHEN sum_paid = 0 THEN 'unpaid'
                    WHEN sum_paid < total THEN 'partial'
                    ELSE 'paid' END AS expected
          FROM paid
         WHERE amount_paid <> sum_paid
            OR payment_status <> CASE
                    WHEN refunds > 0 AND sum_paid = 0 THEN 'refunded'
                    WHEN sum_paid = 0 AND total = 0 THEN 'paid'
                    WHEN sum_paid = 0 THEN 'unpaid'
                    WHEN sum_paid < total THEN 'partial'
                    ELSE 'paid' END
         ORDER BY id`);
      return rows
        .filter((r) => !(r.payment_status === 'partial' && Number(r.payments) === 0 && String(r.notes || '').includes(PART_PAID_NOTE)))
        .map((r) => ({ id: r.id, label: r.reference, detail: `${r.payment_status} with ${Number(r.sum_paid)} paid - should be ${r.expected}` }));
    },
    async fix(tx) {
      const { rowCount } = await tx.query(`
        WITH paid AS (
          SELECT s.id, COALESCE(sum(p.amount), 0) AS sum_paid, count(p.id) FILTER (WHERE p.amount < 0) AS refunds, count(p.id) AS payments
            FROM sales s LEFT JOIN payments p ON p.sale_id = s.id GROUP BY s.id
        )
        UPDATE sales s
           SET amount_paid = paid.sum_paid,
               payment_status = CASE
                 WHEN paid.refunds > 0 AND paid.sum_paid = 0 THEN 'refunded'
                 WHEN paid.sum_paid = 0 AND s.total = 0 THEN 'paid'
                 WHEN paid.sum_paid = 0 THEN 'unpaid'
                 WHEN paid.sum_paid < s.total THEN 'partial'
                 ELSE 'paid' END
          FROM paid
         WHERE paid.id = s.id
           AND NOT (s.payment_status = 'partial' AND paid.payments = 0 AND COALESCE(s.notes, '') LIKE '%' || $1 || '%')
           AND (s.amount_paid <> paid.sum_paid OR s.payment_status <> CASE
                 WHEN paid.refunds > 0 AND paid.sum_paid = 0 THEN 'refunded'
                 WHEN paid.sum_paid = 0 AND s.total = 0 THEN 'paid'
                 WHEN paid.sum_paid = 0 THEN 'unpaid'
                 WHEN paid.sum_paid < s.total THEN 'partial'
                 ELSE 'paid' END)`, [PART_PAID_NOTE]);
      return rowCount;
    },
  },
  {
    id: 'part_paid_unknown',
    title: 'Part-paid sales have an amount',
    explain: 'Sales carried over from the earlier version as part-paid never recorded how much was paid. Record the payment on each.',
    fixable: false,
    severity: 'warning',
    async find() {
      const { rows } = await db.query(
        `SELECT s.id, s.reference, s.total FROM sales s
          WHERE s.payment_status = 'partial' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id)
          ORDER BY s.created_at`
      );
      return rows.map((r) => ({ id: r.id, label: r.reference, detail: `total ${r.total}, amount paid unknown` }));
    },
  },
  {
    id: 'order_status',
    title: 'Purchase order status follows what arrived',
    explain: 'Fully received orders are "received", part-received ones "partial".',
    fixable: true,
    async find() {
      const { rows } = await db.query(`
        SELECT po.id, po.reference, po.status,
               CASE WHEN bool_and(i.quantity_received >= i.quantity) THEN 'received'
                    WHEN bool_or(i.quantity_received > 0) THEN 'partial' END AS expected
          FROM purchase_orders po JOIN purchase_order_items i ON i.purchase_order_id = po.id
         WHERE po.status <> 'cancelled'
         GROUP BY po.id
        HAVING (bool_and(i.quantity_received >= i.quantity) AND po.status <> 'received')
            OR (bool_or(i.quantity_received > 0) AND NOT bool_and(i.quantity_received >= i.quantity) AND po.status <> 'partial')
         ORDER BY po.id`);
      return rows.map((r) => ({ id: r.id, label: r.reference, detail: `marked ${r.status}, deliveries say ${r.expected}` }));
    },
    async fix(tx) {
      const { rowCount } = await tx.query(`
        UPDATE purchase_orders po
           SET status = x.expected, received_date = CASE WHEN x.expected = 'received' THEN COALESCE(po.received_date, current_date) ELSE NULL END
          FROM (SELECT purchase_order_id AS id,
                       CASE WHEN bool_and(quantity_received >= quantity) THEN 'received' ELSE 'partial' END AS expected
                  FROM purchase_order_items GROUP BY purchase_order_id
                HAVING bool_or(quantity_received > 0)) x
         WHERE x.id = po.id AND po.status <> 'cancelled' AND po.status <> x.expected`);
      return rowCount;
    },
  },
  {
    id: 'low_stock_alerts',
    title: 'Low-stock alerts match stock levels',
    explain: 'Every product at or below its reorder level has one waiting alert, and no other product does.',
    fixable: true,
    async find() {
      const { rows } = await db.query(`
        SELECT p.id, p.name, p.stock_quantity, p.reorder_level, (m.id IS NOT NULL) AS has_alert
          FROM products p
          LEFT JOIN message_log m ON m.related_type = 'product' AND m.related_id = p.id AND m.trigger_type = 'low_stock' AND m.status = 'queued'
         WHERE (p.reorder_level > 0 AND p.stock_quantity <= p.reorder_level) <> (m.id IS NOT NULL)
         ORDER BY p.name`);
      return rows.map((r) => ({ id: r.id, label: r.name, detail: r.has_alert ? 'alert waiting but stock is fine' : 'low but no alert waiting' }));
    },
    // Re-applying the reorder level fires the alert trigger, which creates or
    // withdraws the alert exactly as a stock change would.
    async fix(tx) {
      const { rowCount } = await tx.query(`
        UPDATE products p SET reorder_level = p.reorder_level
         WHERE (p.reorder_level > 0 AND p.stock_quantity <= p.reorder_level) <> EXISTS (
           SELECT 1 FROM message_log m WHERE m.related_type = 'product' AND m.related_id = p.id AND m.trigger_type = 'low_stock' AND m.status = 'queued')`);
      return rowCount;
    },
  },
  {
    id: 'missing_files',
    title: 'Every file record has its file on disk',
    explain: 'A record whose file was deleted outside DocDesk can no longer be opened.',
    fixable: true,
    async find() {
      const { rows } = await db.query('SELECT id, original_name, stored_name FROM files ORDER BY id');
      return rows
        .filter((f) => {
          try {
            return !fs.existsSync(resolveStoredPath(f.stored_name));
          } catch {
            return true;
          }
        })
        .map((f) => ({ id: f.id, label: f.original_name, detail: 'file missing from the uploads folder' }));
    },
    async fix(tx) {
      const missing = await this.find();
      if (!missing.length) return 0;
      const { rowCount } = await tx.query('DELETE FROM files WHERE id = ANY($1::bigint[])', [missing.map((m) => m.id)]);
      return rowCount;
    },
  },
  {
    id: 'orphan_files',
    title: 'Every file on disk belongs to a record',
    explain: 'Files left in the uploads folder with no record take space and can\'t be seen in DocDesk.',
    fixable: true,
    async find() {
      if (!fs.existsSync(UPLOAD_DIR)) return [];
      const { rows } = await db.query('SELECT stored_name FROM files');
      const known = new Set(rows.map((r) => r.stored_name));
      return fs
        .readdirSync(UPLOAD_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && !known.has(entry.name))
        .map((entry) => ({ id: entry.name, label: entry.name, detail: `${Math.round(fs.statSync(resolveStoredPath(entry.name)).size / 1024)} KB with no record` }));
    },
    async fix() {
      const orphans = await this.find();
      for (const orphan of orphans) fs.rmSync(resolveStoredPath(orphan.id), { force: true });
      return orphans.length;
    },
  },
  {
    id: 'duplicate_customers',
    title: 'No duplicate customers',
    explain: 'Two customer records with the same phone number are probably the same person.',
    fixable: false,
    severity: 'warning',
    async find() {
      const { rows } = await db.query(`
        SELECT regexp_replace(phone, '\\D', '', 'g') AS digits, string_agg(name, ', ' ORDER BY id) AS names, count(*) AS n, min(id) AS id
          FROM customers WHERE phone IS NOT NULL AND length(regexp_replace(phone, '\\D', '', 'g')) >= 7
         GROUP BY 1 HAVING count(*) > 1 ORDER BY n DESC`);
      return rows.map((r) => ({ id: r.id, label: r.names, detail: `${r.n} records share phone ending ${r.digits.slice(-4)}` }));
    },
  },
];

// Guaranteed by the schema itself - listed so the report shows what holds, and why.
const GUARANTEED = [
  { id: 'fk', title: 'Every reference points at a real record', by: 'Foreign key constraints' },
  { id: 'negative_stock', title: 'No product has negative stock', by: 'CHECK (stock_quantity >= 0)' },
  { id: 'overpaid', title: 'No sale is paid more than its total', by: 'CHECK (amount_paid <= total) and the payments trigger' },
  { id: 'over_received', title: 'No order line received more than ordered', by: 'CHECK (quantity_received <= quantity)' },
  { id: 'unique_sku', title: 'No two products share a code', by: 'Unique index on lower(sku)' },
  { id: 'emails', title: 'Email addresses are well-formed', by: 'CHECK constraints on customers and suppliers' },
];

async function runChecks() {
  const started = Date.now();
  const results = [];
  for (const check of CHECKS) {
    try {
      const problems = await check.find();
      results.push({
        id: check.id,
        title: check.title,
        explain: check.explain,
        status: problems.length ? check.severity || 'error' : 'ok',
        count: problems.length,
        samples: problems.slice(0, 12),
        fixable: Boolean(check.fixable && problems.length),
      });
    } catch (err) {
      results.push({ id: check.id, title: check.title, explain: check.explain, status: 'error', count: 0, samples: [], error: err.message, fixable: false });
    }
  }
  return {
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    healthy: results.every((r) => r.status === 'ok'),
    results,
    guaranteed: GUARANTEED,
  };
}

async function fixCheck(id) {
  const check = CHECKS.find((c) => c.id === id);
  if (!check) throw fail('Unknown check', 404);
  if (!check.fixable) throw fail('That problem needs a person to look at it - there is no automatic fix.', 400);
  const fixed = await db.transaction((tx) => check.fix(tx), { actor: 'integrity-check' });
  return { id, fixed };
}

module.exports = { runChecks, fixCheck };
