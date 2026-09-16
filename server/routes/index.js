const express = require('express');

const products = require('../controllers/products');
const customers = require('../controllers/customers');
const suppliers = require('../controllers/suppliers');
const sales = require('../controllers/sales');
const purchaseOrders = require('../controllers/purchaseOrders');
const messages = require('../controllers/messages');
const leads = require('../controllers/leads');
const exportsCtrl = require('../controllers/exports');
const files = require('../controllers/files');
const settings = require('../controllers/settings');
const reports = require('../controllers/reports');
const importProducts = require('../controllers/importProducts');
const receptionist = require('../controllers/receptionist');
const scheduling = require('../controllers/scheduling');
const knowledge = require('../controllers/knowledge');
const ai = require('../controllers/ai');
const database = require('../controllers/database');
const search = require('../controllers/search');
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
router.get('/products/:id/movements', products.movements);

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
router.post('/sales/:id/payments', sales.addPayment);
router.delete('/sales/:id/payments/:paymentId', sales.removePayment);

router.get('/purchase-orders', purchaseOrders.list);
router.post('/purchase-orders', purchaseOrders.create);
router.get('/purchase-orders/:id', purchaseOrders.get);
router.put('/purchase-orders/:id', purchaseOrders.update);
router.delete('/purchase-orders/:id', purchaseOrders.remove);
router.post('/purchase-orders/:id/receive', purchaseOrders.receive);

router.get('/messages', messages.list);
router.post('/messages', messages.create);
router.post('/messages/send', messages.send);
router.delete('/messages/:id', messages.remove);

// People who have been dealt with but are not customers yet.
router.get('/leads', leads.list);
router.post('/leads', leads.create);
router.get('/leads/:id', leads.get);
router.put('/leads/:id', leads.update);
router.delete('/leads/:id', leads.remove);
router.post('/leads/:id/convert', leads.convert);

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
router.get('/reports/heatmap', reports.heatmap);
router.get('/reports/by-weekday', reports.byWeekday);
router.get('/customers/:id/history', reports.customerHistory);

router.get('/ai/status', ai.status);
router.get('/ai/models', ai.models);
router.post('/ai/discover', ai.discover);
router.get('/ai/usage', ai.usage);
router.get('/ai/events', ai.events);
router.post('/ai/events/seen', ai.markEventsSeen);
router.put('/ai/overrides', ai.setOverrides);
router.put('/ai/providers/:key', ai.setProviderEnabled);
router.get('/ai/agreement', ai.agreement);
router.get('/ai/scoreboard', ai.scoreboard);

router.post('/receptionist/message', receptionist.message);
router.post('/receptionist/confirm', receptionist.confirm);
router.post('/receptionist/cancel', receptionist.cancel);

// The front desk: what can be booked, who can do it, and when.
router.get('/services', scheduling.services.list);
router.post('/services', scheduling.services.create);
router.get('/services/:id', scheduling.services.get);
router.put('/services/:id', scheduling.services.update);
router.delete('/services/:id', scheduling.services.remove);

router.get('/resources', scheduling.resources.list);
router.post('/resources', scheduling.resources.create);
router.get('/resources/:id', scheduling.resources.get);
router.put('/resources/:id', scheduling.resources.update);
router.delete('/resources/:id', scheduling.resources.remove);
router.put('/resources/:id/services', scheduling.setResourceServices);

router.get('/hours', scheduling.hours);
router.put('/hours', scheduling.setHours);
router.get('/closures', scheduling.closures);
router.post('/closures', scheduling.addClosure);
router.delete('/closures/:id', scheduling.removeClosure);

// Declared before /appointments/:id so "day" is not read as an id.
router.get('/appointments/day', scheduling.day);
router.get('/appointments/availability', scheduling.availability);
router.get('/appointments/capabilities', scheduling.capabilities);
router.get('/appointments', scheduling.listAppointments);
router.post('/appointments', scheduling.createAppointment);
router.get('/appointments/:id', scheduling.getAppointment);
router.post('/appointments/:id/reschedule', scheduling.rescheduleAppointment);
router.post('/appointments/:id/status', scheduling.setAppointmentStatus);

// What the receptionist is allowed to say about the business.
router.get('/knowledge/search', knowledge.search);
router.get('/knowledge/gaps', knowledge.gaps);
router.post('/knowledge/rebuild', knowledge.rebuild);
router.get('/knowledge', knowledge.list);
router.post('/knowledge', knowledge.create);
router.get('/knowledge/:id', knowledge.get);
router.put('/knowledge/:id', knowledge.update);
router.delete('/knowledge/:id', knowledge.remove);

// One search box for everything (Spotlight).
router.get('/search', search.search);

// The Database page.
router.get('/db/overview', database.overview);
router.get('/db/tables', database.tables);
router.get('/db/tables/:name', database.table);
router.get('/db/tables/:name/rows', database.rows);
router.get('/db/tables/:name/rows/:id', database.row);
router.get('/db/table-stats', database.tableStats);
router.get('/db/saved-queries', database.savedQueries);
router.post('/db/saved-queries', database.saveQuery);
router.put('/db/saved-queries/:id', database.updateQuery);
router.delete('/db/saved-queries/:id', database.deleteQuery);
router.get('/db/relationships', database.relationships);
router.get('/db/routines', database.routines);
router.get('/db/samples', database.samples);
router.post('/db/query', database.query);
router.post('/db/explain', database.explain);
router.get('/db/activity', database.activity);
router.get('/db/history/:table/:id', database.history);
router.get('/db/performance', database.performance);
router.get('/db/integrity', database.integrity);
router.post('/db/integrity/:id/fix', database.fix);
router.get('/db/backups', database.backups);
router.post('/db/backups', database.createBackup);
router.get('/db/backups/:name', database.downloadBackup);
router.delete('/db/backups/:name', database.deleteBackup);
router.post('/db/restore', database.restore);
router.get('/db/export.sql', database.exportSql);
router.post('/db/maintenance', database.maintenance);

router.get('/export', exportsCtrl.options);
router.get('/export/:table', exportsCtrl.table);

module.exports = router;
