const express = require('express');
const db = require('../db');
const { listTables } = require('../db/migrate');
const llm = require('../lib/llm');
const accounts = require('../lib/auth/accounts');
const { isLoopbackAddress, authRequired } = require('../lib/net');
const { readCookie } = require('../middleware/authenticate');

const router = express.Router();

// Tables the dashboard reports counts for, in display order.
const COUNTED_TABLES = [
  'products', 'categories', 'customers', 'suppliers', 'sales', 'sale_items', 'payments',
  'purchase_orders', 'stock_movements', 'message_log', 'files', 'audit_log',
];

// GET /api/health - liveness plus a real database round trip, so a green
// response here proves the whole chain and not just that Express is up.
//
// It is the one route anybody can call, so what it says depends on who asks.
// A stranger learns that DocDesk is up and nothing more; the exact engine and
// version - which is what somebody looking for a known weakness wants first -
// go only to this computer (the launcher) and to people who are signed in.
router.get('/health', async (req, res, next) => {
  try {
    const started = Date.now();
    await db.query('SELECT 1 AS ok');
    const latencyMs = Date.now() - started;

    const trusted = isLoopbackAddress(req.ip) || !authRequired() || Boolean(await accounts.findSession(readCookie(req)));
    if (!trusted) {
      return res.json({ status: 'ok', database: { connected: true }, timestamp: new Date().toISOString() });
    }

    const tables = await listTables();
    const info = db.describe();
    return res.json({
      status: 'ok',
      database: {
        driver: 'postgres',
        engine: info.engine,
        mode: info.mode,
        version: info.version,
        connected: true,
        tables: tables.length,
        latencyMs,
      },
      // Whether an AI service is set up, from the environment alone - asking
      // the providers themselves is a signed-in action (GET /api/ai/status).
      ai: { configured: llm.isConfigured() },
      signInRequired: authRequired(),
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return next(err);
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
// the process is ended. Only answers the launcher on this computer.
//
// "From this computer" is not enough on its own: a web page open in a browser
// on this computer is also "from this computer". A browser always says where a
// POST came from, and the launcher is not a browser, so any request that
// carries an Origin or the browser's fetch metadata is turned away.
router.post('/system/shutdown', (req, res) => {
  const local = isLoopbackAddress(req.socket.remoteAddress);
  const fromBrowser = req.get('origin') !== undefined || req.get('sec-fetch-site') !== undefined;
  if (!local || fromBrowser || req.get('x-docdesk-stop') !== 'yes') {
    return res.status(403).json({ error: 'Shutdown is only available from this computer.' });
  }
  res.json({ ok: true, stopping: true });
  setTimeout(() => req.app.locals.shutdown?.(), 50);
  return undefined;
});

module.exports = router;
