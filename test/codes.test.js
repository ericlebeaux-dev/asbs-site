import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { naicsCatalog, normalizeNaics, normalizeNigp } from "../server/codes.js";

const root = path.resolve(".");
const dash = " \u2014 ";

test("the shipped NAICS file is the 2022 Census six-digit set", () => {
  const data = naicsCatalog();
  assert.equal(data.vintage, 2022);
  assert.equal(data.url, "https://www.census.gov/naics/2022NAICS/2-6%20digit_2022_Codes.xlsx");
  assert.equal(data.retrieved, "2026-11-10");
  assert.equal(data.sectors.length, 20);
  assert.equal(data.codes.length, 1012);
  const sectors = new Set(data.sectors.map(([code]) => code));
  const seen = new Set();
  for (const [code, title, sector] of data.codes) {
    assert.match(code, /^\d{6}$/);
    assert.equal(title.trim().length > 0, true);
    assert.equal(sectors.has(sector), true, sector);
    assert.equal(seen.has(code), false);
    seen.add(code);
  }
  assert.equal(data.byCode.get("111110").title, "Soybean Farming");
  assert.equal(data.byCode.get("541511").title, "Custom Computer Programming Services");
  assert.equal(data.byCode.get("541512").title, "Computer Systems Design Services");
  assert.equal(data.byCode.get("238220").title, "Plumbing, Heating, and Air-Conditioning Contractors");
  assert.equal(data.byCode.get("928120").title, "International Affairs");
  assert.equal(fs.existsSync(path.join(root, "assets/codes/nigp.json")), false);
  assert.equal(fs.existsSync(path.join(root, "assets/codes/nigp-codes.json")), false);
});

test("NAICS submissions keep official titles and reject invented codes", () => {
  assert.equal(normalizeNaics(""), "");
  assert.equal(normalizeNaics(null), "");
  const stored = normalizeNaics("541511 — WRONG, 541512 — Computer Systems Design Services\n238220");
  assert.equal(stored, [
    `541511${dash}Custom Computer Programming Services`,
    `541512${dash}Computer Systems Design Services`,
    `238220${dash}Plumbing, Heating, and Air-Conditioning Contractors`,
  ].join("\n"));
  assert.equal(normalizeNaics("541511\n541511"), `541511${dash}Custom Computer Programming Services`);
  assert.throws(() => normalizeNaics("000000"), /not a 2022 NAICS code/);
  assert.throws(() => normalizeNaics("software"), /6-digit/);
  const many = naicsCatalog().codes.slice(0, 21).map(([code]) => code).join("\n");
  assert.throws(() => normalizeNaics(many), /20/);
});

test("NIGP submissions store typed codes and notes without an official catalog", () => {
  assert.equal(normalizeNigp(""), "");
  assert.equal(normalizeNigp("90514 road patching; 910"), `905-14${dash}road patching\n910`);
  assert.equal(normalizeNigp("005"), "005");
  assert.equal(normalizeNigp("005-00"), "005-00");
  assert.throws(() => normalizeNigp("hello"), /3-digit/);
  assert.throws(() => normalizeNigp("12"), /3-digit/);
  assert.throws(() => normalizeNigp("1234"), /2 digits/);
  assert.throws(() => normalizeNigp("123-4"), /2 digits/);
  assert.throws(() => normalizeNigp(`910${dash}one\n910${dash}two`), /more than once/);
  assert.equal(normalizeNigp("910\n910"), "910");
  assert.throws(() => normalizeNigp(`123-45${dash}${"n".repeat(81)}`), /80/);
});

test("consultation and intake pages expose the reference and the pickers", () => {
  const consult = fs.readFileSync(path.join(root, "consult.html"), "utf8");
  const intake = fs.readFileSync(path.join(root, "intake.html"), "utf8");
  const codes = fs.readFileSync(path.join(root, "codes.html"), "utf8");
  assert.match(consult, /id="codes"/);
  assert.match(consult, /data-naics-browser/);
  assert.match(consult, /assets\/js\/codes\.js/);
  assert.match(consult, /does not copy/);
  assert.match(codes, /id="naics"/);
  assert.match(codes, /id="nigp"/);
  assert.match(codes, /data-load="eager"/);
  assert.match(codes, /does not copy/);
  assert.equal(intake.includes('type="hidden"'), false);
  assert.equal((intake.match(/role="combobox"/g) || []).length, 2);
  assert.equal((intake.match(/role="listbox"/g) || []).length, 2);
  assert.match(intake, /name="naics"/);
  assert.match(intake, /name="nigp"/);
  assert.match(intake, /data-code-picker="naics"/);
  assert.match(intake, /data-code-picker="nigp"/);
  assert.match(intake, /commbook\.app\.cpa\.state\.tx\.us/);
  const client = fs.readFileSync(path.join(root, "assets/js/codes.js"), "utf8");
  assert.equal(client.includes("/api/slots"), false);
  assert.equal(client.includes("/api/bookings"), false);
});
