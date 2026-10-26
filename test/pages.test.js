import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PACKAGES } from "../server/packages.js";

const root = path.resolve(".");
const htmlFiles = fs.readdirSync(root).filter((file) => file.endsWith(".html"));

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("internal links and anchors resolve", () => {
  const missing = [];
  for (const file of htmlFiles) {
    const html = read(file);
    const hrefs = [...html.matchAll(/\shref="([^"]+)"/g)].map((match) => match[1]);
    for (const href of hrefs) {
      if (/^(https?:|mailto:|tel:)/.test(href)) continue;
      const [beforeHash, hash] = href.split("#");
      const target = beforeHash.split("?")[0];
      if (target) {
        const local = path.normalize(path.join(root, target));
        if (!local.startsWith(root) || !fs.existsSync(local)) missing.push(`${file} -> ${href}`);
      }
      if (hash) {
        const host = target ? read(path.basename(target)) : html;
        if (!host.includes(`id="${hash}"`) && !host.includes(`id='${hash}'`)) missing.push(`${file} -> #${hash}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("packages stay proposed and are not wired to checkout", () => {
  const html = read("packages.html");
  for (const item of PACKAGES) {
    assert.equal(html.includes(item.name), true, item.name);
    assert.equal(html.includes(item.proposedPrice), true, item.proposedPrice);
  }
  assert.match(html, /not available for purchase/i);
  assert.match(html, /Pending owner approval/);
  assert.equal(html.includes("buy.stripe.com"), false);
  assert.equal(html.includes("sk_live"), false);
});

test("consultation page lists every free appointment type", () => {
  const html = read("consult.html");
  for (const id of ["discovery_15", "qualified_30", "onboarding_45", "quick_bid_preview_30"]) {
    assert.equal(html.includes(`data-type="${id}"`), true);
  }
  assert.match(html, /\(281\) 954-5167/);
  assert.match(html, /America\/Chicago|Central/);
});

test("dashboard is not indexed and client code has no secrets", () => {
  assert.match(read("dashboard.html"), /noindex/);
  assert.match(read("robots.txt"), /Disallow: \/dashboard\.html/);
  const client = htmlFiles.map(read).join("\n") + fs.readdirSync(path.join(root, "assets/js")).map((file) => fs.readFileSync(path.join(root, "assets/js", file), "utf8")).join("\n");
  assert.equal(/ya29\./.test(client), false);
  assert.equal(/BEGIN [A-Z ]*PRIVATE KEY/.test(client), false);
  assert.equal(/sk_live_/.test(client), false);
  assert.equal(/ASBS_DASHBOARD_PASSWORD\s*=\s*["'][^"']+/.test(client), false);
});

test("sitemap lists the public pages and skips the dashboard", () => {
  const sitemap = read("sitemap.xml");
  assert.equal(sitemap.includes("dashboard.html"), false);
  for (const file of ["services.html", "packages.html", "consult.html", "intake.html", "vendors.html", "about.html", "contact.html"]) {
    assert.equal(sitemap.includes(file), true);
  }
});
