const { zonedToInstant, instantToZoned, addDays, weekdayOf, isRealDate } = require('./zoned');

/**
 * "next Tuesday at 4" -> an instant.
 *
 * The model is never asked to do this. A parser is free, instant, testable and
 * cannot hallucinate a date that does not exist, which matters when the answer
 * becomes a real appointment in somebody's day. What is left for the model is
 * the genuinely fuzzy part - what the person wants - not arithmetic on a
 * calendar.
 *
 * Two conventions worth stating because they are not universal:
 *
 * - DD/MM, not MM/DD. This is written for a shop in Chennai. 09/11 is the ninth
 *   of November. When both numbers are 12 or less the other reading exists, so
 *   the result is flagged and the receptionist confirms rather than assuming.
 *
 * - "next Tuesday" means the Tuesday of next week, and "this Tuesday" or
 *   "coming Tuesday" means the next one to arrive. People do disagree about
 *   this, so a bare weekday within the next few days is flagged too.
 *
 * Anything assumed is listed in `assumptions`, and anything genuinely ambiguous
 * sets `needsConfirmation`. Nothing here ever silently picks for the caller.
 */

const WEEKDAYS = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, half: 30, quarter: 15,
};

/** Parts of the day, as the hours a shop would mean by them. */
const DAY_PARTS = {
  morning: [9, 12],
  afternoon: [12, 17],
  evening: [17, 20],
  night: [19, 22],
  noon: [12, 13],
  midday: [12, 13],
  midnight: [0, 1],
};

function normalise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\bo'?\s?clock\b/g, "o'clock")
    .replace(/\btmrw?\b/g, 'tomorrow')
    .replace(/\btmr\b/g, 'tomorrow')
    .replace(/\btoday\b/g, 'today')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} text
 * @param {object} options
 * @param {Date}   [options.now]         the instant to read "tomorrow" against
 * @param {string} [options.timezone]    the shop's zone
 * @param {number} [options.openHour]    used to read a bare "4" as an hour the shop is open
 * @param {number} [options.closeHour]
 * @returns {null|object}
 */
function parseDateTime(text, { now = new Date(), timezone = 'UTC', openHour = 9, closeHour = 18 } = {}) {
  const input = normalise(text);
  if (!input) return null;

  const today = instantToZoned(now, timezone);
  const assumptions = [];
  let ambiguous = false;

  // Time first, then the date on what is left. The order matters: "10.30" and
  // "10.09" are the same shape, and the only thing that tells a time from a
  // short date is whether something has already claimed those characters.
  const time = matchTime(input, { openHour, closeHour });
  const remainder = time?.text ? input.replace(time.text, ' ') : input;
  const date = matchDate(remainder, { today, assumptions, onAmbiguous: () => { ambiguous = true; } });

  if (!date && !time) return null;

  // A time on its own means today if it has not passed, otherwise tomorrow -
  // nobody asks for four o'clock meaning four o'clock this morning at five in
  // the afternoon. Said out loud so the caller can disagree.
  let day = date?.day || null;
  if (!day && time) {
    const nowMinutes = today.hour * 60 + today.minute;
    const wanted = time.hour * 60 + time.minute;
    day = wanted > nowMinutes
      ? { year: today.year, month: today.month, day: today.day }
      : addDays(today, 1);
    assumptions.push(wanted > nowMinutes ? 'no day given - took today' : 'that time has passed today - took tomorrow');
  }

  if (!time && day) {
    // A date with no time is the whole day, which is what a booking request
    // usually is before anyone has picked a slot.
    const start = zonedToInstant({ ...day, hour: 0, minute: 0 }, timezone);
    const end = zonedToInstant({ ...addDays(day, 1), hour: 0, minute: 0 }, timezone);
    return {
      kind: 'date',
      start, end,
      allDay: true,
      ambiguous: ambiguous || Boolean(date?.ambiguous),
      needsConfirmation: ambiguous || Boolean(date?.ambiguous),
      assumptions: [...assumptions, ...(date?.assumptions || [])],
      source: input,
    };
  }

  const start = zonedToInstant({ ...day, hour: time.hour, minute: time.minute }, timezone);
  const end = time.endHour !== undefined
    ? zonedToInstant({ ...day, hour: time.endHour, minute: time.endMinute ?? 0 }, timezone)
    : null;

  const needsConfirmation = ambiguous || Boolean(date?.ambiguous) || Boolean(time.ambiguous);
  return {
    kind: time.isRange ? 'range' : 'datetime',
    start,
    end,
    allDay: false,
    ambiguous: needsConfirmation,
    needsConfirmation,
    assumptions: [...assumptions, ...(date?.assumptions || []), ...(time.assumptions || [])],
    source: input,
  };
}

