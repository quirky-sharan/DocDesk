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
const { upload, importUpload, verifyUploads, verifyTextUpload } = require('../lib/storage');
const { allow, withContext } = require('../middleware/authenticate');
const { heavy } = require('../middleware/rateLimit');
const { cacheFor } = require('../middleware/responseCache');

const router = express.Router();

// Every route here is already behind sign-in (see index.js). What is added
// below is the second question - not "who are you" but "may you do this":
//
//   (no guard)   anyone on the team: the day-to-day work of the shop
//   manager      how the business is set up, and looking inside the database
//   owner        anything that could destroy all of the data or carry it away
//
// The guard sits on the route, next to the thing it protects, so the rule for
// a route is read in the same line as the route.
const manager = allow('manager');
const owner = allow('owner');

// Aggregates over the whole sales history: asked for constantly, changed only
// by a write. middleware/responseCache.js explains why they are never stale.
const cached = cacheFor(30);

// A file upload is parsed outside the request's call stack, which loses track
// of who is acting. These put that back, then check the bytes really are what
// the upload said they were.
const afterUpload = [withContext, verifyUploads];
const afterImport = [withContext, verifyTextUpload];

// Inventory. The summary route is declared before /:id so "summary" is not
// parsed as an id.
router.get('/products/summary', cached, products.summary);
router.get('/products/categories', products.categories);
router.get('/products/restock-suggestion', products.restockSuggestion);
router.post('/products/import/preview', heavy, importUpload.single('file'), afterImport, importProducts.preview);
router.post('/products/import', heavy, importUpload.single('file'), afterImport, importProducts.commit);
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
// Removing a sale or a payment rewrites the takings, so it is not a till job.
router.delete('/sales/:id', manager, sales.remove);
router.get('/sales/:id/receipt', sales.receipt);
router.get('/sales/:id/receipt.pdf', exportsCtrl.receipt);
router.post('/sales/:id/payments', sales.addPayment);
router.delete('/sales/:id/payments/:paymentId', manager, sales.removePayment);

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
router.post('/files', upload.array('files', 10), afterUpload, files.upload);
router.get('/files/:id', files.get);
router.put('/files/:id', files.update);
router.get('/files/:id/content', files.download);
router.delete('/files/:id', files.remove);

router.get('/settings', settings.get);
router.put('/settings', manager, settings.update);

router.get('/reports/summary', cached, reports.summary);
router.get('/reports/sales-by-day', cached, reports.salesByDay);
router.get('/reports/top-products', cached, reports.topProducts);
router.get('/reports/top-customers', cached, reports.topCustomers);
router.get('/reports/by-category', cached, reports.byCategory);
router.get('/reports/by-payment-method', cached, reports.byPaymentMethod);
router.get('/reports/stock-by-category', cached, reports.stockByCategory);
router.get('/reports/pulse', cached, reports.pulse);
router.get('/reports/heatmap', cached, reports.heatmap);
router.get('/reports/by-weekday', cached, reports.byWeekday);
router.get('/customers/:id/history', reports.customerHistory);

// ?probe=1 asks every provider, right now, what it has - a call out to the
// internet on demand, so it is paced like one.
router.get('/ai/status', (req, res, next) => (req.query.probe === '1' ? heavy(req, res, next) : next()), ai.status);
router.get('/ai/models', ai.models);
router.post('/ai/discover', manager, heavy, ai.discover);
router.get('/ai/usage', ai.usage);
router.get('/ai/events', ai.events);
router.post('/ai/events/seen', ai.markEventsSeen);
router.put('/ai/overrides', manager, ai.setOverrides);
router.put('/ai/providers/:key', manager, ai.setProviderEnabled);
router.get('/ai/agreement', ai.agreement);
router.get('/ai/scoreboard', ai.scoreboard);

router.get('/receptionist/front-desk', receptionist.frontDesk);
router.get('/receptionist/conversations', receptionist.conversations);
router.get('/receptionist/conversations/:id', receptionist.transcript);
router.post('/receptionist/message', heavy, receptionist.message);
router.post('/receptionist/confirm', receptionist.confirm);
router.post('/receptionist/cancel', receptionist.cancel);

// The front desk: what can be booked, who can do it, and when. Booking is
// everybody's; deciding what the business offers and when it is open is not.
router.get('/services', scheduling.services.list);
router.post('/services', manager, scheduling.services.create);
router.get('/services/:id', scheduling.services.get);
router.put('/services/:id', manager, scheduling.services.update);
router.delete('/services/:id', manager, scheduling.services.remove);

router.get('/resources', scheduling.resources.list);
router.post('/resources', manager, scheduling.resources.create);
router.get('/resources/:id', scheduling.resources.get);
router.put('/resources/:id', manager, scheduling.resources.update);
router.delete('/resources/:id', manager, scheduling.resources.remove);
router.put('/resources/:id/services', manager, scheduling.setResourceServices);

router.get('/hours', scheduling.hours);
router.put('/hours', manager, scheduling.setHours);
router.get('/closures', scheduling.closures);
router.post('/closures', manager, scheduling.addClosure);
router.delete('/closures/:id', manager, scheduling.removeClosure);

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
router.post('/knowledge/rebuild', manager, heavy, knowledge.rebuild);
router.get('/knowledge', knowledge.list);
router.post('/knowledge', knowledge.create);
router.get('/knowledge/:id', knowledge.get);
router.put('/knowledge/:id', knowledge.update);
router.delete('/knowledge/:id', knowledge.remove);

// One search box for everything (Spotlight).
router.get('/search', search.search);

// The Database page. Looking inside is a manager's job. The per-record history
// and the latest-changes feed are shown on ordinary pages, so those two stay
// open to the whole team. Anything that can change the database wholesale, or
// carry all of it away in one file, is the owner's.
router.get('/db/activity', database.activity);
router.get('/db/history/:table/:id', database.history);

router.get('/db/overview', manager, database.overview);
router.get('/db/tables', manager, database.tables);
router.get('/db/tables/:name', manager, database.table);
router.get('/db/tables/:name/rows', manager, database.rows);
router.get('/db/tables/:name/rows/:id', manager, database.row);
router.get('/db/table-stats', manager, database.tableStats);
router.get('/db/saved-queries', manager, database.savedQueries);
router.post('/db/saved-queries', owner, database.saveQuery);
router.put('/db/saved-queries/:id', manager, database.updateQuery);
router.delete('/db/saved-queries/:id', owner, database.deleteQuery);
router.get('/db/relationships', manager, database.relationships);
router.get('/db/routines', manager, database.routines);
router.get('/db/samples', manager, database.samples);
// Reading is a manager's. "Allow changes" is checked inside, and is the owner's.
router.post('/db/query', manager, heavy, database.query);
router.post('/db/explain', manager, heavy, database.explain);
router.get('/db/performance', manager, database.performance);
router.get('/db/integrity', manager, database.integrity);
router.post('/db/integrity/:id/fix', owner, database.fix);
router.get('/db/backups', manager, database.backups);
router.post('/db/backups', manager, heavy, database.createBackup);
router.get('/db/backups/:name', owner, heavy, database.downloadBackup);
router.delete('/db/backups/:name', owner, database.deleteBackup);
router.post('/db/restore', owner, heavy, database.restore);
router.get('/db/export.sql', owner, heavy, database.exportSql);
router.post('/db/maintenance', owner, database.maintenance);

router.get('/export', exportsCtrl.options);
router.get('/export/:table', heavy, exportsCtrl.table);

module.exports = router;
