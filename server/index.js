require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const express = require('express');

const firebase = require('../shared/firebase.json');
const db = require('./db');
const { migrate, listTables } = require('./db/migrate');
const { importLegacySqlite } = require('./db/legacy/importSqlite');
const { scheduleBackups } = require('./lib/dbconsole/backup');
const llm = require('./lib/llm');
const { listenHost, localOnly, authRequired, production } = require('./lib/net');
const errorHandler = require('./middleware/errorHandler');
const security = require('./middleware/security');
const { authenticate } = require('./middleware/authenticate');
const rateLimit = require('./middleware/rateLimit');
const systemRoutes = require('./routes/system');
const authRoutes = require('./routes/auth');
const devRoutes = require('./routes/dev');
const apiRoutes = require('./routes');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const HOST = listenHost();

app.disable('x-powered-by');
// Behind a host's proxy the real client address and "was this HTTPS?" arrive
// in forwarded headers. They are believed for one hop in a deployment and not
// at all on somebody's own computer, where nothing sits in front of DocDesk and
// the header would simply be whatever the caller typed.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined && trustProxy !== '') {
  app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy === 'true');
} else if (production()) {
  app.set('trust proxy', 1);
}

// Until the database is open and migrated, API calls wait for it rather than fail.
let startup = null;

// The order below is the order a request is judged in, cheapest check first:
// is it addressed to us, is it from a site we trust, is this address asking
// too much - all before anything is parsed, looked up or run.
app.use(security.securityHeaders);
app.use('/api', security.apiHeaders);
app.use('/api', security.hostGuard);
app.use('/api', security.cors());
app.use('/api', security.originGuard);
app.use('/api', rateLimit.perAddress);
app.use(express.json({ limit: '2mb' }));

app.use('/api', async (req, res, next) => {
  if (!startup) return next();
  try {
    await startup;
    next();
  } catch (err) {
    // The reason helps the person whose computer this is, and is nobody else's
    // business: a deployment says only that it failed.
    const reason = localOnly() ? `: ${err.message}` : '. The server log has the reason.';
    res.status(503).json({ error: `The database could not be opened${reason}` });
  }
});

// Who is asking, and are they allowed in. Everything after this line runs for a
// signed-in, active member of the team (or is one of the few routes named
// public in middleware/authenticate.js). It also records who is acting, for
// the audit trail: a person in the app, or the receptionist on their behalf.
app.use('/api', authenticate);
app.use('/api', rateLimit.perPerson);
app.use('/api', rateLimit.changes);

app.use('/api', systemRoutes);
app.use('/api', authRoutes);
app.use('/api/dev', devRoutes);
app.use('/api', apiRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
});

// In a deployment this one server is the whole of DocDesk: it serves the built
// web app as well as the API. One address means the session cookie is
// first-party and no cross-site rules have to be loosened to make sign-in work.
const WEB_APP = path.join(__dirname, '..', 'client', 'dist');
if (production() && fs.existsSync(path.join(WEB_APP, 'index.html'))) {
  const policy = security.pagePolicy(firebase);
  // Source maps would hand the original source to anybody who asks. The build
  // does not make them; this is so a stray one is never served either.
  app.use((req, res, next) => (req.path.endsWith('.map') ? res.status(404).end() : next()));
  // Built files carry a hash of their contents in their name, so a given name
  // never changes meaning and can be kept for a year.
  app.use('/assets', express.static(path.join(WEB_APP, 'assets'), { immutable: true, maxAge: '365d', index: false, fallthrough: false }));
  app.use(express.static(WEB_APP, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.set({
      'Content-Security-Policy': policy,
      // Google sign-in opens a pop-up and has to be able to hear back from it.
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cache-Control': 'no-cache',
    });
    return res.sendFile(path.join(WEB_APP, 'index.html'));
  });
}

app.use(errorHandler);

async function prepareDatabase() {
  await db.ready;
  const applied = await migrate({ log: (line) => console.log(`  [db] ${line}`) });
  await importLegacySqlite({ log: (line) => console.log(`  ${line}`) }).catch((err) => {
    // A failed carry-over leaves the old file untouched and the new database
    // empty, so it can simply be tried again on the next start.
    console.error(`  [import] Could not carry over the old SQLite database: ${err.message}`);
  });
  // Ask each provider what models it has, and read back what is left of
  // yesterday's allowances. Deliberately not awaited by the request middleware:
  // DocDesk answers with no AI at all, so nothing waits on this.
  llm.warmUp().catch(() => {});
  // A daily limit or a pinned model set months ago must still be in force after
  // a restart, so the saved settings are pushed into the gateway on the way up.
  require('./controllers/settings').applyAiOverrides().catch((err) => {
    console.warn(`  [ai] could not apply saved AI settings: ${err.message}`);
  });
  return applied;
}

function start() {
  // The port is taken first: if another DocDesk is already running, this one
  // stops here - before it could open the same embedded database a second time.
  const server = app.listen(PORT, HOST, async () => {
    startup = prepareDatabase();
    try {
      const applied = await startup;
      const tables = await listTables();
      const info = db.describe();
      console.log(`DocDesk API listening on http://localhost:${PORT}`);
      console.log(`  database: ${info.engine} ${info.version || ''} (${info.mode === 'embedded' ? info.location : info.location})`);
      console.log(`  tables:   ${tables.length}${applied.length ? `, ${applied.length} migration(s) applied` : ''}`);
      console.log(`  reach:    ${localOnly() ? 'this computer only' : `${HOST} - reachable from the network`}`);
      if (process.env.AUTH_REQUIRED === 'off') {
        console.warn(authRequired()
          ? '  sign-in:  AUTH_REQUIRED=off was IGNORED - it only works for the embedded database on this computer.'
          : '  sign-in:  OFF (AUTH_REQUIRED=off). Anyone using this computer is the owner. Remove that line to turn sign-in back on.');
      }
      scheduleBackups();
    } catch (err) {
      console.error(`Cannot open the ${db.mode} database: ${err.message}`);
      process.exit(1);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use - DocDesk may already be running.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  });

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close();
    // Close the database cleanly so the embedded engine flushes everything.
    db.close()
      .catch(() => {})
      .finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(signal, shutdown);
  app.locals.shutdown = shutdown;
}

// Run directly (npm start, npm run dev) it serves. Required from a test it only
// hands over the app, so the real middleware chain can be exercised on a
// throwaway port and database.
if (require.main === module) start();

module.exports = app;
