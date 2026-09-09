const pool = require('../db');

exports.getAllPatients = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, d.name as doctor_name 
      FROM patients p 
      LEFT JOIN doctors d ON p.doctor_id = d.id 
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching patients' });
  }
};

exports.getPatientById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(`
      SELECT p.*, d.name as doctor_name 
      FROM patients p 
      LEFT JOIN doctors d ON p.doctor_id = d.id 
      WHERE p.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching patient' });
  }
};

exports.createPatient = async (req, res) => {
  const { name, age, species, phone, doctor_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO patients (name, age, species, phone, doctor_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, age, species, phone, doctor_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating patient' });
  }
};

exports.updatePatient = async (req, res) => {
  const { id } = req.params;
  const { name, age, species, phone, doctor_id } = req.body;
  try {
    const result = await pool.query(
      'UPDATE patients SET name = $1, age = $2, species = $3, phone = $4, doctor_id = $5 WHERE id = $6 RETURNING *',
      [name, age, species, phone, doctor_id || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating patient' });
  }
};

exports.deletePatient = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM patients WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Patient not found' });
    }
    res.json({ message: 'Patient deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error deleting patient' });
  }
};
