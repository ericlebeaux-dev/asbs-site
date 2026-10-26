import assert from "node:assert/strict";
import test from "node:test";
import { generateSlots } from "../server/slots.js";
import { zonedParts, zonedTimeToUtc } from "../server/time.js";

test("Chicago clock converts correctly across daylight saving time", () => {
  assert.equal(zonedTimeToUtc(2026, 10, 27, 9, 0).toISOString(), "2026-10-27T14:00:00.000Z");
  assert.equal(zonedTimeToUtc(2026, 11, 3, 9, 0).toISOString(), "2026-11-03T15:00:00.000Z");
  assert.equal(zonedTimeToUtc(2026, 3, 9, 9, 0).toISOString(), "2026-03-09T14:00:00.000Z");
  assert.equal(zonedParts(zonedTimeToUtc(2026, 11, 3, 9, 0)).hour, 9);
  assert.equal(zonedParts(zonedTimeToUtc(2026, 10, 27, 13, 0)).hour, 13);
});

test("slots stay inside weekday consultation windows", () => {
  const now = new Date("2026-10-26T12:00:00.000Z");
  const slots = generateSlots({ now, days: 8, typeId: "discovery_15", minNoticeHours: 24, bufferMinutes: 15, busy: [] });
  assert.ok(slots.length > 0);
  for (const slot of slots) {
    const start = zonedParts(new Date(slot.start));
    const end = zonedParts(new Date(slot.end));
    assert.equal(["Sat", "Sun"].includes(start.weekday), false);
    const startMin = start.hour * 60 + start.minute;
    const endMin = end.hour * 60 + end.minute;
    const inMorning = startMin >= 9 * 60 && endMin <= 11 * 60;
    const inAfternoon = startMin >= 13 * 60 && endMin <= 15 * 60;
    assert.equal(inMorning || inAfternoon, true);
  }
});

test("a 45-minute consultation cannot run past the window", () => {
  const slots = generateSlots({
    now: new Date("2026-10-26T12:00:00.000Z"),
    days: 3,
    typeId: "onboarding_45",
    minNoticeHours: 24,
    bufferMinutes: 0,
    busy: [],
  });
  const morning = slots.filter((slot) => slot.start.startsWith("2026-10-27T14") || slot.start.startsWith("2026-10-27T15"));
  assert.equal(morning.at(-1).start, "2026-10-27T15:15:00.000Z");
  assert.equal(morning.some((slot) => slot.start === "2026-10-27T15:30:00.000Z"), false);
});

test("Sunday has no consultation slots", () => {
  const slots = generateSlots({
    now: new Date("2026-10-25T15:00:00.000Z"),
    days: 1,
    typeId: "discovery_15",
    minNoticeHours: 0,
    bufferMinutes: 0,
    busy: [],
  });
  assert.equal(slots.length, 0);
});
