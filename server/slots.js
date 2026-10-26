import { TIME_ZONE, addDaysYmd, zonedParts, zonedTimeToUtc, zonedToday } from "./time.js";

/** Monday–Friday windows, America/Chicago, from the owner brief. */
export const WINDOWS = [
  { start: 9 * 60, end: 11 * 60 },
  { start: 13 * 60, end: 15 * 60 },
];

export const STEP_MINUTES = 15;

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

export function generateSlots({
  now,
  days = 21,
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
  const boundedDays = Math.min(Math.max(Number(days) || 21, 1), 60);
  const today = zonedToday(now, timeZone);
  const noticeCutoff = now.getTime() + minNoticeHours * 60 * 60 * 1000;
  const slots = [];

  for (let offset = 0; offset < boundedDays; offset += 1) {
    const ymd = addDaysYmd(today.year, today.month, today.day, offset);
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
        const blocked = busy.some((item) => overlapsRange(
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
