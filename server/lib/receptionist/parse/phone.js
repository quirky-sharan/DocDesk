/**
 * Phone numbers, normalised to E.164.
 *
 * Written for Indian numbers because that is where this shop is: a bare ten
 * digits, a leading 0, a +91, an 0091, or any of those with spaces, hyphens and
 * brackets through them. Anything already carrying another country code is kept
 * as it is rather than mangled into +91.
 *
 * Storing one shape matters more than it looks: a customer typed in as
 * "98765 43210" and again as "+91 98765-43210" is two customers unless
 * something makes them the same string.
 */

const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY_CODE || '91';

/** Digits only, keeping a leading + if there was one. */
function digitsOf(text) {
  const raw = String(text || '').trim();
  const plus = raw.startsWith('+') || raw.startsWith('00');
  const digits = raw.replace(/\D/g, '');
  return { digits, plus };
}

/**
 * @returns {null|{ e164: string, national: string, country: string }}
 */
function parsePhone(text, { country = DEFAULT_COUNTRY } = {}) {
  if (!text) return null;

  // A number written inside a sentence: take the longest run of digits and the
  // separators people put through them, rather than every digit in the line.
  const found = String(text).match(/(?:\+|00)?[\d][\d\s().-]{6,20}\d/);
  if (!found) return null;

  let { digits, plus } = digitsOf(found[0]);
  if (!digits) return null;

  // 00 is how the rest of the world writes +.
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
    plus = true;
  }

  // Someone else's country code, left alone.
  if (plus && !digits.startsWith(country)) {
    if (digits.length < 8 || digits.length > 15) return null;
    return { e164: `+${digits}`, national: digits, country: null };
  }

  if (digits.startsWith(country) && digits.length === country.length + 10) {
    digits = digits.slice(country.length);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    // The trunk prefix people dial out of habit.
    digits = digits.slice(1);
  }

  if (digits.length !== 10) return null;
  // Indian mobile numbers start 6-9. A ten-digit number starting 0-5 is a
  // mistyped landline or not a phone number at all.
  if (country === '91' && !/^[6-9]/.test(digits)) return null;

  return { e164: `+${country}${digits}`, national: digits, country };
}

/** Back into the shape people here actually write. */
function formatPhone(e164, { country = DEFAULT_COUNTRY } = {}) {
  const text = String(e164 || '');
  if (!text.startsWith('+')) return text;
  const digits = text.slice(1);
  if (digits.startsWith(country) && digits.length === country.length + 10) {
    const national = digits.slice(country.length);
    return `+${country} ${national.slice(0, 5)} ${national.slice(5)}`;
  }
  return text;
}

/** Whether two numbers are the same person, however each was typed. */
function samePhone(a, b) {
  const first = parsePhone(a);
  const second = parsePhone(b);
  return Boolean(first && second && first.e164 === second.e164);
}

module.exports = { parsePhone, formatPhone, samePhone };
