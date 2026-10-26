(function () {
  function watchIntake() {
    var form = document.getElementById("intakeForm");
    if (!form) return;
    var packages = ["quick-bid-review", "contractor-starter", "registration-accelerator", "contractor-launch", "growth-partner"];
    function sync() {
      var levels = Array.prototype.map.call(form.querySelectorAll('input[name="contractingLevel"]:checked'), function (item) { return item.value; });
      var registration = document.getElementById("registrationFields");
      if (registration) registration.hidden = !levels.some(function (level) { return level === "federal" || level === "state" || level === "local"; });
      var budget = document.getElementById("budgetWrap");
      var interest = form.querySelector("[name=serviceInterest]");
      if (budget && interest) budget.hidden = packages.indexOf(interest.value) === -1;
    }
    form.addEventListener("change", sync);
    sync();
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var alert = document.getElementById("formAlert");
      window.ASBS.showMessage(alert, "");
      var body = window.ASBS.formData(form);
      body.consent = body.consent === true;
      var button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        var result = await window.ASBS.apiFetch("/api/intake", { method: "POST", body: body });
        form.reset();
        sync();
        window.ASBS.showMessage(alert, result.message, "ok");
      } catch (error) {
        window.ASBS.showMessage(alert, error.message || "The intake was not saved.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function watchVendor() {
    var form = document.getElementById("vendorForm");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var alert = document.getElementById("formAlert");
      window.ASBS.showMessage(alert, "");
      var body = window.ASBS.formData(form);
      body.consent = body.consent === true;
      var file = form.querySelector("[name=documentFile]").files[0];
      if (file) {
        if (file.size > 4 * 1024 * 1024) {
          window.ASBS.showMessage(alert, "Attachments must be 4 MB or less.", "error");
          return;
        }
        if (["application/pdf", "image/png", "image/jpeg"].indexOf(file.type) === -1) {
          window.ASBS.showMessage(alert, "Upload a PDF, PNG, or JPEG.", "error");
          return;
        }
        body.document = await readFile(file);
      }
      delete body.documentFile;
      var button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        var result = await window.ASBS.apiFetch("/api/vendors", { method: "POST", body: body });
        form.reset();
        window.ASBS.showMessage(alert, result.message, "ok");
      } catch (error) {
        window.ASBS.showMessage(alert, error.message || "The registration was not saved.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function watchContact() {
    var form = document.getElementById("contactForm");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var alert = document.getElementById("formAlert");
      var body = window.ASBS.formData(form);
      body.consent = body.consent === true;
      var button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        var result = await window.ASBS.apiFetch("/api/inquiries", { method: "POST", body: body });
        form.reset();
        window.ASBS.showMessage(alert, result.message, "ok");
      } catch (error) {
        window.ASBS.showMessage(alert, (error.message || "The message was not saved.") + " You can also call (281) 954-5167 or email info@americanstandardbusinesssolutions.com.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("The file could not be read.")); };
      reader.onload = function () {
        var value = String(reader.result || "");
        var marker = value.indexOf(",");
        resolve({ filename: file.name, mimeType: file.type, dataBase64: marker >= 0 ? value.slice(marker + 1) : value });
      };
      reader.readAsDataURL(file);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    watchIntake();
    watchVendor();
    watchContact();
    document.addEventListener("asbs:offline", function () {
      var alert = document.getElementById("formAlert");
      if (alert && !document.getElementById("bookingForm")) {
        window.ASBS.showMessage(alert, "This form needs the ASBS staging server. It is not available on the static site alone. Call (281) 954-5167.", "error");
      }
    });
  });
})();
