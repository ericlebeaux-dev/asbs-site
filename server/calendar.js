import { MAX_BLOCKING_BUSY_MS } from "./slots.js";
import { TIME_ZONE, zonedTimeToUtc } from "./time.js";

export function calendarFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const clientId = env.GOOGLE_CLIENT_ID || "";
  const clientSecret = env.GOOGLE_CLIENT_SECRET || "";
  const refreshToken = env.GOOGLE_REFRESH_TOKEN || "";
  const calendarId = env.GOOGLE_CALENDAR_ID || "primary";
  const configured = Boolean(clientId && clientSecret && refreshToken);
  let cached = null;

  async function accessToken() {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });
    const response = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw calendarError("Google Calendar authorization failed. No appointment was booked.");
    }
    cached = {
      token: payload.access_token,
      expiresAt: Date.now() + (Number(payload.expires_in) || 3000) * 1000,
    };
    return cached.token;
  }

  function notConfigured() {
    const error = new Error("Google Calendar is not connected on this server.");
    error.status = 503;
    return error;
  }

  return {
    configured,
    reason: configured ? null : "Google Calendar OAuth credentials are not configured on the server.",
    calendarId: configured ? calendarId : null,
    async listBusy(timeMin, timeMax) {
      if (!configured) throw notConfigured();
      const token = await accessToken();
      const busy = [];
      let pageToken = "";
      for (let page = 0; page < 40; page += 1) {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
        url.searchParams.set("timeMin", timeMin);
        url.searchParams.set("timeMax", timeMax);
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("maxResults", "250");
        url.searchParams.set("fields", "items(status,transparency,start,end,eventType),nextPageToken");
        for (const eventType of ["default", "fromGmail", "outOfOffice", "focusTime"]) {
          url.searchParams.append("eventTypes", eventType);
        }
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw calendarError("Google Calendar availability could not be checked. No appointment was booked.");
        }
        for (const item of payload.items || []) {
          const interval = busyInterval(item);
          if (interval) busy.push(interval);
        }
        pageToken = payload.nextPageToken || "";
        if (!pageToken) return busy;
      }
      throw calendarError("Google Calendar availability could not be checked. No appointment was booked.");
    },
    async createEvent(booking) {
      if (!configured) throw notConfigured();
      const token = await accessToken();
      const event = eventBody(booking);
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none${booking.meetingMode === "meet" ? "&conferenceDataVersion=1" : ""}`;
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.id) {
        throw calendarError("The appointment could not be added to Google Calendar. Nothing was confirmed.");
      }
      return { eventId: payload.id, meetLink: payload.hangoutLink || null };
    },
    async updateEvent(eventId, booking) {
      if (!configured) throw notConfigured();
      const token = await accessToken();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none${booking.meetingMode === "meet" ? "&conferenceDataVersion=1" : ""}`;
      const response = await fetchImpl(url, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(eventBody(booking)),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw calendarError("The calendar event could not be moved. The original appointment is still held.");
      return { eventId: payload.id || eventId, meetLink: payload.hangoutLink || null };
    },
    async deleteEvent(eventId) {
      if (!configured) throw notConfigured();
      const token = await accessToken();
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;
      const response = await fetchImpl(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok && response.status !== 404) {
        throw calendarError("The calendar event could not be removed. The appointment is still held.");
      }
    },
  };
}

function isGmailEvent(item) {
  // Gmail events use eventType "fromGmail". The Events resource has no fromGmail
  // field; asking for one makes events.list fail. A payload that still sets the
  // flag is treated as busy.
  return item.eventType === "fromGmail" || Boolean(item.fromGmail);
}

function busyInterval(item) {
  if (!item || item.status === "cancelled") return null;
  if (item.eventType === "workingLocation" || item.eventType === "birthday") return null;
  if (item.transparency === "transparent" && !isGmailEvent(item)) return null;
  let start;
  let end;
  if (item.start?.dateTime && item.end?.dateTime) {
    start = new Date(item.start.dateTime);
    end = new Date(item.end.dateTime);
  } else if (item.start?.date && item.end?.date) {
    const [ys, ms, ds] = item.start.date.split("-").map(Number);
    const [ye, me, de] = item.end.date.split("-").map(Number);
    start = zonedTimeToUtc(ys, ms, ds, 0, 0);
    end = zonedTimeToUtc(ye, me, de, 0, 0);
  } else {
    return null;
  }
  const span = end.getTime() - start.getTime();
  if (!Number.isFinite(span) || span <= 0 || span > MAX_BLOCKING_BUSY_MS) return null;
  return { start, end };
}

function calendarError(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

function eventBody(booking) {
  const lines = [
    "Free ASBS consultation. This event is not a paid engagement.",
    `Customer: ${booking.name}`,
    `Business: ${booking.organization}`,
    `Email: ${booking.email}`,
    `Phone: ${booking.phone}`,
    `Consultation: ${booking.typeLabel || booking.type}`,
    `Service interest: ${booking.serviceInterest}`,
    booking.notes ? `Notes: ${booking.notes}` : "",
    "Created by the ASBS staging scheduling system. Customer email invitations are not sent.",
  ].filter(Boolean);
  const event = {
    summary: `ASBS free consultation — ${booking.name}`,
    description: lines.join("\n"),
    start: { dateTime: booking.start, timeZone: TIME_ZONE },
    end: { dateTime: booking.end, timeZone: TIME_ZONE },
    location: booking.meetingMode === "phone" ? `Phone: ${booking.phone}` : "Google Meet",
  };
  if (booking.meetingMode === "meet") {
    event.conferenceData = {
      createRequest: {
        requestId: booking.id,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return event;
}
