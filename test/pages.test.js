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
      const home = target === "/" || target === "/index.html";
      if (target && !home) {
        const local = path.normalize(path.join(root, target));
        if (!local.startsWith(root) || !fs.existsSync(local)) missing.push(`${file} -> ${href}`);
      }
      if (hash) {
        const host = home ? read("index.html") : (target ? read(path.basename(target)) : html);
        if (!host.includes(`id="${hash}"`) && !host.includes(`id='${hash}'`)) missing.push(`${file} -> #${hash}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test("public consulting pages do not publish package prices and checkout stays off", () => {
  const html = read("packages.html");
  const marketing = ["index.html", "services.html", "packages.html", "consult.html", "about.html"].map(read).join("\n");
  for (const item of PACKAGES) {
    assert.equal(html.includes(`id="${item.id}"`), true, item.id);
    if (item.price.includes("$")) assert.equal(marketing.includes(item.price), false, item.price);
  }
  for (const blocked of [
    "Registration Sprint",
    "Bid-Ready Sprint",
    "BidReady",
    "Monthly Bid Desk",
    "MonthlyBidDesk",
    "$397",
    "$747",
    "$297",
    "Mission-Ready Supplies",
    "Contractor Starter",
    "Registration Accelerator",
    "$1,299",
    "$2,499",
    "buy.stripe.com",
    "sk_live",
    "not available for purchase",
    "pending owner approval",
  ]) {
    assert.equal(html.toLowerCase().includes(blocked.toLowerCase()), false, blocked);
  }
  assert.match(html, /Online checkout is off/);
  assert.match(html, /there is no checkout on this page/i);
  assert.match(html, /Paid work begins only after a written agreement/);
  assert.match(read("assets/css/site.css"), /PROVISIONAL THEME/);
  assert.match(read("assets/css/site.css"), /--asbs-navy/);
  assert.match(read("assets/css/site.css"), /prefers-reduced-motion/);
});

test("intake offers consulting topics without the withdrawn package menu", () => {
  const retired = [
    "contractor-starter",
    "registration-accelerator",
    "growth-partner",
    "Contractor Starter",
    "Registration Accelerator",
    "Full-Service Contractor Launch",
    "Contracting Growth Partner",
    "five consulting packages",
    "Bid Readiness Assessment",
    "Quick Bid Review",
    "Full Capture",
  ];
  const surfaces = ["consult.html", "intake.html", "services.html", "assets/js/forms.js", "server/validate.js"];
  for (const file of surfaces) {
    const text = read(file);
    for (const name of retired) {
      assert.equal(text.includes(name), false, `${file} still lists ${name}`);
    }
  }
  const intake = read("intake.html");
  assert.equal(SERVICE_INTERESTS.includes("free-consultation"), true);
  assert.equal(intake.includes('value="free-consultation"'), false);
  for (const choice of [
    ["operations", "Growth, expansion, and readiness"],
    ["contracting-readiness", "Government contracting opportunities"],
    ["procurement-consulting", "Commercial contracting opportunities"],
  ]) {
    assert.equal(SERVICE_INTERESTS.includes(choice[0]), true, choice[0]);
    assert.match(intake, new RegExp(`<option value="${choice[0]}">${choice[1]}</option>`));
  }
  assert.equal(intake.includes("janitorial"), false);
  assert.equal(intake.includes("value=\"supplies\""), false);
  assert.match(intake, /id="intakeForm"/);
  assert.match(read("assets/js/forms.js"), /\/api\/intake/);
  assert.match(read("contact.html"), /id="contactForm"/);
  assert.match(read("contact.html"), /\/api\/inquiries|assets\/js\/forms\.js/);
  assert.match(read("assets/js/config.js"), /asbs-staging\.onrender\.com/);
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
  assert.equal(fs.existsSync(path.join(root, "dashboard.html")), false);
  assert.equal(fs.existsSync(path.join(root, "command.html")), false);
  assert.match(fs.readFileSync(path.join(root, "_private/dashboard.html"), "utf8"), /noindex/);
  assert.match(read("robots.txt"), /Disallow: \/dashboard\.html/);
  const client = htmlFiles.map(read).join("\n") + fs.readdirSync(path.join(root, "assets/js")).map((file) => fs.readFileSync(path.join(root, "assets/js", file), "utf8")).join("\n");
  assert.equal(/ya29\./.test(client), false);
  assert.equal(/BEGIN [A-Z ]*PRIVATE KEY/.test(client), false);
  assert.equal(/sk_live_/.test(client), false);
  assert.equal(/ASBS_DASHBOARD_PASSWORD\s*=\s*["'][^"']+/.test(client), false);
});

test("HubSpot tracking is on public pages and off the private dashboards", () => {
  const loader = fs.readFileSync(path.join(root, "assets/js/asbs.js"), "utf8");
  assert.match(loader, /hs-script-loader/);
  assert.match(loader, /scheduleHubSpot/);
  assert.match(loader, /window\.addEventListener\("load"/);
  for (const file of htmlFiles) {
    const html = read(file);
    assert.equal(html.includes("hs-scripts.com"), false, file);
  }
  for (const file of ["_private/dashboard.html", "_private/command.html"]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(html.includes("hs-scripts.com"), false, file);
    assert.equal(html.includes("247883336"), false, file);
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

test("public pages and client scripts do not name Katy", () => {
  const files = [
    ...htmlFiles,
    ...fs.readdirSync(path.join(root, "assets/js")).map((file) => path.join("assets/js", file)),
  ];
  for (const file of files) {
    assert.equal(/katy/i.test(read(file)), false, file);
  }
  assert.match(read("index.html"), /Veteran-led consulting · Greater Houston · San Antonio · Austin · DFW/);
  assert.match(read("about.html"), /consulting firm in Greater Houston, San Antonio, Austin, and DFW, Texas\./);
  assert.match(read("contact.html"), /in Greater Houston, San Antonio, Austin, and DFW, Texas\./);
  assert.match(read("services.html"), /Serving Greater Houston, Greater San Antonio, Greater Austin, and Greater DFW, including communities within about 50 miles of each\./);
  assert.match(read("index.html"), /Serving Greater Houston, San Antonio, Austin & DFW and surrounding areas/);
  assert.match(read("assets/js/forms.js"), /such as Dallas, TX/);
  assert.match(read("contact.html"), /\(281\) 954-5167/);
});

test("sitemap lists the public pages and skips the dashboard", () => {
  const sitemap = read("sitemap.xml");
  for (const file of ["packages.html", "thanks.html"]) {
    assert.equal(sitemap.includes(file), false, file);
  }
  for (const file of ["services.html", "consult.html", "codes.html", "intake.html", "vendors.html", "about.html", "contact.html"]) {
    assert.equal(sitemap.includes(file), true);
  }
});

test("November 10 quick fixes stay within the approved scope", () => {
  const title = read("index.html").match(/<title>([^<]*)<\/title>/)[1];
  assert.equal(title.length <= 60, true, title);
  assert.equal(/jotform/i.test(read("index.html")), false);
  assert.match(read("assets/css/site.css"), /\.hero \.button:not\(\.secondary\) \{[\s\S]*background: var\(--asbs-ivory\)/);
  assert.match(read("assets/css/site.css"), /\.hero \.eyebrow,\s*\n\.eyebrow \{[\s\S]*letter-spacing: 0\.16em;/);
  assert.match(read("intake.html"), /id="stepProgress"[^>]*aria-label="Intake progress"/);
  assert.match(read("assets/js/asbs.js"), /button\.textContent = hidden \? "Menu" : "Close"/);
  assert.match(read("consult.html"), /<title>Call or email ASBS<\/title>/);
  assert.match(read("consult.html"), /free consultation/i);
  assert.equal(read("index.html").includes("streetAddress"), false);
  assert.equal(read("index.html").includes("postalCode"), false);
  assert.equal(fs.existsSync(path.join(root, "favicon.ico")), true);
  for (const file of ["thanks.html", "packages.html"]) {
    assert.match(read(file), /noindex, nofollow/);
  }
  assert.match(fs.readFileSync(path.join(root, "_private/command.html"), "utf8"), /noindex, nofollow/);
  const marketing = htmlFiles.filter((file) => file !== "command.html" && file !== "dashboard.html");
  for (const file of marketing) {
    const html = read(file);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    assert.equal(header.includes("Approach"), false, file);
    assert.match(header, /href="intake\.html"[^>]*>Request a free consultation/, file);
    assert.match(header, /class="header-call" href="tel:\+12819545167"/, file);
    assert.match(html, /Monday–Friday, 8:00 a\.m\.–5:00 p\.m\. Central Time/, file);
    assert.match(html, /\(281\) 954-5167/, file);
    assert.match(html, /property="og:title"/, file);
    assert.match(html, /property="og:url"/, file);
    assert.match(html, /property="og:image"/, file);
    assert.match(html, /property="og:type"/, file);
    assert.match(html, /name="twitter:card"/, file);
    assert.equal(/katy/i.test(html), false, file);
  }
});

test("public titles and descriptions are unique and within search limits", () => {
  const titles = new Map();
  const descriptions = new Map();
  const marketing = htmlFiles.filter((file) => file !== "command.html" && file !== "dashboard.html");
  for (const file of marketing) {
    const html = read(file);
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
    assert.equal(title.length <= 60, true, `${file} title ${title.length}: ${title}`);
    assert.equal(description.length <= 160, true, `${file} description ${description.length}`);
    assert.equal(titles.has(title), false, `duplicate title ${title}`);
    assert.equal(descriptions.has(description), false, `duplicate description on ${file}`);
    titles.set(title, file);
    descriptions.set(description, file);
    assert.match(html, /<a class="brand" href="\/">/);
    for (const image of html.match(/<img\b[^>]*>/g) || []) {
      const alt = image.match(/\balt="([^"]*)"/);
      assert.equal(Boolean(alt && alt[1].trim()), true, `${file} ${image}`);
    }
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/);
    if (canonical) {
      assert.equal(canonical[1].startsWith("https://www.americanstandardbusinesssolutions.com/"), true, file);
      assert.equal(canonical[1].includes("index.html"), false, file);
    }
  }
  assert.match(read("consult.html"), /<h1>Call or email ASBS<\/h1>/);
  assert.match(read("intake.html"), /<h1[^>]*>Request a free consultation<\/h1>/);
  assert.match(read("index.html"), /href="intake\.html"[^>]*>Request a free consultation/);
  assert.equal(read("assets/js/asbs.js").includes("sendBeacon"), false);
  assert.match(read("assets/js/asbs.js"), /credentials:\s*"omit"/);
  assert.match(read("assets/js/forms.js"), /formStartedAt/);
  assert.match(read("assets/js/forms.js"), /Connecting securely, this can take up to a minute/);
  assert.match(read("intake.html"), /name="company_url"[^>]*tabindex="-1"/);
  assert.match(read("vendors.html"), /name="company_url"[^>]*tabindex="-1"/);
  assert.match(read("intake.html"), /id="turnstileSlot"/);
  assert.match(read("assets/js/forms.js"), /turnstileToken/);
  assert.match(read("robots.txt"), /Sitemap: https:\/\/www\.americanstandardbusinesssolutions\.com\/sitemap\.xml/);
  const sitemap = read("sitemap.xml");
  assert.equal((sitemap.match(/<lastmod>2026-11-11<\/lastmod>/g) || []).length, 11);
  for (const blocked of ["packages.html", "thanks.html", "command.html", "dashboard.html", "index.html"]) {
    assert.equal(sitemap.includes(blocked), false, blocked);
  }
});
