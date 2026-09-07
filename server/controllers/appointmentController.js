const pool = require('../db');

// GET /api/appointments
async function listAppointments(req, res, next) {
  try {
    const { date, status, patient_id } = req.query;
    let query = `
      SELECT a.*, p.pet_name, p.owner_name, u.name AS doctor_name
      FROM app_appointments a
      LEFT JOIN patients p ON p.id = a.patient_id
      LEFT JOIN users    u ON u.id = a.doctor_id
    `;
    const conditions = [];
    const params = [];
    if (date)      { params.push(date);       conditions.push(`a.appointment_date = $${params.length}`); }
    if (status)    { params.push(status);     conditions.push(`a.status = $${params.length}`); }
    if (patient_id){ params.push(patient_id); conditions.push(`a.patient_id = $${params.length}`); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY a.appointment_date DESC, a.appointment_time DESC';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/appointments
async function createAppointment(req, res, next) {
  try {
    const { patient_id, doctor_id, appointment_date, appointment_time, reason, status, notes } = req.body;
    if (!patient_id || !appointment_date || !appointment_time) {
      return res.status(400).json({ error: 'patient_id, appointment_date, and appointment_time are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO app_appointments (patient_id, doctor_id, appointment_date, appointment_time, reason, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [patient_id, doctor_id, appointment_date, appointment_time, reason, status || 'scheduled', notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /api/appointments/:id
async function getAppointment(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, p.pet_name, p.owner_name, u.name AS doctor_name
       FROM app_appointments a
       LEFT JOIN patients p ON p.id = a.patient_id
       LEFT JOIN users    u ON u.id = a.doctor_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// PUT /api/appointments/:id
async function updateAppointment(req, res, next) {
  try {
    const { patient_id, doctor_id, appointment_date, appointment_time, reason, status, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE app_appointments SET
         patient_id=$1, doctor_id=$2, appointment_date=$3, appointment_time=$4,
         reason=$5, status=$6, notes=$7
       WHERE id=$8 RETURNING *`,
      [patient_id, doctor_id, appointment_date, appointment_time, reason, status, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/appointments/:id
async function deleteAppointment(req, res, next) {
  try {
    const { rowCount } = await pool.query('DELETE FROM app_appointments WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Appointment not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { listAppointments, createAppointment, getAppointment, updateAppointment, deleteAppointment };
