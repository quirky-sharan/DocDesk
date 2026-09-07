const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const ctrl = require('../controllers/billingController');

router.use(authMiddleware);

router.get('/',          ctrl.listBills);
router.post('/',         ctrl.createBill);
router.get('/:id',       ctrl.getBill);
router.put('/:id',       ctrl.updateBill);
router.delete('/:id',    ctrl.deleteBill);
router.get('/:id/pdf',   ctrl.downloadBillPdf);

module.exports = router;
