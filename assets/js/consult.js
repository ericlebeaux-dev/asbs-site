(function () {
  var PACKAGE_TYPES = {
    "free-consultation": "discovery_15",
    "bid-readiness-assessment": "qualified_30",
    "quick-bid-review": "quick_bid_preview_30",
    "sam-registration-prep": "qualified_30",
    "registration-bundle": "qualified_30",
    "certification-support": "qualified_30",
    "contractor-launch": "onboarding_45",
    "monitor": "onboarding_45",
    "starter-bid": "onboarding_45",
    "growth": "onboarding_45",
    "full-capture": "onboarding_45"
  };
  var selectedType = "discovery_15";
  var selectedStart = "";
  var confirmation = null;
  var currentMonth = "";
  var firstMonth = "";
  var lastMonth = "";

  function byId(id) { return document.getElementById(id); }

  function setType(id) {
    if (confirmation && id !== confirmation.type) {
      window.ASBS.showMessage(byId("consultAlert"), "This booking keeps its current length. Cancel it before choosing another consultation type.", "error");
      return;
    }
    selectedType = id;
    document.querySelectorAll("[data-type]").forEach(function (button) {
      var active = button.getAttribute("data-type") === id;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.classList.toggle("ring-2", active);
      button.classList.toggle("ring-asbs-teal", active);
    });
    loadSlots();
  }

  function monthTitle(ym) {
    var parts = String(ym || "").split("-");
    if (parts.length !== 2) return "This month";
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1, 12));
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(date);
  }

  function shiftMonth(ym, delta) {
    var parts = String(ym || "").split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1 + delta, 1));
    return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0");
  }

  function renderSlots(slots, month) {
    var host = byId("slotList");
    var summary = byId("slotSummary");
    byId("monthLabel").textContent = monthTitle(month);
    var prev = byId("prevMonth");
    var next = byId("nextMonth");
    prev.disabled = !firstMonth || currentMonth <= firstMonth;
    next.disabled = !lastMonth || currentMonth >= lastMonth;
    host.replaceChildren();
    if (!slots.length) {
      summary.textContent = "";
      host.innerHTML = "<p class=\"text-sm text-slate-600\">No open times in " + monthTitle(month) + ". Use the month buttons to check another month, or call (281) 954-5167.</p>";
      return;
    }
    summary.textContent = slots.length + " open time" + (slots.length === 1 ? "" : "s") + " in " + monthTitle(month) + ". Weekdays, 9:00–11:00 a.m. and 1:00–3:00 p.m. Central.";
    var groups = {};
    slots.forEach(function (slot) {
      var label = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        weekday: "long",
        month: "long",
        day: "numeric"
      }).format(new Date(slot.start));
      groups[label] = groups[label] || [];
      groups[label].push(slot);
    });
    Object.keys(groups).forEach(function (label) {
      var group = document.createElement("fieldset");
      group.className = "border border-slate-200 rounded-xl p-4";
      var legend = document.createElement("legend");
      legend.className = "px-1 font-semibold text-asbs-navy";
      legend.textContent = label;
      group.appendChild(legend);
      var row = document.createElement("div");
      row.className = "mt-3 flex flex-wrap gap-2";
      groups[label].forEach(function (slot) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "min-h-11 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:border-asbs-teal";
        button.textContent = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Chicago",
          hour: "numeric",
          minute: "2-digit"
        }).format(new Date(slot.start));
        button.addEventListener("click", function () {
          selectedStart = slot.start;
          row.querySelectorAll("button").forEach(function (item) {
            item.classList.remove("bg-asbs-navy", "text-white");
          });
          button.classList.add("bg-asbs-navy", "text-white");
          byId("selectedSlot").textContent = "Selected: " + label + " at " + button.textContent + " Central.";
        });
        row.appendChild(button);
      });
      group.appendChild(row);
      host.appendChild(group);
    });
  }

  async function loadSlots() {
    var host = byId("slotList");
    host.textContent = "Checking open times…";
    byId("slotSummary").textContent = "";
    try {
      var query = "/api/slots?type=" + encodeURIComponent(selectedType);
      if (currentMonth) query += "&month=" + encodeURIComponent(currentMonth);
      var data = await window.ASBS.apiFetch(query);
      firstMonth = data.firstMonth || firstMonth;
      lastMonth = data.lastMonth || lastMonth;
      currentMonth = data.month || currentMonth || firstMonth;
      selectedStart = "";
      byId("selectedSlot").textContent = "No time selected yet.";
      renderSlots(data.slots || [], currentMonth);
    } catch (error) {
      host.textContent = "";
      window.ASBS.showMessage(byId("consultAlert"), error.message, "error");
    }
  }

  function showConfirmation(data) {
    confirmation = data;
    try { sessionStorage.setItem("asbs.confirmation", JSON.stringify(data)); } catch (error) {}
    byId("customerFields").hidden = true;
    var panel = byId("confirmation");
    panel.hidden = false;
    var meet = data.meetLink ? " Google Meet: " + data.meetLink + "." : "";
    panel.querySelector("[data-summary]").textContent = data.typeLabel + " on " + data.when + ". " + (data.meetingMode === "phone" ? "ASBS will call the phone number you entered." : "Meeting option: Google Meet.") + meet;
    panel.querySelector("[data-calendar]").textContent = data.calendar.message;
    panel.querySelector("[data-code]").textContent = data.cancelToken || "";
    panel.querySelector("[data-instructions]").textContent = data.instructions;
  }

  async function restore() {
    try {
      var saved = JSON.parse(sessionStorage.getItem("asbs.confirmation") || "null");
      if (saved && saved.bookingId && saved.cancelToken) showConfirmation(saved);
    } catch (error) {}
  }

  document.addEventListener("DOMContentLoaded", function () {
    var params = new URLSearchParams(location.search);
    var requestedPackage = params.get("package") || "";
    if (PACKAGE_TYPES[requestedPackage]) {
      selectedType = PACKAGE_TYPES[requestedPackage];
      var interest = document.querySelector("#bookingForm [name=serviceInterest]");
      if (interest) interest.value = requestedPackage;
    }
    document.querySelectorAll("[data-type]").forEach(function (button) {
      button.addEventListener("click", function () { setType(button.getAttribute("data-type")); });
    });
    byId("prevMonth").addEventListener("click", function () {
      if (!currentMonth || currentMonth <= firstMonth) return;
      currentMonth = shiftMonth(currentMonth, -1);
      loadSlots();
    });
    byId("nextMonth").addEventListener("click", function () {
      if (!currentMonth || (lastMonth && currentMonth >= lastMonth)) return;
      currentMonth = shiftMonth(currentMonth, 1);
      loadSlots();
    });
    setType(selectedType);
    restore();
    document.addEventListener("asbs:offline", function () {
      window.ASBS.showMessage(byId("consultAlert"), "The scheduling service is not reachable from this page. Call (281) 954-5167. Nothing was booked.", "error");
    });
    document.addEventListener("asbs:health", function (event) {
      var health = event.detail || {};
      var note = byId("calendarStatus");
      if (!health.calendar || !health.calendar.connected) {
        note.textContent = "Google Calendar is not connected on this server. A booking is saved here and blocked against other bookings on this server, but it is not written to the owner's Google Calendar until the owner connects it.";
      } else {
        var mailNote = health.mail && health.mail.configured
          ? " A confirmation email is sent from American Standard Business Solutions."
          : " A confirmation email is sent once mailbox sending is connected.";
        note.textContent = "Google Calendar is connected. Open times exclude conflicts on that calendar, and a successful booking is added there. Google does not send a calendar invitation." + mailNote;
      }
    });

    byId("bookingForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      window.ASBS.showMessage(byId("consultAlert"), "");
      if (!selectedStart) {
        window.ASBS.showMessage(byId("consultAlert"), "Choose an open time before submitting.", "error");
        return;
      }
      var body = window.ASBS.formData(event.currentTarget);
      body.type = selectedType;
      body.start = selectedStart;
      body.consent = body.consent === true;
      if (PACKAGE_TYPES[body.serviceInterest]) body.packageId = body.serviceInterest;
      var button = event.currentTarget.querySelector("[type=submit]");
      button.disabled = true;
      try {
        var result = await window.ASBS.apiFetch("/api/bookings", { method: "POST", body: body });
        showConfirmation(result);
      } catch (error) {
        window.ASBS.showMessage(byId("consultAlert"), error.message, "error");
        if (error.status === 409) loadSlots();
      } finally {
        button.disabled = false;
      }
    });

    byId("cancelBooking").addEventListener("click", async function () {
      if (!confirmation) return;
      var result = await window.ASBS.apiFetch("/api/bookings/" + confirmation.bookingId + "/cancel", {
        method: "POST",
        body: { token: confirmation.cancelToken }
      }).catch(function (error) { return { message: error.message, failed: true }; });
      window.ASBS.showMessage(byId("consultAlert"), result.message, result.failed ? "error" : "ok");
      if (!result.failed) {
        confirmation = null;
        sessionStorage.removeItem("asbs.confirmation");
        byId("confirmation").hidden = true;
        byId("customerFields").hidden = false;
        loadSlots();
      }
    });

    byId("rescheduleBooking").addEventListener("click", async function () {
      if (!confirmation || !selectedStart) {
        window.ASBS.showMessage(byId("consultAlert"), "Choose a different open time, then select Reschedule.", "error");
        return;
      }
      try {
        var result = await window.ASBS.apiFetch("/api/bookings/" + confirmation.bookingId + "/reschedule", {
          method: "POST",
          body: { token: confirmation.cancelToken, start: selectedStart }
        });
        confirmation.start = result.start;
        confirmation.end = result.end;
        confirmation.when = result.when;
        confirmation.calendar = confirmation.calendar || {};
        showConfirmation(confirmation);
        window.ASBS.showMessage(byId("consultAlert"), result.message || "The appointment was moved.", "ok");
      } catch (error) {
        window.ASBS.showMessage(byId("consultAlert"), error.message, "error");
      }
    });
  });
})();
