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

function number(value, label, { required = false, min, max, integer = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw fail(`${label} is required`);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw fail(`${label} must be a number`);
  if (integer && !Number.isInteger(parsed)) throw fail(`${label} must be a whole number`);
  if (min !== undefined && parsed < min) throw fail(`${label} cannot be less than ${min}`);
  if (max !== undefined && parsed > max) throw fail(`${label} cannot be more than ${max}`);
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

// Money is stored as a scaled decimal; rounding at the boundary keeps floating
// point drift out of stored totals.
function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = { fail, text, number, oneOf, id, money };
