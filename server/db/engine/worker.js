// Runs the embedded PostgreSQL (PGlite) on its own thread.
//
// PGlite executes queries synchronously inside WebAssembly. On the main thread a
// heavy query would freeze every other request; here it only occupies this
// worker, and a query that runs away can be stopped by terminating the thread.
// The data directory survives that - it was tested by killing writers mid-
// transaction and reopening (see memory.md).

const { parentPort, workerData } = require('worker_threads');
const { PGlite, types } = require('@electric-sql/pglite');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');

let db;

// The same conversions the hosted driver applies, so a row looks identical
// whichever database produced it: numbers as numbers, calendar dates as plain
// 'YYYY-MM-DD' strings (no timezone shift), timestamps as Date objects.
const parsers = {
  [types.NUMERIC]: (value) => (value === null ? null : Number(value)),
  [types.INT8]: (value) => (value === null ? null : Number(value)),
  [types.DATE]: (value) => value,
  [types.TIMESTAMP]: (value) => value,
};

function serialiseError(err) {
  const out = { message: err?.message || String(err) };
  for (const key of ['code', 'detail', 'hint', 'position', 'constraint', 'table', 'column', 'schema', 'severity', 'where', 'dataType', 'routine']) {
    if (err && err[key] !== undefined) out[key] = err[key];
  }
  return out;
}

function shape(result) {
  return {
    rows: result.rows,
    rowCount: result.affectedRows ?? result.rows?.length ?? 0,
    fields: (result.fields || []).map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
  };
}

async function open() {
  db = await PGlite.create({
    dataDir: workerData.dataDir,
    extensions: { pg_trgm },
    parsers,
  });
  // Stored timestamps are UTC; reports convert to the shop's timezone explicitly.
  await db.exec("SET TIME ZONE 'UTC'");
  const { rows } = await db.query('SHOW server_version');
  parentPort.postMessage({ type: 'ready', version: rows[0].server_version });
}

parentPort.on('message', async (message) => {
  const { id, op, sql, params, options } = message;
  try {
    let result;
    if (op === 'query') {
      result = shape(await db.query(sql, params || [], { rowMode: options?.rowMode === 'array' ? 'array' : 'object' }));
    } else if (op === 'exec') {
      result = (await db.exec(sql)).map(shape);
    } else if (op === 'close') {
      await db.close();
      result = { closed: true };
    } else {
      throw new Error(`Unknown database operation "${op}"`);
    }
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: serialiseError(err) });
  }
});

open().catch((err) => {
  parentPort.postMessage({ type: 'failed', error: serialiseError(err) });
});
