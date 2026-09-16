// Scheduling: availability, booking and the rules that stop a double booking.
//
//   npm test            (a throwaway embedded database under db/test-pgdata)
//   DATABASE_URL=...    (a hosted one - the same tests against a real server)
//
// A note on the concurrency test. The embedded engine (PGlite) has exactly one
// connection, so two bookings fired at once queue rather than truly race. That
// still exercises the re-check inside book_appointment(), and it is what a shop
// laptop actually does. Real parallelism is only tested when DATABASE_URL points
// at a server with a pool - the test reports which one it ran. The exclusion
// constraint is tested separately by writing rows directly, which is the
// guarantee that holds however the write arrived.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.env.DATABASE_URL) {
  process.env.PGDATA_DIR = process.env.TEST_PGDATA_DIR || path.join(__dirname, '..', 'db', 'test-pgdata-scheduling');
  fs.rmSync(process.env.PGDATA_DIR, { recursive: true, force: true });
  fs.rmSync(`${process.env.PGDATA_DIR}.lock`, { force: true });
}

const db = require('../db');
const { migrate } = require('../db/migrate');

const TABLES = [
  'appointment_events', 'appointments', 'waitlist', 'business_closures', 'business_hours',
  'resource_services', 'resources', 'services', 'audit_log', 'customers',
];

async function reset() {
  await db.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  await db.query('ALTER SEQUENCE appointment_number_seq RESTART WITH 1001');
  await db.query("DELETE FROM settings WHERE key = 'timezone'");
}

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

async function rejects(fn, expected) {
  let error = null;
  try {
    await fn();
  } catch (err) {
    error = err;
  }
  assert.ok(error, 'expected that to be refused, but it went through');
  if (expected) assert.match(error.message, expected);
  return error;
}

/** A shop in Chennai, open 9-5 every day, with one person who does one service. */
async function setUpShop({
  duration = 60, bufferBefore = 0, bufferAfter = 0, maxPerDay = null, timezone = 'Asia/Kolkata',
} = {}) {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('timezone', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [timezone]
  );
  const service = await one(
    `INSERT INTO services (name, duration_minutes, buffer_before_minutes, buffer_after_minutes, max_per_day, price)
     VALUES ('Consultation', $1, $2, $3, $4, 500) RETURNING *`,
    [duration, bufferBefore, bufferAfter, maxPerDay]
  );
  const resource = await one(`INSERT INTO resources (name, kind) VALUES ('Dr Rao', 'person') RETURNING *`);
  await db.query('INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2)', [resource.id, service.id]);
  for (let weekday = 0; weekday <= 6; weekday++) {
    await db.query(
      `INSERT INTO business_hours (weekday, open_time, close_time) VALUES ($1, '09:00', '17:00')`,
      [weekday]
    );
  }
  return { service, resource };
}

const book = (serviceId, resourceId, startsAt, extra = {}) =>
  one('SELECT * FROM book_appointment($1, $2, $3, $4, $5)', [
    serviceId, resourceId, startsAt, extra.customerId ?? null, extra.status ?? 'confirmed',
  ]);

const slots = (serviceId, from, to, resourceId = null, step = null) =>
  db.query('SELECT * FROM available_slots($1, $2, $3, $4, $5)', [serviceId, resourceId, from, to, step])
    .then((r) => r.rows);

// 2026-10-05 is a Monday. Times are written as +05:30 so they read as the wall
// clock a person in Chennai would say out loud.
const at = (time) => `2026-10-05T${time}+05:30`;

test.before(async () => {
  await db.ready;
  await migrate();
});

test.after(async () => {
  await db.close();
});

test.beforeEach(reset);

test('two bookings for the same slot: exactly one wins', async () => {
  const { service, resource } = await setUpShop();
  const parallel = db.mode !== 'embedded';

  const results = await Promise.allSettled([
    book(service.id, resource.id, at('10:00')),
    book(service.id, resource.id, at('10:00')),
  ]);

  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected');
  assert.equal(won.length, 1, `exactly one booking should win (${parallel ? 'parallel' : 'queued'})`);
  assert.equal(lost.length, 1);
  assert.match(lost[0].reason.message, /already booked/i);

  const { rows } = await db.query('SELECT count(*)::int AS n FROM appointments');
  assert.equal(rows[0].n, 1, 'only one appointment should exist');
});

