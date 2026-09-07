const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/appointmentController');

router.use(authMiddleware);

router.get('/',      ctrl.listAppointments);
router.post('/',     ctrl.createAppointment);
router.get('/:id',   ctrl.getAppointment);
router.put('/:id',   ctrl.updateAppointment);
router.delete('/:id', ctrl.deleteAppointment);

module.exports = router;
