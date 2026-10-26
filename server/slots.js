import { TIME_ZONE, addDaysYmd, zonedParts, zonedTimeToUtc, zonedToday } from "./time.js";

/** Monday–Friday windows, America/Chicago, from the owner brief. */
export const WINDOWS = [
  { start: 9 * 60, end: 11 * 60 },
  { start: 13 * 60, end: 15 * 60 },
];

export const STEP_MINUTES = 15;

/** Last bookable date is this many days after today in America/Chicago. */
export const HORIZON_DAYS = 365;

/**
 * Google free/busy merges overlapping events into one span. A year-long item
 * therefore hides every real opening. Busy intervals longer than this are
 * reminders, not meetings, and do not block a consultation.
 */
export const MAX_BLOCKING_BUSY_MS = 14 * 24 * 60 * 60 * 1000;

export const CONSULTATION_TYPES = {
  discovery_15: {
    id: "discovery_15",
    label: "Free 15-minute discovery call",
    minutes: 15,
    priceCents: 0,
  },
  qualified_30: {
    id: "qualified_30",
    label: "Free 30-minute qualified consultation",
    minutes: 30,
    priceCents: 0,
  },
  onboarding_45: {
    id: "onboarding_45",
    label: "Free 45-minute onboarding consultation",
    minutes: 45,
    priceCents: 0,
  },
  quick_bid_preview_30: {
    id: "quick_bid_preview_30",
    label: "Free pre-purchase consultation for Quick Bid Review",
    minutes: 30,
    priceCents: 0,
    packageId: "quick-bid-review",
    durationNote: "30 minutes is assumed until the owner confirms the length. The Quick Bid Review fee is not charged for this call.",
  },
};

export function consultationType(id) {
  return CONSULTATION_TYPES[id] || null;
}

export function overlapsRange(startMs, endMs, otherStartMs, otherEndMs, bufferMinutes) {
  const bufferMs = bufferMinutes * 60 * 1000;
  return startMs < otherEndMs + bufferMs && endMs > otherStartMs - bufferMs;
}

function ymdNumber(value) {
  return value.year * 10000 + value.month * 100 + value.day;
}

export function blockingBusy(busy, maxMs = MAX_BLOCKING_BUSY_MS) {
  return busy.filter((item) => {
    const span = item.end.getTime() - item.start.getTime();
    return Number.isFinite(span) && span > 0 && span <= maxMs;
  });
}

export function generateSlots({
  now,
  days,
  month,
  day,
  typeId,
  busy = [],
  minNoticeHours = 24,
  bufferMinutes = 15,
  timeZone = TIME_ZONE,
}) {
  const type = consultationType(typeId);
  if (!type) {
    const error = new Error("Unknown consultation type.");
    error.status = 400;
    throw error;
  }
  const today = zonedToday(now, timeZone);
  const horizonLast = addDaysYmd(today.year, today.month, today.day, HORIZON_DAYS);
  let cursor;
  let endExclusive;
  if (day) {
    cursor = { year: day.year, month: day.month, day: day.day };
    endExclusive = addDaysYmd(day.year, day.month, day.day, 1);
  } else if (month) {
    cursor = { year: month.year, month: month.month, day: 1 };
    endExclusive = month.month === 12
      ? { year: month.year + 1, month: 1, day: 1 }
      : { year: month.year, month: month.month + 1, day: 1 };
  } else {
    const boundedDays = Math.min(Math.max(Number(days) || (HORIZON_DAYS + 1), 1), HORIZON_DAYS + 1);
    cursor = { year: today.year, month: today.month, day: today.day };
    endExclusive = addDaysYmd(today.year, today.month, today.day, boundedDays);
  }
  const noticeCutoff = now.getTime() + minNoticeHours * 60 * 60 * 1000;
  const intervals = blockingBusy(busy);
  const slots = [];

  while (ymdNumber(cursor) < ymdNumber(endExclusive)) {
    const ymd = cursor;
    cursor = addDaysYmd(ymd.year, ymd.month, ymd.day, 1);
    if (ymdNumber(ymd) < ymdNumber(today) || ymdNumber(ymd) > ymdNumber(horizonLast)) continue;
    const noon = zonedTimeToUtc(ymd.year, ymd.month, ymd.day, 12, 0, timeZone);
    const parts = zonedParts(noon, timeZone);
    if (parts.weekday === "Sat" || parts.weekday === "Sun") continue;

    for (const window of WINDOWS) {
      for (let minuteOfDay = window.start; minuteOfDay + type.minutes <= window.end; minuteOfDay += STEP_MINUTES) {
        const start = zonedTimeToUtc(
          ymd.year,
          ymd.month,
          ymd.day,
          Math.floor(minuteOfDay / 60),
          minuteOfDay % 60,
          timeZone,
        );
        const end = new Date(start.getTime() + type.minutes * 60 * 1000);
        if (start.getTime() < noticeCutoff) continue;
        const blocked = intervals.some((item) => overlapsRange(
          start.getTime(),
          end.getTime(),
          item.start.getTime(),
          item.end.getTime(),
          bufferMinutes,
        ));
        if (blocked) continue;
        slots.push({
          start: start.toISOString(),
          end: end.toISOString(),
          type: type.id,
          minutes: type.minutes,
        });
      }
    }
  }

  return slots;
}
