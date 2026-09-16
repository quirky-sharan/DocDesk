const db = require('../../db');
const { save } = require('./index');

/**
 * Knowledge built from what the database already knows.
 *
 * Opening hours, the service list and the business's own details are facts the
 * shop maintains elsewhere. Asking an owner to also write them into a knowledge
 * base guarantees the two disagree within a month, and the receptionist would
 * confidently quote whichever one was stale.
 *
 * So these documents are generated, marked is_generated, and rebuilt whenever
 * the underlying data changes. The Knowledge page shows them as read-only and
 * points at the page that actually owns each fact.
 */

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const time = (value) => String(value || '').slice(0, 5);

async function settingsDocument() {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const name = settings.business_name || 'the business';

  const lines = [`${name} is the business you are answering for.`];
  if (settings.business_address) lines.push(`Address: ${settings.business_address}`);
  if (settings.business_phone) lines.push(`Phone: ${settings.business_phone}`);
  if (settings.business_email) lines.push(`Email: ${settings.business_email}`);
  if (settings.timezone) lines.push(`All times are in ${settings.timezone}.`);

  // Only what has been filled in. A generated line reading "Address: " is worse
  // than no line at all, because retrieval would match "address" and answer
  // with nothing.
  if (lines.length === 1) {
    lines.push('No address or phone number has been filled in yet, so those questions need a person.');
  }

  return { title: 'About the business', source: 'settings', body: lines.join('\n\n') };
}

async function hoursDocument() {
  const { rows } = await db.query(
    `SELECT weekday, open_time, close_time, resource_id
       FROM business_hours
      WHERE resource_id IS NULL
      ORDER BY weekday, open_time`
  );

  if (!rows.length) {
    return {
      title: 'Opening hours',
      source: 'hours',
      body: 'Opening hours have not been set up yet, so questions about when the business is open need a person.',
    };
  }

  const byDay = new Map();
  for (const row of rows) {
    if (!byDay.has(row.weekday)) byDay.set(row.weekday, []);
    byDay.get(row.weekday).push(`${time(row.open_time)} to ${time(row.close_time)}`);
  }

  const openDays = [];
  const closedDays = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const name = WEEKDAY_NAMES[weekday];
    if (byDay.has(weekday)) openDays.push(`${name}: ${byDay.get(weekday).join(', ')}`);
    else closedDays.push(name);
  }

  const parts = ['Opening hours, by day of the week:', openDays.join('\n')];
  if (closedDays.length) {
    parts.push(`Closed on ${closedDays.join(', ')}.`);
  }

  const { rows: closures } = await db.query(
    `SELECT starts_on, ends_on, reason FROM business_closures
      WHERE ends_on >= current_date ORDER BY starts_on LIMIT 10`
  );
  if (closures.length) {
    parts.push(
      'Upcoming days closed:\n'
      + closures
        .map((c) => `${c.starts_on}${c.ends_on !== c.starts_on ? ` to ${c.ends_on}` : ''}${c.reason ? ` (${c.reason})` : ''}`)
        .join('\n')
    );
  }

  return { title: 'Opening hours', source: 'hours', body: parts.join('\n\n') };
}

async function servicesDocument() {
  const { rows } = await db.query(
    `SELECT s.name, s.description, s.duration_minutes, s.price, s.is_active,
            array_remove(array_agg(r.name ORDER BY r.name), NULL) AS resources
       FROM services s
       LEFT JOIN resource_services rs ON rs.service_id = s.id
       LEFT JOIN resources r ON r.id = rs.resource_id AND r.is_active
      WHERE s.is_active
      GROUP BY s.id
      ORDER BY s.name`
  );

  if (!rows.length) {
    return {
      title: 'What we offer',
      source: 'services',
      body: 'No services have been set up yet, so questions about what can be booked need a person.',
    };
  }

  const body = rows
    .map((row) => {
      const bits = [`${row.name} takes about ${row.duration_minutes} minutes`];
      if (Number(row.price) > 0) bits.push(`and costs ${Number(row.price).toFixed(2)}`);
      let line = `${bits.join(' ')}.`;
      if (row.description) line += ` ${row.description}`;
      if (row.resources?.length) line += ` Done by: ${row.resources.join(', ')}.`;
      return line;
    })
    .join('\n\n');

  return { title: 'What we offer', source: 'services', body: `These can be booked:\n\n${body}` };
}

const BUILDERS = { settings: settingsDocument, hours: hoursDocument, services: servicesDocument };

/**
 * Rebuilds the generated documents.
 * @param {string[]} [only] which sources to rebuild; all of them by default.
 */
async function regenerate(only = null) {
  const sources = only?.length ? only.filter((s) => BUILDERS[s]) : Object.keys(BUILDERS);
  const written = [];

  for (const source of sources) {
    const document = await BUILDERS[source]();
    const { rows } = await db.query(
      'SELECT id FROM kb_documents WHERE source = $1 AND is_generated LIMIT 1',
      [source]
    );
    const saved = await save({
      id: rows[0]?.id ?? null,
      title: document.title,
      body: document.body,
      source,
      isGenerated: true,
    });
    written.push({ source, title: document.title, chunks: saved?.chunks ?? 0 });
  }

  return written;
}

module.exports = { regenerate, BUILDERS };
