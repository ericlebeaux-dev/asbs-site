import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { clearCookie, passwordsMatch, readCookie, sessionCookie, signSession, verifySession } from "./auth.js";
import { calendarFromEnv } from "./calendar.js";
import { PACKAGES, PRICING_STATUS } from "./packages.js";
import { consultationType, generateSlots } from "./slots.js";
import { createStore } from "./store.js";
import { TIME_ZONE, formatZoned } from "./time.js";
import {
  httpError,
  validateBooking,
  validateDocument,
  validateInquiry,
  validateIntake,
  validateVendor,
} from "./validate.js";

const MAX_BODY = 6 * 1024 * 1024;

export function loadConfig(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  const password = env.ASBS_DASHBOARD_PASSWORD || "";
  let sessionSecret = env.ASBS_SESSION_SECRET || "";
  let sessionSecretEphemeral = false;
  if (password && !sessionSecret) {
    sessionSecret = crypto.randomBytes(32).toString("hex");
    sessionSecretEphemeral = true;
  }
  return {
    env,
    dataDir: options.dataDir || env.ASBS_DATA_DIR || path.join(process.cwd(), "data"),
    rootDir: options.rootDir || process.cwd(),
    host: options.host || env.ASBS_HOST || "127.0.0.1",
    port: Number(options.port || env.ASBS_PORT || 8787),
    minNoticeHours: numberOr(env.ASBS_MIN_NOTICE_HOURS, 24),
    bufferMinutes: numberOr(env.ASBS_BUFFER_MINUTES, 15),
    slotDays: numberOr(env.ASBS_SLOT_DAYS, 21),
    environment: env.ASBS_ENV || "staging",
    dashboardPassword: password,
    sessionSecret,
    sessionSecretEphemeral,
    secureCookie: env.ASBS_COOKIE_SECURE === "1",
    now: options.now || (() => new Date()),
  };
}

export function createApp(options = {}) {
  const config = loadConfig(options);
  const store = options.store || createStore(config.dataDir);
  const calendar = options.calendar || calendarFromEnv(config.env);
  const limits = new Map();
  const server = http.createServer((req, res) => {
    handle(req, res, { config, store, calendar, limits }).catch((error) => {
      sendJson(res, error.status || 500, {
        message: error.status ? error.message : "Something went wrong. Nothing was saved.",
        fields: error.fields || undefined,
      });
    });
  });
  return { server, config, store, calendar };
}

async function handle(req, res, ctx) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  setSecurityHeaders(res);
  if (url.pathname.startsWith("/api/")) {
    await routeApi(req, res, url, ctx);
    return;
  }
  serveStatic(req, res, url, ctx.config.rootDir);
}

