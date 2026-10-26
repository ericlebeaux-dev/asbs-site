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
      if (navigator.sendBeacon) {
        navigator.sendBeacon(api + "/api/events", new Blob([payload], { type: "application/json" }));
        return;
      }
    } catch (error) { /* The page still works if analytics cannot be sent. */ }
    fetch(api + "/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true
    }).catch(function () {});
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

  function init() {
    var button = document.querySelector("[data-menu-button]");
    var menu = document.querySelector("[data-mobile-menu]");
    if (button && menu) {
      button.addEventListener("click", function () {
        var hidden = menu.classList.toggle("hidden");
        button.setAttribute("aria-expanded", hidden ? "false" : "true");
        button.setAttribute("aria-label", hidden ? "Open menu" : "Close menu");
      });
    }
    document.addEventListener("click", function (event) {
      var tracked = event.target.closest("[data-track]");
      if (tracked) track("cta_click", { id: tracked.getAttribute("data-track") });
    });
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
    track("page_view");
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
      if (banner && health.environment && health.environment !== "production") {
        banner.hidden = false;
        banner.classList.remove("hidden");
        banner.textContent = "Staging preview. This is not the live ASBS website. Consulting packages cannot be purchased here.";
      }
      document.dispatchEvent(new CustomEvent("asbs:health", { detail: health }));
    }).catch(function () {
      document.dispatchEvent(new CustomEvent("asbs:offline"));
    });
  }

  window.ASBS = { apiFetch: apiFetch, track: track, showMessage: showMessage, formData: formData, cfg: cfg };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
