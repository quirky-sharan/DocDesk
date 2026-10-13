/**
 * A small in-process cache.
 *
 *  - time-to-live: an entry answers for `ttlMs`, then it is a miss
 *  - a size cap, evicting the least recently used entry first
 *  - an optional version: an entry stored under one version is a miss under
 *    another, which is how "anything changed since?" is answered without
 *    having to find and delete every entry a write might have touched
 *  - single-flight loading: when ten requests miss on the same key at once,
 *    one of them does the work and the other nine wait for its answer
 *
 * It lives in this process's memory, so it empties on restart and two copies of
 * the server would each keep their own. That is the right size for one shop on
 * one machine; a shared store (Redis) is what replaces it when there are two.
 */

const registry = [];

function createCache({ name, ttlMs = 30_000, max = 500, now = Date.now } = {}) {
  // A Map remembers insertion order, so re-inserting on every hit keeps the
  // least recently used entry at the front, where eviction finds it.
  const entries = new Map();
  const loading = new Map();
  const stats = { hits: 0, misses: 0, evictions: 0 };

  function peek(key, version) {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (now() >= entry.expiresAt || entry.version !== version) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  }

  function get(key, { version } = {}) {
    const entry = peek(key, version);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }
    stats.hits += 1;
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function set(key, value, { ttl = ttlMs, version } = {}) {
    entries.delete(key);
    entries.set(key, { value, version, expiresAt: now() + ttl });
    while (entries.size > max) {
      entries.delete(entries.keys().next().value);
      stats.evictions += 1;
    }
    return value;
  }

  /** The cached value, or `loader()`'s - run once however many callers ask. */
  async function wrap(key, loader, options = {}) {
    const cached = get(key, options);
    if (cached !== undefined) return cached;
    if (loading.has(key)) return loading.get(key);
    const pending = Promise.resolve()
      .then(loader)
      .then((value) => (value === undefined ? value : set(key, value, options)))
      .finally(() => loading.delete(key));
    loading.set(key, pending);
    return pending;
  }

  function remove(key) {
    return entries.delete(key);
  }

  /** Drops every entry whose value matches, e.g. everything for one user. */
  function removeWhere(predicate) {
    let removed = 0;
    for (const [key, entry] of entries) {
      if (predicate(entry.value, key)) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  function clear() {
    entries.clear();
  }

  function snapshot() {
    const asked = stats.hits + stats.misses;
    return {
      name,
      entries: entries.size,
      max,
      ttlMs,
      ...stats,
      hitRate: asked ? Math.round((stats.hits / asked) * 1000) / 10 : null,
    };
  }

  const cache = { get, set, wrap, delete: remove, deleteWhere: removeWhere, clear, snapshot };
  if (name) registry.push(cache);
  return cache;
}

/** Every named cache's counters, for the Database page's performance view. */
function cacheStats() {
  return registry.map((cache) => cache.snapshot());
}

module.exports = { createCache, cacheStats };
