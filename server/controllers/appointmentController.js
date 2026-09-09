const pool = require('../db');

exports.getAllAppointments = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, d.name as doctor_name 
      FROM appointments a 
      LEFT JOIN patients p ON a.patient_id = p.id 
      LEFT JOIN doctors d ON a.doctor_id = d.id 
      ORDER BY a.appointment_date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching appointments' });
  }
};

exports.getAppointmentById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT a.*, p.name as patient_name, d.name as doctor_name 
      FROM appointments a 
      LEFT JOIN patients p ON a.patient_id = p.id 
      LEFT JOIN doctors d ON a.doctor_id = d.id 
      WHERE a.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching appointment' });
  }
};

exports.createAppointment = async (req, res) => {
  const { patient_id, doctor_id, appointment_date, status, notes } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO appointments (patient_id, doctor_id, appointment_date, status, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [patient_id, doctor_id, appointment_date, status || 'scheduled', notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating appointment' });
  }
};

exports.updateAppointment = async (req, res) => {
  const { id } = req.params;
  const { patient_id, doctor_id, appointment_date, status, notes } = req.body;
  try {
    const result = await pool.query(
      'UPDATE appointments SET patient_id = $1, doctor_id = $2, appointment_date = $3, status = $4, notes = $5 WHERE id = $6 RETURNING *',
      [patient_id, doctor_id, appointment_date, status, notes, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating appointment' });
  }
};

exports.deleteAppointment = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM appointments WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found' });
    }
    res.json({ message: 'Appointment deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error deleting appointment' });
  }
};
