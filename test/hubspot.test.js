import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../server/app.js";
import {
  HUBSPOT_FORM_GUID,
  HUBSPOT_PORTAL_ID,
  HUBSPOT_TIMEOUT_MS,
  INTAKE_PAGE_NAME,
  INTAKE_PAGE_URI,
  buildHubSpotSubmission,
  hubspotConfigFromEnv,
  pageUriFromReferer,
  splitName,
  submitIntakeToHubSpot,
} from "../server/hubspot.js";
import { validateIntake } from "../server/validate.js";

const LEAD_ID = "5dfacc95-a894-4ff3-a028-dde4f9ab9cb2";
const SUBMITTED = "2026-11-11T00:40:00.000Z";

function intake(overrides = {}) {
  return validateIntake({
    name: "TEST ASBS HubSpot Sync - Do Not Contact",
    organization: "TEST - delete me",
    email: "asbs-hubspot-test-20261110@example.com",
    phone: "000-000-0000",
    consent: true,
    company_url: "",
    based: "Testville, TX",
    serviceInterest: "operations",
    serviceArea: "Greater Houston",
    timeline: "Next quarter",
    notes: "TEST SUBMISSION - delete",
    naics: "541611",
    nigp: "918-00 (test)",
    code_description: "Test record for HubSpot sync",
    ...overrides,
  });
}

function fieldMap(submission) {
  return Object.fromEntries(submission.fields.map((field) => [field.name, field.value]));
}

test("intake fields map to the public HubSpot form without a token or tracking context", () => {
  const saved = intake();
  const submission = buildHubSpotSubmission(saved, {
    leadId: LEAD_ID,
    submittedAt: SUBMITTED,
    pageUri: INTAKE_PAGE_URI,
  });
  const fields = fieldMap(submission);
  assert.deepEqual(splitName(saved.name), {
    firstname: "TEST",
    lastname: "ASBS HubSpot Sync - Do Not Contact",
  });
  assert.equal(fields.firstname, "TEST");
  assert.equal(fields.lastname, "ASBS HubSpot Sync - Do Not Contact");
  assert.equal(fields.email, "asbs-hubspot-test-20261110@example.com");
  assert.equal(fields.phone, "000-000-0000");
  assert.equal(fields.company, "TEST - delete me");
  assert.match(fields.naics, /^541611 — /);
  assert.equal(fields.nigp, "918-00 — (test)");
  assert.equal(fields.code_description, "Test record for HubSpot sync");
  assert.equal(fields.message.startsWith("TEST SUBMISSION - delete\n"), true);
  assert.match(fields.message, /Service area: Greater Houston/);
  assert.match(fields.message, /Services of interest: Growth, expansion, and readiness/);
  assert.match(fields.message, /Timeline: Next quarter/);
  assert.match(fields.message, new RegExp(`Submission id: ${LEAD_ID}`));
  assert.match(fields.message, new RegExp(`Submitted: ${SUBMITTED}`));
  assert.equal(submission.context.pageUri, INTAKE_PAGE_URI);
  assert.equal(submission.context.pageName, INTAKE_PAGE_NAME);
  assert.equal("hutk" in submission.context, false);
  assert.equal("ipAddress" in submission.context, false);
  assert.equal(submission.fields.every((field) => field.objectTypeId === "0-1"), true);
  assert.equal(pageUriFromReferer(""), INTAKE_PAGE_URI);
  assert.equal(pageUriFromReferer("https://www.americanstandardbusinesssolutions.com/intake.html"), INTAKE_PAGE_URI);
  assert.equal(hubspotConfigFromEnv({}).portalId, HUBSPOT_PORTAL_ID);
  assert.equal(hubspotConfigFromEnv({}).formGuid, HUBSPOT_FORM_GUID);
  assert.equal(HUBSPOT_TIMEOUT_MS, 8000);
  assert.equal(splitName("Ada").lastname, "");
});

