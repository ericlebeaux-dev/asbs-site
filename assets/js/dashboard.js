(function () {
  function money(cents) {
    if (cents == null) return "Not connected";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  }

  function card(label, value, note) {
    return '<article class="rounded-2xl bg-white border border-slate-200 p-5"><p class="text-xs uppercase tracking-wide text-slate-500 font-semibold">' + label + '</p><p class="mt-2 text-2xl font-extrabold text-asbs-navy">' + value + '</p><p class="mt-2 text-xs text-slate-500">' + note + '</p></article>';
  }

  var rangeDays = 7;

  function load(days) {
    rangeDays = days === 30 || days === 90 ? days : 7;
    return window.ASBS.apiFetch("/api/dashboard?days=" + rangeDays).then(render);
  }

  function trendChart(title, series, key) {
    var max = 1;
    series.forEach(function (day) { if (day[key] > max) max = day[key]; });
    var bars = series.map(function (day) {
      var height = day[key] ? Math.max(8, Math.round((day[key] / max) * 100)) : 2;
      return '<span title="' + escapeHtml(day.date + ": " + day[key]) + '" class="flex-1 min-w-0 rounded-sm ' + (day[key] ? "bg-asbs-teal" : "bg-slate-200") + '" style="height:' + height + '%"></span>';
    }).join("");
    return '<div class="rounded-2xl bg-white border border-slate-200 p-6"><h2 class="font-bold text-lg text-asbs-navy">' + escapeHtml(title) + '</h2><div class="mt-4 flex items-end gap-px h-28" role="img" aria-label="' + escapeHtml(title) + '">' + bars + '</div><p class="mt-2 text-xs text-slate-500">' + escapeHtml(series[0].date) + " through " + escapeHtml(series[series.length - 1].date) + ", America/Chicago.</p></div>";
  }

  function render(data) {
    var report = data.report;
    var host = document.getElementById("dashContent");
    var pipeline = report.pipeline;
    var days = report.spanDays || rangeDays;
    var max = Math.max(1, pipeline.newLeads, pipeline.consultationsScheduled, pipeline.won, pipeline.vendorRegistrations);
    var pages = (report.website.topPages || []).map(function (page) {
      return "<li>" + escapeHtml(page.path) + " · " + page.count + "</li>";
    }).join("") || "<li>No page views in this range.</li>";
    function rangeButton(value) {
      var current = value === days;
      return '<button type="button" data-range="' + value + '" class="px-3 py-1.5 rounded-lg text-sm font-semibold border ' + (current ? "bg-asbs-navy text-white border-asbs-navy" : "bg-white text-asbs-navy border-slate-300") + '">' + value + " days</button>";
    }
    function bar(label, count) {
      var width = Math.round((count / max) * 100);
      return '<div class="grid grid-cols-[9rem_1fr_2rem] gap-3 items-center text-sm"><span>' + label + '</span><span class="h-3 bg-slate-100 rounded"><span class="block h-3 rounded bg-asbs-teal" style="width:' + width + '%"></span></span><span class="text-right">' + count + '</span></div>';
    }
    host.innerHTML = [
      '<p class="text-sm text-slate-500">Generated ' + escapeHtml(report.generatedAt) + '. Environment: ' + escapeHtml(data.environment) + '.</p>',
      '<p class="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">' + escapeHtml(report.persistence || data.sources.persistence) + '</p>',
      '<div class="mt-4 flex gap-2" role="group" aria-label="Date range">' + rangeButton(7) + rangeButton(30) + rangeButton(90) + '</div>',
      '<div class="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">',
      card("Page views, " + days + " days", report.website.pageViews, report.website.note),
      card("Submissions, " + days + " days", report.website.submissions || 0, "Bookings, intake, contact, quotes, and vendor forms saved by this server."),
      card("Consultations booked, " + days + " days", report.pipeline.consultationsBookedThisWeek, "Includes cancelled records created in this range."),
      card("Verified collected revenue", money(report.financial.verifiedCollectedCents), report.financial.note),
      '</div>',
      '<section class="mt-8 grid lg:grid-cols-3 gap-6">',
      trendChart("Page views", report.trends, "pageViews"),
      trendChart("Submissions", report.trends, "submissions"),
      trendChart("Bookings", report.trends, "bookings"),
      '</section>',
      '<section class="mt-8 rounded-2xl bg-white border border-slate-200 p-6"><h2 class="font-bold text-lg text-asbs-navy">Top pages</h2><ol class="mt-3 list-decimal pl-5 text-sm space-y-1">' + pages + '</ol></section>',
      '<section class="mt-8 grid lg:grid-cols-2 gap-6">',
      '<div class="rounded-2xl bg-white border border-slate-200 p-6"><h2 class="font-bold text-lg text-asbs-navy">Pipeline on hand</h2><div class="mt-4 space-y-3">' + [
        bar("New leads", pipeline.newLeads),
        bar("Scheduled", pipeline.consultationsScheduled),
        bar("Won", pipeline.won),
        bar("Vendors", pipeline.vendorRegistrations)
      ].join("") + '</div><p class="mt-4 text-xs text-slate-500">Counts are records in this server. They are not estimates.</p></div>',
      '<div class="rounded-2xl bg-white border border-slate-200 p-6"><h2 class="font-bold text-lg text-asbs-navy">Sources</h2><ul class="mt-4 space-y-2 text-sm text-slate-700"><li>Google Analytics: ' + data.sources.googleAnalytics + '</li><li>Stripe: ' + data.sources.stripe + '</li><li>Google Calendar: ' + data.sources.googleCalendar + '</li><li>Revenue: ' + data.sources.revenue + '</li></ul><h3 class="mt-6 font-bold text-asbs-navy">Three actions</h3><ol class="mt-2 list-decimal pl-5 text-sm space-y-2">' + report.actions.map(function (item) { return "<li>" + escapeHtml(item) + "</li>"; }).join("") + '</ol></div>',
      '</section>',
      '<section class="mt-8"><h2 class="font-bold text-lg text-asbs-navy">New leads in range</h2><p class="mt-1 text-sm text-slate-600">' + report.pipeline.newLeads + ' customer or vendor records were first saved in this range. The table below is every record still on this server.</p></section>',
      '<section class="mt-4"><h2 class="font-bold text-lg text-asbs-navy">Records</h2><div class="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white"><table class="min-w-full text-sm"><thead class="bg-slate-50 text-left"><tr><th class="p-3">Name</th><th class="p-3">Role</th><th class="p-3">Stage</th><th class="p-3">Interest</th><th class="p-3">Follow-up</th></tr></thead><tbody>' + data.leads.map(function (lead) {
        return '<tr class="border-t border-slate-100"><td class="p-3">' + escapeHtml(lead.organization || lead.name) + '<div class="text-xs text-slate-500">' + escapeHtml(lead.email) + '</div></td><td class="p-3">' + escapeHtml(lead.role) + '</td><td class="p-3"><select data-lead="' + lead.id + '" class="border rounded p-1">' + ["new_lead","qualified","consultation_scheduled","consultation_completed","proposal_sent","won","lost","active_client","completed","follow_up"].map(function (stage) {
          return '<option' + (stage === lead.stage ? " selected" : "") + '>' + stage + '</option>';
        }).join("") + '</select></td><td class="p-3">' + escapeHtml(lead.serviceInterest || "") + '</td><td class="p-3">' + escapeHtml(lead.followUpAt || "—") + '</td></tr>';
      }).join("") + '</tbody></table></div></section>'
    ].join("");
    host.querySelectorAll("[data-range]").forEach(function (button) {
      button.addEventListener("click", function () {
        load(Number(button.getAttribute("data-range"))).catch(function (error) { alert(error.message); });
      });
    });
    host.querySelectorAll("select[data-lead]").forEach(function (select) {
      select.addEventListener("change", function () {
        window.ASBS.apiFetch("/api/leads/" + select.getAttribute("data-lead"), {
          method: "PATCH",
          body: { stage: select.value }
        }).catch(function (error) { alert(error.message); });
      });
    });
    document.getElementById("loginPanel").hidden = true;
    host.hidden = false;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char];
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("loginForm").addEventListener("submit", async function (event) {
      event.preventDefault();
      var alert = document.getElementById("formAlert");
      try {
        await window.ASBS.apiFetch("/api/auth/login", { method: "POST", body: { password: document.getElementById("password").value } });
        await load(7);
      } catch (error) {
        window.ASBS.showMessage(alert, error.message, "error");
      }
    });
    load(7).catch(function () {});
    document.getElementById("logoutButton").addEventListener("click", async function () {
      await window.ASBS.apiFetch("/api/auth/logout", { method: "POST", body: {} }).catch(function () {});
      location.reload();
    });
  });
})();
