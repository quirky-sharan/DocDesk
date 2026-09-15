const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');

/**
 * Embedded PostgreSQL: a real Postgres (PGlite, compiled to WebAssembly) running
 * in a worker thread, storing its data in a folder on disk. No install, no
 * server to manage - `npm install` is the whole setup.
 *
 * PGlite is single-connection, so every operation queues on one lock here. A
 * transaction holds that lock from BEGIN to COMMIT, which is exactly the
 * isolation a single shop's front desk needs, and nothing can interleave with
 * it. Postgres' own statement_timeout is not enforced inside WebAssembly, so a
 * query given a time limit is enforced here instead: on expiry the worker is
 * terminated and reopened, and the caller gets a plain error.
 */
class EmbeddedEngine {
  constructor({ dataDir }) {
    this.mode = 'embedded';
    this.dataDir = dataDir;
    this.pending = new Map();
    this.sequence = 0;
    this.tail = Promise.resolve();
    this.closing = false;
    this.version = null;
    this.startedAt = Date.now();
    this.restarts = 0;
    fs.mkdirSync(path.dirname(dataDir), { recursive: true });
    this.claimLock();
    this.start();
  }

  /**
   * One process at a time: two engines writing the same data folder would
   * corrupt it. A lock file holds the owner's process id; a lock left by a
   * process that no longer exists (a crash, a forced stop) is simply taken over.
   */
  claimLock() {
    this.lockFile = `${this.dataDir}.lock`;
    try {
      const owner = Number(fs.readFileSync(this.lockFile, 'utf8').trim());
      if (owner && owner !== process.pid) {
        let alive = false;
        try {
          process.kill(owner, 0);
          alive = true;
        } catch (err) {
          alive = err.code === 'EPERM';
        }
        if (alive) {
          const err = new Error(
            `The DocDesk database is already open in another program (process ${owner}). Stop DocDesk (stop_all.bat) before running this, ` +
              `or if nothing is running, delete ${this.lockFile}.`
          );
          err.code = 'DB_LOCKED';
          throw err;
        }
      }
    } catch (err) {
      if (err.code === 'DB_LOCKED') throw err;
      // No lock file yet, or an unreadable one: ours to take.
    }
    fs.writeFileSync(this.lockFile, String(process.pid));
    const release = () => {
      try {
        if (Number(fs.readFileSync(this.lockFile, 'utf8').trim()) === process.pid) fs.rmSync(this.lockFile, { force: true });
      } catch {
        // Already gone.
      }
    };
    this.releaseLock = release;
    process.once('exit', release);
  }

  start() {
    const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { dataDir: this.dataDir } });
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      worker.on('message', (message) => {
        if (message.type === 'ready') {
          this.version = message.version;
          resolve();
        } else if (message.type === 'failed') {
          reject(Object.assign(new Error(`The database could not be opened: ${message.error.message}`), message.error));
        } else {
          this.settle(message);
        }
      });
      worker.once('error', (err) => {
        reject(err);
        this.failAll(worker, err);
      });
      worker.once('exit', (code) => {
        this.failAll(worker, new Error('The database stopped unexpectedly. It is restarting - try again in a moment.'));
        // Only an exit nobody asked for is a crash worth restarting from here.
        if (!this.closing && !worker.intentional && this.worker === worker) {
          console.error(`[db] embedded database worker exited (code ${code}); restarting`);
          this.restarts += 1;
          this.start();
        }
      });
    });
    // Avoid an unhandled rejection before anyone awaits `ready`.
    this.ready.catch(() => {});
  }

  settle({ id, ok, result, error }) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (ok) entry.resolve(result);
    else entry.reject(Object.assign(new Error(error.message), error));
  }

  /** Rejects whatever was still waiting on a worker that has gone away. */
  failAll(worker, err) {
    for (const [id, entry] of this.pending) {
      if (entry.worker !== worker) continue;
      clearTimeout(entry.timer);
      entry.reject(err);
      this.pending.delete(id);
    }
  }

  /** Sends one operation to the worker. Callers must hold the lock. */
  async call(op, payload = {}, { timeoutMs } = {}) {
    await this.ready;
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: null, worker: this.worker };
      if (timeoutMs) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          const err = new Error(`The query took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`);
          err.code = '57014';
          err.status = 408;
          reject(err);
          this.recycle();
        }, timeoutMs);
      }
      this.pending.set(id, entry);
      this.worker.postMessage({ id, op, ...payload });
    });
  }

  /** Stops a stuck worker and opens the database again. */
  recycle() {
    const old = this.worker;
    old.intentional = true;
    this.restarts += 1;
    // The old thread must be fully gone before the data directory is opened
    // again - two engines on one directory would corrupt it.
    this.ready = old
      .terminate()
      .catch(() => {})
      .then(() => {
        this.start();
        return this.ready;
      });
    this.ready.catch(() => {});
  }

  /** Runs `fn` with exclusive use of the database. */
  exclusive(fn) {
    const run = this.tail.then(() => fn());
    this.tail = run.catch(() => {});
    return run;
  }

  query(sql, params, options = {}) {
    return this.exclusive(() => this.call('query', { sql, params, options }, options));
  }

  exec(sql) {
    return this.exclusive(() => this.call('exec', { sql }));
  }

  /**
   * BEGIN ... COMMIT around `fn`, holding the lock throughout. `fn` receives a
   * client whose queries run inside the transaction without re-taking the lock.
   */
  transaction(fn, { timeoutMs } = {}) {
    return this.exclusive(async () => {
      const client = {
        query: (sql, params, options = {}) => this.call('query', { sql, params, options }, { timeoutMs: options.timeoutMs ?? timeoutMs }),
        exec: (sql) => this.call('exec', { sql }, { timeoutMs }),
      };
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        // After a timeout the worker was replaced; there is nothing to roll back.
        if (err.code !== '57014') await this.call('query', { sql: 'ROLLBACK' }).catch(() => {});
        throw err;
      }
    });
  }

  describe() {
    return {
      mode: this.mode,
      engine: 'PostgreSQL (embedded)',
      version: this.version,
      location: this.dataDir,
      connections: { max: 1, note: 'Single embedded connection - queries run one at a time' },
      restarts: this.restarts,
      startedAt: new Date(this.startedAt).toISOString(),
    };
  }

  async close() {
    this.closing = true;
    try {
      await this.exclusive(() => this.call('close'));
    } catch {
      // Closing a database that already stopped is fine.
    }
    await this.worker.terminate().catch(() => {});
    this.releaseLock?.();
  }
}

module.exports = { EmbeddedEngine };
