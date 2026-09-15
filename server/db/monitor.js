// In-memory query telemetry for the Database page: the most recent statements,
// the slowest ones, the busiest query shapes, and a per-five-seconds timeline.
// Nothing is written to disk and nothing leaves the process.

const RECENT_LIMIT = 150;
const BUCKET_MS = 5_000;
const BUCKETS = 72; // six minutes
const SLOW_MS = 150;

const recent = [];
const slow = [];
const shapes = new Map();
const buckets = new Map();
let total = 0;
let errors = 0;
let totalMs = 0;
const startedAt = Date.now();

/** Collapses literals and whitespace so the same query with different values groups together. */
function normalise(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+(\.\d+)?\b/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function record(sql, ms, rows, error, actor) {
  // Housekeeping statements would drown out the interesting ones.
  if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET TRANSACTION|SELECT set_config)/i.test(sql)) return;

  total += 1;
  totalMs += ms;
  if (error) errors += 1;

  const shape = normalise(sql);
  const entry = { sql: shape, ms: Math.round(ms * 10) / 10, rows, at: Date.now(), actor, error: error ? error.message : null };
  recent.push(entry);
  if (recent.length > RECENT_LIMIT) recent.shift();

  if (ms >= SLOW_MS) {
    slow.push(entry);
    slow.sort((a, b) => b.ms - a.ms);
    if (slow.length > 25) slow.length = 25;
  }

  const agg = shapes.get(shape) || { sql: shape, calls: 0, totalMs: 0, maxMs: 0, rows: 0, errors: 0 };
  agg.calls += 1;
  agg.totalMs += ms;
  agg.maxMs = Math.max(agg.maxMs, ms);
  agg.rows += rows || 0;
  if (error) agg.errors += 1;
  shapes.set(shape, agg);
  if (shapes.size > 500) {
    // Forget the least-used shapes rather than grow without bound.
    const sorted = [...shapes.values()].sort((a, b) => a.calls - b.calls);
    for (const s of sorted.slice(0, 100)) shapes.delete(s.sql);
  }

  const bucket = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const b = buckets.get(bucket) || { at: bucket, count: 0, totalMs: 0, errors: 0 };
  b.count += 1;
  b.totalMs += ms;
  if (error) b.errors += 1;
  buckets.set(bucket, b);
  for (const key of buckets.keys()) {
    if (key < bucket - BUCKET_MS * BUCKETS) buckets.delete(key);
  }
}

function snapshot() {
  const now = Math.floor(Date.now() / BUCKET_MS) * BUCKET_MS;
  const timeline = [];
  for (let i = BUCKETS - 1; i >= 0; i--) {
    const at = now - i * BUCKET_MS;
    const b = buckets.get(at);
    timeline.push({ at, count: b?.count || 0, avgMs: b?.count ? Math.round((b.totalMs / b.count) * 10) / 10 : 0, errors: b?.errors || 0 });
  }
  const sortedRecent = [...recent].reverse();
  const durations = recent.map((r) => r.ms).sort((a, b) => a - b);
  const percentile = (p) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(p * durations.length))] : 0);

  return {
    since: new Date(startedAt).toISOString(),
    total,
    errors,
    avgMs: total ? Math.round((totalMs / total) * 10) / 10 : 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    slowThresholdMs: SLOW_MS,
    recent: sortedRecent.slice(0, 60),
    slowest: slow.slice(0, 15),
    topByTime: [...shapes.values()]
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 12)
      .map((s) => ({ ...s, totalMs: Math.round(s.totalMs), maxMs: Math.round(s.maxMs * 10) / 10, avgMs: Math.round((s.totalMs / s.calls) * 10) / 10 })),
    timeline,
  };
}

module.exports = { record, snapshot, normalise };
