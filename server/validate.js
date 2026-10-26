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
];

export const SERVICE_INTERESTS = [
  "contracting-readiness",
  "quick-bid-review",
  "contractor-starter",
  "registration-accelerator",
  "contractor-launch",
  "growth-partner",
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

export function rejectHoneypot(body) {
  if (body && typeof body.company_url === "string" && body.company_url.trim()) {
    throw httpError(400, "The form could not be submitted.");
  }
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

export function validateIntake(body) {
  const contact = contactBase(body);
  const contracting = cleanList(
    body.contractingLevel,
    ["federal", "state", "local", "none", "unsure"],
    "Contracting interest",
  );
  return {
    ...contact,
    role: "customer",
    businessCity: cleanText(body.businessCity, 80, { required: true, label: "Business city" }),
    businessState: cleanText(body.businessState, 40, { required: true, label: "Business state" }),
    serviceArea: cleanText(body.serviceArea, 160, { required: true, label: "Service area" }),
    businessDescription: cleanText(body.businessDescription, 2000, { required: true, label: "Business description" }),
    industry: cleanText(body.industry, 120, { required: true, label: "Industry" }),
    serviceInterest: cleanChoice(body.serviceInterest, SERVICE_INTERESTS, "Service interest", { required: true }),
    contractingLevel: contracting,
    naics: cleanText(body.naics, 120),
    nigp: cleanText(body.nigp, 120),
    uei: cleanText(body.uei, 20),
    cage: cleanText(body.cage, 10),
    registrations: cleanText(body.registrations, 1000),
    certifications: cleanText(body.certifications, 1000),
    priorExperience: cleanText(body.priorExperience, 2000),
    challenges: cleanText(body.challenges, 2000),
    timeline: cleanText(body.timeline, 160),
    budgetRange: cleanChoice(body.budgetRange, BUDGET_RANGES, "Budget range"),
    consultationType: cleanText(body.consultationType, 40),
    leadSource: cleanChoice(body.leadSource, LEAD_SOURCES, "Lead source") || "website",
    packageId: cleanText(body.packageId, 40),
    notes: cleanText(body.notes, 2000),
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
    references: cleanText(body.references, 1000),
    insurance: cleanText(body.insurance, 1000),
    bonding: cleanText(body.bonding, 500),
    licenses: cleanText(body.licenses, 1000),
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
