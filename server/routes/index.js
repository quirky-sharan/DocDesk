const express = require('express');

const products = require('../controllers/products');
const customers = require('../controllers/customers');
const suppliers = require('../controllers/suppliers');
const sales = require('../controllers/sales');
const purchaseOrders = require('../controllers/purchaseOrders');
const messages = require('../controllers/messages');
const exportsCtrl = require('../controllers/exports');
const files = require('../controllers/files');
const settings = require('../controllers/settings');
const reports = require('../controllers/reports');
const importProducts = require('../controllers/importProducts');
const { upload, importUpload } = require('../lib/storage');

const router = express.Router();

// Inventory. The summary route is declared before /:id so "summary" is not
// parsed as an id.
router.get('/products/summary', products.summary);
router.get('/products/categories', products.categories);
router.get('/products/restock-suggestion', products.restockSuggestion);
router.post('/products/import/preview', importUpload.single('file'), importProducts.preview);
router.post('/products/import', importUpload.single('file'), importProducts.commit);
router.get('/products', products.list);
router.post('/products', products.create);
router.get('/products/:id', products.get);
router.put('/products/:id', products.update);
router.delete('/products/:id', products.remove);
router.post('/products/:id/stock', products.adjustStock);
router.get('/products/:id/history', products.history);

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

router.get('/files/info', files.info);
router.get('/files', files.list);
router.post('/files', upload.array('files', 10), files.upload);
router.get('/files/:id', files.get);
router.put('/files/:id', files.update);
router.get('/files/:id/content', files.download);
router.delete('/files/:id', files.remove);

router.get('/settings', settings.get);
router.put('/settings', settings.update);

router.get('/reports/summary', reports.summary);
router.get('/reports/sales-by-day', reports.salesByDay);
router.get('/reports/top-products', reports.topProducts);
router.get('/reports/top-customers', reports.topCustomers);
router.get('/reports/by-category', reports.byCategory);
router.get('/reports/by-payment-method', reports.byPaymentMethod);
router.get('/reports/stock-by-category', reports.stockByCategory);
router.get('/reports/pulse', reports.pulse);
router.get('/customers/:id/history', reports.customerHistory);

router.get('/export', exportsCtrl.options);
router.get('/export/:table', exportsCtrl.table);

module.exports = router;
