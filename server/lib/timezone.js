const db = require('../db');

// Reports bucket sales into days and hours in the shop's own timezone. The zone
// comes from the browser (?tz=Asia/Kolkata), falling back to the one saved in
// Settings, then UTC. Names are checked against the database's own list before
// they ever reach a query.

let known = null;

async function knownZones() {
  if (!known) {
    const { rows } = await db.query('SELECT name FROM pg_timezone_names');
    known = new Set(rows.map((r) => r.name));
    known.add('UTC');
  }
  return known;
}

async function resolveTimezone(req) {
  const zones = await knownZones();
  const requested = typeof req?.query?.tz === 'string' ? req.query.tz.trim() : '';
  if (requested && zones.has(requested)) return requested;

  const { rows } = await db.query("SELECT value FROM settings WHERE key = 'timezone'");
  const saved = rows[0]?.value;
  if (saved && zones.has(saved)) return saved;
  return 'UTC';
}

/** Today's date (YYYY-MM-DD) in a timezone. */
function todayIn(timezone, offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

module.exports = { resolveTimezone, knownZones, todayIn };
