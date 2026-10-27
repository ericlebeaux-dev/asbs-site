import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { clearCookie, passwordsMatch, readCookie, sessionCookie, signSession, verifySession } from "./auth.js";
import { calendarFromEnv } from "./calendar.js";
import { mailerFromEnv } from "./mail.js";
import { PACKAGES, PRICING_STATUS } from "./packages.js";
import { HORIZON_DAYS, consultationType, generateSlots } from "./slots.js";
import { createStore } from "./store.js";
import { TIME_ZONE, addDaysYmd, formatZoned, zonedParts, zonedTimeToUtc, zonedToday } from "./time.js";
import {
  httpError,
  validateBooking,
  validateDocument,
  validateInquiry,
  validateIntake,
  validateQuote,
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
    host: options.host || env.ASBS_HOST || (env.PORT ? "0.0.0.0" : "127.0.0.1"),
    port: Number(options.port || env.PORT || env.ASBS_PORT || 8787),
    minNoticeHours: numberOr(env.ASBS_MIN_NOTICE_HOURS, 24),
    bufferMinutes: numberOr(env.ASBS_BUFFER_MINUTES, 15),
    slotDays: Math.min(Math.max(numberOr(env.ASBS_SLOT_DAYS, HORIZON_DAYS), 1), HORIZON_DAYS),
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
  const mailer = options.mailer || mailerFromEnv(config.env);
  const limits = new Map();
  const server = http.createServer((req, res) => {
    handle(req, res, { config, store, calendar, mailer, limits }).catch((error) => {
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
  const corsOrigin = applyCors(req, res);
  if (req.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    res.writeHead(corsOrigin ? 204 : 403);
    res.end();
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    await routeApi(req, res, url, ctx);
    return;
  }
  serveStatic(req, res, url, ctx.config.rootDir);
}

async function routeApi(req, res, url, ctx) {
  const { config, store, calendar, mailer } = ctx;
  if (!allowRate(ctx, req, `${req.method} ${url.pathname}`)) {
    sendJson(res, 429, { message: "Too many requests. Wait a few minutes and try again." });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, health(config, calendar, mailer));
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
    const monthRaw = url.searchParams.get("month") || "";
    const month = parseMonth(monthRaw);
    if (monthRaw && !month) {
      sendJson(res, 400, { message: "Choose a month as YYYY-MM." });
      return;
    }
    const daysRaw = url.searchParams.get("days");
    const days = daysRaw ? Number(daysRaw) : undefined;
    if (daysRaw && (!Number.isFinite(days) || days < 1)) {
      sendJson(res, 400, { message: "Choose a valid number of days." });
      return;
    }
    const range = month
      ? { month }
      : daysRaw
        ? { days }
        : currentMonthRange(config.now());
    const slots = await slotsFor(config, store, calendar, type, range);
    const bounds = horizonBounds(config.now());
    sendJson(res, 200, {
      timezone: TIME_ZONE,
      type,
      calendarConnected: calendar.configured,
      ...bounds,
      month: range.month ? monthKey(range.month.year, range.month.month) : null,
      slots,
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/intake") {
    const body = await readJson(req);
    const fields = validateIntake(body);
    const followUp = new Date(config.now().getTime() + 24 * 60 * 60 * 1000).toISOString();
    const saved = await store.createCustomerLead(fields, { stage: "new_lead", followUp });
    const mail = await confirm(mailer, {
      kind: "intake",
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      organization: fields.organization,
      summaryLines: [
        `Name: ${fields.name}`,
        `Business: ${fields.organization}`,
        `Email: ${fields.email}`,
        `Phone: ${fields.phone}`,
        `Interest: ${fields.serviceInterest}`,
      ],
    });
    await remember(store, config, "intake");
    sendJson(res, saved.duplicate ? 200 : 201, {
      leadId: saved.lead.id,
      duplicate: saved.duplicate,
      stage: saved.lead.stage,
      email: { sent: mail.sent === true },
      message: saved.duplicate
        ? receipt("We already had a record for this email, so we updated it instead of creating a second one.", mail)
        : receipt("Your intake was received. It does not hire ASBS or authorize any submission on your behalf.", mail),
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
    const mail = await confirm(mailer, {
      kind: "vendor",
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      organization: fields.legalName,
      summaryLines: [
        `Business: ${fields.legalName}`,
        `Contact: ${fields.name}`,
        `Email: ${fields.email}`,
        `Phone: ${fields.phone || ""}`,
        `Services: ${fields.services}`,
      ],
    });
    await remember(store, config, "vendor");
    sendJson(res, saved.duplicate ? 200 : 201, {
      leadId: saved.lead.id,
      duplicate: saved.duplicate,
      documentId,
      email: { sent: mail.sent === true },
      message: receipt("Your vendor registration was saved privately. It does not guarantee teaming, subcontracting, or a contract award.", mail),
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
    const mail = await confirm(mailer, {
      kind: "contact",
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      organization: fields.organization,
      summaryLines: [`Topic: ${fields.topic}`, `Message: ${fields.message}`],
    });
    await remember(store, config, "contact");
    sendJson(res, 201, {
      leadId: saved.lead.id,
      duplicate: saved.duplicate,
      email: { sent: mail.sent === true },
      message: receipt("Your message was received.", mail),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/quotes") {
    const body = await readJson(req);
    const fields = validateQuote(body);
    const summary = [
      `Buyer type: ${fields.buyerType || "Not specified"}`,
      `Services: ${fields.services.join(", ") || "Not specified"}`,
      `Quantity or scope: ${fields.quantity || "Not specified"}`,
      `Timeline: ${fields.timeline || "Not specified"}`,
      `Details: ${fields.details || "Not specified"}`,
    ];
    const saved = await store.createCustomerLead(
      {
        name: fields.name,
        email: fields.email,
        phone: fields.phone || "",
        organization: fields.organization || fields.name,
        serviceInterest: "supplies",
        leadSource: "website",
        consent: true,
        notes: summary.join("\n"),
      },
      { stage: "new_lead", followUp: new Date(config.now().getTime() + 24 * 60 * 60 * 1000).toISOString() },
    );
    await store.updateLead(saved.lead.id, {}, `Quote request:\n${summary.join("\n")}`);
    const mail = await confirm(mailer, {
      kind: "quote",
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      organization: fields.organization,
      summaryLines: [`Name: ${fields.name}`, `Email: ${fields.email}`, ...summary],
    });
    await remember(store, config, "quote");
    sendJson(res, saved.duplicate ? 200 : 201, {
      leadId: saved.lead.id,
      duplicate: saved.duplicate,
      email: { sent: mail.sent === true },
      message: receipt("Your quote request was received.", mail),
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/bookings") {
    const body = await readJson(req);
    const fields = validateBooking(body);
    const result = await book(config, store, calendar, fields);
    const mail = await confirm(mailer, {
      kind: "booking",
      name: fields.name,
      email: fields.email,
      phone: fields.phone,
      organization: fields.organization,
      summaryLines: [
        `Consultation: ${result.typeLabel}`,
        `When: ${result.when}`,
        `How we will meet: ${fields.meetingMode === "phone" ? "Phone" : "Google Meet"}`,
        `Cancellation code: ${result.cancelToken}`,
      ],
    });
    await remember(store, config, "booking");
    result.email = { sent: mail.sent === true };
    if (mail.sent) {
      result.instructions = "A confirmation email was sent to you. Keep the cancellation code. Use it on this page to cancel or choose a different open time. To reach a person, call (281) 954-5167.";
    }
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
    const existing = store.findBooking(cancel[1]);
    const result = await cancelBooking(config, store, calendar, cancel[1], body.token);
    if (existing) {
      const mail = await confirm(mailer, {
        kind: "cancel",
        name: existing.name,
        email: existing.email,
        phone: existing.phone,
        organization: existing.organization,
        summaryLines: [`Consultation: ${existing.typeLabel || existing.type}`, `When: ${formatZoned(new Date(existing.start))}`],
      });
      await remember(store, config, "cancel");
      result.email = { sent: mail.sent === true };
    }
    sendJson(res, 200, result);
    return;
  }
  const move = url.pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})\/reschedule$/);
  if (req.method === "POST" && move) {
    const body = await readJson(req);
    const result = await reschedule(config, store, calendar, move[1], body);
    const mail = await confirm(mailer, {
      kind: "reschedule",
      name: result.name,
      email: result.email || store.findBooking(move[1])?.email,
      phone: store.findBooking(move[1])?.phone,
      organization: store.findBooking(move[1])?.organization,
      summaryLines: [`Consultation: ${result.typeLabel || result.type}`, `When: ${result.when}`],
    });
    await remember(store, config, "reschedule");
    result.email = { sent: mail.sent === true };
    sendJson(res, 200, result);
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
    sendJson(res, 200, dashboard(config, store, calendar, spanDays(url), mailer));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/reports/weekly") {
    sendJson(res, 200, weekly(config, store, calendar, spanDays(url), mailer));
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

function health(config, calendar, mailer) {
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
    mail: {
      configured: mailer?.configured === true,
      from: "americanstandardsolutions@gmail.com",
      transport: "gmail_api",
    },
    payments: {
      livePackageCheckout: false,
      pricingStatus: PRICING_STATUS,
    },
    consultationWindows: ["Mon/Wed/Fri 09:00-11:00 America/Chicago", "Mon/Wed/Fri 13:00-16:00 America/Chicago"],
    minimumNoticeHours: config.minNoticeHours,
    bufferMinutes: config.bufferMinutes,
    bookingHorizonDays: HORIZON_DAYS,
  };
}

async function slotsFor(config, store, calendar, type, range) {
  if (!consultationType(type)) throw httpError(400, "Choose a consultation type.");
  const now = config.now();
  const busy = store.activeBusy().map(({ start, end }) => ({ start, end }));
  if (calendar.configured) {
    const window = queryWindow(now, range);
    try {
      busy.push(...await calendar.listBusy(window.start.toISOString(), window.end.toISOString()));
    } catch (error) {
      throw httpError(503, error.message || "Calendar availability could not be checked. No times are being offered.");
    }
  }
  return generateSlots({
    now,
    days: range.days,
    month: range.month,
    day: range.day,
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
    const slots = await offeredInside(config, calendar, read, fields.type, now, "", fields.start);
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
      instructions: "Keep the cancellation code. Use it on this page to cancel or choose a different open time. A confirmation email is sent to you when mailbox sending is connected. To reach a person, call (281) 954-5167.",
    };
  });
}

async function offeredInside(config, calendar, read, type, now, ignoreBookingId = "", focusStart = "") {
  const data = read();
  const busy = data.bookings
    .filter((booking) => booking.status === "scheduled" && booking.id !== ignoreBookingId)
    .map((booking) => ({ start: new Date(booking.start), end: new Date(booking.end) }));
  const focus = Number.isFinite(Date.parse(focusStart)) ? zonedParts(new Date(focusStart)) : null;
  const range = focus
    ? { day: { year: focus.year, month: focus.month, day: focus.day } }
    : { days: config.slotDays };
  if (calendar.configured) {
    const window = queryWindow(now, range);
    try {
      busy.push(...await calendar.listBusy(window.start.toISOString(), window.end.toISOString()));
    } catch (error) {
      throw httpError(503, error.message || "Calendar availability could not be checked. Nothing was changed.");
    }
  }
  return generateSlots({
    now,
    days: range.days,
    day: range.day,
    typeId: type,
    busy,
    minNoticeHours: config.minNoticeHours,
    bufferMinutes: config.bufferMinutes,
  });
}

function currentMonthRange(now) {
  const today = zonedToday(now);
  return { month: { year: today.year, month: today.month } };
}

function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 2020 || year > 2100) return null;
  return { year, month };
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function horizonBounds(now) {
  const today = zonedToday(now);
  const last = addDaysYmd(today.year, today.month, today.day, HORIZON_DAYS);
  return {
    firstMonth: monthKey(today.year, today.month),
    lastMonth: monthKey(last.year, last.month),
    horizonDays: HORIZON_DAYS,
  };
}

function queryWindow(now, range) {
  if (range.day) {
    const next = addDaysYmd(range.day.year, range.day.month, range.day.day, 1);
    return {
      start: zonedTimeToUtc(range.day.year, range.day.month, range.day.day, 0, 0),
      end: zonedTimeToUtc(next.year, next.month, next.day, 0, 0),
    };
  }
  if (range.month) {
    const nextMonth = range.month.month === 12
      ? { year: range.month.year + 1, month: 1 }
      : { year: range.month.year, month: range.month.month + 1 };
    return {
      start: zonedTimeToUtc(range.month.year, range.month.month, 1, 0, 0),
      end: zonedTimeToUtc(nextMonth.year, nextMonth.month, 1, 0, 0),
    };
  }
  const days = Math.min(Math.max(Number(range.days) || HORIZON_DAYS, 1), HORIZON_DAYS + 1);
  return { start: now, end: new Date(now.getTime() + (days + 1) * 24 * 60 * 60 * 1000) };
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
    instructions: "To cancel or reschedule, use the confirmation code from this booking. Call (281) 954-5167 if you lose it. A confirmation email is sent when mailbox sending is connected.",
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
    const slots = await offeredInside(config, calendar, read, current.type, config.now(), id, body.start);
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

async function confirm(mailer, submission) {
  try {
    if (!mailer || typeof mailer.notify !== "function") {
      return { sent: false, customerSent: false, ownerSent: false, reason: "not_configured" };
    }
    const result = await mailer.notify(submission);
    return result || { sent: false, customerSent: false, ownerSent: false, reason: "send_failed" };
  } catch {
    return { sent: false, customerSent: false, ownerSent: false, reason: "send_failed" };
  }
}

function receipt(base, mail) {
  const extra = mail?.sent
    ? " A confirmation email was sent to you."
    : " Someone will reach out promptly.";
  return `${base}${extra}`;
}

async function remember(store, config, kind) {
  try {
    await store.addEvent({
      id: crypto.randomUUID(),
      name: "submission",
      path: String(kind || "submission").slice(0, 160),
      viewport: "unknown",
      meta: { id: String(kind || "submission").slice(0, 80) },
      at: config.now().toISOString(),
    });
  } catch {
    // A metrics write must not undo a saved form.
  }
}

function spanDays(url) {
  const days = Number(url.searchParams.get("days"));
  return days === 30 || days === 90 ? days : 7;
}

function dashboard(config, store, calendar, days = 7, mailer) {
  const snap = store.snapshot();
  const report = weekly(config, store, calendar, days, mailer);
  return {
    generatedAt: config.now().toISOString(),
    environment: config.environment,
    sources: {
      websiteEvents: "ASBS server log for this staging server only",
      googleAnalytics: "not_connected",
      stripe: "not_synced",
      googleCalendar: calendar.configured ? "connected" : "not_connected",
      mail: mailer?.configured ? "gmail_api" : "not_configured",
      revenue: "Owner-attested payments only. Package prices are not revenue while checkout is off.",
      persistence: "Counts live on this server's disk. The free Render plan erases them on restart. They are not in a database.",
    },
    report,
    leads: snap.leads,
    bookings: snap.bookings,
    documents: snap.documents,
  };
}

function weekly(config, store, calendar, days = 7, mailer) {
  const span = days === 30 || days === 90 ? days : 7;
  const snap = store.snapshot();
  const now = config.now();
  const today = zonedToday(now);
  const series = dailySeries(snap, today, span);
  const windowStart = series.startMs;
  const inWeek = (value) => Date.parse(value || "") >= windowStart;
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
  const actions = recommendedActions({ leads, calendar, events, config, mailer });
  return {
    spanDays: span,
    periodStart: new Date(windowStart).toISOString(),
    periodEnd: now.toISOString(),
    generatedAt: now.toISOString(),
    persistence: "These counts are on this server's disk. A free Render restart erases them. They do not include the public GitHub Pages site.",
    trends: series.rows,
    website: {
      pageViews: byName.page_view || 0,
      ctaClicks: byName.cta_click || 0,
      submissions: byName.submission || 0,
      inquiries: leads.filter((lead) => lead.role === "customer" && inWeek(lead.createdAt)).length,
      viewport: byViewport,
      topPages: pageTotals(events),
      submissionsByKind: submissionTotals(events),
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
        : "No verified collected revenue is stored. Checkout is off, so package prices are not revenue. Stripe is not synced.",
    },
    actions,
  };
}

function chicagoKey(date) {
  const parts = zonedParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function ymdKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function dailySeries(snap, today, span) {
  const rows = [];
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    rows.push({
      date: ymdKey(addDaysYmd(today.year, today.month, today.day, -offset)),
      pageViews: 0,
      submissions: 0,
      bookings: 0,
    });
  }
  const index = new Map(rows.map((row, position) => [row.date, position]));
  const first = addDaysYmd(today.year, today.month, today.day, -(span - 1));
  const startMs = zonedTimeToUtc(first.year, first.month, first.day, 0, 0).getTime();
  for (const event of snap.events) {
    const at = Date.parse(event.at || "");
    if (!Number.isFinite(at) || at < startMs) continue;
    const position = index.get(chicagoKey(new Date(at)));
    if (position == null) continue;
    if (event.name === "page_view") rows[position].pageViews += 1;
    if (event.name === "submission") rows[position].submissions += 1;
  }
  for (const booking of snap.bookings) {
    const at = Date.parse(booking.createdAt || "");
    if (!Number.isFinite(at) || at < startMs) continue;
    const position = index.get(chicagoKey(new Date(at)));
    if (position == null) continue;
    rows[position].bookings += 1;
  }
  return { rows, startMs };
}

function pageTotals(events) {
  const counts = countBy(
    events.filter((event) => event.name === "page_view"),
    (event) => event.path || "/",
  );
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([page, count]) => ({ path: page, count }));
}

function submissionTotals(events) {
  return countBy(
    events.filter((event) => event.name === "submission"),
    (event) => event.path || "unknown",
  );
}

function recommendedActions({ leads, calendar, events, config, mailer }) {
  const actions = [];
  if (mailer && mailer.configured === false) {
    actions.push("Add the Gmail refresh token for americanstandardsolutions@gmail.com so each submission can send a confirmation. Leave the calendar token unchanged.");
  }
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

const PRODUCTION_ORIGINS = new Set([
  "https://www.americanstandardbusinesssolutions.com",
  "https://americanstandardbusinesssolutions.com",
]);

function applyCors(req, res) {
  const origin = req.headers.origin || "";
  if (!PRODUCTION_ORIGINS.has(origin)) return null;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  return origin;
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
