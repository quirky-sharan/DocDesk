const express = require('express');

const products = require('../controllers/products');
const customers = require('../controllers/customers');
const suppliers = require('../controllers/suppliers');
const sales = require('../controllers/sales');
const purchaseOrders = require('../controllers/purchaseOrders');
const messages = require('../controllers/messages');
const exportsCtrl = require('../controllers/exports');

const router = express.Router();

// Inventory. The summary route is declared before /:id so "summary" is not
// parsed as an id.
router.get('/products/summary', products.summary);
router.get('/products', products.list);
router.post('/products', products.create);
router.get('/products/:id', products.get);
router.put('/products/:id', products.update);
router.delete('/products/:id', products.remove);
router.post('/products/:id/stock', products.adjustStock);

router.get('/customers', customers.list);
router.post('/customers', customers.create);
router.get('/customers/:id', customers.get);
router.put('/customers/:id', customers.update);
router.delete('/customers/:id', customers.remove);

router.get('/suppliers', suppliers.list);
router.post('/suppliers', suppliers.create);
router.get('/suppliers/:id', suppliers.get);
router.put('/suppliers/:id', suppliers.update);
router.delete('/suppliers/:id', suppliers.remove);

router.get('/sales', sales.list);
router.post('/sales', sales.create);
router.get('/sales/:id', sales.get);
router.put('/sales/:id', sales.update);
router.delete('/sales/:id', sales.remove);
router.get('/sales/:id/receipt', sales.receipt);
router.get('/sales/:id/receipt.pdf', exportsCtrl.receipt);

router.get('/purchase-orders', purchaseOrders.list);
router.post('/purchase-orders', purchaseOrders.create);
router.get('/purchase-orders/:id', purchaseOrders.get);
router.put('/purchase-orders/:id', purchaseOrders.update);
router.delete('/purchase-orders/:id', purchaseOrders.remove);
router.post('/purchase-orders/:id/receive', purchaseOrders.receive);

router.get('/messages', messages.list);
router.post('/messages/send', messages.send);
router.delete('/messages/:id', messages.remove);

router.get('/export', exportsCtrl.options);
router.get('/export/:table', exportsCtrl.table);

module.exports = router;
