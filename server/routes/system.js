const express = require('express');
const db = require('../db');
const { listTables } = require('../db/migrate');

const router = express.Router();

// Tables the dashboard reports counts for, in display order.
const COUNTED_TABLES = [
  'products', 'categories', 'customers', 'suppliers', 'sales', 'sale_items', 'payments',
  'purchase_orders', 'stock_movements', 'message_log', 'files', 'audit_log',
];

// GET /api/health - liveness plus a real database round trip, so a green
// response here proves the whole chain and not just that Express is up.
router.get('/health', async (req, res, next) => {
  try {
    const started = Date.now();
    await db.query('SELECT 1 AS ok');
    const tables = await listTables();
    const info = db.describe();
    res.json({
      status: 'ok',
      database: {
        driver: 'postgres',
        engine: info.engine,
        mode: info.mode,
        version: info.version,
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

// GET /api/stats - exact row counts per table, in one query.
router.get('/stats', async (req, res, next) => {
  try {
    const tables = new Set(await listTables());
    const present = COUNTED_TABLES.filter((t) => tables.has(t));
    // Table names come from COUNTED_TABLES, never from user input.
    const { rows } = await db.query(`SELECT ${present.map((t) => `(SELECT count(*) FROM ${t}) AS ${t}`).join(', ')}`);
    res.json({ driver: 'postgres', mode: db.mode, counts: rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/system/shutdown - lets stop_all close the database cleanly before
// the process is ended. Only answers requests from this computer.
router.post('/system/shutdown', (req, res) => {
  const address = req.socket.remoteAddress || '';
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
  if (!local || req.get('x-docdesk-stop') !== 'yes') {
    return res.status(403).json({ error: 'Shutdown is only available from this computer.' });
  }
  res.json({ ok: true, stopping: true });
  setTimeout(() => req.app.locals.shutdown?.(), 50);
});

module.exports = router;
