const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/patientController');

router.use(authMiddleware); // all patient routes require login

router.get('/',      ctrl.listPatients);
router.post('/',     ctrl.createPatient);
router.get('/:id',   ctrl.getPatient);
router.put('/:id',   ctrl.updatePatient);
router.delete('/:id', ctrl.deletePatient);

module.exports = router;
