const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./index');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Versioned migrations. Each file in db/migrations runs once, in order, inside
 * its own transaction - PostgreSQL DDL is transactional, so a migration either
 * applies completely or not at all. Applied versions are recorded with a
 * checksum; editing a file after it has run is reported rather than silently
 * ignored.
 */
async function migrate({ log = () => {} } = {}) {
  await db.ready;
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      name        text NOT NULL,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL DEFAULT 0
    )
  `);

  const { rows } = await db.query('SELECT version, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const ran = [];

  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);

    if (applied.has(version)) {
      if (applied.get(version) !== checksum) {
        console.warn(`[db] migration ${file} has changed since it was applied; it will not run again.`);
      }
      continue;
    }

    const started = Date.now();
    await db.transaction(
      async (tx) => {
        await tx.exec(sql);
        await tx.query(
          'INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
          [version, rest.join(' '), checksum, Date.now() - started]
        );
      },
      { actor: 'system' }
    );
    ran.push(file);
    log(`applied ${file} (${Date.now() - started} ms)`);
  }

  return ran;
}

async function listTables() {
  const { rows } = await db.query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`
  );
  return rows.map((r) => r.name);
}

async function appliedMigrations() {
  const { rows } = await db.query(
    'SELECT version, name, checksum, applied_at, duration_ms FROM schema_migrations ORDER BY version'
  );
  return rows;
}

module.exports = { migrate, listTables, appliedMigrations };

// `npm run migrate`. The running API applies migrations itself at startup, and
// the embedded database can only be open in one process, so this refuses to
// touch it while the API is up.
if (require.main === module) {
  (async () => {
    const port = Number(process.env.PORT) || 5000;
    if (db.mode === 'embedded') {
      const running = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
        .then((r) => r.ok)
        .catch(() => false);
      if (running) {
        console.log('DocDesk is running and has already applied its migrations. Nothing to do.');
        process.exit(0);
      }
    }
    try {
      const ran = await migrate({ log: (line) => console.log(`  ${line}`) });
      const tables = await listTables();
      console.log(ran.length ? `migrated (${ran.length} applied)` : 'database is up to date');
      console.log(`  ${tables.length} tables: ${tables.join(', ')}`);
      await db.close();
      process.exit(0);
    } catch (err) {
      console.error('migration failed:', err.message);
      await db.close().catch(() => {});
      process.exit(1);
    }
  })();
}
