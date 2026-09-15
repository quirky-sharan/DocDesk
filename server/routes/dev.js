const express = require('express');
const { seed, clear } = require('../db/seed');
const { listTables } = require('../db/migrate');

const router = express.Router();

// Sample-data controls. These exist so Phase 1 can prove writes actually
// persist end to end; they are development helpers, not product features.
router.post('/seed', async (req, res, next) => {
  try {
    const tables = await listTables();
    if (!tables.includes('products')) {
      return res.status(503).json({ error: 'Database is not migrated yet. Run: npm run migrate' });
    }
    const result = await seed();
    res.status(201).json({ ok: true, inserted: result });
  } catch (err) {
    next(err);
  }
});

router.delete('/seed', async (req, res, next) => {
  try {
    const result = await clear();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
