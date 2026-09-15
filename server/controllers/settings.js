const db = require('../db');
const { text, number, fail } = require('../lib/validate');
const { knownZones } = require('../lib/timezone');

// Whitelisted so an arbitrary key can't be written, and so defaults exist
// before anyone has saved anything.
const SETTINGS = {
  business_name: { label: 'Business name', default: 'DocDesk', parse: (v) => text(v, 'Business name', { max: 120 }) },
  business_address: { label: 'Address', default: '', parse: (v) => text(v, 'Address', { max: 400 }) },
  business_phone: { label: 'Phone', default: '', parse: (v) => text(v, 'Phone', { max: 40 }) },
  business_email: { label: 'Email', default: '', parse: (v) => text(v, 'Email', { max: 150 }) },
  currency_symbol: { label: 'Currency symbol', default: '', parse: (v) => text(v, 'Currency symbol', { max: 8 }) },
  default_tax_rate: {
    label: 'Default tax %',
    default: '0',
    parse: (v) => String(number(v, 'Default tax %', { min: 0, max: 100, fallback: 0 })),
  },
  receipt_footer: { label: 'Receipt footer', default: '', parse: (v) => text(v, 'Receipt footer', { max: 300 }) },
  timezone: {
    label: 'Timezone',
    default: '',
    parse: async (v) => {
      const zone = text(v, 'Timezone', { max: 60 });
      if (zone && !(await knownZones()).has(zone)) throw fail(`"${zone}" is not a timezone name, e.g. Asia/Kolkata`);
      return zone;
    },
  },
};

async function readAll() {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const result = {};
  for (const [key, config] of Object.entries(SETTINGS)) {
    result[key] = stored[key] ?? config.default;
  }
  return result;
}

exports.get = async (req, res, next) => {
  try {
    res.json({
      values: await readAll(),
      fields: Object.entries(SETTINGS).map(([key, c]) => ({ key, label: c.label })),
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const incoming = req.body || {};
    const unknown = Object.keys(incoming).filter((k) => !SETTINGS[k]);
    if (unknown.length) throw fail(`Unknown setting: ${unknown.join(', ')}`);

    const parsed = {};
    for (const [key, raw] of Object.entries(incoming)) {
      parsed[key] = (await SETTINGS[key].parse(raw)) ?? '';
    }

    await db.transaction(async (tx) => {
      for (const [key, value] of Object.entries(parsed)) {
        await tx.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
           WHERE settings.value IS DISTINCT FROM EXCLUDED.value`,
          [key, value]
        );
      }
    });

    res.json({ ok: true, values: await readAll() });
  } catch (err) {
    next(err);
  }
};

exports.readAll = readAll;
