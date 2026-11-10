import fs from "node:fs";
import { fileURLToPath } from "node:url";

const dataUrl = new URL("../assets/codes/naics-2022.json", import.meta.url);
const DASH = " \u2014 ";
const MAX_ENTRIES = 20;
const MAX_FIELD = 4000;
const MAX_NOTE = 80;

let catalog;

function fail(message, label) {
  const error = new Error(message);
  error.status = 400;
  error.fields = [label];
  throw error;
}

export function naicsCatalog() {
  if (!catalog) {
    const data = JSON.parse(fs.readFileSync(fileURLToPath(dataUrl), "utf8"));
    const byCode = new Map(data.codes.map(([code, title, sector]) => [code, { code, title, sector }]));
    catalog = { ...data, byCode };
  }
  return catalog;
}

function cleanRaw(value, label) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") fail(`${label} must be text.`, label);
  const raw = value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  if (raw.length > 8000) fail(`${label} must be 8000 characters or fewer.`, label);
  return raw;
}

function splitEntries(raw, digits) {
  const pattern = new RegExp(`\\s*(?:\\n|;|,\\s*(?=\\d{${digits}}\\b))\\s*`);
  return raw.split(pattern).map((part) => part.trim()).filter(Boolean);
}

export function normalizeNaics(value) {
  const raw = cleanRaw(value, "NAICS codes");
  if (!raw) return "";
  const { byCode } = naicsCatalog();
  const seen = new Set();
  const lines = [];
  for (const part of splitEntries(raw, 6)) {
    const match = part.match(/^(\d{6})(?:\s*[\u2014\u2013-]\s*.*|\s+.*)?$/);
    if (!match) fail("Each NAICS entry must start with a 6-digit 2022 Census code.", "NAICS codes");
    const known = byCode.get(match[1]);
    if (!known) fail(`${match[1]} is not a 2022 NAICS code.`, "NAICS codes");
    if (seen.has(known.code)) continue;
    seen.add(known.code);
    lines.push(`${known.code}${DASH}${known.title}`);
  }
  if (lines.length > MAX_ENTRIES) fail(`Select up to ${MAX_ENTRIES} NAICS codes.`, "NAICS codes");
  const formatted = lines.join("\n");
  if (formatted.length > MAX_FIELD) fail("NAICS codes must be 4000 characters or fewer.", "NAICS codes");
  return formatted;
}

export function parseNigpEntry(part) {
  const classMatch = part.match(/^(\d{3})([\s\S]*)$/);
  if (!classMatch) return { error: "Enter a 3-digit NIGP class, or a class-item as 3 digits, a hyphen, and 2 digits." };
  const klass = classMatch[1];
  let rest = classMatch[2];
  let item = "";
  if (/^-\d{2}(?!\d)/.test(rest)) {
    item = rest.slice(1, 3);
    rest = rest.slice(3);
  } else if (/^\d{2}(?!\d)/.test(rest)) {
    item = rest.slice(0, 2);
    rest = rest.slice(2);
  } else if (/^\d/.test(rest) || rest.startsWith("-")) {
    return { error: "A NIGP class-item needs exactly 2 digits after the class. Example shape: 123-45." };
  }
  rest = rest.trim();
  if (rest === "-" || rest === "\u2014" || rest === "\u2013") {
    return { error: "Add a note after the dash, or leave the dash off." };
  }
  let note = "";
  if (rest) {
    note = rest.replace(/^[\u2014\u2013-]\s*/, "").replace(/\s+/g, " ").trim();
    if (!note) return { error: "Add a note after the dash, or leave the dash off." };
    if (note.length > MAX_NOTE) return { error: "A NIGP note must be 80 characters or fewer." };
  }
  const code = item ? `${klass}-${item}` : klass;
  return { code, note };
}

export function normalizeNigp(value) {
  const raw = cleanRaw(value, "NIGP codes");
  if (!raw) return "";
  const seen = new Map();
  const lines = [];
  for (const part of splitEntries(raw, 3)) {
    const parsed = parseNigpEntry(part);
    if (parsed.error) fail(parsed.error, "NIGP codes");
    const line = parsed.note ? `${parsed.code}${DASH}${parsed.note}` : parsed.code;
    if (seen.has(parsed.code)) {
      if (seen.get(parsed.code) !== line) fail(`${parsed.code} is listed more than once.`, "NIGP codes");
      continue;
    }
    seen.set(parsed.code, line);
    lines.push(line);
  }
  if (lines.length > MAX_ENTRIES) fail(`Select up to ${MAX_ENTRIES} NIGP codes.`, "NIGP codes");
  const formatted = lines.join("\n");
  if (formatted.length > MAX_FIELD) fail("NIGP codes must be 4000 characters or fewer.", "NIGP codes");
  return formatted;
}

export function codeSummary(label, value) {
  if (!value) return "";
  return `${label}: ${value.replace(/\n/g, "; ")}`;
}
