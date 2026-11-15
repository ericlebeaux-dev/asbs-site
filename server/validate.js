import { normalizeNaics, normalizeNigp } from "./codes.js";
import { PACKAGES } from "./packages.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BANNED_KEYS = [
  "ssn",
  "socialsecurity",
  "socialsecuritynumber",
  "password",
  "passwd",
  "bankaccount",
  "accountnumber",
  "routingnumber",
  "routing",
  "cvv",
  "cvc",
  "cardnumber",
  "otp",
  "onetimecode",
  "ein",
  "taxid",
  "taxpayerid",
  "employeridentificationnumber",
  "dob",
  "dateofbirth",
  "birthdate",
  "birthday",
  "dateborn",
];

export const SERVICE_INTERESTS = [
  ...PACKAGES.map((item) => item.id),
  "contracting-readiness",
  "procurement-consulting",
  "supply-chain",
  "operations",
  "janitorial",
  "supplies",
  "facility-support",
  "other",
];

export const BUDGET_RANGES = [
  "not-sure",
  "under-1000",
  "1000-5000",
  "5000-15000",
  "over-15000",
  "prefer-to-discuss",
];

export const LEAD_SOURCES = ["website", "referral", "search", "event", "other"];

export function httpError(status, message, fields) {
  const error = new Error(message);
  error.status = status;
  if (fields) error.fields = fields;
  return error;
}

export function assertNoSensitiveKeys(value, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (BANNED_KEYS.includes(normalized)) {
      throw httpError(400, "That form asked for information ASBS does not collect. Remove sensitive identity, banking, or password fields and submit again.");
    }
    assertNoSensitiveKeys(child, path ? `${path}.${key}` : key);
  }
}

export function cleanText(value, max, { required = false, label = "This field" } = {}) {
  if (value == null) value = "";
  if (typeof value !== "string") throw httpError(400, `${label} must be text.`);
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (required && !text) throw httpError(400, `${label} is required.`, [label]);
  if (text.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`);
  return text;
}

export function cleanEmail(value) {
  const email = cleanText(value, 160, { required: true, label: "Email" }).toLowerCase();
  if (!EMAIL.test(email)) throw httpError(400, "Enter a valid email address.", ["Email"]);
  return email;
}

export function cleanPhone(value) {
  const phone = cleanText(value, 40, { required: true, label: "Phone" });
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw httpError(400, "Enter a phone number with at least 10 digits.", ["Phone"]);
  return phone;
}

export function cleanChoice(value, allowed, label, { required = false } = {}) {
  const text = cleanText(value, 80, { required, label });
  if (!text && !required) return "";
  if (!allowed.includes(text)) throw httpError(400, `${label} is not a valid choice.`);
  return text;
}

export function cleanList(value, allowed, label, max = 8) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  if (items.length > max) throw httpError(400, `${label} has too many selections.`);
  return items.map((item) => cleanChoice(item, allowed, label, { required: true }));
}

export const MIN_FILL_MS = 3000;

export function rejectHoneypot(body) {
  if (body && typeof body.company_url === "string" && body.company_url.trim()) {
    throw httpError(400, "The form could not be submitted.");
  }
}

function startedAtMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return null;
}

export function isQuietSpam(body, now = Date.now()) {
  if (!body || typeof body !== "object") return false;
  if (typeof body.company_url === "string" && body.company_url.trim()) return true;
  const started = startedAtMs(body.formStartedAt);
  if (started == null) return false;
  const elapsed = now - started;
  return elapsed >= 0 && elapsed < MIN_FILL_MS;
}

export function requireConsent(body) {
  if (body?.consent !== true) {
    throw httpError(400, "Consent to be contacted is required before ASBS can save this request.", ["Consent"]);
  }
}

function contactBase(body) {
  assertNoSensitiveKeys(body);
  rejectHoneypot(body);
  requireConsent(body);
  return {
    name: cleanText(body.name, 120, { required: true, label: "Name" }),
    email: cleanEmail(body.email),
    phone: cleanPhone(body.phone),
    organization: cleanText(body.organization, 160, { required: true, label: "Business name" }),
    consent: true,
    consentAt: new Date().toISOString(),
  };
}

function intakeLocation(body) {
  const city = cleanText(body.businessCity, 80);
  const state = cleanText(body.businessState, 40);
  if (city && state) return { businessCity: city, businessState: state };
  if (city || state) throw httpError(400, "Enter both a city and a state.", ["Where the business is based"]);
  const based = cleanText(body.based, 120, { required: true, label: "Where the business is based" });
  const comma = based.lastIndexOf(",");
  const parsedCity = comma > 0 ? based.slice(0, comma).trim() : "";
  const parsedState = comma > 0 ? based.slice(comma + 1).trim() : "";
  if (!parsedCity || !parsedState || parsedCity.length > 80 || parsedState.length > 40) {
    throw httpError(400, "Enter a city and state, such as Katy, TX.", ["Where the business is based"]);
  }
  return { businessCity: parsedCity, businessState: parsedState };
}

function assertContracting(levels) {
  const government = levels.some((level) => level === "federal" || level === "state" || level === "local");
  if (government && (levels.includes("none") || levels.includes("unsure"))) {
    throw httpError(400, "Not pursuing contracts and Not sure cannot be combined with Federal, State, or Local.", ["Contracting interest"]);
  }
  return levels;
}

const ROW_LIMIT = 10;

function cleanLink(value, label) {
  const text = cleanText(value, 500, { label });
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw httpError(400, `${label} must start with https://.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw httpError(400, `${label} must start with https://.`);
  }
  return text;
}

