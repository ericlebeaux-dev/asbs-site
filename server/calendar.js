import { TIME_ZONE } from "./time.js";

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
      const response = await fetchImpl("https://www.googleapis.com/calendar/v3/freeBusy", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw calendarError("Google Calendar availability could not be checked. No appointment was booked.");
      }
      const busy = payload.calendars?.[calendarId]?.busy || [];
      if (payload.calendars?.[calendarId]?.errors?.length) {
        throw calendarError("Google Calendar did not return a reliable busy list. No appointment was booked.");
      }
      return busy.map((item) => ({ start: new Date(item.start), end: new Date(item.end) }));
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
