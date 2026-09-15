function fail(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// Messages here are read by non-technical users, so they name the field the way
// the form labels it and say what is wrong, not what the type checker wanted.
function text(value, label, { required = false, max = 250 } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (required) throw fail(`${label} is required`);
    return null;
  }
  const trimmed = String(value).trim();
  if (trimmed.length > max) throw fail(`${label} must be ${max} characters or fewer`);
  return trimmed;
}

function number(value, label, { required = false, min, max, integer = false, fallback = null, decimals } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw fail(`${label} is required`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw fail(`${label} must be a number`);
  if (integer && !Number.isInteger(parsed)) throw fail(`${label} must be a whole number`);
  if (min !== undefined && parsed < min) throw fail(`${label} cannot be less than ${min}`);
  if (max !== undefined && parsed > max) throw fail(`${label} cannot be more than ${max}`);
  if (decimals !== undefined) {
    const factor = 10 ** decimals;
    return Math.round(parsed * factor) / factor;
  }
  return parsed;
}

function oneOf(value, label, allowed, { required = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw fail(`${label} is required`);
    return fallback;
  }
  const v = String(value);
  if (!allowed.includes(v)) throw fail(`${label} must be one of: ${allowed.join(', ')}`);
  return v;
}

function id(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw fail(`${label} is not valid`);
  return parsed;
}

// Same rule as the database's CHECK constraint, checked first so the person
// sees which field is wrong.
function email(value, label = 'Email') {
  const trimmed = text(value, label, { max: 150 });
  if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    throw fail(`${label} doesn't look like an email address`);
  }
  return trimmed;
}

// Money is stored as numeric(14,2); rounding at the boundary keeps floating
// point drift out of stored totals.
function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank', 'other'];
const METHOD_ALIASES = {
  cash: 'cash', card: 'card', 'credit card': 'card', 'debit card': 'card', credit: 'card', debit: 'card',
  upi: 'upi', gpay: 'upi', 'google pay': 'upi', phonepe: 'upi', paytm: 'upi',
  bank: 'bank', 'bank transfer': 'bank', transfer: 'bank', neft: 'bank', imps: 'bank', rtgs: 'bank',
  cheque: 'other', check: 'other', other: 'other',
};

/** Accepts the ways people write a payment method ("UPI", "bank transfer"). */
function paymentMethod(value, label = 'Payment method', { fallback = null } = {}) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const key = String(value).trim().toLowerCase();
  const method = METHOD_ALIASES[key];
  if (!method) throw fail(`${label} must be cash, card, UPI, bank transfer or other`);
  return method;
}

/** The row_version a form was loaded with, for optimistic locking. */
function version(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

module.exports = { fail, text, number, oneOf, id, email, money, paymentMethod, version, PAYMENT_METHODS };
