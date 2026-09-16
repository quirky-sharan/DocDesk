const db = require('../db');
const { simpleResource } = require('./simpleResource');
const { text, number, oneOf, id, fail } = require('../lib/validate');
const { resolveTimezone } = require('../lib/timezone');
const { regenerate } = require('../lib/knowledge/generate');

/**
 * Services, resources, opening hours and appointments.
 *
 * Every booking goes through the database functions from migration 008 rather
 * than an INSERT here, so the per-resource lock and the overlap re-check apply
 * however the booking arrived - a button, the receptionist, or somebody with a
 * SQL console. There is no second path that writes an appointment.
 */

const STATUSES = ['requested', 'confirmed', 'arrived', 'completed', 'no_show', 'cancelled'];
const SOURCES = ['walk_in', 'receptionist', 'operator', 'import'];

// Generated knowledge is rebuilt behind the response rather than in front of
// it: nobody should wait for re-chunking to find out their service was saved.
function refreshKnowledge(sources) {
  regenerate(sources).catch((err) => {
    console.warn(`[knowledge] could not rebuild ${sources.join(', ')}: ${err.message}`);
  });
}

// --- services and resources -------------------------------------------------

const services = simpleResource({
  table: 'services',
  label: 'Service',
  parse: (body) => ({
    name: text(body.name, 'Name', { required: true, max: 150 }),
    description: text(body.description, 'Description', { max: 2000 }),
    duration_minutes: number(body.duration_minutes, 'Duration', { required: true, min: 1, max: 1440, integer: true }),
    buffer_before_minutes: number(body.buffer_before_minutes, 'Gap before', { min: 0, max: 480, integer: true, fallback: 0 }),
    buffer_after_minutes: number(body.buffer_after_minutes, 'Gap after', { min: 0, max: 480, integer: true, fallback: 0 }),
    price: number(body.price, 'Price', { min: 0, fallback: 0, decimals: 2 }),
    max_per_day: body.max_per_day === '' || body.max_per_day === null || body.max_per_day === undefined
      ? null
      : number(body.max_per_day, 'Most per day', { min: 1, integer: true }),
    requires_deposit: Boolean(body.requires_deposit),
    colour: text(body.colour, 'Colour', { max: 40 }),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  }),
});

const resources = simpleResource({
  table: 'resources',
  label: 'Person or place',
  parse: (body) => ({
    name: text(body.name, 'Name', { required: true, max: 150 }),
    kind: oneOf(body.kind, 'Type', ['person', 'room', 'chair', 'bay', 'equipment', 'other'], { fallback: 'person' }),
    notes: text(body.notes, 'Notes', { max: 2000 }),
    is_active: body.is_active === undefined ? true : Boolean(body.is_active),
  }),
});

/**
 * Rebuilds generated knowledge after a successful write, hooked on the response
 * rather than wrapped around the handler - passing a no-op `next` would swallow
 * validation errors and leave the request hanging.
 */
function alsoRefresh(handler, sources) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 400) refreshKnowledge(sources);
    });
    return handler(req, res, next);
  };
}

exports.services = {
  ...services,
  create: alsoRefresh(services.create, ['services']),
  update: alsoRefresh(services.update, ['services']),
  remove: alsoRefresh(services.remove, ['services']),
};
exports.resources = {
  ...resources,
  create: alsoRefresh(resources.create, ['services']),
  update: alsoRefresh(resources.update, ['services']),
  remove: alsoRefresh(resources.remove, ['services']),
};

/** Which services a person or place can deliver. */
exports.setResourceServices = async (req, res, next) => {
  try {
    const resourceId = id(req.params.id, 'Person or place');
    const serviceIds = Array.isArray(req.body?.service_ids) ? req.body.service_ids.map((v) => id(v, 'Service')) : [];

    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM resource_services WHERE resource_id = $1', [resourceId]);
      for (const serviceId of serviceIds) {
        await tx.query(
          'INSERT INTO resource_services (resource_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [resourceId, serviceId]
        );
      }
    });
    refreshKnowledge(['services']);
    res.json({ ok: true, service_ids: serviceIds });
  } catch (err) {
    next(err);
  }
};

// --- opening hours and closures ---------------------------------------------