// --- the date half ----------------------------------------------------------

function matchDate(input, { today, assumptions, onAmbiguous }) {
  // 16/09/2026, 16-9-26, 16.09
  const numeric = input.match(/\b(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?\b/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : today.year;
    if (year < 100) year += 2000;

    // Day first, as people write it here. If the first number cannot be a day
    // but the second can, the writer clearly meant it the other way round.
    let day = first;
    let month = second;
    if (first > 12 && second <= 12) {
      day = first; month = second;
    } else if (second > 12 && first <= 12) {
      day = second; month = first;
      assumptions.push(`read ${numeric[0]} as month first, because ${second} cannot be a month`);
    } else if (first <= 12 && second <= 12) {
      // Both readings work. Take the local one and say so.
      onAmbiguous();
      assumptions.push(`read ${numeric[0]} as day/month - confirm if you meant month/day`);
    }

    if (!isRealDate({ year, month, day })) return null;
    const candidate = { year, month, day };
    if (!numeric[3] && isBefore(candidate, today)) {
      candidate.year += 1;
      assumptions.push(`no year given - took ${candidate.year}`);
    }
    return { day: candidate, assumptions: [] };
  }

  // 16 September, Sept 16, 16th of September 2026
  const monthNames = Object.keys(MONTHS).join('|');
  const dayFirst = input.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthNames})\\b(?:\\s+(\\d{4}))?`));
  const monthFirst = input.match(new RegExp(`\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`));
  const named = dayFirst || monthFirst;
  if (named) {
    const day = Number(dayFirst ? named[1] : named[2]);
    const month = MONTHS[dayFirst ? named[2] : named[1]];
    let year = named[3] ? Number(named[3]) : today.year;
    if (!isRealDate({ year, month, day })) return null;
    const candidate = { year, month, day };
    if (!named[3] && isBefore(candidate, today)) {
      candidate.year += 1;
      assumptions.push(`no year given - took ${candidate.year}`);
    }
    return { day: candidate, assumptions: [] };
  }

  if (/\bday after tomorrow\b/.test(input)) return { day: addDays(today, 2) };
  if (/\bday before yesterday\b/.test(input)) return { day: addDays(today, -2) };
  if (/\btomorrow\b/.test(input)) return { day: addDays(today, 1) };
  if (/\byesterday\b/.test(input)) return { day: addDays(today, -1) };
  if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(input)) {
    return { day: { year: today.year, month: today.month, day: today.day } };
  }

  const inDays = input.match(/\bin (\d+|a|an|two|three|four|five|six|seven) (day|days|week|weeks)\b/);
  if (inDays) {
    const count = inDays[1] === 'a' || inDays[1] === 'an' ? 1 : (NUMBER_WORDS[inDays[1]] ?? Number(inDays[1]));
    const days = inDays[2].startsWith('week') ? count * 7 : count;
    return { day: addDays(today, days) };
  }

  const weekend = input.match(/\b(this|next|coming)?\s?weekend\b/);
  if (weekend) {
    // Saturday is what people mean by "the weekend" for a shop appointment.
    const ahead = weekend[1] === 'next' ? 7 : 0;
    return { day: nextWeekday(today, 6, { forceNextWeek: false, extraDays: ahead }) };
  }

  const weekdayNames = Object.keys(WEEKDAYS).join('|');
  const weekday = input.match(new RegExp(`\\b(this|next|coming|on)?\\s?(${weekdayNames})\\b`));
  if (weekday) {
    const target = WEEKDAYS[weekday[2]];
    const qualifier = weekday[1];
    const day = nextWeekday(today, target, { forceNextWeek: qualifier === 'next' });
    // "Tuesday" said on a Sunday could mean either Tuesday. "Next Tuesday" said
    // on a Tuesday is the classic argument. Both get confirmed.
    const bare = !qualifier || qualifier === 'on';
    const result = { day };
    if (bare && daysBetween(today, day) <= 2) {
      result.ambiguous = true;
      result.assumptions = [`took ${dayName(target)} to mean ${formatDay(day)}`];
    }
    return result;
  }

  if (/\bnext week\b/.test(input)) {
    return { day: addDays(today, 7), assumptions: ['"next week" is vague - took the same weekday next week'], ambiguous: true };
  }

  return null;
}

function nextWeekday(today, target, { forceNextWeek = false, extraDays = 0 } = {}) {
  const current = weekdayOf(today);
  let delta = (target - current + 7) % 7;
  // "Next Tuesday" on a Tuesday means a week away, not right now.
  if (delta === 0) delta = 7;
  if (forceNextWeek && delta < 7) delta += 7;
  return addDays(today, delta + extraDays);
}

const asNumber = ({ year, month, day }) => year * 10000 + month * 100 + day;
const isBefore = (a, b) => asNumber(a) < asNumber(b);
const daysBetween = (a, b) =>
  Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
const dayName = (index) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index];
const formatDay = ({ year, month, day }) =>
  `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

