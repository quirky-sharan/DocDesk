const pool = require('../db');

// GET /api/medications
async function listMedications(req, res, next) {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM medications';
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      query += ` WHERE name ILIKE $1 OR dosage_form ILIKE $1`;
    }
    query += ' ORDER BY name ASC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

// POST /api/medications
async function createMedication(req, res, next) {
  try {
    const { name, dosage_form, unit, stock_quantity, price_per_unit, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { rows } = await pool.query(
      `INSERT INTO medications (name, dosage_form, unit, stock_quantity, price_per_unit, description)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, dosage_form, unit, stock_quantity || 0, price_per_unit || 0, description]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// GET /api/medications/:id
async function getMedication(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM medications WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Medication not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// PUT /api/medications/:id
async function updateMedication(req, res, next) {
  try {
    const { name, dosage_form, unit, stock_quantity, price_per_unit, description } = req.body;
    const { rows } = await pool.query(
      `UPDATE medications SET
         name=$1, dosage_form=$2, unit=$3, stock_quantity=$4, price_per_unit=$5, description=$6
       WHERE id=$7 RETURNING *`,
      [name, dosage_form, unit, stock_quantity, price_per_unit, description, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Medication not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

// DELETE /api/medications/:id
async function deleteMedication(req, res, next) {
  try {
    const { rowCount } = await pool.query('DELETE FROM medications WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Medication not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { listMedications, createMedication, getMedication, updateMedication, deleteMedication };
