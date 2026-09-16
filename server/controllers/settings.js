const db = require('../db');
const brand = require('../../shared/brand.json');
const { text, number, oneOf, fail } = require('../lib/validate');
const { knownZones } = require('../lib/timezone');
const llm = require('../lib/llm');

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

  // --- Receptionist AI ------------------------------------------------------
  // Added in Phase 7. They live in the same whitelisted settings table as
  // everything else rather than a parallel config system, so they are backed
  // up, audited and editable from the SQL console like any other row.
  receptionist_name: {
    label: 'What it calls itself',
    default: brand.receptionist,
    parse: (v) => text(v, 'Name', { max: 60 }),
  },
  receptionist_mode: {
    label: 'Mode',
    // Suggest, not Live. Every real deployment of this should start with a
    // person reading what it wants to say for a week.
    default: 'suggest',
    parse: (v) => oneOf(v, 'Mode', ['off', 'suggest', 'live'], { fallback: 'suggest' }),
  },
  receptionist_tone: {
    label: 'Tone',
    default: 'warm',
    parse: (v) => oneOf(v, 'Tone', ['warm', 'brief', 'formal'], { fallback: 'warm' }),
  },
  receptionist_greeting: {
    label: 'Greeting',
    default: '',
    parse: (v) => text(v, 'Greeting', { max: 300 }),
  },
  receptionist_emergency_phrases: {
    label: 'Emergency phrases',
    default: '',
    parse: (v) => text(v, 'Emergency phrases', { max: 4000 }),
  },
  receptionist_emergency_response: {
    label: 'What to say in an emergency',
    default: '',
    parse: (v) => text(v, 'Emergency reply', { max: 1000 }),
  },
  receptionist_always_escalate: {
    label: 'Always fetch a person for',
    default: '',
    parse: (v) => text(v, 'Always escalate', { max: 1000 }),
  },
  receptionist_booking_confirm: {
    label: 'New bookings',
    default: 'auto',
    parse: (v) => oneOf(v, 'New bookings', ['auto', 'approve'], { fallback: 'auto' }),
  },
  receptionist_quote_prices: {
    label: 'May quote prices',
    default: 'on',
    parse: (v) => oneOf(v, 'May quote prices', ['on', 'off'], { fallback: 'on' }),
  },
  receptionist_retention_days: {
    label: 'Keep conversations for (days)',
    default: '365',
    parse: (v) => String(number(v, 'Retention', { min: 7, max: 3650, integer: true, fallback: 365 })),
  },
  ai_daily_token_cap: {
    label: 'Daily AI limit (tokens, 0 for none)',
    default: '0',
    parse: (v) => String(number(v, 'Daily AI limit', { min: 0, max: 100000000, integer: true, fallback: 0 })),
  },
  ai_pinned_model: {
    label: 'Always use this model',
    default: '',
    parse: (v) => text(v, 'Model', { max: 120 }),
  },
  ai_deterministic_only: {
    label: 'Work without a language model',
    default: 'off',
    parse: (v) => oneOf(v, 'Work without a language model', ['on', 'off'], { fallback: 'off' }),
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

    const values = await readAll();
    await applyAiOverrides(values);
    res.json({ ok: true, values });
  } catch (err) {
    next(err);
  }
};

/**
 * Pushes the AI settings into the running gateway.
 *
 * Called on save and at start-up, so a daily limit or a pinned model takes
 * effect without a restart - and, more importantly, so a limit set months ago
 * is still in force after one.
 */
async function applyAiOverrides(values = null) {
  const settings = values || (await readAll());
  llm.gateway.setOverrides({
    dailyTokenCap: Number(settings.ai_daily_token_cap || 0),
    pinnedModel: settings.ai_pinned_model || null,
    deterministicOnly: settings.ai_deterministic_only === 'on' || settings.receptionist_mode === 'off',
  });
  return llm.gateway.getOverrides();
}

exports.readAll = readAll;
exports.applyAiOverrides = applyAiOverrides;
