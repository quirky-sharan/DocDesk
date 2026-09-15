const db = require('../db');
const { text, number, fail } = require('../lib/validate');

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

    await db.transaction(async (tx) => {
      for (const [key, raw] of Object.entries(incoming)) {
        const value = SETTINGS[key].parse(raw) ?? '';
        // Upsert by hand so both drivers behave the same; ON CONFLICT syntax
        // differs enough between them to be worth avoiding.
        const { rowCount } = await tx.query(
          'UPDATE settings SET value = $1, updated_at = CURRENT_TIMESTAMP WHERE key = $2',
          [value, key]
        );
        if (!rowCount) {
          await tx.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
        }
      }
    });

    res.json({ ok: true, values: await readAll() });
  } catch (err) {
    next(err);
  }
};

exports.readAll = readAll;