function cleanRows(value, cleaner) {
  if (value == null || value === "") return [];
  if (!Array.isArray(value)) throw httpError(400, "Send each item as its own row.");
  if (value.length > ROW_LIMIT) throw httpError(400, `Send up to ${ROW_LIMIT} rows.`);
  return value.map((row) => cleaner(row)).filter(Boolean);
}

function present(values) {
  return values.some((value) => String(value || "").trim());
}

function cleanLicenseRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw httpError(400, "A license row could not be read.");
  assertNoSensitiveKeys(row);
  const item = {
    licenseType: cleanText(row.licenseType, 120),
    number: cleanText(row.number, 80),
    issuer: cleanText(row.issuer, 160),
    scope: cleanText(row.scope, 200),
    expiry: cleanText(row.expiry, 40),
    docLink: cleanLink(row.docLink, "License link"),
  };
  return present(Object.values(item)) ? item : null;
}

function cleanInsuranceRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw httpError(400, "An insurance row could not be read.");
  assertNoSensitiveKeys(row);
  const item = {
    coverageType: cleanText(row.coverageType, 120),
    limits: cleanText(row.limits, 160),
    carrier: cleanText(row.carrier, 160),
    expiry: cleanText(row.expiry, 40),
    coiLink: cleanLink(row.coiLink, "Certificate of insurance link"),
  };
  return present(Object.values(item)) ? item : null;
}

function cleanJobRole(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (!text) return "";
  if (text === "prime" || text === "sub") return text;
  throw httpError(400, "Role must be prime or sub.");
}

function cleanJobStatus(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (!text) return "";
  if (text === "completed") return "completed";
  if (text === "bid-only" || text === "bid only") return "bid-only";
  throw httpError(400, "Mark the job completed or bid only.");
}

function cleanJobRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw httpError(400, "A past job row could not be read.");
  assertNoSensitiveKeys(row);
  const item = {
    client: cleanText(row.client, 160),
    project: cleanText(row.project, 160),
    scope: cleanText(row.scope, 500),
    contractValue: cleanText(row.contractValue, 80),
    start: cleanText(row.start, 40),
    end: cleanText(row.end, 40),
    role: cleanJobRole(row.role),
    referenceId: cleanText(row.referenceId, 80),
    completed: cleanJobStatus(row.completed),
  };
  return present([item.client, item.project, item.scope, item.contractValue, item.start, item.end, item.role, item.referenceId, item.completed]) ? item : null;
}

function cleanPermission(value, required) {
  const text = cleanText(value, 8).toLowerCase();
  if (!text && !required) return "";
  if (text === "yes" || text === "y") return "yes";
  if (text === "no" || text === "n") return "no";
  throw httpError(400, "Choose whether ASBS may contact this reference.", ["Permission to contact"]);
}

function cleanReferenceRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw httpError(400, "A reference row could not be read.");
  assertNoSensitiveKeys(row);
  const item = {
    name: cleanText(row.name, 120),
    title: cleanText(row.title, 120),
    org: cleanText(row.org, 160),
    contact: cleanText(row.contact, 160),
    relationship: cleanText(row.relationship, 160),
  };
  if (!present(Object.values(item))) return null;
  item.permission = cleanPermission(row.permission, true);
  return item;
}

function cleanResumeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw httpError(400, "A resume row could not be read.");
  assertNoSensitiveKeys(row);
  const item = {
    person: cleanText(row.person, 120),
    role: cleanText(row.role, 120),
    docLink: cleanLink(row.docLink, "Resume link"),
  };
  return present(Object.values(item)) ? item : null;
}

function legacyLicense(value) {
  const text = cleanText(value, 1000);
  return text ? [{ licenseType: text, number: "", issuer: "", scope: "", expiry: "", docLink: "" }] : [];
}

function legacyInsurance(value) {
  const text = cleanText(value, 1000);
  return text ? [{ coverageType: text, limits: "", carrier: "", expiry: "", coiLink: "" }] : [];
}

function legacyJob(value) {
  const text = cleanText(value, 2000);
  return text ? [{ client: "", project: "", scope: text, contractValue: "", start: "", end: "", role: "", referenceId: "", completed: "" }] : [];
}

function documentRows(value, cleaner, legacy) {
  if (typeof value === "string") return legacy(value);
  return cleanRows(value, cleaner);
}

export function cleanDocumentKind(value) {
  const text = cleanText(value, 20).toLowerCase();
  if (!text) return "";
  if (text === "license" || text === "coi" || text === "other") return text;
  throw httpError(400, "Choose what the uploaded file is.");
}

export function validateIntake(body) {
  const contact = contactBase(body);
  const contracting = assertContracting(cleanList(
    body.contractingLevel,
    ["federal", "state", "local", "none", "unsure"],
    "Contracting interest",
  ));
  const location = intakeLocation(body);
  const leadSource = body.leadSource == null
    ? "website"
    : cleanChoice(body.leadSource, LEAD_SOURCES, "Lead source");
  return {
    ...contact,
    role: "customer",
    ...location,
    serviceArea: cleanText(body.serviceArea, 160),
    businessDescription: cleanText(body.businessDescription, 2000),
    industry: cleanText(body.industry, 120),
    serviceInterest: cleanChoice(body.serviceInterest, SERVICE_INTERESTS, "Service interest", { required: true }),
    contractingLevel: contracting,
    naics: normalizeNaics(body.naics),
    nigp: normalizeNigp(body.nigp),
    code_description: cleanText(body.code_description, 500),
    uei: cleanText(body.uei, 20),
    cage: cleanText(body.cage, 10),
    registrations: cleanText(body.registrations, 1000),
    certifications: cleanText(body.certifications, 1000),
    priorExperience: cleanText(body.priorExperience, 2000),
    challenges: cleanText(body.challenges, 2000),
    timeline: cleanText(body.timeline, 160),
    budgetRange: cleanChoice(body.budgetRange, BUDGET_RANGES, "Budget range"),
    consultationType: cleanText(body.consultationType, 40),
    leadSource,
    packageId: cleanText(body.packageId, 40),
    notes: cleanText(body.notes, 2000),
    bonding: cleanText(body.bonding, 500),
    licenses: documentRows(body.licenses, cleanLicenseRow, legacyLicense),
    insurance: documentRows(body.insurance, cleanInsuranceRow, legacyInsurance),
    pastJobs: documentRows(body.pastJobs, cleanJobRow, legacyJob),
    references: Array.isArray(body.references) ? cleanRows(body.references, cleanReferenceRow) : [],
    referencesNote: typeof body.references === "string" ? cleanText(body.references, 1000) : "",
    resumes: cleanRows(body.resumes, cleanResumeRow),
  };
}

export function validateVendor(body) {
  assertNoSensitiveKeys(body);
  rejectHoneypot(body);
  requireConsent(body);
  return {
    role: "vendor",
    legalName: cleanText(body.legalName, 160, { required: true, label: "Legal business name" }),
    name: cleanText(body.contactName, 120, { required: true, label: "Primary contact" }),
    email: cleanEmail(body.email),
    phone: cleanPhone(body.phone),
    services: cleanText(body.services, 2000, { required: true, label: "Services" }),
    coverage: cleanText(body.coverage, 500, { required: true, label: "Geographic coverage" }),
    naics: cleanText(body.naics, 160),
    nigp: cleanText(body.nigp, 160),
    certifications: cleanText(body.certifications, 1000),
    registrations: cleanText(body.registrations, 1000),
    equipment: cleanText(body.equipment, 1000),
    experience: cleanText(body.experience, 2000),
    bonding: cleanText(body.bonding, 500),
    licenses: documentRows(body.licenses, cleanLicenseRow, legacyLicense),
    insurance: documentRows(body.insurance, cleanInsuranceRow, legacyInsurance),
    pastJobs: documentRows(body.pastJobs || body.experience, cleanJobRow, legacyJob),
    references: Array.isArray(body.references) ? cleanRows(body.references, cleanReferenceRow) : [],
    referencesNote: typeof body.references === "string" ? cleanText(body.references, 1000) : "",
    resumes: cleanRows(body.resumes, cleanResumeRow),
    documentKind: cleanDocumentKind(body.documentKind),
    teamingInterest: cleanChoice(body.teamingInterest, ["yes", "no", "later"], "Teaming interest", { required: true }),
    notes: cleanText(body.notes, 2000),
    consent: true,
    consentAt: new Date().toISOString(),
    organization: cleanText(body.legalName, 160, { required: true, label: "Legal business name" }),
  };
}

