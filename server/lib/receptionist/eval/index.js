#!/usr/bin/env node
// npm run bench:receptionist            the whole suite
// npm run bench:receptionist -- --degraded   only what must work with no key
//
// Results go to eval_runs / eval_results and show on the AI page. A model that
// fails a must-pass case is kept out of the routing pool - that is enforced by
// the routing query, not by anybody remembering.
const db = require('../../../db');
const { run } = require('./run');

(async () => {
  const degraded = process.argv.includes('--degraded');
  try {
    await db.ready;
    const result = await run({ degraded });
    await db.close();
    // A blocked model is a failure worth failing CI over.
    process.exit(result.blocked ? 1 : 0);
  } catch (err) {
    console.error(`\n  The benchmark could not run: ${err.message}\n`);
    await db.close().catch(() => {});
    process.exit(1);
  }
})();
