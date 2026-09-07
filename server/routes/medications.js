const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/medicationController');

router.use(authMiddleware);

router.get('/',      ctrl.listMedications);
router.post('/',     ctrl.createMedication);
router.get('/:id',   ctrl.getMedication);
router.put('/:id',   ctrl.updateMedication);
router.delete('/:id', ctrl.deleteMedication);

module.exports = router;