// --- the time half ----------------------------------------------------------

const WORD_HOURS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve';

/**
 * Finds a time and says which characters it used, so the date pass can ignore
 * them. Without that, "10.30" is read as the 30th of October: a dotted pair
 * looks exactly like a short date, and the only thing telling them apart is
 * that one of them has already been claimed as a time.
 */
function matchTime(input, { openHour, closeHour }) {
  // half past four, quarter to five, ten past nine.
  //
  // Written out rather than built from a template string on purpose: inside a
  // JS template literal \b is a backspace character and \d is a plain "d", so
  // a regex assembled that way silently matches nothing. It cost an hour here.
  const spoken = input.match(
    /\b(half|quarter|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\s+(past|to)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2}|noon|midnight)\b/
  );
  if (spoken) {
    const offset = NUMBER_WORDS[spoken[1]] ?? Number(spoken[1]);
    const anchorWord = spoken[3];
    const anchor = anchorWord === 'noon' ? 12
      : anchorWord === 'midnight' ? 0
      : (NUMBER_WORDS[anchorWord] ?? Number(anchorWord));
    let minute = spoken[2] === 'past' ? offset : 60 - offset;
    let hour = spoken[2] === 'past' ? anchor : anchor - 1;
    if (minute === 60) { minute = 0; hour += 1; }
    if (hour < 0) hour += 24;
    const resolved = applyMeridiem(hour, input, { openHour, closeHour });
    return { hour: resolved.hour, minute, ambiguous: resolved.ambiguous, assumptions: resolved.assumptions, text: spoken[0] };
  }

  // 16:30, 4:30 pm, 10.30 - but never a piece of 16.09.2026, which is why the
  // guards on either side refuse a digit, dot, slash or dash as a neighbour.
  const withMinutes = input.match(/(?<![\d.\/-])(\d{1,2})[:.](\d{2})\s*(am|pm|a\.m\.|p\.m\.)?(?![\d.\/-])/);
  if (withMinutes) {
    return finish(Number(withMinutes[1]), Number(withMinutes[2]), withMinutes[3], withMinutes[0], input, { openHour, closeHour });
  }

  // 4pm, 4 p.m.
  const meridiem = input.match(/\b(\d{1,2})\s*(am|pm|a\.m\.|p\.m\.)\b/);
  if (meridiem) {
    return finish(Number(meridiem[1]), 0, meridiem[2], meridiem[0], input, { openHour, closeHour });
  }

  // 4 o'clock
  const oclock = input.match(/\b(\d{1,2})\s*o'clock\b/);
  if (oclock) {
    return finish(Number(oclock[1]), 0, null, oclock[0], input, { openHour, closeHour });
  }

  // "at 4" - the "at" is what makes a bare number a time rather than a
  // quantity. "book 4 people" must not become four o'clock.
  const bare = input.match(/\bat\s+(\d{1,2})\b(?![\s]*[:.\d\/-])/);
  if (bare) {
    return finish(Number(bare[1]), 0, null, bare[0], input, { openHour, closeHour });
  }

  for (const [name, [from, to]] of Object.entries(DAY_PARTS)) {
    if (new RegExp(`\\b${name}\\b`).test(input)) {
      return {
        hour: from, minute: 0, endHour: to, endMinute: 0, isRange: true,
        assumptions: [`"${name}" taken as ${from}:00 to ${to}:00`],
        text: name,
      };
    }
  }

  return null;
}

