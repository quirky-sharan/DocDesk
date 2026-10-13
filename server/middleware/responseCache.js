const db = require('../db');
const { createCache } = require('../lib/cache');

/**
 * Remembers the answer to an expensive read.
 *
 * The reports and the dashboard figures are aggregates over the whole sales
 * history. They are asked for constantly - every page that shows a number, and
 * the receptionist several at a time - and change only when something is
 * written. So the answer is kept, keyed by the exact URL, and reused until
 * either of two things happens:
 *
 *   - the database's data version moves, meaning something was committed.
 *     This is what keeps it honest: record a sale and the very next request
 *     is a miss, so a figure is never out of date because of the cache.
 *   - `seconds` pass. "Today" and "this week" move on their own, and a change
 *     made outside this process (psql, another copy of the server) has no
 *     version to move.
 *
 * Only for routes whose answer is the same whoever asks. The X-Cache header
 * says which way it went, so it can be watched in the browser's network tab.
 */
const responses = createCache({ name: 'responses', ttlMs: 30_000, max: 300 });

function cacheFor(seconds) {
  return (req, res, next) => {
    if (req.method !== 'GET' || process.env.RESPONSE_CACHE === 'off') return next();

    const key = req.originalUrl;
    // Taken before the handler runs. If something is written while it is
    // working, what it stores is already labelled out of date.
    const version = db.dataVersion();

    const hit = responses.get(key, { version });
    if (hit !== undefined) {
      res.set('X-Cache', 'HIT');
      return res.json(hit);
    }

    const send = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) responses.set(key, body, { ttl: seconds * 1000, version });
      res.set('X-Cache', 'MISS');
      return send(body);
    };
    return next();
  };
}

module.exports = { cacheFor, responses };
