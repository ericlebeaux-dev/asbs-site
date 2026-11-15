import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../server/app.js";
import { sheetsFromEnv } from "../server/sheets.js";
import { validateIntake, validateVendor } from "../server/validate.js";

function customer(overrides = {}) {
  return {
    name: "Test Customer",
    organization: "Example Consulting Co",
    email: "records.customer@example.com",
    phone: "(281) 555-0100",
    consent: true,
    company_url: "",
    based: "Dallas, TX",
    serviceInterest: "operations",
    ...overrides,
  };
}

function vendor(overrides = {}) {
  return {
    legalName: "Example Supply LLC",
    contactName: "Pat Example",
    email: "records.vendor@example.com",
    phone: "(713) 555-0199",
    services: "Janitorial supplies",
    coverage: "Texas",
    teamingInterest: "later",
    consent: true,
    company_url: "",
    ...overrides,
  };
}

async function start({ sheets, mailer } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asbs-records-"));
  const notices = [];
  const app = createApp({
    dataDir,
    rootDir: path.resolve("."),
    now: () => new Date("2026-11-14T18:00:00.000Z"),
    calendar: { configured: false, reason: "test", async listBusy() { return []; } },
    mailer: mailer || {
      configured: true,
      async notify(submission) {
        notices.push(submission);
        return { sent: true, customerSent: true, ownerSent: true };
      },
    },
    sheets,
    env: { ASBS_ENV: "staging", ASBS_DASHBOARD_PASSWORD: "test-dashboard-password", ASBS_SESSION_SECRET: "test-session-secret" },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  return {
    notices,
    base: `http://127.0.0.1:${app.server.address().port}`,
    async stop() {
      app.server.close();
      await once(app.server, "close");
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function post(base, pathname, body) {
  const response = await fetch(base + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

test("intake and vendor records reject SSN, EIN, and date of birth fields", () => {
  for (const key of ["ssn", "ein", "dob", "dateOfBirth"]) {
    assert.throws(() => validateIntake(customer({ [key]: "000-00-0000" })), (error) => error.status === 400);
    assert.throws(() => validateVendor(vendor({ [key]: "00-0000000" })), (error) => error.status === 400);
  }
  assert.throws(() => validateVendor(vendor({ licenses: [{ licenseType: "Electrical", dob: "2000-01-01" }] })), (error) => error.status === 400);
  assert.throws(() => validateIntake(customer({ resumes: [{ person: "Pat", ein: "00-0000000" }] })), (error) => error.status === 400);
});

test("partner rows keep permission and legacy text", () => {
  const saved = validateVendor(vendor({
    licenses: "State license E-1",
    insurance: [{ coverageType: "General liability", limits: "1 million", carrier: "Example Mutual", expiry: "2027-02-01", coiLink: "https://example.com/coi" }],
    pastJobs: [{ client: "City of Dallas", project: "Warehouse", scope: "Supplies", contractValue: "25000", start: "2024-01-01", end: "2024-06-01", role: "prime", referenceId: "PO-9", completed: "bid-only" }],
    references: [{ name: "Pat Example", title: "Buyer", org: "City of Dallas", contact: "pat@example.com", relationship: "Past client", permission: "no" }],
    resumes: [{ person: "Pat Example", role: "Estimator", docLink: "https://example.com/resume" }],
    bonding: "Can bond 100000",
  }));
  assert.equal(saved.licenses[0].licenseType, "State license E-1");
  assert.equal(saved.pastJobs[0].completed, "bid-only");
  assert.equal(saved.references[0].permission, "no");
  assert.equal(saved.resumes[0].docLink, "https://example.com/resume");
  assert.throws(() => validateVendor(vendor({
    references: [{ name: "Pat Example", permission: "" }],
  })), (error) => error.status === 400);
  assert.throws(() => validateIntake(customer({
    licenses: [{ docLink: "javascript:alert(1)" }],
  })), (error) => error.status === 400);
  const legacy = validateVendor(vendor({ experience: "Three school jobs.", references: "Call the office." }));
  assert.equal(legacy.pastJobs[0].scope, "Three school jobs.");
  assert.equal(legacy.referencesNote, "Call the office.");
  assert.deepEqual(legacy.references, []);
});

test("a partner submission appends test rows and emails the notify mailbox", async () => {
  const calls = [];
  const sheets = sheetsFromEnv({
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_SHEETS_REFRESH_TOKEN: "refresh-token",
    SHEETS_LIBRARY_ID: "sheet-id",
  }, async (url, options) => {
    calls.push({ url: String(url), body: options.body });
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 });
  });
  const ctx = await start({ sheets });
  try {
    const saved = await post(ctx.base, "/api/vendors", vendor({
      pastJobs: [{ client: "City of Dallas", project: "Warehouse", scope: "Supplies", contractValue: "25000", start: "2024-01-01", end: "2024-06-01", role: "sub", completed: "completed" }],
      references: [{ name: "Pat Example", contact: "pat@example.com", permission: "yes" }],
    }));
    assert.equal(saved.status, 201);
    assert.equal(saved.data.sheets.written, true);
    assert.equal(saved.data.email.sent, true);
    assert.equal(ctx.notices.length, 1);
    assert.match(ctx.notices[0].summaryLines.join("\n"), /Past jobs: 1/);
    assert.equal(ctx.notices[0].kind, "vendor");
    const bodies = calls.filter((call) => call.url.includes("/values/")).map((call) => JSON.parse(call.body));
    assert.equal(bodies[0].values[0][0], "[TEST] Example Supply LLC");
    assert.equal(bodies[0].values[0][7], "TEST staging");
    assert.equal(bodies.some((body) => body.values[0][1] === "City of Dallas"), true);

    const spam = await post(ctx.base, "/api/vendors", vendor({ email: "spam.vendor@example.com", company_url: "https://spam.example" }));
    assert.equal(spam.status, 201);
    assert.equal(ctx.notices.length, 1);
    assert.equal(calls.filter((call) => call.url.includes("/values/")).length, bodies.length);
  } finally {
    await ctx.stop();
  }
});

test("an unset sheet still accepts the optional intake documents", async () => {
  const ctx = await start();
  try {
    const saved = await post(ctx.base, "/api/intake", customer({
      licenses: [{ licenseType: "Electrical", docLink: "https://example.com/license" }],
      resumes: [],
    }));
    assert.equal(saved.status, 201);
    assert.equal(saved.data.sheets.written, false);
    assert.match(ctx.notices[0].summaryLines.join("\n"), /Licenses: 1/);
    const step1 = await post(ctx.base, "/api/intake", customer({ email: "step1.records@example.com", notes: "A sentence." }));
    assert.equal(step1.status, 201);
  } finally {
    await ctx.stop();
  }
});
