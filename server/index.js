require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { migrate, listTables } = require('./db/migrate');
const { importLegacySqlite } = require('./db/legacy/importSqlite');
const { scheduleBackups } = require('./lib/dbconsole/backup');
const errorHandler = require('./middleware/errorHandler');
const systemRoutes = require('./routes/system');
const devRoutes = require('./routes/dev');
const apiRoutes = require('./routes');

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Until the database is open and migrated, API calls wait for it rather than fail.
let startup = null;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '2mb' }));

app.use('/api', async (req, res, next) => {
  if (!startup) return next();
  try {
    await startup;
    next();
  } catch (err) {
    res.status(503).json({ error: `The database could not be opened: ${err.message}` });
  }
});

// Who is making changes, for the audit trail: the assistant calls the API with
// this header; everything else is a person using the app.
app.use('/api', (req, res, next) => {
  const actor = req.get('x-docdesk-actor') === 'assistant' ? 'assistant' : 'web';
  db.runAs(actor, () => next());
});

app.use('/api', systemRoutes);
app.use('/api/dev', devRoutes);
app.use('/api', apiRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);

async function prepareDatabase() {
  await db.ready;
  const applied = await migrate({ log: (line) => console.log(`  [db] ${line}`) });
  await importLegacySqlite({ log: (line) => console.log(`  ${line}`) }).catch((err) => {
    // A failed carry-over leaves the old file untouched and the new database
    // empty, so it can simply be tried again on the next start.
    console.error(`  [import] Could not carry over the old SQLite database: ${err.message}`);
  });
  return applied;
}

function start() {
  // The port is taken first: if another DocDesk is already running, this one
  // stops here - before it could open the same embedded database a second time.
  const server = app.listen(PORT, async () => {
    startup = prepareDatabase();
    try {
      const applied = await startup;
      const tables = await listTables();
      const info = db.describe();
      console.log(`DocDesk API listening on http://localhost:${PORT}`);
      console.log(`  database: ${info.engine} ${info.version || ''} (${info.mode === 'embedded' ? info.location : info.location})`);
      console.log(`  tables:   ${tables.length}${applied.length ? `, ${applied.length} migration(s) applied` : ''}`);
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

start();
