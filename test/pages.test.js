import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PACKAGES } from "../server/packages.js";
import { SERVICE_INTERESTS } from "../server/validate.js";

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

test("approved package prices are shown and checkout stays off", () => {
  const html = read("packages.html");
  for (const item of PACKAGES) {
    assert.equal(html.includes(`id="${item.id}"`), true, item.id);
    assert.equal(html.includes(item.name), true, item.name);
    assert.equal(html.includes(item.price), true, item.price);
  }
  for (const retired of [
    "Contractor Starter",
    "Registration Accelerator",
    "Full-Service Contractor Launch",
    "Contracting Growth Partner",
    "$1,299",
    "$2,499",
    "$999–$2,499/month",
  ]) {
    assert.equal(html.includes(retired), false, retired);
  }
  assert.match(html, /Online checkout is off/);
  assert.match(html, /there is no checkout on this page/i);
  assert.match(html, /Paid work begins only after a written agreement/);
  assert.equal(/not available for purchase/i.test(html), false);
  assert.equal(/pending owner approval/i.test(html), false);
  assert.equal(/Proposed \$/.test(html), false);
  assert.equal(html.includes("buy.stripe.com"), false);
  assert.equal(html.includes("sk_live"), false);
});

test("consultation and intake forms offer the current packages", () => {
  const retired = [
    "contractor-starter",
    "registration-accelerator",
    "growth-partner",
    "Contractor Starter",
    "Registration Accelerator",
    "Full-Service Contractor Launch",
    "Contracting Growth Partner",
    "five consulting packages",
  ];
  const surfaces = ["consult.html", "intake.html", "services.html", "assets/js/forms.js", "server/validate.js"];
  for (const file of surfaces) {
    const text = read(file);
    for (const name of retired) {
      assert.equal(text.includes(name), false, `${file} still lists ${name}`);
    }
  }
  const intake = read("intake.html");
  for (const item of PACKAGES) {
    assert.equal(intake.includes(`<option value="${item.id}">${item.name}</option>`), true, `intake.html ${item.name}`);
  }
  const forms = read("assets/js/forms.js");
  for (const item of PACKAGES) {
    assert.equal(SERVICE_INTERESTS.includes(item.id), true, item.id);
    assert.equal(forms.includes(`"${item.id}"`), true, `forms.js ${item.id}`);
  }
  for (const retiredId of ["contractor-starter", "registration-accelerator", "growth-partner"]) {
    assert.equal(SERVICE_INTERESTS.includes(retiredId), false, retiredId);
  }
});

test("consultation page asks visitors to contact ASBS instead of picking a slot", () => {
  const html = read("consult.html");
  assert.match(html, /\(281\) 954-5167/);
  assert.match(html, /info@americanstandardbusinesssolutions\.com/);
  assert.match(html, /href="contact\.html"/);
  assert.match(html, /href="intake\.html"/);
  assert.match(html, /does not list open times/);
  assert.equal(html.includes("assets/js/consult.js"), false);
  assert.equal(html.includes("calendar.google.com"), false);
  assert.equal(html.includes("/api/slots"), false);
  assert.equal(html.includes("/api/bookings"), false);
  assert.equal(html.includes("bookingForm"), false);
  assert.equal(html.includes("slotList"), false);
  assert.equal(html.includes("Checking open times"), false);
  assert.equal(html.includes("Checking whether Google Calendar"), false);
  assert.equal(fs.existsSync(path.join(root, "assets/js/consult.js")), false);
  const clientJs = fs.readdirSync(path.join(root, "assets/js")).map((file) => read(path.join("assets/js", file))).join("\n");
  assert.equal(clientJs.includes("/api/slots"), false);
  assert.equal(clientJs.includes("/api/bookings"), false);
  assert.equal(clientJs.includes("calendar.google.com"), false);
  for (const file of htmlFiles) {
    const page = read(file);
    assert.equal(page.includes("calendar.google.com"), false, file);
    assert.equal(page.includes("/api/slots"), false, file);
    assert.equal(page.includes("See open times"), false, file);
  }
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

test("HubSpot tracking is on public pages and off the private dashboards", () => {
  const snippet = '<script type="text/javascript" id="hs-script-loader" async defer src="//js-na2.hs-scripts.com/247883336.js"></script>';
  const privatePages = new Set(["command.html", "dashboard.html"]);
  for (const file of htmlFiles) {
    const html = read(file);
    const at = html.lastIndexOf(snippet);
    if (privatePages.has(file)) {
      assert.equal(at, -1, file);
      assert.equal(html.includes("hs-scripts.com"), false, file);
      assert.equal(html.includes("247883336"), false, file);
      continue;
    }
    const body = html.lastIndexOf("</body>");
    assert.notEqual(at, -1, file);
    assert.equal(at < body, true, file);
    assert.equal(html.slice(at + snippet.length, body).trim(), "", `${file} snippet is not the last node before </body>`);
  }
  for (const file of ["contact.html", "intake.html"]) {
    const html = read(file);
    assert.match(html, /<form\b[^>]*\bid="(?:contact|intake)Form"/);
    assert.match(html, /<input\b[^>]*\bname="name"/);
    assert.match(html, /<input\b[^>]*\btype="email"[^>]*\bname="email"/);
    assert.equal(html.includes('type="hidden"'), false, `${file} has a hidden field HubSpot will not collect`);
  }
  assert.match(read("privacy.html"), /This site uses HubSpot to manage inquiries\./);
});

test("sitemap lists the public pages and skips the dashboard", () => {
  const sitemap = read("sitemap.xml");
  assert.equal(sitemap.includes("dashboard.html"), false);
  for (const file of ["services.html", "packages.html", "consult.html", "intake.html", "vendors.html", "about.html", "contact.html"]) {
    assert.equal(sitemap.includes(file), true);
  }
});
