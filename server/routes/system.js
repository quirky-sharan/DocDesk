const express = require('express');
const db = require('../db');
const { listTables } = require('../db/migrate');

const router = express.Router();

// Tables the dashboard reports counts for, in display order.
const COUNTED_TABLES = [
  'products',
  'customers',
  'sales',
  'sale_items',
  'suppliers',
  'purchase_orders',
  'message_log',
];

// GET /api/health - liveness plus a real database round trip, so a green
// response here proves the whole chain and not just that Express is up.
router.get('/health', async (req, res, next) => {
  try {
    const started = Date.now();
    await db.query('SELECT 1 AS ok');
    const tables = await listTables();
    res.json({
      status: 'ok',
      database: {
        driver: db.name,
        connected: true,
        tables: tables.length,
        latencyMs: Date.now() - started,
      },
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/stats - row counts per table, read live from the database.
router.get('/stats', async (req, res, next) => {
  try {
    const tables = await listTables();
    const counts = {};
    for (const table of COUNTED_TABLES) {
      if (!tables.includes(table)) continue;
      // Table names come from COUNTED_TABLES, never from user input.
      const { rows } = await db.query(`SELECT COUNT(*) AS count FROM ${table}`);
      counts[table] = Number(rows[0].count);
    }
    res.json({ driver: db.name, counts });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
