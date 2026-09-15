require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { EmbeddedEngine } = require('./engine/embedded');
const { ServerEngine } = require('./engine/server');
const monitor = require('./monitor');

/**
 * The one database handle the whole server uses. It is always PostgreSQL:
 *
 *   DATABASE_URL set    -> a hosted Postgres through a connection pool
 *   DATABASE_URL unset  -> embedded Postgres in server/db/pgdata, zero setup
 *
 * On top of the engine this adds three things every caller gets for free:
 *   - transactions that follow the call stack (AsyncLocalStorage), so a helper
 *     called inside a transaction joins it instead of deadlocking or escaping it
 *   - the "actor" (web / assistant / sql-console / system) recorded against
 *     every change by the audit triggers
 *   - timing for every statement, for the Database page's performance view
 */

const engine = process.env.DATABASE_URL
  ? new ServerEngine({ connectionString: process.env.DATABASE_URL })
  : new EmbeddedEngine({ dataDir: process.env.PGDATA_DIR || path.join(__dirname, 'pgdata') });

const context = new AsyncLocalStorage();

// Statements that change something - run inside a transaction so the audit
// trigger can see who made the change. VACUUM is excluded: it refuses to run in
// a transaction block.
const WRITE = /^\s*(?:\(\s*)*(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|comment|refresh|reindex|cluster)\b/i;
const CTE_WRITE = /^\s*with\b[\s\S]*\b(insert|update|delete)\b/i;

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function isWrite(sql) {
  const text = stripComments(sql);
  return WRITE.test(text) || CTE_WRITE.test(text);
}

function currentActor() {
  return context.getStore()?.actor || 'system';
}

async function timed(sql, params, run) {
  const started = performance.now();
  try {
    const result = await run();
    monitor.record(sql, performance.now() - started, result?.rowCount ?? 0, null, currentActor());
    return result;
  } catch (err) {
    monitor.record(sql, performance.now() - started, 0, err, currentActor());
    throw err;
  }
}

function wrapClient(client) {
  return {
    query: (sql, params = [], options = {}) => timed(sql, params, () => client.query(sql, params, options)),
    exec: (sql) => timed(sql, [], () => client.exec(sql)),
  };
}

const db = {
  name: 'postgres',
  get mode() {
    return engine.mode;
  },
  get ready() {
    return engine.ready;
  },

  /**
   * Runs one statement. Inside a transaction it joins that transaction; a write
   * outside one gets a transaction of its own so the audit log knows the actor.
   */
  async query(sql, params = [], options = {}) {
    const store = context.getStore();
    if (store?.tx) return store.tx.query(sql, params, options);
    if (isWrite(sql)) return db.transaction((tx) => tx.query(sql, params, options));
    return timed(sql, params, () => engine.query(sql, params, options));
  },

  /** Multi-statement SQL (migrations). Joins an open transaction if there is one. */
  async exec(sql) {
    const store = context.getStore();
    if (store?.tx) return store.tx.exec(sql);
    return timed(sql, [], () => engine.exec(sql));
  },

  /**
   * Runs `fn(tx)` in a transaction. Nested calls join the outer transaction.
   * Options: readOnly, timeoutMs, actor, settings ({ 'docdesk.x': 'on' } applied
   * as transaction-local settings before `fn` runs).
   */
  async transaction(fn, { readOnly = false, timeoutMs, actor, settings } = {}) {
    const store = context.getStore();
    if (store?.tx) return fn(store.tx);

    return engine.transaction(async (client) => {
      const tx = wrapClient(client);
      if (readOnly) await tx.query('SET TRANSACTION READ ONLY');
      await tx.query("SELECT set_config('docdesk.actor', $1, true)", [actor || currentActor()]);
      for (const [key, value] of Object.entries(settings || {})) {
        await tx.query('SELECT set_config($1, $2, true)', [key, String(value)]);
      }
      return context.run({ ...store, tx, actor: actor || currentActor() }, () => fn(tx));
    }, { timeoutMs });
  },

  /** Runs `fn` with every change inside attributed to `actor`. */
  runAs(actor, fn) {
    return context.run({ ...context.getStore(), actor }, fn);
  },

  currentActor,
  isWrite,

  describe() {
    return engine.describe();
  },

  async close() {
    await engine.close();
  },
};

module.exports = db;
