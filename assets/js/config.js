/* Public site settings only. Do not put API secrets, refresh tokens, or private keys here. */
(function () {
  var host = (typeof location !== "undefined" && location.hostname) || "";
  var onProductionDomain =
    host === "www.americanstandardbusinesssolutions.com" ||
    host === "americanstandardbusinesssolutions.com";
  // GitHub Pages serves the HTML on the production domain but cannot run /api.
  // Booking, intake, and dashboard calls go to the Render Node service until the
  // custom domain is pointed at Render itself.
  var apiBase = onProductionDomain ? "https://asbs-staging.onrender.com" : "";
  window.ASBS_PUBLIC_CONFIG = {
    apiBase: apiBase,
    gaMeasurementId: "",
    phoneDisplay: "(281) 954-5167",
    phoneTel: "+12819545167",
    email: "info@americanstandardbusinesssolutions.com",
    timezone: "America/Chicago",
    onProductionDomain: onProductionDomain
  };
})();
