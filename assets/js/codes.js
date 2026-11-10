(function () {
  var NAICS_URL = "assets/codes/naics-2022.json";
  var DASH = " \u2014 ";
  var MAX_ENTRIES = 20;
  var naicsPromise = null;

  function loadNaics() {
    if (!naicsPromise) {
      naicsPromise = fetch(NAICS_URL, { credentials: "same-origin" }).then(function (response) {
        if (!response.ok) throw new Error("The NAICS list did not load.");
        return response.json();
      });
    }
    return naicsPromise;
  }

  function sectorTitle(data, code) {
    for (var i = 0; i < data.sectors.length; i += 1) {
      if (data.sectors[i][0] === code) return data.sectors[i][1];
    }
    return code;
  }

  function wordsMatch(text, query) {
    var words = query.toLowerCase().split(/\s+/).filter(Boolean);
    var hay = text.toLowerCase();
    return words.every(function (word) { return hay.indexOf(word) !== -1; });
  }

  function matchNaics(entry, query) {
    var q = query.trim().toLowerCase();
    if (q.length < 2) return false;
    if (entry.code.indexOf(q) === 0) return true;
    return wordsMatch(entry.code + " " + entry.title, q);
  }

  function rankNaics(entry, query) {
    var q = query.trim().toLowerCase();
    if (entry.code === q) return 0;
    if (entry.code.indexOf(q) === 0) return 1;
    if (entry.title.toLowerCase().indexOf(q) === 0) return 2;
    return 3;
  }

  function say(node, message) {
    if (!node) return;
    node.textContent = "";
    window.setTimeout(function () { node.textContent = message; }, 30);
  }

  function parseNigp(part) {
    var match = String(part || "").trim().match(/^(\d{3})([\s\S]*)$/);
    if (!match) return { error: "Enter a 3-digit class, or a class-item as 3 digits, a hyphen, and 2 digits." };
    var rest = match[2];
    var item = "";
    if (/^-\d{2}(?!\d)/.test(rest)) {
      item = rest.slice(1, 3);
      rest = rest.slice(3);
    } else if (/^\d{2}(?!\d)/.test(rest)) {
      item = rest.slice(0, 2);
      rest = rest.slice(2);
    } else if (/^\d/.test(rest) || rest.charAt(0) === "-") {
      return { error: "A class-item needs exactly 2 digits after the class. Example shape: 123-45." };
    }
    rest = rest.trim();
    if (rest === "-" || rest === "\u2014" || rest === "\u2013") return { error: "Add a note after the dash, or leave the dash off." };
    var note = "";
    if (rest) {
      note = rest.replace(/^[\u2014\u2013-]\s*/, "").replace(/\s+/g, " ").trim();
      if (!note) return { error: "Add a note after the dash, or leave the dash off." };
      if (note.length > 80) return { error: "A note must be 80 characters or fewer." };
    }
    return { code: item ? match[1] + "-" + item : match[1], note: note };
  }

  function mountBrowser(root) {
    var status = root.querySelector("[data-naics-status]");
    loadNaics().then(function (data) {
      var entries = data.codes.map(function (row) {
        return { code: row[0], title: row[1], sector: row[2] };
      });
      var bySector = {};
      data.sectors.forEach(function (sector) { bySector[sector[0]] = []; });
      entries.forEach(function (entry) {
        if (!bySector[entry.sector]) bySector[entry.sector] = [];
        bySector[entry.sector].push(entry);
      });

      var toolbar = document.createElement("div");
      toolbar.className = "code-toolbar";
      var label = document.createElement("label");
      label.setAttribute("for", root.id ? root.id + "-search" : "naics-browser-search");
      label.textContent = "Search NAICS codes";
      var input = document.createElement("input");
      input.id = label.getAttribute("for");
      input.type = "text";
      input.autocomplete = "off";
      input.autocapitalize = "off";
      input.spellcheck = false;
      input.placeholder = "Code or words from the title";
      input.setAttribute("aria-describedby", input.id + "-count");
      label.appendChild(input);

      var tools = document.createElement("div");
      tools.className = "code-tools";
      var expand = document.createElement("button");
      expand.type = "button";
      expand.className = "button secondary";
      expand.textContent = "Expand all";
      var collapse = document.createElement("button");
      collapse.type = "button";
      collapse.className = "button secondary";
      collapse.textContent = "Collapse all";
      tools.appendChild(expand);
      tools.appendChild(collapse);
      toolbar.appendChild(label);
      toolbar.appendChild(tools);

      var count = document.createElement("p");
      count.id = input.id + "-count";
      count.className = "code-count";
      count.setAttribute("aria-live", "polite");

      var list = document.createElement("div");
      list.className = "code-sectors";
      var details = [];
      data.sectors.forEach(function (sector) {
        var group = document.createElement("details");
        group.className = "code-sector";
        var summary = document.createElement("summary");
        var rows = bySector[sector[0]] || [];
        summary.textContent = sector[0] + " \u2014 " + sector[1] + " (" + rows.length + ")";
        group.appendChild(summary);
        rows.forEach(function (entry) {
          var row = document.createElement("div");
          row.className = "code-row";
          row.dataset.code = entry.code;
          row.dataset.title = entry.title;
          var num = document.createElement("span");
          num.className = "code-num";
          num.textContent = entry.code;
          var name = document.createElement("span");
          name.textContent = entry.title;
          row.appendChild(num);
          row.appendChild(name);
          group.appendChild(row);
        });
        details.push(group);
        list.appendChild(group);
      });

      root.replaceChildren(toolbar, count, list);

      function apply(query) {
        var q = query.trim();
        var visible = 0;
        details.forEach(function (group) {
          var shown = 0;
          var rows = group.querySelectorAll(".code-row");
          rows.forEach(function (row) {
            var entry = { code: row.dataset.code, title: row.dataset.title };
            var keep = q.length < 2 || matchNaics(entry, q);
            row.hidden = !keep;
            if (keep) shown += 1;
          });
          group.hidden = shown === 0;
          if (q.length >= 2) group.open = shown > 0;
          visible += shown;
        });
        if (q.length < 2) {
          count.textContent = entries.length + " six-digit NAICS codes in " + data.sectors.length + " sectors. Open a sector, or type at least two characters.";
        } else if (!visible) {
          count.textContent = "No 2022 NAICS code matches \u201c" + q + "\u201d.";
        } else {
          count.textContent = visible + (visible === 1 ? " code matches." : " codes match.");
        }
      }

      input.addEventListener("input", function () { apply(input.value); });
      expand.addEventListener("click", function () {
        details.forEach(function (group) { if (!group.hidden) group.open = true; });
      });
      collapse.addEventListener("click", function () {
        details.forEach(function (group) { group.open = false; });
        input.focus();
      });
      apply("");
    }).catch(function () {
      if (status) status.textContent = "The NAICS list did not load.";
      var link = document.createElement("p");
      var anchor = document.createElement("a");
      anchor.href = "https://www.census.gov/naics/?year=2022";
      anchor.textContent = "Open the Census Bureau NAICS search";
      link.appendChild(anchor);
      root.appendChild(link);
    });
  }

  function whenVisible(root, fn) {
    if (root.getAttribute("data-load") === "eager" || !("IntersectionObserver" in window)) {
      fn();
      return;
    }
    var watcher = new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) {
        watcher.disconnect();
        fn();
      }
    }, { rootMargin: "240px 0px" });
    watcher.observe(root);
  }

  function mountPicker(root) {
    var kind = root.getAttribute("data-code-picker");
    var input = root.querySelector("[role=combobox]");
    var list = root.querySelector("[role=listbox]");
    var chips = root.querySelector("[data-chips]");
    var field = root.querySelector("textarea");
    var live = root.querySelector("[data-live]");
    var match = root.querySelector("[data-match]");
    if (!input || !list || !chips || !field) return;
    var selected = [];
    var options = [];
    var active = -1;
    var catalog = null;

    function lineFor(item) {
      return item.note ? item.code + DASH + item.note : item.code + (item.title ? DASH + item.title : "");
    }

    function writeField() {
      field.value = selected.map(lineFor).join("\n");
      field.readOnly = true;
    }

    function renderChips() {
      chips.replaceChildren();
      chips.hidden = selected.length === 0;
      selected.forEach(function (item, index) {
        var li = document.createElement("li");
        li.className = "code-chip";
        var text = document.createElement("span");
        var label = item.title ? item.code + " " + item.title : (item.note ? item.code + " " + item.note : item.code);
        text.textContent = label;
        var button = document.createElement("button");
        button.type = "button";
        button.textContent = "Remove";
        button.setAttribute("aria-label", "Remove " + label);
        button.addEventListener("click", function () {
          selected.splice(index, 1);
          renderChips();
          writeField();
          say(live, "Removed " + item.code + ". " + selected.length + " selected.");
          input.focus();
        });
        li.appendChild(text);
        li.appendChild(button);
        chips.appendChild(li);
      });
      writeField();
    }

    function closeList() {
      list.hidden = true;
      list.replaceChildren();
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      options = [];
      active = -1;
    }

    function setActive(index) {
      if (!options.length) return;
      active = (index + options.length) % options.length;
      options.forEach(function (option, optionIndex) {
        var on = optionIndex === active;
        option.classList.toggle("is-active", on);
        option.setAttribute("aria-selected", on ? "true" : "false");
      });
      input.setAttribute("aria-activedescendant", options[active].id);
      var item = options[active];
      if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
      }
    }

    function already(code) {
      return selected.some(function (item) { return item.code === code; });
    }

    function addItem(item) {
      if (selected.length >= MAX_ENTRIES) {
        say(live, "20 is the maximum on this form.");
        if (match) match.textContent = "20 is the maximum on this form.";
        closeList();
        return;
      }
      if (already(item.code)) {
        say(live, item.code + " is already selected.");
        if (match) match.textContent = item.code + " is already selected.";
        closeList();
        input.value = "";
        return;
      }
      selected.push(item);
      renderChips();
      input.value = "";
      closeList();
      if (match) match.textContent = "";
      var spoken = item.title || item.note || "";
      say(live, "Added " + item.code + (spoken ? ", " + spoken : "") + ". " + selected.length + " selected.");
      input.focus();
    }

    function openOptions(items, labelFor) {
      list.replaceChildren();
      options = items.map(function (item, index) {
        var option = document.createElement("li");
        option.id = input.id + "-opt-" + index;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.code = item.code;
        var num = document.createElement("span");
        num.className = "code-num";
        num.textContent = item.code;
        var name = document.createElement("span");
        name.textContent = labelFor(item);
        option.appendChild(num);
        option.appendChild(name);
        option.addEventListener("mousedown", function (event) {
          event.preventDefault();
          addItem(item);
        });
        list.appendChild(option);
        return option;
      });
      if (!options.length) {
        closeList();
        return;
      }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      setActive(0);
    }

    function filterNaics() {
      var query = input.value.trim();
      if (!catalog) {
        if (match) match.textContent = "Loading the Census NAICS list.";
        return;
      }
      if (query.length < 2) {
        closeList();
        if (match) match.textContent = query ? "Type at least 2 characters." : "";
        return;
      }
      var found = catalog.filter(function (entry) { return matchNaics(entry, query) && !already(entry.code); });
      found.sort(function (a, b) { return rankNaics(a, query) - rankNaics(b, query) || a.code.localeCompare(b.code); });
      found = found.slice(0, 8);
      if (!found.length) {
        closeList();
        if (match) match.textContent = "No 2022 NAICS code matches.";
        return;
      }
      if (match) match.textContent = found.length + (found.length === 1 ? " match. Arrow keys move. Enter adds." : " matches. Arrow keys move. Enter adds.");
      openOptions(found, function (item) { return item.title; });
    }

    function filterNigp() {
      var query = input.value.trim();
      if (!query) {
        closeList();
        if (match) match.textContent = "";
        return;
      }
      var parsed = parseNigp(query);
      if (parsed.error) {
        closeList();
        if (match) match.textContent = parsed.error;
        return;
      }
      if (match) match.textContent = "Enter adds " + parsed.code + ".";
      openOptions([parsed], function (item) {
        return item.note ? "Add with your note: " + item.note : "Add this code";
      });
    }

    function filter() {
      if (kind === "naics") filterNaics();
      else filterNigp();
    }

    function chooseActive() {
      if (active >= 0 && options[active]) {
        var code = options[active].dataset.code;
        if (kind === "naics") {
          var entry = (catalog || []).find(function (item) { return item.code === code; });
          if (entry) addItem({ code: entry.code, title: entry.title });
        } else {
          var parsed = parseNigp(input.value.trim());
          if (!parsed.error) addItem(parsed);
        }
        return;
      }
      if (kind === "nigp") {
        var direct = parseNigp(input.value.trim());
        if (!input.value.trim()) return;
        if (direct.error) {
          if (match) match.textContent = direct.error;
          say(live, direct.error);
          return;
        }
        addItem(direct);
      }
    }

    input.addEventListener("input", filter);
    input.addEventListener("focus", function () {
      if (kind !== "naics" || catalog || input.dataset.loading === "1") return;
      input.dataset.loading = "1";
      input.setAttribute("aria-busy", "true");
      if (match) match.textContent = "Loading the Census NAICS list.";
      loadNaics().then(function (data) {
        catalog = data.codes.map(function (row) {
          return { code: row[0], title: row[1], sector: row[2], sectorTitle: sectorTitle(data, row[2]) };
        });
        input.removeAttribute("aria-busy");
        if (match && document.activeElement === input) filter();
        else if (match) match.textContent = "";
      }).catch(function () {
        delete input.dataset.loading;
        input.removeAttribute("aria-busy");
        if (match) match.textContent = "The NAICS list did not load. You can still submit the rest of the form.";
      });
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (list.hidden) filter();
        else if (options.length) setActive(active + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (options.length) setActive(active - 1);
      } else if (event.key === "Home" && !list.hidden) {
        event.preventDefault();
        setActive(0);
      } else if (event.key === "End" && !list.hidden) {
        event.preventDefault();
        setActive(options.length - 1);
      } else if (event.key === "Escape") {
        if (!list.hidden) {
          event.preventDefault();
          closeList();
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        chooseActive();
      } else if (event.key === "Backspace" && input.value === "" && selected.length) {
        selected.pop();
        renderChips();
        say(live, "Removed the last code. " + selected.length + " selected.");
      }
    });
    document.addEventListener("mousedown", function (event) {
      if (!root.contains(event.target)) closeList();
    });
    var form = root.closest("form");
    if (form) {
      form.addEventListener("reset", function () {
        selected = [];
        window.setTimeout(function () {
          renderChips();
          closeList();
          input.value = "";
          if (match) match.textContent = "";
        }, 0);
      });
    }
    renderChips();
  }

  function init() {
    document.querySelectorAll("[data-naics-browser]").forEach(function (root) {
      whenVisible(root, function () { mountBrowser(root); });
    });
    document.querySelectorAll("[data-code-picker]").forEach(mountPicker);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
