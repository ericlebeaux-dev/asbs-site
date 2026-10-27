import assert from "node:assert/strict";
import test from "node:test";
import { calendarFromEnv } from "../server/calendar.js";

test("Google event creation does not email the customer", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method, body: options.body ? String(options.body) : "" });
    if (String(url).includes("oauth2.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 }) };
    }
    if (String(url).includes("/freeBusy")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ calendars: { primary: { busy: [] } } }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "evt_test", hangoutLink: "https://meet.google.com/abc-defg-hij" }),
    };
  };
  const calendar = calendarFromEnv({
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REFRESH_TOKEN: "refresh",
    GOOGLE_CALENDAR_ID: "primary",
  }, fetchImpl);

  await calendar.listBusy("2026-10-27T00:00:00.000Z", "2026-10-28T00:00:00.000Z");
  const created = await calendar.createEvent({
    id: "11111111-1111-1111-1111-111111111111",
    name: "Test Customer",
    organization: "Example Co",
    email: "test.customer@example.com",
    phone: "281-555-0100",
    type: "discovery_15",
    typeLabel: "Free 15-minute discovery call",
    serviceInterest: "contracting-readiness",
    notes: "Synthetic test",
    meetingMode: "meet",
    start: "2026-10-27T14:30:00.000Z",
    end: "2026-10-27T14:45:00.000Z",
  });
  await calendar.createEvent({
    id: "22222222-2222-2222-2222-222222222222",
    name: "Test Customer",
    organization: "Example Co",
    email: "test.customer@example.com",
    phone: "281-555-0100",
    type: "qualified_30",
    typeLabel: "Free 30-minute qualified consultation",
    serviceInterest: "supplies",
    meetingMode: "phone",
    start: "2026-10-27T18:00:00.000Z",
    end: "2026-10-27T18:30:00.000Z",
  });

  const creates = calls.filter((call) => call.method === "POST" && call.url.includes("/events"));
  assert.equal(creates.length, 2);
  assert.match(creates[0].url, /sendUpdates=none/);
  assert.match(creates[0].url, /conferenceDataVersion=1/);
  const meet = JSON.parse(creates[0].body);
  assert.equal(meet.attendees, undefined);
  assert.equal(meet.conferenceData.createRequest.requestId, "11111111-1111-1111-1111-111111111111");
  assert.equal(creates[0].body.includes("ya29.fake-token"), false);
  const phone = JSON.parse(creates[1].body);
  assert.equal(phone.conferenceData, undefined);
  assert.match(phone.location, /281-555-0100/);
  assert.equal(created.meetLink, "https://meet.google.com/abc-defg-hij");
});

test("calendar busy list keeps meetings and skips year-long or free events", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("oauth2.googleapis.com")) {
      return { ok: true, status: 200, json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 }) };
    }
    assert.match(String(url), /\/events\?/);
    assert.match(String(url), /singleEvents=true/);
    assert.match(String(url), /eventTypes=fromGmail/);
    assert.equal(String(url).includes("summary"), false);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            status: "confirmed",
            start: { dateTime: "2026-01-21T06:41:43Z" },
            end: { dateTime: "2026-12-31T21:41:00Z" },
          },
          {
            status: "confirmed",
            transparency: "transparent",
            start: { dateTime: "2026-10-28T14:00:00Z" },
            end: { dateTime: "2026-10-28T14:30:00Z" },
          },
          {
            status: "confirmed",
            start: { dateTime: "2026-10-28T15:00:00Z" },
            end: { dateTime: "2026-10-28T16:00:00Z" },
          },
          {
            status: "confirmed",
            eventType: "fromGmail",
            transparency: "transparent",
            start: { dateTime: "2026-11-02T15:00:00Z" },
            end: { dateTime: "2026-11-02T20:00:00Z" },
          },
          {
            status: "confirmed",
            fromGmail: true,
            transparency: "transparent",
            start: { dateTime: "2026-11-04T15:00:00Z" },
            end: { dateTime: "2026-11-04T16:00:00Z" },
          },
          {
            status: "cancelled",
            eventType: "fromGmail",
            start: { dateTime: "2026-11-04T19:00:00Z" },
            end: { dateTime: "2026-11-04T20:00:00Z" },
          },
          {
            status: "confirmed",
            eventType: "workingLocation",
            start: { dateTime: "2026-10-28T17:00:00Z" },
            end: { dateTime: "2026-10-28T18:00:00Z" },
          },
          {
            status: "confirmed",
            eventType: "birthday",
            start: { date: "2026-10-30" },
            end: { date: "2026-10-31" },
          },
          {
            status: "confirmed",
            eventType: "fromGmail",
            transparency: "transparent",
            start: { dateTime: "2026-01-01T00:00:00Z" },
            end: { dateTime: "2026-12-31T00:00:00Z" },
          },
          {
            status: "cancelled",
            start: { dateTime: "2026-10-28T18:00:00Z" },
            end: { dateTime: "2026-10-28T18:30:00Z" },
          },
        ],
      }),
    };
  };
  const calendar = calendarFromEnv({
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REFRESH_TOKEN: "refresh",
  }, fetchImpl);
  const busy = await calendar.listBusy("2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  assert.deepEqual(busy.map((item) => item.start.toISOString()), [
    "2026-10-28T15:00:00.000Z",
    "2026-11-02T15:00:00.000Z",
    "2026-11-04T15:00:00.000Z",
  ]);
});

test("calendar client reports when credentials are missing", () => {
  const calendar = calendarFromEnv({});
  assert.equal(calendar.configured, false);
  assert.match(calendar.reason, /not configured/i);
});