test("HubSpot retries once after a timeout or 5xx and does not retry a 4xx", async () => {
  const saved = intake({ name: "Ada Lovelace", email: "ada@example.com", notes: "Hello" });
  const logs = [];
  let timeouts = 0;
  const timeoutResult = await submitIntakeToHubSpot({
    intake: saved,
    leadId: LEAD_ID,
    submittedAt: SUBMITTED,
    timeoutMs: 20,
    log: (entry) => logs.push(entry),
    fetchImpl: (_url, init) => new Promise((resolve, reject) => {
      timeouts += 1;
      if (timeouts === 1) {
        const fail = () => {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          reject(error);
        };
        if (init.signal.aborted) fail();
        else init.signal.addEventListener("abort", fail, { once: true });
        return;
      }
      resolve(new Response("{}", { status: 200 }));
    }),
  });
  assert.equal(timeouts, 2);
  assert.equal(timeoutResult.status, 200);
  assert.equal(timeoutResult.ok, true);

  let serverErrors = 0;
  const recovered = await submitIntakeToHubSpot({
    intake: saved,
    leadId: LEAD_ID,
    submittedAt: SUBMITTED,
    log: (entry) => logs.push(entry),
    fetchImpl: async () => {
      serverErrors += 1;
      return new Response("busy", { status: serverErrors === 1 ? 503 : 200 });
    },
  });
  assert.equal(serverErrors, 2);
  assert.equal(recovered.status, 200);

  let rejected = 0;
  const clientError = await submitIntakeToHubSpot({
    intake: saved,
    leadId: LEAD_ID,
    submittedAt: SUBMITTED,
    log: (entry) => logs.push(entry),
    fetchImpl: async () => {
      rejected += 1;
      return new Response("no", { status: 400 });
    },
  });
  assert.equal(rejected, 1);
  assert.equal(clientError.ok, false);
  assert.equal(clientError.status, 400);

  const logged = JSON.stringify(logs);
  assert.equal(logged.includes("ada@example.com"), false);
  assert.equal(logged.includes("Ada Lovelace"), false);
  assert.equal(logs.every((entry) => entry.leadId === LEAD_ID && entry.event === "hubspot_intake"), true);
});

test("a HubSpot failure still saves the intake and records hubspotStatus", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asbs-hubspot-"));
  let calls = 0;
  const app = createApp({
    dataDir,
    rootDir: path.resolve("."),
    now: () => new Date("2026-11-11T00:40:00.000Z"),
    calendar: { configured: false, reason: "test", async listBusy() { throw new Error("no"); } },
    mailer: { configured: false, async notify() { return { sent: false }; } },
    hubspotFetch: async () => {
      calls += 1;
      throw new Error("network down");
    },
    hubspotTimeoutMs: 20,
    env: {
      ASBS_ENV: "staging",
      ASBS_DASHBOARD_PASSWORD: "test-dashboard-password",
      ASBS_SESSION_SECRET: "test-session-secret",
    },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const response = await fetch(base + "/api/intake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://www.americanstandardbusinesssolutions.com/intake.html",
      },
      body: JSON.stringify({
        name: "TEST ASBS HubSpot Sync - Do Not Contact",
        organization: "TEST - delete me",
        email: "hubspot.down@example.com",
        phone: "000-000-0000",
        consent: true,
        based: "Testville, TX",
        serviceInterest: "operations",
        notes: "TEST SUBMISSION - delete",
      }),
    });
    const data = await response.json();
    assert.equal(response.status, 201);
    assert.equal(data.hubspot.ok, false);
    assert.equal(data.hubspot.status, 0);
    assert.equal(calls, 2);
    const login = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "test-dashboard-password" }),
    });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const dash = await fetch(base + "/api/dashboard", { headers: { cookie } });
    const body = await dash.json();
    const lead = body.leads.find((item) => item.email === "hubspot.down@example.com");
    assert.equal(lead.hubspotStatus.ok, false);
    assert.equal(lead.hubspotStatus.status, 0);
  } finally {
    app.server.close();
    await once(app.server, "close");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
