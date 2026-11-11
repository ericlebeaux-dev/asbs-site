(function () {
  function watchIntake() {
    var form = document.getElementById("intakeForm");
    if (!form) return;
    var DRAFT_KEY = "asbs.intake.draft";
    var SUGGEST_WAIT = 250;
    var step = 1;
    var formStartedAt = Date.now();
    var suggestTimer = 0;
    var suggestItems = [];
    var suggestIndex = -1;

    function levels() {
      return Array.prototype.map.call(form.querySelectorAll('input[name="contractingLevel"]:checked'), function (item) { return item.value; });
    }

    function governmentSelected() {
      return levels().some(function (level) { return level === "federal" || level === "state" || level === "local"; });
    }

    function setAlert(message, kind) {
      var alert = document.getElementById("formAlert");
      if (!alert) return;
      alert.hidden = !message;
      alert.textContent = message || "";
      alert.className = "form-alert" + (kind ? " is-" + kind : "");
    }

    function showStep(next) {
      step = next;
      var first = document.getElementById("step1");
      var second = document.getElementById("step2");
      if (first) first.hidden = next !== 1;
      if (second) second.hidden = next !== 2;
      var label = document.getElementById("stepLabel");
      var text = next === 1 ? "Step 1 of 2" : "Step 2 of 2";
      if (label) label.textContent = text;
      var bar = document.getElementById("stepProgress");
      if (bar) {
        bar.setAttribute("aria-valuenow", String(next));
        bar.setAttribute("aria-valuetext", text);
        var fill = bar.querySelector("span");
        if (fill) fill.style.width = next === 1 ? "50%" : "100%";
      }
      var note = document.getElementById("stepNote");
      if (note) note.textContent = next === 1
        ? "About a minute. Office hours are Monday–Friday, 8:00 a.m.–5:00 p.m. Central."
        : "Optional. Your request is not sent until you submit.";
      var heading = document.getElementById(next === 1 ? "step1Heading" : "step2Heading");
      if (heading) heading.focus();
    }

    function markInvalid(el, invalid) {
      if (!el) return;
      if (invalid) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    }

    function validateStep1() {
      var errors = [];
      var first = null;
      function need(name, label, check) {
        var el = form.querySelector('[name="' + name + '"]');
        var bad = check ? !check(el) : !el || !String(el.value || "").trim();
        markInvalid(el, bad);
        if (bad) {
          errors.push(label);
          if (!first) first = el;
        }
      }
      need("name", "Enter your name.");
      need("organization", "Enter the business name.");
      need("email", "Enter an email address.", function (el) { return el && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()); });
      need("phone", "Enter a phone number.", function (el) { return el && el.value.replace(/\D/g, "").length >= 10; });
      need("based", "Enter a city and state, such as Dallas, TX.", function (el) {
        return el && /,\s*\S+/.test(el.value.trim());
      });
      need("serviceInterest", "Choose what you want to talk about.", function (el) { return el && el.value; });
      var consent = form.querySelector('[name="consent"]');
      var consentBad = !consent || !consent.checked;
      markInvalid(consent, consentBad);
      if (consentBad) {
        errors.push("Consent is required before ASBS can save this request.");
        if (!first) first = consent;
      }
      if (errors.length) {
        setAlert(errors.join(" "), "error");
        if (first && first.focus) first.focus();
        return false;
      }
      setAlert("");
      return true;
    }

    function syncGovernment() {
      var block = document.getElementById("govCodes");
      if (block) block.hidden = !governmentSelected();
      var cert = document.getElementById("certFields");
      var holds = form.querySelector('[name="holdsCertifications"]');
      if (cert) cert.hidden = !holds || holds.value !== "yes";
      if (holds && holds.value !== "yes") {
        var box = form.querySelector('[name="certifications"]');
        if (box) box.value = "";
      }
    }

    function syncContractLocks(changed) {
      var boxes = form.querySelectorAll('[name="contractingLevel"]');
      var chosen = levels();
      var gov = chosen.some(function (level) { return level === "federal" || level === "state" || level === "local"; });
      var exclusive = chosen.indexOf("none") !== -1 || chosen.indexOf("unsure") !== -1;
      if (changed && (changed.value === "none" || changed.value === "unsure") && changed.checked) {
        boxes.forEach(function (box) {
          if (box !== changed) box.checked = false;
        });
        exclusive = true;
        gov = false;
      } else if (changed && changed.checked && changed.value !== "none" && changed.value !== "unsure") {
        boxes.forEach(function (box) {
          if (box.value === "none" || box.value === "unsure") box.checked = false;
        });
        gov = true;
        exclusive = false;
      }
      boxes.forEach(function (box) {
        var isExclusive = box.value === "none" || box.value === "unsure";
        if (exclusive) box.disabled = box.value !== (chosen.indexOf("none") !== -1 ? "none" : "unsure");
        else if (gov) box.disabled = isExclusive;
        else box.disabled = false;
      });
      syncGovernment();
    }

    function splitBased(body) {
      var based = String(body.based || "").trim();
      var comma = based.lastIndexOf(",");
      if (comma > 0) {
        body.businessCity = based.slice(0, comma).trim();
        body.businessState = based.slice(comma + 1).trim();
      }
      return body;
    }

    function suggestStatus(message) {
      var status = document.getElementById("codeSuggestStatus");
      if (!status) return;
      status.textContent = "";
      window.setTimeout(function () { status.textContent = message; }, 30);
    }

    function clearSuggestions() {
      suggestItems = [];
      suggestIndex = -1;
      var list = document.getElementById("codeSuggestList");
      if (list) {
        list.replaceChildren();
        list.hidden = true;
      }
      var field = document.getElementById("codeDescription");
      if (field) field.setAttribute("aria-expanded", "false");
    }

    function highlight(node, text, query) {
      node.replaceChildren();
      var source = String(text || "");
      var words = String(query || "").trim().toLowerCase().split(/\s+/).filter(function (word) { return word.length >= 2; });
      if (!words.length) {
        node.textContent = source;
        return;
      }
      var lower = source.toLowerCase();
      var cursor = 0;
      var ranges = [];
      words.forEach(function (word) {
        var from = 0;
        var at = lower.indexOf(word, from);
        while (at !== -1) {
          ranges.push([at, at + word.length]);
          from = at + word.length;
          at = lower.indexOf(word, from);
        }
      });
      ranges.sort(function (a, b) { return a[0] - b[0]; });
      var merged = [];
      ranges.forEach(function (range) {
        var last = merged[merged.length - 1];
        if (!last || range[0] > last[1]) merged.push([range[0], range[1]]);
        else last[1] = Math.max(last[1], range[1]);
      });
      merged.forEach(function (range) {
        if (range[0] > cursor) node.appendChild(document.createTextNode(source.slice(cursor, range[0])));
        var mark = document.createElement("mark");
        mark.className = "code-hit";
        mark.textContent = source.slice(range[0], range[1]);
        node.appendChild(mark);
        cursor = range[1];
      });
      if (cursor < source.length) node.appendChild(document.createTextNode(source.slice(cursor)));
    }

    function addSuggestion(item) {
      document.dispatchEvent(new CustomEvent("asbs:add-naics", { detail: { code: item.code, title: item.title } }));
      suggestStatus("Added " + item.code + " " + item.title + " to NAICS.");
    }

    function renderSuggestions(query, hits) {
      var list = document.getElementById("codeSuggestList");
      var field = document.getElementById("codeDescription");
      if (!list || !field) return;
      list.replaceChildren();
      suggestItems = hits;
      suggestIndex = hits.length ? 0 : -1;
      if (!hits.length) {
        list.hidden = true;
        field.setAttribute("aria-expanded", "false");
        suggestStatus(query.trim().length >= 2 ? "No NAICS title matches. NIGP titles are not listed here." : "");
        return;
      }
      hits.forEach(function (hit, index) {
        var option = document.createElement("li");
        option.setAttribute("role", "option");
        option.id = "codeSuggestOpt" + index;
        option.setAttribute("aria-selected", index === 0 ? "true" : "false");
        var button = document.createElement("button");
        button.type = "button";
        var code = document.createElement("span");
        code.className = "code-num";
        code.textContent = hit.code;
        var title = document.createElement("span");
        highlight(title, hit.title, query);
        button.appendChild(code);
        button.appendChild(title);
        button.addEventListener("click", function () { addSuggestion(hit); });
        option.appendChild(button);
        list.appendChild(option);
      });
      list.hidden = false;
      field.setAttribute("aria-expanded", "true");
      suggestStatus(hits.length + (hits.length === 1 ? " NAICS suggestion." : " NAICS suggestions.") + " NIGP titles are not listed.");
    }

    function moveSuggestion(delta) {
      if (!suggestItems.length) return;
      suggestIndex = (suggestIndex + delta + suggestItems.length) % suggestItems.length;
      var list = document.getElementById("codeSuggestList");
      if (!list) return;
      var options = list.querySelectorAll("[role=option]");
      options.forEach(function (option, index) {
        option.setAttribute("aria-selected", index === suggestIndex ? "true" : "false");
      });
      var button = options[suggestIndex] && options[suggestIndex].querySelector("button");
      if (button) button.focus();
    }

    function runSuggest(query) {
      var engine = window.ASBS_SUGGEST;
      var loader = window.ASBS_CODES && window.ASBS_CODES.load;
      if (!engine || !loader) return;
      if (String(query || "").trim().length < 2) {
        clearSuggestions();
        return;
      }
      loader().then(function (catalog) {
        var hits = engine.search(query, { codes: catalog.codes || [] });
        if (document.getElementById("codeDescription").value !== query) return;
        renderSuggestions(query, hits);
      }).catch(function () {
        suggestStatus("Industry titles did not load. You can still type the description.");
      });
    }

    function readDraft() {
      try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); }
      catch (error) { return null; }
    }

    function writeDraft() {
      var data = window.ASBS.formData(form);
      data._step = step;
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: new Date().toISOString(), data: data }));
      var banner = document.getElementById("draftBanner");
      if (banner) banner.hidden = false;
      var status = document.getElementById("draftStatus");
      if (status) status.textContent = "Saved in this browser. Nothing was emailed. Come back on this device to finish.";
    }

    function applyDraft(data) {
      if (!data) return;
      Object.keys(data).forEach(function (key) {
        if (key === "_step" || key === "contractingLevel") return;
        var fields = form.querySelectorAll('[name="' + key + '"]');
        if (!fields.length) return;
        if (fields[0].type === "checkbox") fields[0].checked = data[key] === true;
        else fields[0].value = data[key] == null ? "" : data[key];
      });
      var chosen = data.contractingLevel || [];
      form.querySelectorAll('[name="contractingLevel"]').forEach(function (box) {
        box.checked = chosen.indexOf(box.value) !== -1;
        box.disabled = false;
      });
      syncContractLocks(null);
      document.dispatchEvent(new CustomEvent("asbs:hydrate-codes"));
      if (data._step === 2) showStep(2);
    }

    function clearDraft() {
      localStorage.removeItem(DRAFT_KEY);
      form.reset();
      document.dispatchEvent(new CustomEvent("asbs:hydrate-codes"));
      clearSuggestions();
      syncContractLocks(null);
      showStep(1);
      setAlert("");
      var banner = document.getElementById("draftBanner");
      if (banner) banner.hidden = true;
    }

    form.addEventListener("change", function (event) {
      if (event.target && event.target.name === "contractingLevel") syncContractLocks(event.target);
      else syncGovernment();
    });
    syncContractLocks(null);

    var describe = document.getElementById("codeDescription");
    if (describe) {
      describe.addEventListener("input", function () {
        window.clearTimeout(suggestTimer);
        var value = describe.value;
        suggestTimer = window.setTimeout(function () { runSuggest(value); }, SUGGEST_WAIT);
      });
      describe.addEventListener("keydown", function (event) {
        var list = document.getElementById("codeSuggestList");
        if (!list || list.hidden) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          var firstButton = list.querySelector("button");
          if (firstButton) firstButton.focus();
        } else if (event.key === "Escape") {
          clearSuggestions();
        }
      });
    }
    var suggestList = document.getElementById("codeSuggestList");
    if (suggestList) {
      suggestList.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown") { event.preventDefault(); moveSuggestion(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); moveSuggestion(-1); }
        else if (event.key === "Escape") {
          clearSuggestions();
          if (describe) describe.focus();
        }
      });
    }

    document.getElementById("continueStep").addEventListener("click", function () {
      if (!validateStep1()) return;
      showStep(2);
    });
    document.getElementById("backStep").addEventListener("click", function () {
      setAlert("");
      showStep(1);
    });
    document.getElementById("saveDraft").addEventListener("click", writeDraft);
    document.getElementById("resumeDraft").addEventListener("click", function () {
      var saved = readDraft();
      if (saved && saved.data) applyDraft(saved.data);
    });
    document.getElementById("clearDraft").addEventListener("click", clearDraft);
    var skip = document.getElementById("skipStep");
    if (skip) skip.addEventListener("click", function () { submitIntake(); });

    var saved = readDraft();
    var banner = document.getElementById("draftBanner");
    if (banner && saved && saved.data) banner.hidden = false;

    async function submitIntake() {
      if (!validateStep1()) {
        if (step !== 1) showStep(1);
        return;
      }
      var alert = document.getElementById("formAlert");
      setAlert("");
      var body = splitBased(window.ASBS.formData(form));
      body.consent = body.consent === true;
      body.formStartedAt = formStartedAt;
      var button = document.getElementById("submitIntake");
      var skipButton = document.getElementById("skipStep");
      if (button) button.disabled = true;
      if (skipButton) skipButton.disabled = true;
      try {
        var result = await window.ASBS.submitForm("/api/intake", body, function () {
          setAlert("Connecting securely, this can take up to a minute…", "pending");
        });
        setAlert("");
        localStorage.removeItem(DRAFT_KEY);
        if (banner) banner.hidden = true;
        form.hidden = true;
        document.getElementById("stepChrome").hidden = true;
        var confirm = document.getElementById("intakeConfirm");
        confirm.hidden = false;
        document.getElementById("confirmText").textContent = result.message;
        confirm.focus();
      } catch (error) {
        setAlert((error.message || "The intake was not saved.") + " The form is still here. Call (281) 954-5167 or email info@americanstandardbusinesssolutions.com.", "error");
        if (button) button.disabled = false;
        if (skipButton) skipButton.disabled = false;
      }
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitIntake();
    });
  }

  function watchVendor() {
    var form = document.getElementById("vendorForm");
    if (!form) return;
    var formStartedAt = Date.now();
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
      body.formStartedAt = formStartedAt;
      var button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        var result = await window.ASBS.submitForm("/api/vendors", body, function () {
          if (!alert) return;
          alert.hidden = false;
          alert.textContent = "Connecting securely, this can take up to a minute…";
          alert.className = "form-alert is-pending";
          alert.setAttribute("aria-live", "polite");
        });
        form.reset();
        window.ASBS.showMessage(alert, result.message, "ok");
      } catch (error) {
        window.ASBS.showMessage(alert, (error.message || "The registration was not saved.") + " The form is still here. Call (281) 954-5167 or email info@americanstandardbusinesssolutions.com.", "error");
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

  function watchQuote() {
    var form = document.getElementById("quoteForm");
    if (!form) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var alert = document.getElementById("quoteAlert");
      window.ASBS.showMessage(alert, "");
      var body = window.ASBS.formData(form);
      body.consent = body.consent === true;
      var button = form.querySelector("[type=submit]");
      button.disabled = true;
      try {
        var result = await window.ASBS.apiFetch("/api/quotes", { method: "POST", body: body });
        form.reset();
        window.ASBS.showMessage(alert, result.message, "ok");
      } catch (error) {
        if (!error.status || error.status === 404) {
          button.disabled = false;
          form.submit();
          return;
        }
        window.ASBS.showMessage(alert, error.message || "The quote request was not saved.", "error");
      } finally {
        button.disabled = false;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    watchIntake();
    watchVendor();
    watchContact();
    watchQuote();
    document.addEventListener("asbs:offline", function () {
      var alert = document.getElementById("formAlert");
      if (alert && !document.getElementById("bookingForm")) {
        window.ASBS.showMessage(alert, "This form needs the ASBS staging server. It is not available on the static site alone. Call (281) 954-5167.", "error");
      }
    });
  });
})();
