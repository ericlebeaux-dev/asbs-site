export function pocPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Document check | ASBS</title>
<style>
  :root { color-scheme: light; --navy:#102033; --ivory:#f6f3ec; --paper:#fffdf8; --gold:#7a5a16; --ink:#1c2430; --line:#ddd6c8; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--ivory); color:var(--ink); font:1.05rem/1.5 "Segoe UI", system-ui, sans-serif; }
  a { color:#0d5c66; }
  .skip { position:absolute; left:.75rem; top:.75rem; transform:translateY(-150%); background:#fff; color:var(--navy); padding:.6rem .9rem; }
  .skip:focus { transform:none; }
  header, main, footer { width:min(42rem, calc(100% - 2rem)); margin-inline:auto; }
  header { padding:1.5rem 0 0; }
  h1, h2 { font-family:Palatino, Georgia, serif; color:var(--navy); font-weight:600; line-height:1.15; }
  h1 { font-size:clamp(2rem, 5vw, 2.8rem); }
  .banner { background:#5c4310; color:#fffdf8; padding:.9rem 1rem; }
  form, .card { background:var(--paper); border:1px solid var(--line); border-radius:1rem; padding:1rem; margin:1rem 0; }
  label { display:block; font-weight:650; margin:.8rem 0; }
  input, button { font:inherit; }
  input { width:100%; min-height:2.75rem; margin-top:.3rem; padding:.65rem .75rem; border:1px solid var(--line); border-radius:.55rem; }
  button, .button { min-height:2.75rem; border:0; border-radius:999px; padding:.65rem 1.1rem; background:var(--navy); color:#fff; cursor:pointer; }
  button.secondary { background:transparent; color:var(--navy); border:1px solid var(--navy); }
  .row { display:flex; flex-wrap:wrap; gap:.6rem; margin-top:1rem; }
  .status { border-radius:.7rem; padding:.75rem .9rem; }
  .status.error { background:#fde8e4; color:#6d2018; }
  .status.ok { background:#e7f2f3; color:var(--navy); }
  .hp { position:absolute; width:1px; height:1px; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); }
  :focus-visible { outline:3px solid #0d5c66; outline-offset:3px; }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior:auto; transition:none; } }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header>
  <p style="letter-spacing:.14em;text-transform:uppercase;color:var(--gold);font-size:.78rem;font-weight:700">American Standard Business Solutions</p>
  <h1>Document check</h1>
</header>
<main id="main">
  <form id="sessionForm">
    <h2>Contact</h2>
    <label>Name <input name="name" autocomplete="name" required></label>
    <label>Business <input name="organization" autocomplete="organization" required></label>
    <label>Email <input name="email" type="email" autocomplete="email" required></label>
    <label>Phone <input name="phone" type="tel" autocomplete="tel" required></label>
    <div class="hp" aria-hidden="true"><label>Company URL <input name="company_url" tabindex="-1" autocomplete="off"></label></div>
    <div id="turnstileSlot" hidden></div>
    <div class="row"><button type="submit">Continue</button></div>
  </form>
  <form id="uploadForm" hidden>
    <h2>W-9 and certificate of insurance</h2>
    <p>PDF, PNG, or JPEG. 10 MB maximum. The file is checked here, then stored encrypted.</p>
    <label>W-9 <input name="w9" type="file" accept="application/pdf,image/png,image/jpeg"></label>
    <label>Certificate of insurance <input name="coi" type="file" accept="application/pdf,image/png,image/jpeg"></label>
    <div class="row"><button type="submit">Upload</button></div>
  </form>
  <section id="signCard" class="card" hidden>
    <h2>Sample - pending attorney review</h2>
    <p>Documenso emails the signing link. This page does not contain the form's text.</p>
    <div class="row">
      <button type="button" id="signButton">Email the form</button>
      <button type="button" class="secondary" id="statusButton">Check signature status</button>
    </div>
    <p id="signLink"></p>
  </section>
  <p id="status" class="status" role="status" aria-live="polite" hidden></p>
</main>
<script>
(function () {
  var ticket = "";
  var ticketId = "";
  var leadId = "";
  var turnstileToken = "";
  var turnstileRequired = false;
  var statusNode = document.getElementById("status");
  function say(message, kind) {
    statusNode.hidden = !message;
    statusNode.textContent = message || "";
    statusNode.className = "status" + (kind ? " " + kind : "");
  }
  function renderTurnstile(key) {
    var slot = document.getElementById("turnstileSlot");
    if (!key || !window.turnstile || slot.dataset.ready === "yes") return;
    slot.hidden = false;
    slot.dataset.ready = "yes";
    turnstileRequired = true;
    window.turnstile.render(slot, {
      sitekey: key,
      callback: function (token) { turnstileToken = token || ""; },
      "expired-callback": function () { turnstileToken = ""; },
      "error-callback": function () { turnstileToken = ""; }
    });
  }
  fetch("/api/health").then(function (response) { return response.json(); }).then(function (health) {
    var key = health.turnstile && health.turnstile.enabled ? health.turnstile.siteKey : "";
    if (!key) return;
    var script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = function () { renderTurnstile(key); };
    document.head.appendChild(script);
  }).catch(function () {});
  async function post(path, body) {
    var response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: Object.assign({ "Content-Type": "application/json" }, ticket ? { Authorization: "Bearer " + ticket, "X-Upload-Ticket": ticketId } : {}),
      body: JSON.stringify(body || {})
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.message || "The request did not succeed.");
    return data;
  }
  document.getElementById("sessionForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (turnstileRequired && !turnstileToken) {
      say("Please confirm you are a person, then continue.", "error");
      return;
    }
    var form = new FormData(event.target);
    try {
      var result = await post("/api/poc/session", {
        name: form.get("name"),
        organization: form.get("organization"),
        email: form.get("email"),
        phone: form.get("phone"),
        company_url: form.get("company_url") || "",
        turnstileToken: turnstileToken
      });
      if (!result.ticket) {
        say("The request was accepted.", "ok");
        return;
      }
      ticket = result.ticket;
      ticketId = result.ticketId;
      leadId = result.leadId;
      event.target.hidden = true;
      document.getElementById("uploadForm").hidden = false;
      document.getElementById("signCard").hidden = false;
      say("Contact check passed. You can upload the two files.", "ok");
    } catch (error) {
      say(error.message, "error");
    }
  });
  async function sendFile(file, role) {
    if (!file || !file.size) return;
    var body = new FormData();
    body.append("role", role);
    body.append("file", file, file.name);
    var response = await fetch("/api/poc/uploads", {
      method: "POST",
      credentials: "same-origin",
      headers: { Authorization: "Bearer " + ticket, "X-Upload-Ticket": ticketId },
      body: body
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.message || "The file was not accepted.");
  }
  document.getElementById("uploadForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var form = new FormData(event.target);
    try {
      await sendFile(form.get("w9"), "w9");
      await sendFile(form.get("coi"), "coi");
      say("The files were recorded. No tax identifier was sent anywhere else.", "ok");
    } catch (error) {
      say(error.message, "error");
    }
  });
  document.getElementById("signButton").addEventListener("click", async function () {
    try {
      var result = await post("/api/poc/authorization", {});
      var link = document.getElementById("signLink");
      link.textContent = result.signingUrl ? "Signing link: " + result.signingUrl : "Documenso will email the signing link.";
      say("The sample form was sent.", "ok");
    } catch (error) {
      say(error.message, "error");
    }
  });
  document.getElementById("statusButton").addEventListener("click", async function () {
    try {
      var response = await fetch("/api/poc/authorization/status", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadId })
      });
      var data = await response.json().catch(function () { return {}; });
      if (response.status === 401) {
        say("Sign in to the private dashboard, then check again.", "error");
        return;
      }
      if (!response.ok) throw new Error(data.message || "The status could not be read.");
      say(data.status === "signed" ? "The signed file is stored." : "The signature is still pending.", "ok");
    } catch (error) {
      say(error.message, "error");
    }
  });
})();
</script>
</body>
</html>`;
}
