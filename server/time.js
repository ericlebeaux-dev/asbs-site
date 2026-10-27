export const TIME_ZONE = "America/Chicago";

export function getTimeZoneOffsetMs(utcDate, timeZone = TIME_ZONE) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcDate).map((part) => [part.type, part.value]));
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - utcDate.getTime();
}

/** Convert a civil clock time in `timeZone` to a UTC Date. Handles DST. */
export function zonedTimeToUtc(year, month, day, hour, minute, timeZone = TIME_ZONE) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset1 = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  let utc = utcGuess - offset1;
  const offset2 = getTimeZoneOffsetMs(new Date(utc), timeZone);
  if (offset2 !== offset1) utc = utcGuess - offset2;
  return new Date(utc);
}

export function zonedParts(date, timeZone = TIME_ZONE) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === "24" ? 0 : Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

export function addDaysYmd(year, month, day, days) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function zonedToday(now, timeZone = TIME_ZONE) {
  const parts = zonedParts(now, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

export function formatZoned(date, timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
