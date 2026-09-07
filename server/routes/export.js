const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/exportController');

router.use(authMiddleware);

// GET /api/export/patients  → patients.xlsx
router.get('/patients', ctrl.exportPatients);

// GET /api/export/billing   → billing.xlsx
router.get('/billing', ctrl.exportBilling);

module.exports = router;
