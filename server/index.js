require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { listTables } = require('./db/migrate');
const errorHandler = require('./middleware/errorHandler');
const systemRoutes = require('./routes/system');
const devRoutes = require('./routes/dev');
const apiRoutes = require('./routes');

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());

app.use('/api', systemRoutes);
app.use('/api/dev', devRoutes);
app.use('/api', apiRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` });
});

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 5000;

async function start() {
  // Fail loudly at boot rather than letting every request 500 later.
  try {
    await db.query('SELECT 1');
  } catch (err) {
    console.error(`Cannot reach the ${db.name} database: ${err.message}`);
    process.exit(1);
  }

  const tables = await listTables();
  if (tables.length === 0) {
    console.warn('Database has no tables yet. Run: npm run migrate');
  }

  const server = app.listen(PORT, () => {
    console.log(`DocDesk API listening on http://localhost:${PORT}`);
    console.log(`  database: ${db.name}${db.file ? ` (${db.file})` : ''}`);
    console.log(`  tables:   ${tables.length}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(async () => {
        await db.close();
        process.exit(0);
      });
    });
  }
}

start();
