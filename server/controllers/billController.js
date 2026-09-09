const pool = require('../db');

exports.getAllBills = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT b.*, p.name as patient_name, d.name as doctor_name 
      FROM bills b 
      LEFT JOIN patients p ON b.patient_id = p.id 
      LEFT JOIN doctors d ON b.doctor_id = d.id 
      ORDER BY b.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching bills' });
  }
};

exports.getBillById = async (req, res) => {
  const { id } = req.params;
  try {
    // Get bill info
    const billResult = await pool.query(`
      SELECT b.*, p.name as patient_name, d.name as doctor_name 
      FROM bills b 
      LEFT JOIN patients p ON b.patient_id = p.id 
      LEFT JOIN doctors d ON b.doctor_id = d.id 
      WHERE b.id = $1
    `, [id]);
    
    if (billResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bill not found' });
    }
    
    // Get bill items
    const itemsResult = await pool.query(`
      SELECT bi.*, m.name as medicine_name 
      FROM bill_items bi 
      LEFT JOIN medicines m ON bi.medicine_id = m.id 
      WHERE bi.bill_id = $1
    `, [id]);
    
    const bill = billResult.rows[0];
    bill.items = itemsResult.rows;
    
    res.json(bill);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching bill' });
  }
};

exports.createBill = async (req, res) => {
  const { patient_id, doctor_id, total_amount, status, items } = req.body;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Create the bill
    const billResult = await client.query(
      'INSERT INTO bills (patient_id, doctor_id, total_amount, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [patient_id, doctor_id, total_amount, status || 'unpaid']
    );
    const newBill = billResult.rows[0];
    
    // 2. Insert bill items and update inventory
    if (items && items.length > 0) {
      for (const item of items) {
        await client.query(
          'INSERT INTO bill_items (bill_id, medicine_id, quantity, unit_price) VALUES ($1, $2, $3, $4)',
          [newBill.id, item.medicine_id, item.quantity, item.unit_price]
        );
        
        // Decrement inventory
        if (item.medicine_id) {
          await client.query(
            'UPDATE inventory SET quantity = quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE medicine_id = $2',
            [item.quantity, item.medicine_id]
          );
        }
      }
    }
    
    await client.query('COMMIT');
    res.status(201).json(newBill);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error creating bill' });
  } finally {
    client.release();
  }
};
