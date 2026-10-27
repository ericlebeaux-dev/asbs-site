import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp, loadConfig } from "../server/app.js";

const NOW = "2026-10-26T12:00:00.000Z";

function disconnectedCalendar() {
  return {
    configured: false,
    reason: "not configured in test",
    async listBusy() { throw new Error("listBusy should not run"); },
    async createEvent() { throw new Error("createEvent should not run"); },
    async updateEvent() { throw new Error("updateEvent should not run"); },
    async deleteEvent() { throw new Error("deleteEvent should not run"); },
  };
}

async function start({ env = {}, calendar = disconnectedCalendar(), password = "test-dashboard-password", mailer } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asbs-"));
  const app = createApp({
    dataDir,
    rootDir: path.resolve("."),
    now: () => new Date(NOW),
    calendar,
    ...(mailer ? { mailer } : {}),
    env: {
      ASBS_ENV: "staging",
      ASBS_DASHBOARD_PASSWORD: password,
      ASBS_SESSION_SECRET: password ? "test-session-secret" : "",
      ...env,
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  return {
    app,
    base: `http://127.0.0.1:${app.server.address().port}`,
    async stop() {
      app.server.close();
      await once(app.server, "close");
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function api(base, method, pathname, body, headers = {}) {
  const response = await fetch(base + pathname, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = {};
  if (text) data = JSON.parse(text);
  return { status: response.status, data, headers: response.headers };
}

function customer(overrides = {}) {
  return {
    name: "Test Customer",
    organization: "Example Consulting Co",
    email: "test.customer@example.com",
    phone: "(281) 555-0100",
    consent: true,
    company_url: "",
    ...overrides,
  };
}

test("hosted PORT binds all interfaces and local default stays loopback", () => {
  const local = loadConfig({ env: { PORT: "", ASBS_HOST: "", ASBS_PORT: "" } });
  assert.equal(local.host, "127.0.0.1");
  assert.equal(local.port, 8787);
  const hosted = loadConfig({ env: { PORT: "10000", ASBS_HOST: "", ASBS_PORT: "8787" } });
  assert.equal(hosted.host, "0.0.0.0");
  assert.equal(hosted.port, 10000);
  const pinned = loadConfig({ env: { PORT: "10000", ASBS_HOST: "127.0.0.1" } });
  assert.equal(pinned.host, "127.0.0.1");
  assert.equal(pinned.port, 10000);
});

test("health, packages, and static protections", async () => {
  const ctx = await start();
  try {
    const health = await api(ctx.base, "GET", "/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.calendar.connected, false);
    assert.equal(health.data.payments.livePackageCheckout, false);
    assert.equal(health.data.timezone, "America/Chicago");

    const packages = await api(ctx.base, "GET", "/api/packages");
    assert.equal(packages.data.purchasable, false);
    assert.equal(packages.data.pricingStatus, "approved");
    assert.deepEqual(
      packages.data.packages.map((item) => [item.id, item.name, item.price]),
      [
        ["free-consultation", "Free consultation", "Free"],
        ["bid-readiness-assessment", "Bid Readiness Assessment", "$199"],
        ["quick-bid-review", "Quick Bid Review", "$249"],
        ["sam-registration-prep", "SAM.gov Registration Prep", "$349"],
        ["registration-bundle", "Registration Bundle", "$599"],
        ["certification-support", "Certification support", "$599 each"],
        ["contractor-launch", "Contractor Launch", "$999"],
        ["monitor", "Monitor", "$350/month"],
        ["starter-bid", "Starter Bid", "$1,000/month"],
        ["growth", "Growth", "$1,800/month"],
        ["full-capture", "Full Capture", "$2,800/month"],
      ],
    );
    assert.equal(health.data.payments.pricingStatus, "approved");
    assert.equal(health.data.payments.livePackageCheckout, false);
    assert.equal(health.data.bookingHorizonDays, 365);
    assert.equal(health.data.mail.configured, false);
    assert.equal(health.data.mail.from, "americanstandardsolutions@gmail.com");
    assert.equal(health.data.mail.transport, "gmail_api");

    const home = await fetch(ctx.base + "/");
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Free Consultation|Request a Quote/);

    assert.equal((await fetch(ctx.base + "/server/app.js")).status, 404);
    assert.equal((await fetch(ctx.base + "/.env")).status, 404);
    assert.equal((await fetch(ctx.base + "/assets/../../server/app.js")).status, 404);
    assert.equal((await api(ctx.base, "GET", "/api/dashboard")).status, 401);
  } finally {
    await ctx.stop();
  }
});

test("intake validates, deduplicates, and rejects sensitive fields", async () => {
  const ctx = await start();
  try {
    const intake = {
      ...customer(),
      businessCity: "Katy",
      businessState: "TX",
      serviceArea: "Nationwide",
      businessDescription: "Office supply reseller.",
      industry: "Facilities",
      serviceInterest: "contracting-readiness",
      contractingLevel: ["federal"],
      leadSource: "website",
      challenges: "Need a readiness checklist.",
    };
    const first = await api(ctx.base, "POST", "/api/intake", intake);
    assert.equal(first.status, 201);
    assert.equal(first.data.duplicate, false);
    const second = await api(ctx.base, "POST", "/api/intake", intake);
    assert.equal(second.status, 200);
    assert.equal(second.data.duplicate, true);
    assert.equal(second.data.leadId, first.data.leadId);

    const rejected = await api(ctx.base, "POST", "/api/intake", { ...intake, ssn: "000-00-0000" });
    assert.equal(rejected.status, 400);
    const noConsent = await api(ctx.base, "POST", "/api/intake", { ...intake, email: "other@example.com", consent: false });
    assert.equal(noConsent.status, 400);

    const login = await api(ctx.base, "POST", "/api/auth/login", { password: "test-dashboard-password" });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    const dash = await api(ctx.base, "GET", "/api/dashboard", null, { cookie: cookie.split(";")[0] });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.leads.length, 1);
    assert.match(dash.data.report.financial.note, /No verified collected revenue|not revenue|not synced/i);
    assert.equal(dash.data.report.financial.verifiedCollectedCents, 0);
  } finally {
    await ctx.stop();
  }
});

test("booking prevents double booking and reports a disconnected calendar", async () => {
  const ctx = await start();
  try {
    const slots = await api(ctx.base, "GET", "/api/slots?type=discovery_15");
    assert.equal(slots.data.calendarConnected, false);
    const first = slots.data.slots[0];
    const second = slots.data.slots[1];
    const third = slots.data.slots[2];
    const payload = {
      ...customer(),
      type: "discovery_15",
      meetingMode: "phone",
      serviceInterest: "contracting-readiness",
      start: first.start,
    };
    const booked = await api(ctx.base, "POST", "/api/bookings", payload);
    assert.equal(booked.status, 201);
    assert.equal(booked.data.calendar.eventCreated, false);
    assert.match(booked.data.calendar.message, /not on the owner's Google Calendar/i);
    assert.ok(booked.data.cancelToken);

    const conflict = await api(ctx.base, "POST", "/api/bookings", { ...payload, email: "second@example.com" });
    assert.equal(conflict.status, 409);
    const buffered = await api(ctx.base, "POST", "/api/bookings", { ...payload, email: "third@example.com", start: second.start });
    assert.equal(buffered.status, 409);

    const moved = await api(ctx.base, "POST", `/api/bookings/${booked.data.bookingId}/reschedule`, {
      token: booked.data.cancelToken,
      start: third.start,
    });
    assert.equal(moved.status, 200);
    assert.equal(Date.parse(moved.data.start), Date.parse(third.start));

    const badCancel = await api(ctx.base, "POST", `/api/bookings/${booked.data.bookingId}/cancel`, { token: "nope" });
    assert.equal(badCancel.status, 403);
    const cancelled = await api(ctx.base, "POST", `/api/bookings/${booked.data.bookingId}/cancel`, { token: booked.data.cancelToken });
    assert.equal(cancelled.status, 200);
    const open = await api(ctx.base, "GET", "/api/slots?type=discovery_15");
    assert.equal(open.data.slots.some((slot) => slot.start === first.start), true);
  } finally {
    await ctx.stop();
  }
});

test("connected calendar creates one event and rolls back when creation fails", async () => {
  const calls = [];
  const calendar = {
    configured: true,
    reason: null,
    async listBusy() {
      return [{ start: new Date("2026-10-27T14:00:00.000Z"), end: new Date("2026-10-27T14:15:00.000Z") }];
    },
    async createEvent(booking) {
      calls.push(booking);
      if (booking.email === "fail@example.com") throw Object.assign(new Error("Calendar rejected the event."), { status: 503 });
      return { eventId: "evt_1", meetLink: "https://meet.google.com/aaa-bbbb-ccc" };
    },
    async updateEvent() { return { eventId: "evt_1", meetLink: "https://meet.google.com/aaa-bbbb-ccc" }; },
    async deleteEvent(id) { calls.push(["delete", id]); },
  };
  const ctx = await start({ calendar });
  try {
    const slots = await api(ctx.base, "GET", "/api/slots?type=qualified_30");
    assert.equal(slots.data.slots.some((slot) => slot.start === "2026-10-27T14:00:00.000Z"), false);
    const start = "2026-10-27T18:00:00.000Z";
    const booked = await api(ctx.base, "POST", "/api/bookings", {
      ...customer({ email: "meet@example.com" }),
      type: "qualified_30",
      meetingMode: "meet",
      serviceInterest: "quick-bid-review",
      packageId: "quick-bid-review",
      start,
    });
    assert.equal(booked.status, 201);
    assert.equal(booked.data.calendar.eventCreated, true);
    assert.equal(booked.data.meetLink, "https://meet.google.com/aaa-bbbb-ccc");
    assert.equal(calls[0].attendees, undefined);

    const failed = await api(ctx.base, "POST", "/api/bookings", {
      ...customer({ email: "fail@example.com" }),
      type: "qualified_30",
      meetingMode: "phone",
      serviceInterest: "supplies",
      start: "2026-10-27T19:00:00.000Z",
    });
    assert.equal(failed.status, 503);
    const again = await api(ctx.base, "GET", "/api/slots?type=qualified_30");
    assert.equal(again.data.slots.some((slot) => slot.start === slots.data.slots[1].start), true);

    const removed = await api(ctx.base, "POST", `/api/bookings/${booked.data.bookingId}/cancel`, { token: booked.data.cancelToken });
    assert.equal(removed.status, 200);
    assert.deepEqual(calls.at(-1), ["delete", "evt_1"]);
  } finally {
    await ctx.stop();
  }
});

test("vendor registration stores a private document the public site cannot read", async () => {
  const ctx = await start();
  try {
    const pdf = Buffer.from("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF").toString("base64");
    const saved = await api(ctx.base, "POST", "/api/vendors", {
      legalName: "Example Supply LLC",
      contactName: "Pat Example",
      email: "vendor@example.com",
      phone: "(713) 555-0199",
      services: "Janitorial supplies",
      coverage: "Texas",
      teamingInterest: "later",
      consent: true,
      company_url: "",
      document: { filename: "redacted-w9.pdf", mimeType: "application/pdf", dataBase64: pdf },
    });
    assert.equal(saved.status, 201);
    assert.match(saved.data.message, /does not guarantee/i);
    const hidden = await fetch(ctx.base + "/data/uploads/nope.pdf");
    assert.equal(hidden.status, 404);
    const login = await api(ctx.base, "POST", "/api/auth/login", { password: "wrong-password" });
    assert.equal(login.status, 401);
    const good = await api(ctx.base, "POST", "/api/auth/login", { password: "test-dashboard-password" });
    const cookie = good.headers.get("set-cookie").split(";")[0];
    const file = await fetch(ctx.base + `/api/documents/${saved.data.documentId}`, { headers: { cookie } });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("content-type"), "application/pdf");
    const anonymous = await fetch(ctx.base + `/api/documents/${saved.data.documentId}`);
    assert.equal(anonymous.status, 401);

    const payment = await api(ctx.base, "PATCH", `/api/leads/${saved.data.leadId}`, {
      payment: { amountCents: 100, attestation: "maybe" },
    }, { cookie });
    assert.equal(payment.status, 400);
  } finally {
    await ctx.stop();
  }
});

test("a quote is saved when confirmation email throws", async () => {
  const ctx = await start({
    mailer: {
      configured: true,
      async notify() {
        throw new Error("mailbox unavailable");
      },
    },
  });
  try {
    const quote = await api(ctx.base, "POST", "/api/quotes", {
      name: "Test Customer",
      organization: "Example Consulting Co",
      email: "quote.customer@example.com",
      phone: "",
      buyer_type: "Government",
      services: ["Office Supplies (424120)"],
      quantity_scope: "One case of paper",
      timeline: "November",
      details: "Need a quote for copy paper.",
      consent: true,
      company_url: "",
      _honey: "",
    });
    assert.equal(quote.status, 201);
    assert.equal(quote.data.email.sent, false);
    assert.match(quote.data.message, /quote request was received/i);
    assert.match(quote.data.message, /Someone will reach out promptly/);
    assert.doesNotMatch(quote.data.message, /confirmation email was sent/i);

    const refused = await api(ctx.base, "POST", "/api/quotes", {
      name: "Test Customer",
      email: "other.quote@example.com",
      consent: false,
    });
    assert.equal(refused.status, 400);
  } finally {
    await ctx.stop();
  }
});

test("dashboard trends follow the selected Central Time range", async () => {
  const ctx = await start();
  try {
    const viewed = await api(ctx.base, "POST", "/api/events", {
      name: "page_view",
      path: "/index.html",
      viewport: "desktop",
    });
    assert.equal(viewed.status, 204);
    const login = await api(ctx.base, "POST", "/api/auth/login", { password: "test-dashboard-password" });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const dash = await api(ctx.base, "GET", "/api/dashboard?days=30", null, { cookie });
    assert.equal(dash.status, 200);
    assert.equal(dash.data.report.spanDays, 30);
    assert.equal(dash.data.report.trends.length, 30);
    assert.equal(dash.data.report.trends.at(-1).date, "2026-10-26");
    assert.equal(dash.data.report.trends.at(-1).pageViews, 1);
    assert.equal(dash.data.report.trends[0].pageViews, 0);
    assert.equal(dash.data.report.website.topPages[0].path, "/index.html");
    assert.match(dash.data.report.persistence, /restart/i);
    const fallback = await api(ctx.base, "GET", "/api/dashboard?days=14", null, { cookie });
    assert.equal(fallback.data.report.spanDays, 7);
    assert.equal(fallback.data.report.trends.length, 7);
    const quarter = await api(ctx.base, "GET", "/api/reports/weekly?days=90", null, { cookie });
    assert.equal(quarter.data.trends.length, 90);
  } finally {
    await ctx.stop();
  }
});

test("dashboard login is unavailable until a password is configured", async () => {
  const ctx = await start({ password: "" });
  try {
    const login = await api(ctx.base, "POST", "/api/auth/login", { password: "anything" });
    assert.equal(login.status, 503);
  } finally {
    await ctx.stop();
  }
});
