/* Public site settings only. Do not put API secrets, refresh tokens, or private keys here. */
(function () {
  var host = (typeof location !== "undefined" && location.hostname) || "";
  var onProductionDomain =
    host === "www.americanstandardbusinesssolutions.com" ||
    host === "americanstandardbusinesssolutions.com";
  // GitHub Pages serves the HTML on the production domain but cannot run /api.
  // Intake, contact, vendor, quote, and dashboard calls go to the Render Node
  // service. The public site does not book consultation slots.
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
