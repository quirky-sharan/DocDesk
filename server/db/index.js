require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { EmbeddedEngine } = require('./engine/embedded');
const { ServerEngine } = require('./engine/server');
const monitor = require('./monitor');
const { currentUserLabel } = require('../lib/auth/context');

/**
 * The one database handle the whole server uses. It is always PostgreSQL:
 *
 *   DATABASE_URL set    -> a hosted Postgres through a connection pool
 *   DATABASE_URL unset  -> embedded Postgres in server/db/pgdata, zero setup
 *
 * On top of the engine this adds four things every caller gets for free:
 *   - transactions that follow the call stack (AsyncLocalStorage), so a helper
 *     called inside a transaction joins it instead of deadlocking or escaping it
 *   - the "actor" (web / receptionist / sql-console / system) and the signed-in
 *     person, recorded against every change by the audit triggers
 *   - timing for every statement, for the Database page's performance view
 *   - a data version that moves on every committed change, so anything cached
 *     from the database can tell it is out of date without being told what
 *     changed
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
// Functions that change data while the statement still reads as a SELECT.
// Without this, `SELECT book_appointment(...)` runs outside a transaction, the
// actor is never set, and the audit trail records 'system' for a booking a
// person made. Add any new write function here.
const WRITE_FUNCTION = /\b(book_appointment|reschedule_appointment|set_appointment_status|apply_stock_change)\s*\(/i;

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function isWrite(sql) {
  const text = stripComments(sql);
  return WRITE.test(text) || CTE_WRITE.test(text) || WRITE_FUNCTION.test(text);
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

// Counts committed changes. Caches store the number they were filled under and
// treat any other number as a miss (see lib/cache.js).
let dataVersion = 0;

function wrapClient(client, state) {
  return {
    query: (sql, params = [], options = {}) => {
      if (isWrite(sql)) state.wrote = true;
      return timed(sql, params, () => client.query(sql, params, options));
    },
    exec: (sql) => {
      state.wrote = true;
      return timed(sql, [], () => client.exec(sql));
    },
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
    const result = await timed(sql, [], () => engine.exec(sql));
    dataVersion += 1;
    return result;
  },

  /**
   * Runs `fn(tx)` in a transaction. Nested calls join the outer transaction.
   * Options: readOnly, timeoutMs, actor, settings ({ 'docdesk.x': 'on' } applied
   * as transaction-local settings before `fn` runs), and quiet - for writes
   * that change nothing anyone reads back (a session's "last used" stamp), so
   * they do not invalidate what has been cached.
   */
  async transaction(fn, { readOnly = false, timeoutMs, actor, settings, quiet = false } = {}) {
    const store = context.getStore();
    if (store?.tx) return fn(store.tx);

    const state = { wrote: false };
    const result = await engine.transaction(async (client) => {
      const tx = wrapClient(client, state);
      if (readOnly) await tx.query('SET TRANSACTION READ ONLY');
      await tx.query(
        "SELECT set_config('docdesk.actor', $1, true), set_config('docdesk.user', $2, true)",
        [actor || currentActor(), currentUserLabel()]
      );
      for (const [key, value] of Object.entries(settings || {})) {
        await tx.query('SELECT set_config($1, $2, true)', [key, String(value)]);
      }
      return context.run({ ...store, tx, actor: actor || currentActor() }, () => fn(tx));
    }, { timeoutMs });
    // Only reached once the transaction has committed - a rollback throws.
    if (state.wrote && !quiet) dataVersion += 1;
    return result;
  },

  /** Runs `fn` with every change inside attributed to `actor`. */
  runAs(actor, fn) {
    return context.run({ ...context.getStore(), actor }, fn);
  },

  currentActor,
  isWrite,
  dataVersion: () => dataVersion,

  describe() {
    return engine.describe();
  },

  async close() {
    await engine.close();
  },
};

module.exports = db;