function finish(hourRaw, minute, meridiemRaw, text, input, { openHour, closeHour }) {
  if (hourRaw > 23 || minute > 59) return null;
  const meridiem = String(meridiemRaw || '').replace(/\./g, '');

  if (meridiem === 'am' || meridiem === 'pm') {
    let hour = hourRaw % 12;
    if (meridiem === 'pm') hour += 12;
    return { hour, minute, assumptions: [], text };
  }

  // A 24-hour clock needs no interpreting.
  if (hourRaw > 12) return { hour: hourRaw, minute, assumptions: [], text };

  const resolved = applyMeridiem(hourRaw, input, { openHour, closeHour });
  return { hour: resolved.hour, minute, ambiguous: resolved.ambiguous, assumptions: resolved.assumptions, text };
}

/**
 * "Four o'clock" at a shop open 9 to 6 means four in the afternoon. Reading it
 * as 4am would be defensible and useless. The reading is stated and confirmed
 * rather than assumed silently.
 */
function applyMeridiem(hour, input, { openHour, closeHour }) {
  if (/\bmorning\b/.test(input)) return { hour: hour === 12 ? 0 : hour, ambiguous: false, assumptions: [] };
  if (/\b(afternoon|evening|night|tonight)\b/.test(input)) {
    return { hour: hour < 12 ? hour + 12 : hour, ambiguous: false, assumptions: [] };
  }

  if (hour === 12) return { hour: 12, ambiguous: false, assumptions: [] };

  const asAm = hour;
  const asPm = hour + 12;
  const amOpen = asAm >= openHour && asAm < closeHour;
  const pmOpen = asPm >= openHour && asPm < closeHour;

  if (amOpen && !pmOpen) return { hour: asAm, ambiguous: false, assumptions: [] };
  if (pmOpen && !amOpen) {
    return { hour: asPm, ambiguous: false, assumptions: [`took ${hour} to mean ${asPm}:00, when you are open`] };
  }
  if (!amOpen && !pmOpen) {
    return { hour: asPm, ambiguous: true, assumptions: [`${hour} o'clock is outside opening hours either way`] };
  }
  // Open at both - genuinely cannot tell.
  return { hour: asPm, ambiguous: true, assumptions: [`${hour} could be ${asAm}:00 or ${asPm}:00`] };
}

/** "in an hour" needs the clock, not the calendar. */
function parseRelative(text, { now = new Date() } = {}) {
  const input = normalise(text);
  const match = input.match(/\bin (a|an|half an|\d+) (hour|hours|minute|minutes|min|mins)\b/);
  if (!match) return null;
  const count = match[1] === 'a' || match[1] === 'an' ? 1 : match[1] === 'half an' ? 0.5 : Number(match[1]);
  const minutes = match[2].startsWith('hour') ? count * 60 : count;
  return {
    kind: 'datetime',
    start: new Date(now.getTime() + minutes * 60000),
    end: null,
    allDay: false,
    ambiguous: false,
    needsConfirmation: false,
    assumptions: [`${minutes} minutes from now`],
    source: input,
  };
}

/** The one entry point: relative first, then everything else. */
function parse(text, options = {}) {
  return parseRelative(text, options) || parseDateTime(text, options);
}

/** How to read a parsed time back to a person, in their own timezone. */
function describe(parsed, timezone = 'UTC') {
  if (!parsed) return '';
  const local = instantToZoned(parsed.start, timezone);
  const date = `${String(local.day).padStart(2, '0')}/${String(local.month).padStart(2, '0')}/${local.year}`;
  if (parsed.allDay) return date;
  return `${date} at ${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
}

module.exports = { parse, parseDateTime, parseRelative, describe, WEEKDAYS, MONTHS, DAY_PARTS };
