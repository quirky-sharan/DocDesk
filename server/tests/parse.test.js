// The deterministic parsers: dates, times and phone numbers.
//
// These need no database and no model, so they run in milliseconds and can be
// exhaustive. Every case here is one the model never has to think about, which
// is the point: a parser cannot hallucinate a Tuesday.
//
// "Now" is fixed at Monday 2026-09-14, 10:30 in Chennai, so "tomorrow" means
// something definite.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parse, describe: describeTime } = require('../lib/receptionist/parse/datetime');
const { parsePhone, formatPhone } = require('../lib/receptionist/parse/phone');
const { instantToZoned } = require('../lib/receptionist/parse/zoned');

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-09-14T10:30:00+05:30'); // a Monday
const at = (text) => parse(text, { now: NOW, timezone: TZ, openHour: 9, closeHour: 18 });

/** What a parse reads as on the shop's clock: "DD/MM/YYYY HH:MM". */
function local(parsed) {
  assert.ok(parsed, 'expected that to parse');
  const t = instantToZoned(parsed.start, TZ);
  return `${String(t.day).padStart(2, '0')}/${String(t.month).padStart(2, '0')}/${t.year} ${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

// --- relative days ----------------------------------------------------------

const DAY_CASES = [
  ['today', '14/09/2026'],
  ['tomorrow', '15/09/2026'],
  ['tmrw', '15/09/2026'],
  ['day after tomorrow', '16/09/2026'],
  ['in 3 days', '17/09/2026'],
  ['in a week', '21/09/2026'],
  ['in two weeks', '28/09/2026'],
  ['next week', '21/09/2026'],
  ['this weekend', '19/09/2026'],
  ['next weekend', '26/09/2026'],
];

for (const [input, expected] of DAY_CASES) {
  test(`day: "${input}" -> ${expected}`, () => {
    assert.equal(local(at(input)).slice(0, 10), expected);
  });
}

// --- weekdays ---------------------------------------------------------------

const WEEKDAY_CASES = [
  ['next tuesday', '22/09/2026'],   // next week's Tuesday, not tomorrow's
  ['this tuesday', '15/09/2026'],
  ['coming friday', '18/09/2026'],
  ['on friday', '18/09/2026'],
  ['saturday', '19/09/2026'],
  ['sunday', '20/09/2026'],
  ['next monday', '21/09/2026'],    // today is Monday: next week, not today
  ['wed', '16/09/2026'],
  ['thurs', '17/09/2026'],
];

for (const [input, expected] of WEEKDAY_CASES) {
  test(`weekday: "${input}" -> ${expected}`, () => {
    assert.equal(local(at(input)).slice(0, 10), expected);
  });
}

test('"next Monday" said on a Monday means a week away, not today', () => {
  assert.equal(local(at('next monday')).slice(0, 10), '21/09/2026');
});

test('a bare weekday a day or two off is flagged rather than assumed', () => {
  // "Tuesday" on a Monday could easily mean tomorrow or next week. Saying
  // which one, and asking, is better than being quietly wrong.
  const soon = at('tuesday');
  assert.equal(soon.needsConfirmation, true);
  assert.match(soon.assumptions.join(' '), /Tuesday to mean 15\/09\/2026/);

  const far = at('saturday');
  assert.equal(far.needsConfirmation, false, 'five days off is not ambiguous');
});

// --- written dates ----------------------------------------------------------

const DATE_CASES = [
  ['16/09', '16/09/2026'],
  ['16/09/2026', '16/09/2026'],
  ['16-09-2026', '16/09/2026'],
  ['16.09.2026', '16/09/2026'],
  ['16/9/26', '16/09/2026'],
  ['25/12', '25/12/2026'],
  ['1/10', '01/10/2026'],
  ['16 september', '16/09/2026'],
  ['16th september', '16/09/2026'],
  ['16th of september', '16/09/2026'],
  ['september 16', '16/09/2026'],
  ['sept 16', '16/09/2026'],
  ['sep 16 2027', '16/09/2027'],
  ['2 jan', '02/01/2027'],          // January has gone; next year is meant
  ['31 december', '31/12/2026'],
];

for (const [input, expected] of DATE_CASES) {
  test(`date: "${input}" -> ${expected}`, () => {
    assert.equal(local(at(input)).slice(0, 10), expected);
  });
}

test('day comes first, the way it is written here', () => {
  assert.equal(local(at('09/11')).slice(0, 10), '09/11/2026', 'the ninth of November');
});

test('a date that could be read either way is flagged for confirmation', () => {
  const both = at('09/11');
  assert.equal(both.needsConfirmation, true);
  assert.match(both.assumptions.join(' '), /confirm if you meant month\/day/);

  const only = at('25/12');
  assert.equal(only.needsConfirmation, false, '25 cannot be a month, so there is nothing to confirm');
});

test('a number that cannot be a day is read the other way round', () => {
  assert.equal(local(at('09/25')).slice(0, 10), '25/09/2026');
});

test('a date with no year that has passed is taken as next year', () => {
  const parsed = at('2 jan');
  assert.equal(local(parsed).slice(0, 10), '02/01/2027');
  assert.match(parsed.assumptions.join(' '), /no year given - took 2027/);
});

test('a date that does not exist is refused, not rounded', () => {
  assert.equal(at('31/02/2026'), null, 'there is no 31 February');
  assert.equal(at('32/01/2026'), null);
});

// --- times ------------------------------------------------------------------

const TIME_CASES = [
  ['tomorrow at 4pm', '15/09/2026 16:00'],
  ['tomorrow at 4 pm', '15/09/2026 16:00'],
  ['tomorrow 4:30pm', '15/09/2026 16:30'],
  ['tomorrow at 16:30', '15/09/2026 16:30'],
  ['tomorrow at 9am', '15/09/2026 09:00'],
  ['tomorrow at 9:15 am', '15/09/2026 09:15'],
  ['tomorrow at noon', '15/09/2026 12:00'],
  ['tomorrow at midnight', '15/09/2026 00:00'],
  ['tomorrow morning', '15/09/2026 09:00'],
  ['tomorrow afternoon', '15/09/2026 12:00'],
  ['tomorrow evening', '15/09/2026 17:00'],
  ['16/09 at 11:45', '16/09/2026 11:45'],
  ['next tuesday at 4', '22/09/2026 16:00'],
  ['friday at half past four', '18/09/2026 16:30'],
  ['friday at quarter to five', '18/09/2026 16:45'],
  ['friday at quarter past nine', '18/09/2026 09:15'],
  ['tomorrow at 4 o clock', '15/09/2026 16:00'],
  ["tomorrow at 4 o'clock", '15/09/2026 16:00'],
  ['tomorrow at 10.30', '15/09/2026 10:30'],
];

for (const [input, expected] of TIME_CASES) {
  test(`time: "${input}" -> ${expected}`, () => {
    assert.equal(local(at(input)), expected);
  });
}

test('a bare hour is read as one the shop is open, and says so', () => {
  // Open 9 to 6: "4" can only sensibly be 16:00. 4am is defensible and useless.
  const four = at('tomorrow at 4');
  assert.equal(local(four), '15/09/2026 16:00');
  assert.match(four.assumptions.join(' '), /took 4 to mean 16:00/);

  const ten = at('tomorrow at 10');
  assert.equal(local(ten), '15/09/2026 10:00', '10am is inside opening hours and 10pm is not');
  assert.equal(ten.needsConfirmation, false);
});

test('an hour that works either way is flagged', () => {
  // Open 6am to 10pm, so both 9am and 9pm fall inside opening hours and there
  // is genuinely no way to tell which was meant. (At a 9pm close it is not
  // ambiguous at all: a 9pm appointment would end after closing.)
  const parsed = parse('tomorrow at 9', { now: NOW, timezone: TZ, openHour: 6, closeHour: 22 });
  assert.equal(parsed.needsConfirmation, true);
  assert.match(parsed.assumptions.join(' '), /9 could be 9:00 or 21:00/);
});

test('"in an hour" is measured from now, not from a calendar', () => {
  assert.equal(local(at('in an hour')), '14/09/2026 11:30');
  assert.equal(local(at('in 30 minutes')), '14/09/2026 11:00');
  assert.equal(local(at('in 2 hours')), '14/09/2026 12:30');
});

test('a time with no day means today, unless it has already gone', () => {
  const later = at('at 4pm');
  assert.equal(local(later), '14/09/2026 16:00');
  assert.match(later.assumptions.join(' '), /no day given - took today/);

  const passed = at('at 9am');
  assert.equal(local(passed), '15/09/2026 09:00');
  assert.match(passed.assumptions.join(' '), /has passed today - took tomorrow/);
});

test('a part of the day comes back as a range, not a point', () => {
  const morning = at('tomorrow morning');
  assert.equal(morning.kind, 'range');
  assert.equal(local(morning), '15/09/2026 09:00');
  assert.equal(instantToZoned(morning.end, TZ).hour, 12);
});

test('a whole day with no time is a whole day', () => {
  const day = at('16/09');
  assert.equal(day.kind, 'date');
  assert.equal(day.allDay, true);
  assert.equal(instantToZoned(day.end, TZ).day, 17, 'it ends at the start of the next day');
});

test('nothing time-like at all parses to nothing', () => {
  for (const input of ['hello', 'do you sell batteries', '', '   ', 'thanks!']) {
    assert.equal(at(input), null, `"${input}" should not look like a date`);
  }
});

test('the parse reads back the way a person would say it', () => {
  assert.equal(describeTime(at('next tuesday at 4'), TZ), '22/09/2026 at 16:00');
});

test('the timezone is the shop\'s, not the server\'s', () => {
  // 9am in Chennai is 03:30 UTC. If this ever reads 09:00 UTC, every
  // appointment in the system is five and a half hours out.
  const parsed = at('tomorrow at 9am');
  assert.equal(parsed.start.toISOString(), '2026-09-15T03:30:00.000Z');
});

// --- phone numbers ----------------------------------------------------------

const PHONE_CASES = [
  ['9876543210', '+919876543210'],
  ['09876543210', '+919876543210'],
  ['+91 98765 43210', '+919876543210'],
  ['+919876543210', '+919876543210'],
  ['91 9876543210', '+919876543210'],
  ['098765-43210', '+919876543210'],
  ['(98765) 43210', '+919876543210'],
  ['+44 20 7946 0958', '+442079460958'],
  ['00 91 9876543210', '+919876543210'],
];

for (const [input, expected] of PHONE_CASES) {
  test(`phone: "${input}" -> ${expected}`, () => {
    assert.equal(parsePhone(input)?.e164, expected);
  });
}

test('something that is not a phone number is refused', () => {
  for (const input of ['12345', 'call me', '', '98765432101234567890']) {
    assert.equal(parsePhone(input), null, `"${input}" is not a phone number`);
  }
});

test('an Indian number reads back the way people write it', () => {
  assert.equal(formatPhone('+919876543210'), '+91 98765 43210');
});

test('a number inside a sentence is still found', () => {
  assert.equal(parsePhone('my number is 98765 43210 thanks')?.e164, '+919876543210');
});
