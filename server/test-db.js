require('dotenv').config();
const pool = require('./db');

async function testConnection() {
  try {
    console.log('Testing database connection...');
    const client = await pool.connect();

    const result = await client.query('SELECT NOW()');
    console.log('✓ Connected successfully!');
    console.log('Server time:', result.rows[0].now);

    // Check tables
    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('\nTables created:');
    tables.rows.forEach(row => console.log('  -', row.table_name));

    client.release();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Connection failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

testConnection();
