/**
 * Wall-clock time in a named timezone, without a date library.
 *
 * Everything the receptionist parses is said in the shop's local time - "four
 * o'clock" means four o'clock in Chennai, not in UTC - but what gets stored is
 * an instant. These two functions are the bridge, and they are separated out
 * because getting them subtly wrong shifts every appointment by hours and the
 * mistake only shows up at a clock change.
 */

/** How far ahead of UTC a zone is at a given instant, in milliseconds. */
function offsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
  // Intl renders midnight as hour 24 in some locales/zones.
  const hour = Number(parts.hour) % 24;
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    hour, Number(parts.minute), Number(parts.second)
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which a zone's clock reads this wall time.
 *
 * Two passes, not one. The offset has to be looked up at some instant, and the
 * only instant available to start with is the wrong one - so the first pass
 * gets close and the second corrects it across a clock change. India has no
 * daylight saving, but this code should not be the reason a shop elsewhere
 * books everything an hour out twice a year.
 */
function zonedToInstant({ year, month, day, hour = 0, minute = 0 }, timeZone) {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let instant = new Date(naive - offsetMs(new Date(naive), timeZone));
  instant = new Date(naive - offsetMs(instant, timeZone));
  return instant;
}

/** What a zone's clock reads at an instant. */
function instantToZoned(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'short',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value])
  );
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays[parts.weekday] ?? 0,
  };
}

/** Adds whole days to a date, staying on calendar days rather than 24-hour jumps. */
function addDays({ year, month, day }, days) {
  const moved = new Date(Date.UTC(year, month - 1, day));
  moved.setUTCDate(moved.getUTCDate() + days);
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** Day of week (0 = Sunday) for a calendar date. */
function weekdayOf({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whether a calendar date exists - 31 February does not. */
function isRealDate({ year, month, day }) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const made = new Date(Date.UTC(year, month - 1, day));
  return made.getUTCFullYear() === year && made.getUTCMonth() === month - 1 && made.getUTCDate() === day;
}

module.exports = { offsetMs, zonedToInstant, instantToZoned, addDays, weekdayOf, isRealDate };
