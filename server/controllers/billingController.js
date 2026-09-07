const pool = require('../db');
const puppeteer = require('puppeteer');

// GET /api/billing
async function listBills(req, res, next) {
  try {
    const { patient_id, payment_status } = req.query;
    let query = `
      SELECT b.*, p.owner_name, p.pet_name
      FROM bills b
      LEFT JOIN patients p ON p.id = b.patient_id
    `;
    const conditions = [];
    const params = [];
    if (patient_id)     { params.push(patient_id);     conditions.push(`b.patient_id = $${params.length}`); }
    if (payment_status) { params.push(payment_status); conditions.push(`b.payment_status = $${params.length}`); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY b.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/billing
async function createBill(req, res, next) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { patient_id, appointment_id, subtotal, tax, discount, total, payment_status, payment_method, items } = req.body;
    if (!patient_id) return res.status(400).json({ error: 'patient_id is required' });

    const { rows: billRows } = await client.query(
      `INSERT INTO bills (patient_id, appointment_id, subtotal, tax, discount, total, payment_status, payment_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [patient_id, appointment_id, subtotal || 0, tax || 0, discount || 0, total || 0, payment_status || 'pending', payment_method]
    );
    const bill = billRows[0];

    // Insert line items
    if (Array.isArray(items) && items.length) {
      for (const item of items) {
        await client.query(
          `INSERT INTO bill_items (bill_id, description, quantity, unit_price)
           VALUES ($1,$2,$3,$4)`,
          [bill.id, item.description, item.quantity || 1, item.unit_price || 0]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(bill);
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
}

// GET /api/billing/:id
async function getBill(req, res, next) {
  try {
    const { rows: billRows } = await pool.query(
      `SELECT b.*, p.owner_name, p.pet_name, p.phone AS owner_phone
       FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!billRows.length) return res.status(404).json({ error: 'Bill not found' });
    const bill = billRows[0];

    const { rows: items } = await pool.query(
      'SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id',
      [req.params.id]
    );
    res.json({ ...bill, items });
  } catch (err) {
    next(err);
  }
}

// PUT /api/billing/:id
async function updateBill(req, res, next) {
  try {
    const { subtotal, tax, discount, total, payment_status, payment_method } = req.body;
    const { rows } = await pool.query(
      `UPDATE bills SET subtotal=$1, tax=$2, discount=$3, total=$4,
         payment_status=$5, payment_method=$6
       WHERE id=$7 RETURNING *`,
      [subtotal, tax, discount, total, payment_status, payment_method, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Bill not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/billing/:id
async function deleteBill(req, res, next) {
  try {
    const { rowCount } = await pool.query('DELETE FROM bills WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Bill not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// GET /api/billing/:id/pdf — generate receipt PDF and stream it
async function downloadBillPdf(req, res, next) {
  let browser;
  try {
    const { rows: billRows } = await pool.query(
      `SELECT b.*, p.owner_name, p.pet_name, p.phone AS owner_phone, p.email AS owner_email
       FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!billRows.length) return res.status(404).json({ error: 'Bill not found' });
    const bill = billRows[0];

    const { rows: items } = await pool.query(
      'SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id',
      [req.params.id]
    );

    const itemsHtml = items.map(i => `
      <tr>
        <td>${i.description}</td>
        <td>${i.quantity}</td>
        <td>₹${Number(i.unit_price).toFixed(2)}</td>
        <td>₹${Number(i.total_price).toFixed(2)}</td>
      </tr>`).join('');

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #111; }
          h1   { color: #1a56db; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
          th { background: #f3f4f6; }
          .totals { text-align: right; margin-top: 16px; font-size: 15px; }
          .totals strong { font-size: 18px; }
        </style>
      </head>
      <body>
        <h1>DocDesk — Receipt</h1>
        <p><strong>Bill #${bill.id}</strong> &nbsp;|&nbsp; ${new Date(bill.created_at).toLocaleDateString()}</p>
        <p>Patient: <strong>${bill.pet_name}</strong> (Owner: ${bill.owner_name})</p>
        <p>Phone: ${bill.owner_phone || '—'} &nbsp;|&nbsp; Email: ${bill.owner_email || '—'}</p>
        <table>
          <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <div class="totals">
          <p>Subtotal: ₹${Number(bill.subtotal).toFixed(2)}</p>
          <p>Tax: ₹${Number(bill.tax).toFixed(2)}</p>
          <p>Discount: -₹${Number(bill.discount).toFixed(2)}</p>
          <p><strong>Total: ₹${Number(bill.total).toFixed(2)}</strong></p>
          <p>Payment: ${bill.payment_status} (${bill.payment_method || '—'})</p>
        </div>
      </body>
      </html>`;

    browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${bill.id}.pdf"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { listBills, createBill, getBill, updateBill, deleteBill, downloadBillPdf };
