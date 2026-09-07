require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./db');

async function createDefaultUsers() {
  try {
    const client = await pool.connect();

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    await client.query(
      'INSERT INTO app_users (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
      ['admin', adminPassword, 'admin']
    );

    const doctorPassword = await bcrypt.hash('doctor123', 10);
    await client.query(
      'INSERT INTO app_users (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
      ['doctor', doctorPassword, 'doctor']
    );

    const receptionistPassword = await bcrypt.hash('reception123', 10);
    await client.query(
      'INSERT INTO app_users (username, password_hash, role) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
      ['receptionist', receptionistPassword, 'receptionist']
    );

    console.log('✓ Default users created:');
    console.log('  Admin:        username: admin        password: admin123');
    console.log('  Doctor:       username: doctor       password: doctor123');
    console.log('  Receptionist: username: receptionist password: reception123');

    client.release();
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Setup failed:', error.message);
    await pool.end();
    process.exit(1);
  }
}

createDefaultUsers();