exports.hours = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT h.*, r.name AS resource_name
         FROM business_hours h
         LEFT JOIN resources r ON r.id = h.resource_id
        ORDER BY h.weekday, h.open_time`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
};

/**
 * Replaces the whole week in one go. A form that edits opening hours one row at
 * a time leaves the shop briefly closed on a Tuesday while somebody saves.
 */
exports.setHours = async (req, res, next) => {
  try {
    const resourceId = req.body?.resource_id ? id(req.body.resource_id, 'Person or place') : null;
    const incoming = Array.isArray(req.body?.hours) ? req.body.hours : [];

    const parsed = incoming.map((row) => {
      const weekday = number(row.weekday, 'Day', { required: true, min: 0, max: 6, integer: true });
      const open = text(row.open_time, 'Opening time', { required: true, max: 8 });
      const close = text(row.close_time, 'Closing time', { required: true, max: 8 });
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(open) || !/^\d{2}:\d{2}(:\d{2})?$/.test(close)) {
        throw fail('Times must look like 09:00');
      }
      if (close <= open) throw fail(`Closing time must be after opening time on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday]}`);
      return { weekday, open, close };
    });

    await db.transaction(async (tx) => {
      if (resourceId) await tx.query('DELETE FROM business_hours WHERE resource_id = $1', [resourceId]);
      else await tx.query('DELETE FROM business_hours WHERE resource_id IS NULL');

      for (const row of parsed) {
        await tx.query(
          'INSERT INTO business_hours (weekday, open_time, close_time, resource_id) VALUES ($1, $2, $3, $4)',
          [row.weekday, row.open, row.close, resourceId]
        );
      }
    });

    refreshKnowledge(['hours']);
    res.json({ ok: true, count: parsed.length });
  } catch (err) {
    next(err);
  }
};

exports.closures = async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, r.name AS resource_name FROM business_closures c
         LEFT JOIN resources r ON r.id = c.resource_id
        WHERE c.ends_on >= current_date - 30 ORDER BY c.starts_on`
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
};

