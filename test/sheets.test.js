import assert from "node:assert/strict";
import test from "node:test";
import {
  SHEET_TABS,
  applyPrivateUpload,
  buildSheetRequests,
  labelCompany,
  sheetsFromEnv,
} from "../server/sheets.js";

const profile = {
  company: "Example Supply LLC",
  role: "Partner",
  status: "New",
  naics: "541511",
  nigp: "123-45",
  certifications: "HUB",
  consent: true,
  source: "website partner",
  verifiedOn: "2026-11-14",
  licenses: [{ licenseType: "Electrical", number: "E-1", issuer: "Texas", scope: "Commercial", expiry: "2027-01-01", docLink: "https://example.com/license" }],
  insurance: [{ coverageType: "General liability", limits: "1 million", carrier: "Example Mutual", expiry: "2027-02-01", coiLink: "" }],
  pastJobs: [{ client: "City of Dallas", project: "Warehouse", scope: "Supplies", contractValue: "25000", start: "2024-01-01", end: "2024-06-01", role: "sub", referenceId: "PO-9", completed: "completed" }],
  references: [{ name: "Pat Example", title: "Buyer", org: "City of Dallas", contact: "pat@example.com", relationship: "Past client", permission: "yes" }],
  resumes: [{ person: "Pat Example", role: "Estimator", docLink: "https://example.com/resume" }],
  gaps: [],
};

test("sheet rows use the exact columns and default test labels", () => {
  const requests = buildSheetRequests(profile, { testMode: true });
  const byTab = Object.fromEntries(requests.map((item) => [item.tab, item.values]));
  assert.deepEqual(Object.keys(byTab), ["Companies", "Licenses", "Insurance", "Past Jobs", "References", "Resumes optional"]);
  assert.equal(byTab.Companies[0].length, SHEET_TABS.Companies.length);
  assert.deepEqual(byTab.Companies[0], [
    "[TEST] Example Supply LLC", "Partner", "New", "541511", "123-45", "HUB", "Y", "TEST staging", "2026-11-14",
  ]);
  assert.deepEqual(byTab.Licenses[0], [
    "[TEST] Example Supply LLC", "Electrical", "E-1", "Texas", "Commercial", "2027-01-01", "https://example.com/license", "TEST staging",
  ]);
  assert.deepEqual(byTab["Past Jobs"][0], [
    "[TEST] Example Supply LLC", "City of Dallas", "Warehouse", "Supplies", "25000", "2024-01-01", "2024-06-01", "Sub", "PO-9", "TEST staging", "Completed",
  ]);
  assert.equal(byTab.References[0][6], "Y");
  assert.equal(byTab["Resumes optional"][0][5], "2026-11-14");
  assert.equal(requests.some((item) => item.tab === "Gaps"), false);
});

test("live writes keep the company and source", () => {
  const [companies] = buildSheetRequests(profile, { testMode: false });
  assert.equal(companies.values[0][0], "Example Supply LLC");
  assert.equal(companies.values[0][7], "website partner");
  assert.equal(labelCompany("[TEST] Already", true), "[TEST] Already");
});

test("a private upload fills an empty document link", () => {
  const next = applyPrivateUpload(profile, "coi");
  assert.equal(next.insurance[0].coiLink, "Private upload saved with this registration");
  const empty = applyPrivateUpload({ ...profile, licenses: [] }, "license");
  assert.equal(empty.licenses[0].docLink, "Private upload saved with this registration");
});

test("the writer does nothing until the token and sheet id are set", async () => {
  let called = false;
  const sheets = sheetsFromEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  });
  assert.equal(sheets.configured, false);
  const result = await sheets.appendProfile(profile);
  assert.deepEqual(result, { written: false, reason: "not_configured", tabs: {} });
  assert.equal(called, false);
});

test("configured writes append each tab and stop when Sheets rejects a tab", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: options.body });
    if (String(url).includes("oauth2")) {
      return new Response(JSON.stringify({ access_token: "token-1", expires_in: 3600 }), { status: 200 });
    }
    if (String(url).includes("Past%20Jobs")) return new Response("no", { status: 500 });
    return new Response(JSON.stringify({ updates: { updatedRows: 1 } }), { status: 200 });
  };
  const sheets = sheetsFromEnv({
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_SHEETS_REFRESH_TOKEN: "refresh-token",
    SHEETS_LIBRARY_ID: "sheet-id",
  }, fetchImpl);
  const failed = await sheets.appendProfile(profile);
  assert.equal(failed.written, false);
  assert.equal(failed.reason, "append_failed");
  assert.equal(failed.tabs.Licenses, "ok");
  assert.equal(failed.tabs["Past Jobs"], "failed");
  const append = calls.find((call) => call.url.includes("/values/"));
  assert.match(append.url, /spreadsheets\/sheet-id\/values\//);
  assert.match(append.url, /valueInputOption=USER_ENTERED/);
  assert.equal(JSON.parse(append.body).values[0][0], "[TEST] Example Supply LLC");
  const sheetBodies = calls.filter((call) => call.url.includes("/values/")).map((call) => call.body).join("\n");
  assert.equal(sheetBodies.includes("refresh-token"), false);

  calls.length = 0;
  const live = sheetsFromEnv({
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_SHEETS_REFRESH_TOKEN: "refresh-token",
    SHEETS_LIBRARY_ID: "sheet-id",
    SHEETS_LIVE_WRITES: "1",
  }, async (url) => {
    calls.push(String(url));
    if (String(url).includes("oauth2")) return new Response(JSON.stringify({ access_token: "token-2", expires_in: 3600 }), { status: 200 });
    return new Response("{}", { status: 200 });
  });
  const companyOnly = await live.appendProfile({ ...profile, licenses: [], insurance: [], pastJobs: [], references: [], resumes: [], gaps: [{ missing: "COI", priority: "high" }] });
  assert.equal(companyOnly.written, true);
  assert.deepEqual(Object.keys(companyOnly.tabs), ["Companies", "Gaps"]);
});

test("a sensitive field never reaches Sheets", async () => {
  let called = false;
  const sheets = sheetsFromEnv({
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_SHEETS_REFRESH_TOKEN: "refresh-token",
    SHEETS_LIBRARY_ID: "sheet-id",
  }, async () => {
    called = true;
    return new Response("{}", { status: 200 });
  });
  const result = await sheets.appendProfile({ ...profile, licenses: [{ ...profile.licenses[0], dob: "2000-01-01" }] });
  assert.equal(result.written, false);
  assert.equal(result.reason, "rejected");
  assert.equal(called, false);
});