test('an overlapping appointment written directly is refused by the database', async () => {
  const { service, resource } = await setUpShop();
  const caps = (await one('SELECT scheduling_capabilities() AS c')).c;

  await book(service.id, resource.id, at('10:00'));

  if (!caps.exclusion_constraint) {
    // Recorded rather than silently skipped: without the constraint, a write
    // that bypasses book_appointment() is not protected, and that is worth
    // knowing about rather than discovering later.
    console.warn('  (no exclusion constraint on this database - overlap protection is the advisory lock only)');
    return;
  }

  await rejects(
    () => db.query(
      `INSERT INTO appointments (service_id, resource_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4, 'confirmed')`,
      [service.id, resource.id, at('10:30'), at('11:30')]
    ),
    /exclusion|overlap/i
  );
});

test('back-to-back bookings are fine; only a real overlap is refused', async () => {
  const { service, resource } = await setUpShop({ duration: 60 });
  await book(service.id, resource.id, at('10:00'));
  await book(service.id, resource.id, at('11:00'));
  const { rows } = await db.query('SELECT count(*)::int AS n FROM appointments');
  assert.equal(rows[0].n, 2, 'an appointment ending at 11:00 does not clash with one starting at 11:00');
});

test('cancelling frees the slot again', async () => {
  const { service, resource } = await setUpShop();
  const first = await book(service.id, resource.id, at('10:00'));
  await rejects(() => book(service.id, resource.id, at('10:00')), /already booked/i);

  await db.query('SELECT set_appointment_status($1, $2, $3)', [first.id, 'cancelled', 'Customer called']);

  const second = await book(service.id, resource.id, at('10:00'));
  assert.ok(second.id, 'the slot should be bookable once the first is cancelled');
});

test('status comes from the events, and cannot be set directly', async () => {
  const { service, resource } = await setUpShop();
  const appointment = await book(service.id, resource.id, at('10:00'), { status: 'requested' });
  assert.equal(appointment.status, 'requested');

  await db.query('SELECT set_appointment_status($1, $2, $3)', [appointment.id, 'confirmed', 'Confirmed by phone']);
  assert.equal((await one('SELECT status FROM appointments WHERE id = $1', [appointment.id])).status, 'confirmed');

  await db.query('SELECT set_appointment_status($1, $2, $3)', [appointment.id, 'arrived', null]);
  assert.equal((await one('SELECT status FROM appointments WHERE id = $1', [appointment.id])).status, 'arrived');

  await rejects(
    () => db.query('UPDATE appointments SET status = $1 WHERE id = $2', ['completed', appointment.id]),
    /comes from its history/i
  );

  const { rows } = await db.query(
    'SELECT status, reason FROM appointment_events WHERE appointment_id = $1 ORDER BY id',
    [appointment.id]
  );
  assert.deepEqual(rows.map((r) => r.status), ['requested', 'confirmed', 'arrived'], 'every step is kept');
  assert.equal(rows[0].reason, 'Booked');
});

test('availability follows the opening hours, in the shop\'s own timezone', async () => {
  const { service } = await setUpShop({ duration: 60 });
  const day = await slots(service.id, at('00:00'), at('23:59'));

  assert.equal(day.length, 8, '09:00 to 17:00 in hour-long slots is eight of them');

  const local = (value) => new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
  assert.equal(local(day[0].starts_at), '09:00:00', 'the first slot is 9am in Chennai, not 9am UTC');
  assert.equal(local(day[day.length - 1].starts_at), '16:00:00', 'the last one ends at close, not after it');
});

test('a closure takes the whole day out', async () => {
  const { service } = await setUpShop();
  await db.query(
    `INSERT INTO business_closures (starts_on, ends_on, reason) VALUES ('2026-10-05', '2026-10-05', 'Public holiday')`
  );
  assert.equal((await slots(service.id, at('00:00'), at('23:59'))).length, 0);
});