export function validateQuote(body) {
  assertNoSensitiveKeys(body);
  rejectHoneypot(body);
  if (body && typeof body._honey === "string" && body._honey.trim()) {
    throw httpError(400, "The form could not be submitted.");
  }
  requireConsent(body);
  const services = Array.isArray(body.services) ? body.services : body.services ? [body.services] : [];
  if (services.length > 12) throw httpError(400, "Select fewer services.");
  return {
    name: cleanText(body.name, 120, { required: true, label: "Name" }),
    email: cleanEmail(body.email),
    phone: optionalPhone(body.phone),
    organization: cleanText(body.organization, 160),
    buyerType: cleanText(body.buyer_type || body.buyerType, 80),
    services: services.map((item) => cleanText(item, 120)).filter(Boolean),
    quantity: cleanText(body.quantity_scope || body.quantity, 200),
    timeline: cleanText(body.timeline, 160),
    details: cleanText(body.details, 4000),
    consent: true,
  };
}

function optionalPhone(value) {
  const phone = cleanText(value, 40);
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw httpError(400, "Enter a phone number with at least 10 digits.", ["Phone"]);
  return phone;
}

export function validateInquiry(body) {
  const contact = contactBase(body);
  return {
    ...contact,
    role: "customer",
    topic: cleanChoice(body.topic, ["quote", "consulting", "vendor", "invoice", "other"], "Topic", { required: true }),
    message: cleanText(body.message, 4000, { required: true, label: "Message" }),
    leadSource: "website",
    serviceInterest: body.topic === "consulting" ? "contracting-readiness" : body.topic === "quote" ? "supplies" : "other",
  };
}

export function validateBooking(body) {
  const contact = contactBase(body);
  const type = cleanChoice(
    body.type,
    ["discovery_15", "qualified_30", "onboarding_45", "quick_bid_preview_30"],
    "Consultation type",
    { required: true },
  );
  const start = cleanText(body.start, 40, { required: true, label: "Appointment time" });
  if (Number.isNaN(Date.parse(start))) throw httpError(400, "Choose an available appointment time.");
  return {
    ...contact,
    role: "customer",
    type,
    start,
    meetingMode: cleanChoice(body.meetingMode, ["meet", "phone"], "Meeting option", { required: true }),
    serviceInterest: cleanChoice(body.serviceInterest, SERVICE_INTERESTS, "Service interest", { required: true }),
    packageId: cleanText(body.packageId, 40),
    notes: cleanText(body.notes, 2000),
    leadSource: cleanChoice(body.leadSource, LEAD_SOURCES, "Lead source") || "website",
  };
}

const ALLOWED_MIME = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export function validateDocument(document) {
  if (!document) return null;
  if (typeof document !== "object") throw httpError(400, "The attachment could not be read.");
  const filename = cleanText(document.filename, 120, { required: true, label: "File name" });
  const mime = cleanChoice(document.mimeType, Object.keys(ALLOWED_MIME), "File type", { required: true });
  const data = cleanText(document.dataBase64, 8_000_000, { required: true, label: "File" });
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > 4 * 1024 * 1024) {
    throw httpError(400, "Attachments must be a PDF, PNG, or JPEG of 4 MB or less.");
  }
  if (!matchesMagic(bytes, mime)) {
    throw httpError(400, "The file contents do not match a PDF, PNG, or JPEG.");
  }
  return { filename, mimeType: mime, extension: ALLOWED_MIME[mime], bytes };
}

function matchesMagic(bytes, mime) {
  if (mime === "application/pdf") return bytes.subarray(0, 4).toString("utf8") === "%PDF";
  if (mime === "image/png") return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}
