const pool = require('../db');

exports.getAllDoctors = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM doctors ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching doctors' });
  }
};

exports.getDoctorById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM doctors WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching doctor' });
  }
};

exports.createDoctor = async (req, res) => {
  const { name, specialization, phone } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO doctors (name, specialization, phone) VALUES ($1, $2, $3) RETURNING *',
      [name, specialization, phone]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating doctor' });
  }
};

exports.updateDoctor = async (req, res) => {
  const { id } = req.params;
  const { name, specialization, phone } = req.body;
  try {
    const result = await pool.query(
      'UPDATE doctors SET name = $1, specialization = $2, phone = $3 WHERE id = $4 RETURNING *',
      [name, specialization, phone, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating doctor' });
  }
};

exports.deleteDoctor = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM doctors WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Doctor not found' });
    }
    res.json({ message: 'Doctor deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error deleting doctor' });
  }
};
