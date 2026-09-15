require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const { toPositional } = require('./sql');

// Driver is chosen by environment, not by config file: if DATABASE_URL is set
// (production / any managed Postgres) we use Postgres, otherwise we fall back
// to a local SQLite file so a fresh clone runs with no setup at all.
const usePostgres = Boolean(process.env.DATABASE_URL);

let driver;

if (usePostgres) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Managed Postgres (Supabase, Neon, Render) terminates TLS with certs that
    // don't chain to a root we ship, so verification is relaxed there only.
    ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false },
  });

  driver = {
    name: 'postgres',
    async query(sql, params = []) {
      const { rows, rowCount } = await pool.query(sql, params);
      return { rows, rowCount };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          async query(sql, params = []) {
            const { rows, rowCount } = await client.query(sql, params);
            return { rows, rowCount };
          },
        };
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
} else {
  const Database = require('better-sqlite3');
  const file = process.env.SQLITE_PATH || path.join(__dirname, 'docdesk.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  const run = (sql, params) => {
    const t = toPositional(sql, params);
    const stmt = sqlite.prepare(t.sql);
    // better-sqlite3 throws if you call .all() on a statement that returns no
    // columns, so branch on what the statement actually produces.
    if (stmt.reader) {
      const rows = stmt.all(...t.params);
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...t.params);
    return { rows: [], rowCount: info.changes };
  };

  driver = {
    name: 'sqlite',
    file,
    async query(sql, params = []) {
      return run(sql, params);
    },
    async transaction(fn) {
      // better-sqlite3 is synchronous, so its own .transaction() helper can't
      // wrap an async callback. Driving BEGIN/COMMIT manually keeps the same
      // async contract the Postgres driver exposes.
      sqlite.exec('BEGIN');
      try {
        const result = await fn({ query: async (sql, params = []) => run(sql, params) });
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async close() {
      sqlite.close();
    },
  };
}

module.exports = driver;