async function routeApi(req, res, url, ctx) {
  const { config, store, calendar } = ctx;
  if (!allowRate(ctx, req, `${req.method} ${url.pathname}`)) {
    sendJson(res, 429, { message: "Too many requests. Wait a few minutes and try again." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, health(config, calendar));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/packages") {
    sendJson(res, 200, {
      pricingStatus: PRICING_STATUS,
      purchasable: false,
      currency: "USD",
      packages: PACKAGES,
    });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/slots") {
    const type = url.searchParams.get("type") || "";
    const days = Number(url.searchParams.get("days") || config.slotDays);
    const slots = await slotsFor(config, store, calendar, type, days);
    sendJson(res, 200, {
      timezone: TIME_ZONE,
      type,
      calendarConnected: calendar.configured,
      slots,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/intake") {
    const body = await readJson(req);
    const fields = validateIntake(body);
    const followUp = new Date(config.now().getTime() + 24 * 60 * 60 * 1000).toISOString();
    const saved = await store.createCustomerLead(fields, { stage: "new_lead", followUp });
    sendJson(res, saved.duplicate ? 200 : 201, {
      leadId: saved.lead.id,
      duplicate: saved.duplicate,
      stage: saved.lead.stage,
      message: saved.duplicate
        ? "We already had a record for this email, so we updated it instead of creating a second one."
        : "Your intake was received. It does not hire ASBS or authorize any submission on your behalf.",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/vendors") {
    const body = await readJson(req);
    const document = validateDocument(body.document);
    const fields = validateVendor(body);
    const saved = await store.createVendorLead(fields);
    let documentId = null;
    if (document) {
      const stored = await store.saveDocument({ ...document, leadId: saved.lead.id }, document.bytes);
      documentId = stored.id;
    }
    sendJson(res, saved.duplicate ? 200 : 201, {
      leadId: saved.lead.id,
      duplicate: saved.duplicate,
      documentId,
      message: "Your vendor registration was saved privately. It does not guarantee teaming, subcontracting, or a contract award.",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/inquiries") {
    const body = await readJson(req);
    const fields = validateInquiry(body);
    const saved = await store.createCustomerLead(
      { ...fields, serviceInterest: fields.serviceInterest, notes: fields.message },
      { stage: "new_lead", followUp: new Date(config.now().getTime() + 24 * 60 * 60 * 1000).toISOString() },
    );
    await store.updateLead(saved.lead.id, {}, `Website inquiry (${fields.topic}): ${fields.message}`);
    sendJson(res, 201, {
      leadId: saved.lead.id,
      duplicate: saved.duplicate,
      message: "Your message was received. ASBS aims to reply within one to two business days. This form does not send a separate confirmation email.",
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const body = await readJson(req);
    const fields = validateBooking(body);
    const result = await book(config, store, calendar, fields);
    sendJson(res, 201, result);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/bookings/lookup") {
    const body = await readJson(req);
    sendJson(res, 200, customerView(requireBooking(store, body.id, body.token)));
    return;
  }
  const cancel = url.pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})\/cancel$/);
  if (req.method === "POST" && cancel) {
    const body = await readJson(req);
    sendJson(res, 200, await cancelBooking(config, store, calendar, cancel[1], body.token));
    return;
  }
  const move = url.pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})\/reschedule$/);
  if (req.method === "POST" && move) {
    const body = await readJson(req);
    sendJson(res, 200, await reschedule(config, store, calendar, move[1], body));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/events") {
    const body = await readJson(req);
    const name = ["page_view", "cta_click", "form_error"].includes(body.name) ? body.name : "";
    if (!name) {
      sendJson(res, 400, { message: "Unknown event." });
      return;
    }
    await store.addEvent({
      id: crypto.randomUUID(),
      name,
      path: String(body.path || "").slice(0, 160),
      viewport: ["mobile", "tablet", "desktop"].includes(body.viewport) ? body.viewport : "unknown",
      meta: sanitizeMeta(body.meta),
      at: config.now().toISOString(),
    });
    sendJson(res, 204, {});
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    if (!config.dashboardPassword) {
      sendJson(res, 503, { message: "The private dashboard is not configured yet." });
      return;
    }
    if (!passwordsMatch(body.password || "", config.dashboardPassword)) {
      sendJson(res, 401, { message: "That password was not accepted." });
      return;
    }
    const token = signSession(config.sessionSecret);
    res.setHeader("Set-Cookie", sessionCookie(token, { secure: config.secureCookie }));
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    res.setHeader("Set-Cookie", clearCookie());
    sendJson(res, 200, { ok: true });
    return;
  }

  if (!authorized(req, config)) {
    sendJson(res, 401, { message: "Sign in to the private dashboard." });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    sendJson(res, 200, dashboard(config, store, calendar));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/reports/weekly") {
    sendJson(res, 200, weekly(config, store, calendar));
    return;
  }
  const leadPatch = url.pathname.match(/^\/api\/leads\/([0-9a-f-]{36})$/);
  if (req.method === "PATCH" && leadPatch) {
    const body = await readJson(req);
    const updated = await store.updateLead(leadPatch[1], {
      stage: body.stage,
      followUpAt: body.followUpAt,
      estimatedValueCents: body.estimatedValueCents,
      packageId: body.packageId,
      payment: body.payment,
    }, typeof body.note === "string" ? body.note.slice(0, 2000) : "");
    if (!updated) {
      sendJson(res, 404, { message: "That record was not found." });
      return;
    }
    sendJson(res, 200, { lead: updated });
    return;
  }
  const download = url.pathname.match(/^\/api\/documents\/([0-9a-f-]{36})$/);
  if (req.method === "GET" && download) {
    const found = store.getDocument(download[1]);
    if (!found) {
      sendJson(res, 404, { message: "That document was not found." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": found.record.mimeType,
      "Content-Disposition": `attachment; filename="${found.record.filename.replace(/["\r\n]/g, "")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(found.bytes);
    return;
  }
  sendJson(res, 404, { message: "That address was not found." });
}

function health(config, calendar) {
  return {
    ok: true,
    environment: config.environment,
    timezone: TIME_ZONE,
    time: config.now().toISOString(),
    calendar: {
      connected: calendar.configured === true,
      reason: calendar.configured ? null : calendar.reason,
    },
    dashboard: { configured: Boolean(config.dashboardPassword) },
    payments: {
      livePackageCheckout: false,
      pricingStatus: PRICING_STATUS,
    },
    consultationWindows: ["09:00-11:00 America/Chicago", "13:00-15:00 America/Chicago"],
    minimumNoticeHours: config.minNoticeHours,
    bufferMinutes: config.bufferMinutes,
  };
}

async function slotsFor(config, store, calendar, type, days) {
  if (!consultationType(type)) throw httpError(400, "Choose a consultation type.");
  const now = config.now();
  const horizonDays = Math.min(Math.max(days || config.slotDays, 1), 60);
  const busy = store.activeBusy();
  if (calendar.configured) {
    const end = new Date(now.getTime() + (horizonDays + 1) * 24 * 60 * 60 * 1000);
    try {
      busy.push(...await calendar.listBusy(now.toISOString(), end.toISOString()));
    } catch (error) {
      throw httpError(503, error.message || "Calendar availability could not be checked. No times are being offered.");
    }
  }
  return generateSlots({
    now,
    days: horizonDays,
    typeId: type,
    busy,
    minNoticeHours: config.minNoticeHours,
    bufferMinutes: config.bufferMinutes,
  });
}

async function book(config, store, calendar, fields) {
  const type = consultationType(fields.type);
  return store.transact(async ({ read, write, tokenHash }) => {
    const now = config.now();
    const slots = await offeredInside(config, calendar, read, fields.type, now);
    const wanted = Date.parse(fields.start);
    const slot = slots.find((item) => Date.parse(item.start) === wanted);
    if (!slot) throw httpError(409, "That time is no longer available. Choose another open slot.");
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString("base64url");
    let calendarEventId = null;
    let meetLink = null;
    let calendarConnected = false;
    if (calendar.configured) {
      calendarConnected = true;
      try {
        const created = await calendar.createEvent({
          ...fields,
          id,
          start: slot.start,
          end: slot.end,
          typeLabel: type.label,
        });
        calendarEventId = created.eventId;
        meetLink = fields.meetingMode === "meet" ? created.meetLink : null;
      } catch (error) {
        throw httpError(503, error.message || "The appointment could not be added to Google Calendar. Nothing was confirmed.");
      }
    }
    const data = read();
    const stamp = now.toISOString();
    let lead = data.leads.find((item) => item.role === "customer" && item.email === fields.email);
    let duplicate = true;
    if (!lead) {
      duplicate = false;
      lead = {
        id: crypto.randomUUID(),
        role: "customer",
        stage: "consultation_scheduled",
        name: fields.name,
        organization: fields.organization,
        email: fields.email,
        phone: fields.phone,
        serviceInterest: fields.serviceInterest,
        packageId: fields.packageId || type.packageId || "",
        leadSource: fields.leadSource,
        estimatedValueCents: null,
        paymentStatus: "not_collected",
        amountVerified: false,
        followUpAt: slot.start,
        intake: fields,
        notes: [],
        submissions: [],
        createdAt: stamp,
        updatedAt: stamp,
      };
      data.leads.push(lead);
    } else {
      lead.name = fields.name;
      lead.organization = fields.organization;
      lead.phone = fields.phone;
      lead.serviceInterest = fields.serviceInterest;
      lead.packageId = fields.packageId || lead.packageId || type.packageId || "";
      lead.stage = "consultation_scheduled";
      lead.followUpAt = slot.start;
      lead.updatedAt = stamp;
      lead.intake = { ...(lead.intake || {}), ...fields };
    }
    lead.notes = lead.notes || [];
    lead.notes.push({
      id: crypto.randomUUID(),
      at: stamp,
      author: "system",
      text: `Free consultation reserved for ${slot.start}. No payment was collected.`,
    });
    lead.submissions = lead.submissions || [];
    lead.submissions.push({ at: stamp, serviceInterest: fields.serviceInterest });
    lead.consultation = {
      bookingId: id,
      type: type.id,
      start: slot.start,
      end: slot.end,
      meetingMode: fields.meetingMode,
      calendarEventId,
    };
    const booking = {
      id,
      leadId: lead.id,
      tokenHash: tokenHash(token),
      status: "scheduled",
      type: type.id,
      typeLabel: type.label,
      start: slot.start,
      end: slot.end,
      meetingMode: fields.meetingMode,
      meetLink,
      calendarEventId,
      name: fields.name,
      organization: fields.organization,
      email: fields.email,
      phone: fields.phone,
      serviceInterest: fields.serviceInterest,
      createdAt: stamp,
      updatedAt: stamp,
    };
    data.bookings.push(booking);
    write(data);
    return {
      bookingId: id,
      cancelToken: token,
      duplicate,
      leadId: lead.id,
      when: formatZoned(new Date(slot.start)),
      start: slot.start,
      end: slot.end,
      type: type.id,
      typeLabel: type.label,
      meetingMode: fields.meetingMode,
      meetLink,
      calendar: {
        connected: calendarConnected,
        eventCreated: Boolean(calendarEventId),
        message: calendarConnected
          ? "The appointment was added to the connected Google Calendar. No email invitation was sent."
          : "Saved in the ASBS scheduling system. It is not on the owner's Google Calendar yet because that connection is not authorized.",
      },
      instructions: "Keep the cancellation code. Use it on this page to cancel or choose a different open time. ASBS does not email a confirmation unless the owner later approves email notices. To reach a person, call (281) 954-5167.",
    };
  });
}

async function offeredInside(config, calendar, read, type, now, ignoreBookingId = "") {
  const data = read();
  const busy = data.bookings
    .filter((booking) => booking.status === "scheduled" && booking.id !== ignoreBookingId)
    .map((booking) => ({ start: new Date(booking.start), end: new Date(booking.end) }));
  if (calendar.configured) {
    const end = new Date(now.getTime() + (config.slotDays + 1) * 24 * 60 * 60 * 1000);
    try {
      busy.push(...await calendar.listBusy(now.toISOString(), end.toISOString()));
    } catch (error) {
      throw httpError(503, error.message || "Calendar availability could not be checked. Nothing was changed.");
    }
  }
  return generateSlots({
    now,
    days: config.slotDays,
    typeId: type,
    busy,
    minNoticeHours: config.minNoticeHours,
    bufferMinutes: config.bufferMinutes,
  });
}

function requireBooking(store, id, token) {
  const booking = store.findBooking(id);
  if (!booking || !store.tokenMatches(booking, token)) {
    throw httpError(403, "That confirmation code was not accepted.");
  }
  return booking;
}

function customerView(booking) {
  return {
    id: booking.id,
    status: booking.status,
    type: booking.type,
    typeLabel: booking.typeLabel,
    start: booking.start,
    end: booking.end,
    when: formatZoned(new Date(booking.start)),
    meetingMode: booking.meetingMode,
    meetLink: booking.meetLink || null,
    name: booking.name,
    calendar: {
      connected: Boolean(booking.calendarEventId),
      eventCreated: Boolean(booking.calendarEventId),
    },
    instructions: "To cancel or reschedule, use the confirmation code from this booking. Call (281) 954-5167 if you lose it. No email reminder is sent.",
  };
}

async function cancelBooking(config, store, calendar, id, token) {
  const booking = requireBooking(store, id, token);
  if (booking.status !== "scheduled") throw httpError(409, "That appointment is already cancelled.");
  if (booking.calendarEventId) await calendar.deleteEvent(booking.calendarEventId);
  await store.updateBooking(id, { status: "cancelled", meetLink: null });
  return { ok: true, message: "The appointment was cancelled and the time is open again." };
}

async function reschedule(config, store, calendar, id, body) {
  const booking = requireBooking(store, id, body.token);
  if (booking.status !== "scheduled") throw httpError(409, "That appointment is not active.");
  const wanted = Date.parse(body.start);
  if (!Number.isFinite(wanted)) throw httpError(400, "Choose an available appointment time.");
  if (wanted === Date.parse(booking.start)) throw httpError(400, "Choose a different time.");
  return store.transact(async ({ read, write }) => {
    const data = read();
    const current = data.bookings.find((item) => item.id === id);
    if (!current || current.status !== "scheduled") throw httpError(409, "That appointment is not active.");
    const slots = await offeredInside(config, calendar, read, current.type, config.now(), id);
    const slot = slots.find((item) => Date.parse(item.start) === wanted);
    if (!slot) throw httpError(409, "That time is no longer available.");
    let meetLink = current.meetLink;
    if (current.calendarEventId) {
      try {
        const updated = await calendar.updateEvent(current.calendarEventId, {
          ...current,
          start: slot.start,
          end: slot.end,
        });
        meetLink = current.meetingMode === "meet" ? updated.meetLink || current.meetLink : null;
      } catch (error) {
        throw httpError(503, error.message || "The calendar event could not be moved. The original appointment is still held.");
      }
    }
    current.start = slot.start;
    current.end = slot.end;
    current.meetLink = meetLink;
    current.updatedAt = config.now().toISOString();
    const lead = data.leads.find((item) => item.id === current.leadId);
    if (lead) {
      lead.consultation = { ...(lead.consultation || {}), start: slot.start, end: slot.end };
      lead.followUpAt = slot.start;
      lead.updatedAt = current.updatedAt;
      lead.notes.push({
        id: crypto.randomUUID(),
        at: current.updatedAt,
        author: "system",
        text: `Consultation moved to ${slot.start}.`,
      });
    }
    write(data);
    return {
      ...customerView(current),
      message: "The appointment was moved. The previous time is no longer held.",
    };
  });
}

function dashboard(config, store, calendar) {
  const snap = store.snapshot();
  const report = weekly(config, store, calendar);
  return {
    generatedAt: config.now().toISOString(),
    environment: config.environment,
    sources: {
      websiteEvents: "ASBS server log for this staging server only",
      googleAnalytics: "not_connected",
      stripe: "not_synced",
      googleCalendar: calendar.configured ? "connected" : "not_connected",
      revenue: "Owner-attested payments only. Unverified package prices are not revenue.",
    },
    report,
    leads: snap.leads,
    bookings: snap.bookings,
    documents: snap.documents,
  };
}

function weekly(config, store, calendar) {
  const snap = store.snapshot();
  const now = config.now();
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const inWeek = (value) => Date.parse(value || "") >= weekAgo;
  const leads = snap.leads;
  const newLeads = leads.filter((lead) => inWeek(lead.createdAt));
  const bookings = snap.bookings.filter((booking) => booking.status === "scheduled");
  const bookedWeek = snap.bookings.filter((booking) => inWeek(booking.createdAt));
  const completed = leads.filter((lead) => lead.stage === "consultation_completed" && inWeek(lead.updatedAt));
  const verified = leads.filter((lead) => lead.amountVerified === true);
  const collectedCents = verified.reduce((sum, lead) => sum + (lead.collectedAmountCents || 0), 0);
  const events = snap.events.filter((event) => inWeek(event.at));
  const byName = countBy(events, (event) => event.name);
  const byViewport = countBy(events, (event) => event.viewport);
  const actions = recommendedActions({ leads, calendar, events, config });
  return {
    periodStart: new Date(weekAgo).toISOString(),
    periodEnd: now.toISOString(),
    generatedAt: now.toISOString(),
    website: {
      pageViews: byName.page_view || 0,
      ctaClicks: byName.cta_click || 0,
      inquiries: leads.filter((lead) => lead.role === "customer" && inWeek(lead.createdAt)).length,
      viewport: byViewport,
      note: "Counts are first-party events received by this server. Google Analytics is not connected, so this is not total public-site traffic.",
    },
    pipeline: {
      newLeads: newLeads.length,
      qualified: leads.filter((lead) => lead.stage === "qualified").length,
      consultationsScheduled: bookings.length,
      consultationsBookedThisWeek: bookedWeek.length,
      consultationsCompletedThisWeek: completed.length,
      proposals: leads.filter((lead) => lead.stage === "proposal_sent").length,
      won: leads.filter((lead) => lead.stage === "won").length,
      lost: leads.filter((lead) => lead.stage === "lost").length,
      activeClients: leads.filter((lead) => lead.stage === "active_client").length,
      vendorRegistrations: leads.filter((lead) => lead.role === "vendor").length,
    },
    financial: {
      verifiedCollectedCents: collectedCents,
      currency: "USD",
      stripe: "not_synced",
      outstandingInvoices: null,
      expenses: null,
      grossProfit: null,
      netProfit: null,
      recurringRevenue: null,
      note: collectedCents
        ? "Collected total includes only payments the owner marked as actually received. Stripe is not synced."
        : "No verified collected revenue is stored. Package prices are proposals, not revenue. Stripe is not synced.",
    },
    actions,
  };
}

function recommendedActions({ leads, calendar, events, config }) {
  const actions = [];
  if (!calendar.configured) {
    actions.push("Connect Google Calendar OAuth on the staging server so new bookings are checked against the owner's calendar and written there.");
  }
  const stale = leads.filter((lead) => lead.stage === "new_lead" && Date.parse(lead.createdAt) < config.now().getTime() - 2 * 24 * 60 * 60 * 1000);
  if (stale.length) actions.push(`Follow up ${stale.length} new lead${stale.length === 1 ? "" : "s"} that have been waiting more than two days.`);
  const due = leads.filter((lead) => lead.followUpAt && Date.parse(lead.followUpAt) <= config.now().getTime() && !["completed", "lost"].includes(lead.stage));
  if (due.length) actions.push(`Review ${due.length} follow-up${due.length === 1 ? "" : "s"} that are due.`);
  if (!events.length) actions.push("Open the staging site and walk the consultation path once so the dashboard has a real activity sample. Do not treat an empty chart as traffic.");
  if (!config.dashboardPassword) actions.push("Set the dashboard password in the server environment before anyone else uses staging.");
  return actions.slice(0, 3);
}

function authorized(req, config) {
  if (!config.dashboardPassword || !config.sessionSecret) return false;
  return verifySession(config.sessionSecret, readCookie(req));
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const id = typeof meta.id === "string" ? meta.id.slice(0, 80) : undefined;
  return id ? { id } : {};
}

function countBy(items, fn) {
  const out = {};
  for (const item of items) {
    const key = fn(item) || "unknown";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function allowRate(ctx, req, bucket) {
  const ip = req.socket.remoteAddress || "unknown";
  const key = `${ip}:${bucket.startsWith("POST /api/events") ? "events" : bucket.startsWith("POST /api/auth/login") ? "login" : "write"}`;
  if (req.method === "GET") return true;
  const limit = key.endsWith("events") ? 120 : key.endsWith("login") ? 8 : 100;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const entry = ctx.limits.get(key) || [];
  const recent = entry.filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    ctx.limits.set(key, recent);
    return false;
  }
  recent.push(now);
  ctx.limits.set(key, recent);
  return true;
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  const body = status === 204 ? "" : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(httpError(413, "That upload is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(httpError(400, "The form could not be read."));
      }
    });
    req.on("error", () => reject(httpError(400, "The form could not be read.")));
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function serveStatic(req, res, url, rootDir) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { message: "That method is not allowed." });
    return;
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.includes("\0")) {
    sendJson(res, 404, { message: "That address was not found." });
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const full = path.normalize(path.join(rootDir, pathname));
  const root = path.normalize(rootDir);
  const relative = path.relative(root, full);
  const top = relative.split(path.sep)[0];
  const hidden = relative.startsWith("..")
    || path.isAbsolute(relative)
    || relative.split(path.sep).some((part) => part.startsWith("."))
    || ["server", "data", "test", "docs", "node_modules"].includes(top);
  if (hidden) {
    sendJson(res, 404, { message: "That address was not found." });
    return;
  }
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    sendJson(res, 404, { message: "That address was not found." });
    return;
  }
  const type = MIME[path.extname(full).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(full).pipe(res);
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