test('a booked slot disappears, and its buffers take the neighbours with it', async () => {
  const { service, resource } = await setUpShop({ duration: 60, bufferAfter: 30 });
  const before = await slots(service.id, at('00:00'), at('23:59'), null, 30);

  await book(service.id, resource.id, at('10:00'));
  const after = await slots(service.id, at('00:00'), at('23:59'), null, 30);

  const times = (rows) => rows.map((r) => new Date(r.starts_at).toISOString());
  const gone = times(before).filter((t) => !times(after).includes(t));

  // 10:00 is taken, and 09:30 plainly overlaps it. The two less obvious ones:
  // 09:00 runs to 10:00 and then needs its own half hour of clearing-up time,
  // so the resource is busy until 10:30 and the 10:00 booking is inside that;
  // and 10:30/11:00 fall inside the buffer that follows the booking itself.
  // Buffers cut both ways, which is the whole point of having them.
  assert.deepEqual(
    gone.map((t) => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })),
    ['09:00:00', '09:30:00', '10:00:00', '10:30:00', '11:00:00']
  );
});

test('hours set for one person replace the business hours for them', async () => {
  const { service, resource } = await setUpShop({ duration: 60 });
  // Dr Rao only works mornings on a Monday, whatever the shop's hours say.
  await db.query(
    `INSERT INTO business_hours (weekday, open_time, close_time, resource_id) VALUES (1, '09:00', '12:00', $1)`,
    [resource.id]
  );
  const day = await slots(service.id, at('00:00'), at('23:59'));
  assert.equal(day.length, 3, 'three hour-long slots between 9 and 12, not eight');
});

test('a service capped per day stops being offered once it is full', async () => {
  const { service, resource } = await setUpShop({ duration: 60, maxPerDay: 2 });
  assert.ok((await slots(service.id, at('00:00'), at('23:59'))).length > 0);

  await book(service.id, resource.id, at('09:00'));
  await book(service.id, resource.id, at('10:00'));

  assert.equal((await slots(service.id, at('00:00'), at('23:59'))).length, 0, 'two a day means two');
});

test('moving an appointment re-checks the clash', async () => {
  const { service, resource } = await setUpShop({ duration: 60 });
  const first = await book(service.id, resource.id, at('10:00'));
  await book(service.id, resource.id, at('12:00'));

  await rejects(
    () => db.query('SELECT reschedule_appointment($1, $2)', [first.id, at('12:00')]),
    /already taken/i
  );

  const moved = await one('SELECT * FROM reschedule_appointment($1, $2, $3, $4)', [first.id, at('14:00'), null, 'Customer asked']);
  assert.equal(new Date(moved.starts_at).toISOString(), new Date(at('14:00')).toISOString());
  assert.equal(new Date(moved.ends_at).toISOString(), new Date(at('15:00')).toISOString(), 'the end moves with it');

  const events = await db.query('SELECT reason FROM appointment_events WHERE appointment_id = $1 ORDER BY id', [first.id]);
  assert.equal(events.rows.at(-1).reason, 'Customer asked', 'why it moved is recorded');
});

test('somebody who does not do the service cannot be booked for it', async () => {
  const { service } = await setUpShop();
  const other = await one(`INSERT INTO resources (name, kind) VALUES ('Reception desk', 'other') RETURNING *`);
  await rejects(() => book(service.id, other.id, at('10:00')), /does not do/i);
});

test('an appointment that is cancelled or done cannot be moved', async () => {
  const { service, resource } = await setUpShop();
  const appointment = await book(service.id, resource.id, at('10:00'));
  await db.query('SELECT set_appointment_status($1, $2, $3)', [appointment.id, 'cancelled', null]);
  await rejects(() => db.query('SELECT reschedule_appointment($1, $2)', [appointment.id, at('14:00')]), /already cancelled/i);
});

test('appointment numbers come from a sequence', async () => {
  const { service, resource } = await setUpShop();
  const first = await book(service.id, resource.id, at('10:00'));
  const second = await book(service.id, resource.id, at('11:00'));
  assert.equal(first.reference, 'A-1001');
  assert.equal(second.reference, 'A-1002');
});

test('every booking is in the audit trail, with who made it', async () => {
  const { service, resource } = await setUpShop();
  await db.runAs('receptionist', () => book(service.id, resource.id, at('10:00')));
  const { rows } = await db.query(
    `SELECT actor, action FROM audit_log WHERE table_name = 'appointments' ORDER BY id`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'INSERT');
  assert.equal(rows[0].actor, 'receptionist');
});
