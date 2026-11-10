(function (root) {
  function wordsOf(query) {
    return String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function searchNaics(query, context) {
    var words = wordsOf(query);
    if (words.length === 0 || words.join("").length < 2) return [];
    var rows = (context && context.codes) || [];
    var hits = [];
    for (var i = 0; i < rows.length; i += 1) {
      var code = String(rows[i][0] || "");
      var title = String(rows[i][1] || "");
      var hay = (code + " " + title).toLowerCase();
      var matched = words.every(function (word) { return hay.indexOf(word) !== -1; });
      if (matched) hits.push({ provider: "naics", code: code, title: title });
    }
    hits.sort(function (a, b) {
      var aStart = a.title.toLowerCase().indexOf(words[0]) === 0 ? 0 : 1;
      var bStart = b.title.toLowerCase().indexOf(words[0]) === 0 ? 0 : 1;
      if (aStart !== bStart) return aStart - bStart;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });
    return hits.slice(0, 6);
  }

  function createNaicsProvider() {
    return { id: "naics", enabled: true, search: searchNaics };
  }

  // Disabled on purpose. A licensed NIGP feed can replace search() later.
  // This stub returns no titles and ships no NIGP list.
  function createNigpProvider() {
    return {
      id: "nigp",
      enabled: false,
      search: function () { return []; },
    };
  }

  var providers = [createNaicsProvider(), createNigpProvider()];

  function search(query, context) {
    var hits = [];
    providers.forEach(function (provider) {
      if (!provider.enabled) return;
      var found = provider.search(query, context) || [];
      found.forEach(function (hit) { hits.push(hit); });
    });
    return hits.slice(0, 6);
  }

  root.ASBS_SUGGEST = {
    providers: providers,
    search: search,
    createNaicsProvider: createNaicsProvider,
    createNigpProvider: createNigpProvider,
  };
})(typeof window !== "undefined" ? window : globalThis);