exports.addClosure = async (req, res, next) => {
  try {
    const startsOn = text(req.body?.starts_on, 'From', { required: true, max: 10 });
    const endsOn = text(req.body?.ends_on, 'To', { max: 10 }) || startsOn;
    if (endsOn < startsOn) throw fail('The last day cannot be before the first');
    const { rows } = await db.query(
      `INSERT INTO business_closures (starts_on, ends_on, reason, resource_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [startsOn, endsOn, text(req.body?.reason, 'Reason', { max: 200 }), req.body?.resource_id ? id(req.body.resource_id, 'Person or place') : null]
    );
    refreshKnowledge(['hours']);
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.removeClosure = async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM business_closures WHERE id = $1', [id(req.params.id, 'Closure')]);
    if (!rowCount) throw fail('That closed day is not there', 404);
    refreshKnowledge(['hours']);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// --- availability -----------------------------------------------------------

/**
 * Free slots, straight out of the database function. Nothing is filtered here:
 * a slot list assembled in JS from a wider query is how two people get booked
 * into one room.
 */
exports.availability = async (req, res, next) => {
  try {
    const serviceId = id(req.query.service_id, 'Service');
    if (!serviceId) throw fail('Which service?');
    const resourceId = req.query.resource_id ? id(req.query.resource_id, 'Person or place') : null;

    const from = req.query.from ? new Date(req.query.from) : new Date();
    const to = req.query.to ? new Date(req.query.to) : new Date(from.getTime() + 7 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw fail('Those dates could not be read');
    if (to <= from) throw fail('The end of the range must be after the start');
    if (to - from > 62 * 86400000) throw fail('Ask for at most two months at a time');

    const step = req.query.step ? number(req.query.step, 'Step', { min: 5, max: 240, integer: true }) : null;

    const { rows } = await db.query(
      'SELECT resource_id, starts_at, ends_at FROM available_slots($1, $2, $3, $4, $5)',
      [serviceId, resourceId, from.toISOString(), to.toISOString(), step]
    );

    const { rows: names } = await db.query('SELECT id, name FROM resources WHERE is_active');
    const nameOf = new Map(names.map((r) => [String(r.id), r.name]));

    res.json({
      items: rows.map((row) => ({ ...row, resource_name: nameOf.get(String(row.resource_id)) || null })),
      timezone: await resolveTimezone(req),
    });
  } catch (err) {
    next(err);
  }
};

// --- appointments -----------------------------------------------------------

exports.listAppointments = async (req, res, next) => {
  try {
    const clauses = [];
    const params = [];
    // Every ? in the clause refers to the same bound value, so a clause that
    // searches two columns binds the term once.
    const add = (sql, value) => {
      params.push(value);
      clauses.push(sql.replaceAll('?', `$${params.length}`));
    };

    if (req.query.from) add('a.starts_at >= ?', new Date(req.query.from).toISOString());
    if (req.query.to) add('a.starts_at < ?', new Date(req.query.to).toISOString());
    if (req.query.resource_id) add('a.resource_id = ?', id(req.query.resource_id, 'Person or place'));
    if (req.query.customer_id) add('a.customer_id = ?', id(req.query.customer_id, 'Customer'));
    if (req.query.status) add('a.status = ?', oneOf(req.query.status, 'Status', STATUSES));
    if (req.query.search) add('(a.reference ILIKE ? OR a.customer_name ILIKE ?)', `%${req.query.search}%`);

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(req.query.pageSize) || 100, 1), 500);

    const { rows } = await db.query(
      `SELECT * FROM v_appointments a ${where} ORDER BY a.starts_at LIMIT ${limit}`,
      params
    );
    res.json({ items: rows, timezone: await resolveTimezone(req) });
  } catch (err) {
    next(err);
  }
};

exports.getAppointment = async (req, res, next) => {
  try {
    const appointmentId = id(req.params.id, 'Appointment');
    const { rows } = await db.query('SELECT * FROM v_appointments WHERE id = $1', [appointmentId]);
    if (!rows.length) throw fail('That appointment is not there', 404);
    const { rows: events } = await db.query(
      'SELECT status, reason, actor, created_at FROM appointment_events WHERE appointment_id = $1 ORDER BY created_at, id',
      [appointmentId]
    );
    res.json({ ...rows[0], events });
  } catch (err) {
    next(err);
  }
};

exports.createAppointment = async (req, res, next) => {
  try {
    const body = req.body || {};
    const serviceId = id(body.service_id, 'Service');
    const resourceId = id(body.resource_id, 'Person or place');
    if (!serviceId) throw fail('Which service is it for?');
    if (!resourceId) throw fail('Who or what is it with?');

    const startsAt = new Date(body.starts_at);
    if (Number.isNaN(startsAt.getTime())) throw fail('That start time could not be read');

    const status = oneOf(body.status, 'Status', ['requested', 'confirmed'], { fallback: 'confirmed' });
    const source = oneOf(body.source, 'Source', SOURCES, { fallback: 'operator' });

    const { rows } = await db.query(
      'SELECT * FROM book_appointment($1, $2, $3, $4, $5, $6, $7)',
      [serviceId, resourceId, startsAt.toISOString(), body.customer_id ? id(body.customer_id, 'Customer') : null,
        status, source, text(body.notes, 'Notes', { max: 2000 })]
    );
    const { rows: full } = await db.query('SELECT * FROM v_appointments WHERE id = $1', [rows[0].id]);
    res.status(201).json(full[0]);
  } catch (err) {
    next(err);
  }
};

exports.rescheduleAppointment = async (req, res, next) => {
  try {
    const appointmentId = id(req.params.id, 'Appointment');
    const startsAt = new Date(req.body?.starts_at);
    if (Number.isNaN(startsAt.getTime())) throw fail('That new time could not be read');

    await db.query('SELECT * FROM reschedule_appointment($1, $2, $3, $4)', [
      appointmentId,
      startsAt.toISOString(),
      req.body?.resource_id ? id(req.body.resource_id, 'Person or place') : null,
      text(req.body?.reason, 'Reason', { max: 300 }),
    ]);
    const { rows } = await db.query('SELECT * FROM v_appointments WHERE id = $1', [appointmentId]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

exports.setAppointmentStatus = async (req, res, next) => {
  try {
    const appointmentId = id(req.params.id, 'Appointment');
    const status = oneOf(req.body?.status, 'Status', STATUSES, { required: true });
    await db.query('SELECT set_appointment_status($1, $2, $3)', [
      appointmentId, status, text(req.body?.reason, 'Reason', { max: 300 }),
    ]);
    const { rows } = await db.query('SELECT * FROM v_appointments WHERE id = $1', [appointmentId]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
};

/** The day at a glance: what is booked, who is free, who is waiting. */
exports.day = async (req, res, next) => {
  try {
    const timezone = await resolveTimezone(req);
    const date = text(req.query.date, 'Date', { max: 10 });

    const { rows: appointments } = await db.query(
      `SELECT * FROM v_appointments
        WHERE (starts_at AT TIME ZONE $2)::date = COALESCE($1::date, (now() AT TIME ZONE $2)::date)
        ORDER BY starts_at`,
      [date || null, timezone]
    );
    const { rows: waiting } = await db.query(
      `SELECT w.*, s.name AS service_name, c.name AS customer_name
         FROM waitlist w
         JOIN services s ON s.id = w.service_id
         LEFT JOIN customers c ON c.id = w.customer_id
        ORDER BY w.created_at`
    );
    res.json({ date: date || null, timezone, appointments, waiting });
  } catch (err) {
    next(err);
  }
};

exports.capabilities = async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT scheduling_capabilities() AS c');
    res.json(rows[0].c);
  } catch (err) {
    next(err);
  }
};
