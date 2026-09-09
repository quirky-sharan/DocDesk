const pool = require('../db');

exports.getAllInventory = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.*, m.name as medicine_name, m.price 
      FROM inventory i 
      JOIN medicines m ON i.medicine_id = m.id 
      ORDER BY m.name ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching inventory' });
  }
};

exports.addInventory = async (req, res) => {
  const { medicine_id, quantity, min_stock_level } = req.body;
  try {
    // Check if inventory for medicine already exists
    const check = await pool.query('SELECT * FROM inventory WHERE medicine_id = $1', [medicine_id]);
    
    if (check.rows.length > 0) {
      // Update existing
      const result = await pool.query(
        'UPDATE inventory SET quantity = quantity + $1, min_stock_level = COALESCE($2, min_stock_level), updated_at = CURRENT_TIMESTAMP WHERE medicine_id = $3 RETURNING *',
        [quantity, min_stock_level, medicine_id]
      );
      return res.json(result.rows[0]);
    }
    
    // Insert new
    const result = await pool.query(
      'INSERT INTO inventory (medicine_id, quantity, min_stock_level) VALUES ($1, $2, $3) RETURNING *',
      [medicine_id, quantity, min_stock_level || 10]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error adding to inventory' });
  }
};

exports.updateInventory = async (req, res) => {
  const { id } = req.params;
  const { quantity, min_stock_level } = req.body;
  try {
    const result = await pool.query(
      'UPDATE inventory SET quantity = $1, min_stock_level = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
      [quantity, min_stock_level, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating inventory' });
  }
};
