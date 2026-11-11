export const HUBSPOT_PORTAL_ID = "247883336";
export const HUBSPOT_FORM_GUID = "2f694034-1873-43f6-b6f8-f57264d7c5f8";
export const HUBSPOT_TIMEOUT_MS = 8000;
export const INTAKE_PAGE_URI = "https://www.americanstandardbusinesssolutions.com/intake.html";
export const INTAKE_PAGE_NAME = "ASBS Intake";

const INTEREST_LABELS = {
  operations: "Growth, expansion, and readiness",
  "contracting-readiness": "Government contracting opportunities",
  "procurement-consulting": "Commercial contracting opportunities",
  "supply-chain": "Operational readiness",
  other: "Something else",
};

export function hubspotConfigFromEnv(env = {}) {
  const portalId = String(env.HUBSPOT_PORTAL_ID || HUBSPOT_PORTAL_ID).trim() || HUBSPOT_PORTAL_ID;
  const formGuid = String(env.HUBSPOT_FORM_GUID || HUBSPOT_FORM_GUID).trim() || HUBSPOT_FORM_GUID;
  return {
    portalId,
    formGuid,
    url: `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
  };
}

export function splitName(name) {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ");
  const space = cleaned.indexOf(" ");
  if (space === -1) return { firstname: cleaned, lastname: "" };
  return {
    firstname: cleaned.slice(0, space),
    lastname: cleaned.slice(space + 1).trim(),
  };
}

export function pageUriFromReferer(referer) {
  const raw = Array.isArray(referer) ? referer[0] : referer;
  if (!raw) return INTAKE_PAGE_URI;
  try {
    const url = new URL(String(raw));
    if (url.protocol !== "https:" && url.protocol !== "http:") return INTAKE_PAGE_URI;
    if (url.username || url.password) return INTAKE_PAGE_URI;
    url.hash = "";
    url.username = "";
    url.password = "";
    const value = url.toString();
    if (value.length > 500) return INTAKE_PAGE_URI;
    return value;
  } catch {
    return INTAKE_PAGE_URI;
  }
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function interestLabel(value) {
  const raw = text(value);
  return INTEREST_LABELS[raw] || raw;
}

export function buildHubSpotSubmission(intake, { leadId, submittedAt, pageUri } = {}) {
  const { firstname, lastname } = splitName(intake.name);
  const codeDescription = text(intake.code_description) || text(intake.businessDescription);
  const visitorMessage = text(intake.notes) || text(intake.message);
  const lines = [];
  if (visitorMessage) lines.push(visitorMessage);
  const add = (label, value) => {
    const line = text(value);
    if (line) lines.push(`${label}: ${line}`);
  };
  add("Service area", intake.serviceArea);
  add("Services of interest", interestLabel(intake.serviceInterest));
  if (Array.isArray(intake.contractingLevel) && intake.contractingLevel.length) {
    add("Contracting interest", intake.contractingLevel.join(", "));
  }
  add("Timeline", intake.timeline);
  add("Based", [intake.businessCity, intake.businessState].filter(Boolean).join(", "));
  add("Industry", intake.industry);
  if (text(intake.code_description) && text(intake.businessDescription)) {
    add("Business description", intake.businessDescription);
  }
  add("Submission id", leadId);
  add("Submitted", submittedAt);

  const fields = [];
  const push = (name, value) => {
    const line = text(value);
    if (line) fields.push({ objectTypeId: "0-1", name, value: line });
  };
  push("email", intake.email);
  push("firstname", firstname);
  push("lastname", lastname);
  push("phone", intake.phone);
  push("company", intake.organization);
  push("naics", intake.naics);
  push("nigp", intake.nigp);
  push("code_description", codeDescription);
  push("message", lines.join("\n"));

  return {
    fields,
    context: {
      pageUri: pageUri || INTAKE_PAGE_URI,
      pageName: INTAKE_PAGE_NAME,
    },
  };
}

function failureKind(error) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "timeout";
  return "network";
}

function logResult(log, leadId, result) {
  const entry = {
    event: "hubspot_intake",
    leadId,
    ok: result.ok === true,
    status: Number(result.status) || 0,
  };
  if (result.error) entry.error = result.error;
  if (typeof log === "function") log(entry);
  else console.info(JSON.stringify(entry));
  return entry;
}

function postOnce(fetchImpl, url, body, timeoutMs) {
  const controller = new AbortController();
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error("The HubSpot request timed out.");
      error.name = "TimeoutError";
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    Promise.resolve(fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body,
      signal: controller.signal,
    })).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function documentReceiptMessage({ received = [], authorization = "pending" } = {}) {
  const labels = [];
  if (received.includes("W9")) labels.push("W9");
  if (received.includes("COI")) labels.push("COI");
  const auth = authorization === "signed" ? "signed" : "pending";
  return `documents received: ${labels.join(", ") || "none"}; authorization: ${auth}`;
}

export async function submitDocumentReceipt({
  email,
  message,
  leadId,
  env,
  fetchImpl = globalThis.fetch,
  log,
  timeoutMs = HUBSPOT_TIMEOUT_MS,
} = {}) {
  const { url } = hubspotConfigFromEnv(env);
  const payload = {
    fields: [
      { objectTypeId: "0-1", name: "email", value: String(email || "") },
      { objectTypeId: "0-1", name: "message", value: String(message || "") },
    ],
    context: { pageUri: INTAKE_PAGE_URI, pageName: INTAKE_PAGE_NAME },
  };
  try {
    const response = await postOnce(fetchImpl, url, JSON.stringify(payload), timeoutMs);
    logResult(log, leadId, { ok: response.status >= 200 && response.status < 300, status: response.status });
    return { ok: response.ok, status: response.status };
  } catch {
    logResult(log, leadId, { ok: false, status: 0, error: "network" });
    return { ok: false, status: 0 };
  }
}

export async function submitIntakeToHubSpot({
  intake,
  leadId,
  submittedAt,
  pageUri,
  env,
  fetchImpl = globalThis.fetch,
  log,
  timeoutMs = HUBSPOT_TIMEOUT_MS,
} = {}) {
  const { url } = hubspotConfigFromEnv(env);
  const payload = buildHubSpotSubmission(intake, { leadId, submittedAt, pageUri });
  const body = JSON.stringify(payload);
  let last = { ok: false, status: 0, error: "network" };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await postOnce(fetchImpl, url, body, timeoutMs);
      const status = response.status;
      if (status >= 500 && attempt === 1) {
        last = { ok: false, status, error: "server" };
        continue;
      }
      const result = { ok: status >= 200 && status < 300, status };
      logResult(log, leadId, result);
      return result;
    } catch (error) {
      last = { ok: false, status: 0, error: failureKind(error) };
      if (attempt === 1) continue;
    }
  }

  logResult(log, leadId, last);
  return { ok: false, status: last.status || 0 };
}
