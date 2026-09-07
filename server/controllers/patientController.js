const pool = require('../db');

// GET /api/patients
async function listPatients(req, res, next) {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM app_patients';
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` WHERE owner_name ILIKE $1 OR pet_name ILIKE $1 OR phone ILIKE $1`;
    }
    query += ' ORDER BY created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/patients
async function createPatient(req, res, next) {
  try {
    const { owner_name, pet_name, species, breed, age, gender, phone, email, address, notes } = req.body;
    if (!owner_name || !pet_name) {
      return res.status(400).json({ error: 'owner_name and pet_name are required' });
    }
    const { rows } = await pool.query(
      `INSERT INTO app_patients (owner_name, pet_name, species, breed, age, gender, phone, email, address, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [owner_name, pet_name, species, breed, age, gender, phone, email, address, notes]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /api/patients/:id
async function getPatient(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM app_patients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Patient not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// PUT /api/patients/:id
async function updatePatient(req, res, next) {
  try {
    const { owner_name, pet_name, species, breed, age, gender, phone, email, address, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE app_patients SET
         owner_name=$1, pet_name=$2, species=$3, breed=$4, age=$5,
         gender=$6, phone=$7, email=$8, address=$9, notes=$10
       WHERE id=$11 RETURNING *`,
      [owner_name, pet_name, species, breed, age, gender, phone, email, address, notes, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Patient not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/patients/:id
async function deletePatient(req, res, next) {
  try {
    const { rowCount } = await pool.query('DELETE FROM app_patients WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Patient not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { listPatients, createPatient, getPatient, updatePatient, deletePatient };
