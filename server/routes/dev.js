const express = require('express');
const { seed, clear } = require('../db/seed');
const { invalidateSchemaCache } = require('../lib/tables');
const { capabilities } = require('../controllers/database');
const { fail } = require('../lib/validate');

const router = express.Router();

// Sample-data controls: load five months of example trading, or clear every
// business record. Handy for trying DocDesk out before entering real data.
router.post('/seed', async (req, res, next) => {
  try {
    const result = await seed();
    res.status(201).json({ ok: true, inserted: result });
  } catch (err) {
    next(err);
  }
});

router.delete('/seed', async (req, res, next) => {
  try {
    if (!capabilities().admin) throw fail('Clearing all records is switched off for this installation (set DB_ADMIN=on to allow it).', 403);
    const result = await clear();
    invalidateSchemaCache();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
