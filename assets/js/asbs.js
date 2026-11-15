(function () {
  var cfg = window.ASBS_PUBLIC_CONFIG || { apiBase: "" };
  var api = String(cfg.apiBase || "").replace(/\/$/, "");

  function viewport() {
    var width = window.innerWidth || 0;
    if (width < 768) return "mobile";
    if (width < 1100) return "tablet";
    return "desktop";
  }

  async function apiFetch(path, options) {
    var opts = options || {};
    var response = await fetch(api + path, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: Object.assign({ "Content-Type": "application/json" }, opts.headers || {}),
      credentials: "same-origin",
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var text = await response.text();
    var data = {};
    if (text) {
      try { data = JSON.parse(text); } catch (error) { data = { message: text.slice(0, 180) }; }
    }
    if (!response.ok) {
      var failure = new Error(data.message || "The request did not succeed.");
      failure.status = response.status;
      failure.details = data;
      throw failure;
    }
    return data;
  }

  function track(name, meta) {
    var payload = JSON.stringify({
      name: name,
      path: location.pathname,
      viewport: viewport(),
      meta: meta || {}
    });
    try {
      fetch(api + "/api/events", {
        method: "POST",
        keepalive: true,
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: payload
      }).catch(function () {});
    } catch (error) { /* The page still works if analytics cannot be sent. */ }
  }

  function submitForm(path, body, onSlow) {
    var deadline = Date.now() + 75000;
    var slowTimer = window.setTimeout(function () {
      if (typeof onSlow === "function") onSlow();
    }, 4000);
    var attempt = 0;
    function run() {
      attempt += 1;
      var remaining = deadline - Date.now();
      if (remaining <= 0) {
        var late = new Error("The request timed out.");
        late.status = 0;
        return Promise.reject(late);
      }
      var controller = new AbortController();
      var timer = window.setTimeout(function () { controller.abort(); }, remaining);
      return fetch(api + path, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      }).then(function (response) {
        window.clearTimeout(timer);
        var retryable = response.status === 502 || response.status === 503 || response.status === 504;
        if (retryable && attempt === 1 && Date.now() < deadline) return run();
        return response.text().then(function (text) {
          var data = {};
          if (text) {
            try { data = JSON.parse(text); } catch (parseError) { data = { message: text.slice(0, 180) }; }
          }
          if (!response.ok) {
            var failure = new Error(data.message || "The request did not succeed.");
            failure.status = response.status;
            throw failure;
          }
          return data;
        });
      }, function (error) {
        window.clearTimeout(timer);
        if (!error.status && attempt === 1 && Date.now() < deadline) return run();
        throw error;
      });
    }
    return run().finally(function () { window.clearTimeout(slowTimer); });
  }

  function showMessage(node, message, kind) {
    if (!node) return;
    node.hidden = !message;
    node.textContent = message || "";
    node.className = kind === "error"
      ? "rounded-lg border border-red-300 bg-red-50 text-red-900 px-4 py-3 text-sm"
      : "rounded-lg border border-teal-200 bg-asbs-tealLight text-asbs-navy px-4 py-3 text-sm";
  }

  function formData(form) {
    var data = {};
    var elements = form.querySelectorAll("input, select, textarea");
    elements.forEach(function (element) {
      if (!element.name || element.disabled) return;
      if (element.type === "checkbox") {
        if (element.name.endsWith("[]") || form.querySelectorAll('input[name="' + element.name + '"]').length > 1) {
          data[element.name] = data[element.name] || [];
          if (element.checked) data[element.name].push(element.value);
          return;
        }
        data[element.name] = element.checked;
        return;
      }
      if (element.type === "radio") {
        if (element.checked) data[element.name] = element.value;
        return;
      }
      data[element.name] = element.value;
    });
    Object.keys(data).forEach(function (key) {
      if (key.endsWith("[]")) {
        data[key.slice(0, -2)] = data[key];
        delete data[key];
      }
    });
    if (data.consent === "on") data.consent = true;
    return data;
  }

  function loadHubSpot() {
    if (document.getElementById("hs-script-loader")) return;
    var script = document.createElement("script");
    script.id = "hs-script-loader";
    script.async = true;
    script.src = "https://js-na2.hs-scripts.com/247883336.js";
    document.body.appendChild(script);
  }

  function scheduleHubSpot() {
    var started = false;
    function start() {
      if (started) return;
      started = true;
      loadHubSpot();
    }
    window.addEventListener("load", function () { window.setTimeout(start, 1); });
    window.addEventListener("pointerdown", start, { once: true, passive: true });
    window.addEventListener("keydown", start, { once: true });
  }

  function init() {
    var button = document.querySelector("[data-menu-button]");
    var menu = document.querySelector("[data-mobile-menu]");
    if (button && menu) {
      button.addEventListener("click", function () {
        var hidden = menu.classList.toggle("hidden");
        button.setAttribute("aria-expanded", hidden ? "false" : "true");
        button.textContent = hidden ? "Menu" : "Close";
      });
    }
    document.addEventListener("click", function (event) {
      var tracked = event.target.closest("[data-track]");
      if (tracked) track("cta_click", { id: tracked.getAttribute("data-track") });
    });
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    track("page_view");
    scheduleHubSpot();
    var measurementId = cfg.gaMeasurementId || "";
    if (/^G-[A-Z0-9]+$/.test(measurementId)) {
      var script = document.createElement("script");
      script.async = true;
      script.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(measurementId);
      document.head.appendChild(script);
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", measurementId);
    }
    apiFetch("/api/health").then(function (health) {
      var banner = document.getElementById("envBanner");
      var onProd = cfg.onProductionDomain === true;
      if (banner && !onProd && health.environment && health.environment !== "production") {
        banner.hidden = false;
        banner.classList.remove("hidden");
        banner.textContent = "Staging preview. This is not the live ASBS website. Consulting packages cannot be purchased here.";
      }
      window.ASBS.turnstileSiteKey = health.turnstile && health.turnstile.enabled ? health.turnstile.siteKey : "";
      document.dispatchEvent(new CustomEvent("asbs:health", { detail: health }));
    }).catch(function () {
      document.dispatchEvent(new CustomEvent("asbs:offline"));
    });
  }

  window.ASBS = { apiFetch: apiFetch, submitForm: submitForm, track: track, showMessage: showMessage, formData: formData, cfg: cfg };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
