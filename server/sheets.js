/** Append-only Google Sheet writer. A missing token or sheet id does nothing. */

import { assertNoSensitiveKeys } from "./validate.js";

export const SHEET_TABS = {
  Companies: ["Company", "Role", "Status", "NAICS", "NIGP", "Certifications", "Consent on file Y/N", "Source", "Last verified"],
  Licenses: ["Company", "License type", "Number", "Issuer", "Class/scope", "Expiry", "Doc link", "Source"],
  Insurance: ["Company", "Coverage type", "Limits", "Carrier", "Expiry", "COI link", "Source"],
  "Past Jobs": ["Company", "Client/agency", "Project", "Scope", "Contract value", "Start", "End", "Role prime/sub", "Reference id", "Source", "Completed vs bid-only"],
  References: ["Company", "Name", "Title", "Org", "Phone/email", "Relationship", "Permission to contact Y/N", "Source"],
  "Resumes optional": ["Company", "Person", "Role/title", "Doc link", "Source", "Last verified"],
  Gaps: ["Company", "Missing item", "Priority"],
};

const TEST_SOURCE = "TEST staging";

export function labelCompany(name, testMode) {
  const text = String(name || "").trim();
  if (!testMode) return text;
  if (text.startsWith("[TEST]")) return text;
  return text ? `[TEST] ${text}` : "[TEST]";
}

export function labelSource(source, testMode) {
  if (testMode) return TEST_SOURCE;
  const text = String(source || "").trim();
  return text || "website";
}

function yn(value) {
  if (value === true || value === "Y" || value === "yes" || value === "y") return "Y";
  if (value === false || value === "N" || value === "no" || value === "n") return "N";
  return "";
}

function cell(value) {
  return value == null ? "" : String(value);
}

function jobRole(value) {
  if (value === "prime") return "Prime";
  if (value === "sub") return "Sub";
  return cell(value);
}

function jobStatus(value) {
  if (value === "completed") return "Completed";
  if (value === "bid-only") return "Bid only";
  return cell(value);
}

function gapPriority(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "high") return "High";
  if (text === "medium") return "Medium";
  if (text === "low") return "Low";
  return cell(value).trim();
}

export function applyPrivateUpload(profile, kind) {
  const next = {
    ...profile,
    licenses: Array.isArray(profile.licenses) ? profile.licenses.map((row) => ({ ...row })) : [],
    insurance: Array.isArray(profile.insurance) ? profile.insurance.map((row) => ({ ...row })) : [],
  };
  const note = "Private upload saved with this registration";
  if (kind === "license") {
    if (!next.licenses.length) {
      next.licenses.push({ licenseType: "Uploaded file", number: "", issuer: "", scope: "", expiry: "", docLink: note });
    } else if (!next.licenses[0].docLink) {
      next.licenses[0].docLink = note;
    }
  }
  if (kind === "coi") {
    if (!next.insurance.length) {
      next.insurance.push({ coverageType: "Certificate of insurance", limits: "", carrier: "", expiry: "", coiLink: note });
    } else if (!next.insurance[0].coiLink) {
      next.insurance[0].coiLink = note;
    }
  }
  return next;
}

export function buildSheetRequests(profile, { testMode = true } = {}) {
  const company = labelCompany(profile.company, testMode);
  const source = labelSource(profile.source, testMode);
  const verified = cell(profile.verifiedOn);
  const requests = [{
    tab: "Companies",
    values: [[
      company,
      cell(profile.role),
      cell(profile.status),
      cell(profile.naics),
      cell(profile.nigp),
      cell(profile.certifications),
      yn(profile.consent),
      source,
      verified,
    ]],
  }];
  const licenses = (profile.licenses || []).map((row) => [
    company, cell(row.licenseType), cell(row.number), cell(row.issuer), cell(row.scope), cell(row.expiry), cell(row.docLink), source,
  ]);
  const insurance = (profile.insurance || []).map((row) => [
    company, cell(row.coverageType), cell(row.limits), cell(row.carrier), cell(row.expiry), cell(row.coiLink), source,
  ]);
  const jobs = (profile.pastJobs || []).map((row) => [
    company,
    cell(row.client),
    cell(row.project),
    cell(row.scope),
    cell(row.contractValue),
    cell(row.start),
    cell(row.end),
    jobRole(row.role),
    cell(row.referenceId),
    source,
    jobStatus(row.completed),
  ]);
  const references = (profile.references || []).map((row) => [
    company, cell(row.name), cell(row.title), cell(row.org), cell(row.contact), cell(row.relationship), yn(row.permission), source,
  ]);
  const resumes = (profile.resumes || []).map((row) => [
    company, cell(row.person), cell(row.role), cell(row.docLink), source, verified,
  ]);
  const gaps = (profile.gaps || []).map((row) => [
    company, cell(row.missing), gapPriority(row.priority),
  ]);
  const extras = [
    ["Licenses", licenses],
    ["Insurance", insurance],
    ["Past Jobs", jobs],
    ["References", references],
    ["Resumes optional", resumes],
    ["Gaps", gaps],
  ];
  for (const [tab, values] of extras) {
    if (values.length) requests.push({ tab, values });
  }
  for (const request of requests) {
    const width = SHEET_TABS[request.tab].length;
    for (const row of request.values) {
      if (row.length !== width) {
        throw new Error(`Sheet row for ${request.tab} has ${row.length} columns.`);
      }
    }
  }
  return requests;
}

export function sheetsFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const clientId = String(env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || "").trim();
  const refreshToken = String(env.GOOGLE_SHEETS_REFRESH_TOKEN || "").trim();
  const spreadsheetId = String(env.SHEETS_LIBRARY_ID || "").trim();
  const testMode = String(env.SHEETS_LIVE_WRITES || "").trim() !== "1";
  const configured = Boolean(clientId && clientSecret && refreshToken && spreadsheetId);
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
      throw new Error("Google Sheets authorization failed.");
    }
    cached = {
      token: payload.access_token,
      expiresAt: Date.now() + (Number(payload.expires_in) || 3000) * 1000,
    };
    return cached.token;
  }

  return {
    configured,
    testMode,
    async appendProfile(profile) {
      if (!configured) return { written: false, reason: "not_configured", tabs: {} };
      if (!profile || !String(profile.company || "").trim()) {
        return { written: false, reason: "missing_company", tabs: {} };
      }
      try {
        assertNoSensitiveKeys(profile);
      } catch {
        return { written: false, reason: "rejected", tabs: {} };
      }
      let requests;
      try {
        requests = buildSheetRequests(profile, { testMode });
      } catch {
        return { written: false, reason: "rejected", tabs: {} };
      }
      const tabs = {};
      try {
        const token = await accessToken();
        for (const request of requests) {
          const range = `${request.tab}!A1`;
          const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
          const response = await fetchImpl(url, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ values: request.values }),
          });
          if (!response.ok) {
            tabs[request.tab] = "failed";
            return { written: false, reason: "append_failed", tabs };
          }
          tabs[request.tab] = "ok";
        }
      } catch {
        return { written: false, reason: "append_failed", tabs };
      }
      return { written: true, reason: null, tabs };
    },
  };
}
