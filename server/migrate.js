require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigration() {
  try {
    console.log('Reading schema.sql...');
    const schemaSQL = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

    console.log('Connecting to database...');
    const client = await pool.connect();

    console.log('Running migrations...');
    await client.query(schemaSQL);

    console.log('✓ Database schema created successfully!');

    client.release();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
