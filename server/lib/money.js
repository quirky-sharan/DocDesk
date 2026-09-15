// Exact money arithmetic for sale lines.
//
// The database computes line_total = round(quantity * unit_price, 2) on exact
// decimals, and checks that a sale's subtotal equals the sum of its lines. Doing
// the same sum in JavaScript floats is occasionally a cent out (1.5 x 0.03 is
// 0.04499999... in binary), which the database would then rightly reject. So
// amounts are handled here as integers: quantities in thousandths, money in cents.

function toCents(value) {
  return BigInt(Math.round(Number(value || 0) * 100));
}

function toMilli(value) {
  return BigInt(Math.round(Number(value || 0) * 1000));
}

/** Rounds a non-negative BigInt division half away from zero. */
function divideRound(numerator, denominator) {
  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  const result = (n * 2n + denominator) / (denominator * 2n);
  return negative ? -result : result;
}

/** round(quantity * price, 2), exactly as PostgreSQL computes it. Returns cents. */
function lineTotalCents(quantity, price) {
  // milli * cents is in units of 1/100000; one cent is 1000 of those.
  return divideRound(toMilli(quantity) * toCents(price), 1000n);
}

/** Tax on a taxable amount (cents) at a percentage with up to 2 decimals. Returns cents. */
function taxCents(taxable, ratePercent) {
  const basisPoints = BigInt(Math.round(Number(ratePercent || 0) * 100));
  return divideRound(taxable * basisPoints, 10000n);
}

function fromCents(cents) {
  return Number(cents) / 100;
}

module.exports = { toCents, toMilli, lineTotalCents, taxCents, fromCents };
