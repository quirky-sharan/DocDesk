const pool = require('../db');
const xlsx = require('xlsx');

// Helper: build & stream an xlsx workbook as a download
function streamWorkbook(res, workbook, filename) {
  const buf = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
}

// GET /api/export/patients
async function exportPatients(req, res, next) {
  try {
    const { rows } = await pool.query(
      'SELECT id, owner_name, pet_name, species, breed, age, gender, phone, email, address, notes, created_at FROM patients ORDER BY created_at DESC'
    );
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Patients');
    streamWorkbook(res, wb, 'patients.xlsx');
  } catch (err) {
    next(err);
  }
}

// GET /api/export/billing
async function exportBilling(req, res, next) {
  try {
    const { rows } = await pool.query(`
      SELECT b.id, p.owner_name, p.pet_name, b.subtotal, b.tax, b.discount, b.total,
             b.payment_status, b.payment_method, b.created_at
      FROM bills b LEFT JOIN patients p ON p.id = b.patient_id
      ORDER BY b.created_at DESC`
    );
    const ws = xlsx.utils.json_to_sheet(rows);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Billing');
    streamWorkbook(res, wb, 'billing.xlsx');
  } catch (err) {
    next(err);
  }
}

module.exports = { exportPatients, exportBilling };
