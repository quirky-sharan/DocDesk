/**
 * Rate limiting with a token bucket.
 *
 * Each caller has a bucket holding up to `capacity` tokens. A request spends
 * one; tokens drip back in at `perMinute`. That allows a short burst - opening
 * the dashboard fires a dozen requests at once and should - while holding the
 * long-run rate to the refill rate. A fixed window ("100 per minute, reset on
 * the minute") lets twice the limit through across the boundary; this does not.
 *
 * Buckets are kept in this process's memory. A bucket that has refilled
 * completely is the same as one that never existed, so those are forgotten.
 */

const MAX_BUCKETS = 10_000;

function createLimiter({ name, capacity, perMinute, now = Date.now }) {
  const buckets = new Map();
  const refillPerMs = perMinute / 60_000;
  const stats = { allowed: 0, limited: 0 };

  function sweep(time) {
    for (const [key, bucket] of buckets) {
      if (bucket.tokens + (time - bucket.updatedAt) * refillPerMs >= capacity) buckets.delete(key);
    }
  }

  /** Spends `cost` tokens for `key`, or says how long until that is possible. */
  function take(key, cost = 1) {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= MAX_BUCKETS) sweep(time);
      // Still full after a sweep means that many callers really are active;
      // the oldest entry goes rather than letting the map grow without bound.
      if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value);
      bucket = { tokens: capacity, updatedAt: time };
      buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(capacity, bucket.tokens + (time - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = time;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      stats.allowed += 1;
      return { allowed: true, limit: capacity, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    stats.limited += 1;
    return { allowed: false, limit: capacity, remaining: 0, retryAfterMs: Math.ceil((cost - bucket.tokens) / refillPerMs) };
  }

  function reset() {
    buckets.clear();
  }

  function snapshot() {
    return { name, capacity, perMinute, tracked: buckets.size, ...stats };
  }

  const timer = setInterval(() => sweep(now()), 60_000);
  timer.unref();

  return { name, take, reset, snapshot };
}

module.exports = { createLimiter };
