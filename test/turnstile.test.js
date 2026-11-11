import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../server/app.js";
import { checkTurnstile, turnstilePublic } from "../server/turnstile.js";

const SECRET = "test-turnstile-secret";
const SITE_KEY = "test-turnstile-site-key";

function listen(app) {
  app.server.listen(0, "127.0.0.1");
  return once(app.server, "listening").then(() => `http://127.0.0.1:${app.server.address().port}`);
}

function appWith(turnstileFetch, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "asbs-turnstile-"));
  const app = createApp({
    dataDir,
    rootDir: path.resolve("."),
    now: () => new Date("2026-11-11T01:00:00.000Z"),
    calendar: { configured: false, reason: "test", async listBusy() { throw new Error("no"); } },
    mailer: { configured: false, async notify() { return { sent: false }; } },
    hubspotFetch: async () => new Response("{}", { status: 200 }),
    turnstileFetch,
    env: {
      ASBS_ENV: "staging",
      ASBS_DASHBOARD_PASSWORD: "test-dashboard-password",
      ASBS_SESSION_SECRET: "test-session-secret",
      ...env,
    },
  });
  return { app, dataDir };
}

async function postIntake(base, extra = {}) {
  const response = await fetch(base + "/api/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "TEST ASBS Fixes - Do Not Contact",
      organization: "TEST - delete me",
      email: extra.email || "turnstile@example.com",
      phone: "000-000-0000",
      consent: true,
      based: "Testville, TX",
      serviceInterest: "operations",
      company_url: "",
      formStartedAt: Date.parse("2026-11-11T01:00:00.000Z") - 10000,
      ...extra,
    }),
  });
  const data = await response.json();
  return { status: response.status, data };
}

async function emails(base) {
  const login = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-dashboard-password" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const dash = await fetch(base + "/api/dashboard", { headers: { cookie } });
  const body = await dash.json();
  return body.leads.map((lead) => lead.email);
}

test("Turnstile stays off unless both keys are set, and the secret is not public", () => {
  assert.deepEqual(turnstilePublic({}), { enabled: false });
  assert.deepEqual(turnstilePublic({ TURNSTILE_SITE_KEY: SITE_KEY }), { enabled: false });
  assert.deepEqual(turnstilePublic({ TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: SECRET }), {
    enabled: true,
    siteKey: SITE_KEY,
  });
  assert.equal(JSON.stringify(turnstilePublic({ TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: SECRET })).includes(SECRET), false);
});

test("a configured Turnstile challenge blocks a missing or rejected token and allows a verified one", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(init.body.toString());
    const token = new URLSearchParams(init.body).get("response");
    return new Response(JSON.stringify({ success: token === "good-token" }), { status: 200 });
  };
  const { app, dataDir } = appWith(fetchImpl, {
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
  });
  const base = await listen(app);
  try {
    const health = await fetch(base + "/api/health");
    const healthBody = await health.json();
    assert.equal(healthBody.turnstile.enabled, true);
    assert.equal(healthBody.turnstile.siteKey, SITE_KEY);
    assert.equal(JSON.stringify(healthBody).includes(SECRET), false);

    const missing = await postIntake(base, { email: "missing.token@example.com" });
    assert.equal(missing.status, 400);

    const rejected = await postIntake(base, { email: "bad.token@example.com", turnstileToken: "bad-token" });
    assert.equal(rejected.status, 400);

    const accepted = await postIntake(base, { email: "good.token@example.com", turnstileToken: "good-token" });
    assert.equal(accepted.status, 201);
    assert.match(calls.at(-1), /secret=test-turnstile-secret/);
    assert.match(calls.at(-1), /response=good-token/);
    assert.equal(calls.length, 2);

    const stored = await emails(base);
    assert.equal(stored.includes("missing.token@example.com"), false);
    assert.equal(stored.includes("bad.token@example.com"), false);
    assert.equal(stored.includes("good.token@example.com"), true);
  } finally {
    app.server.close();
    await once(app.server, "close");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("a Turnstile outage does not block a real intake", async () => {
  const { app, dataDir } = appWith(async () => {
    throw new Error("cloudflare down");
  }, {
    TURNSTILE_SITE_KEY: SITE_KEY,
    TURNSTILE_SECRET_KEY: SECRET,
  });
  const base = await listen(app);
  try {
    const saved = await postIntake(base, { email: "outage@example.com", turnstileToken: "any-token" });
    assert.equal(saved.status, 201);
    assert.equal((await emails(base)).includes("outage@example.com"), true);
  } finally {
    app.server.close();
    await once(app.server, "close");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("checkTurnstile skips verification when the keys are unset", async () => {
  let called = false;
  const result = await checkTurnstile({ turnstileToken: "" }, {}, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(called, false);
});
