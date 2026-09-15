const { Pool, types } = require('pg');

// Match the embedded engine's conversions exactly (see worker.js): numbers as
// numbers, calendar dates as 'YYYY-MM-DD', timestamps without zone untouched.
types.setTypeParser(types.builtins.NUMERIC, (value) => (value === null ? null : Number(value)));
types.setTypeParser(types.builtins.INT8, (value) => (value === null ? null : Number(value)));
types.setTypeParser(types.builtins.DATE, (value) => value);
types.setTypeParser(types.builtins.TIMESTAMP, (value) => value);

function shape(result) {
  return {
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows?.length ?? 0,
    fields: (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
  };
}

/**
 * A hosted PostgreSQL (Neon, Supabase, Render, your own) through a connection
 * pool. Used whenever DATABASE_URL is set - the SQL is identical to the
 * embedded engine's, so moving from one to the other is a setting, not a port.
 */
class ServerEngine {
  constructor({ connectionString }) {
    this.mode = 'server';
    this.startedAt = Date.now();
    const url = new URL(connectionString);
    this.host = url.hostname;
    this.database = url.pathname.replace(/^\//, '') || 'postgres';
    this.pool = new Pool({
      connectionString,
      // Managed Postgres terminates TLS with certificates that don't chain to a
      // root Node ships, so verification is relaxed; DATABASE_SSL=off disables
      // TLS entirely for a local server.
      ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX) || 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      application_name: 'docdesk',
    });
    // An idle client dropped by the provider (Neon scales to zero) must not
    // crash the process; the pool simply opens a new connection next time.
    // No per-connection session setup: connection poolers (PgBouncer on Neon and
    // Supabase) don't keep it, so every query is written to not depend on the
    // session timezone - dates are always converted with an explicit AT TIME ZONE.
    this.pool.on('error', (err) => console.warn(`[db] idle connection closed: ${err.message}`));
    this.ready = this.pool.query("SELECT current_setting('server_version') AS version, current_setting('server_encoding') AS encoding").then(({ rows }) => {
      this.version = rows[0].version;
      this.encoding = rows[0].encoding;
      if (this.encoding !== 'UTF8') {
        console.warn(`[db] This database uses ${this.encoding} encoding. Create it with UTF8 so names in any language (and symbols like ₹) can be stored.`);
      }
    });
    this.ready.catch(() => {});
  }

  async query(sql, params = [], options = {}) {
    const result = await this.pool.query({ text: sql, values: params, rowMode: options.rowMode === 'array' ? 'array' : undefined });
    return shape(result);
  }

  async exec(sql) {
    const result = await this.pool.query(sql);
    return (Array.isArray(result) ? result : [result]).map(shape);
  }

  async transaction(fn, { timeoutMs } = {}) {
    const client = await this.pool.connect();
    const wrapped = {
      query: async (sql, params = [], options = {}) =>
        shape(await client.query({ text: sql, values: params, rowMode: options.rowMode === 'array' ? 'array' : undefined })),
      exec: async (sql) => {
        const result = await client.query(sql);
        return (Array.isArray(result) ? result : [result]).map(shape);
      },
    };
    try {
      await client.query('BEGIN');
      if (timeoutMs) await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
      const result = await fn(wrapped);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  describe() {
    return {
      mode: this.mode,
      engine: 'PostgreSQL (hosted)',
      version: this.version,
      location: `${this.host} / ${this.database}`,
      connections: {
        max: this.pool.options.max,
        total: this.pool.totalCount,
        idle: this.pool.idleCount,
        waiting: this.pool.waitingCount,
      },
      startedAt: new Date(this.startedAt).toISOString(),
    };
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { ServerEngine };
