import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(".");

function loadSuggest() {
  const context = { window: {}, console };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, "assets/js/suggest.js"), "utf8"), context);
  return context.window.ASBS_SUGGEST;
}

test("NIGP suggestions stay empty and the site bundle has no NIGP catalog", () => {
  const api = loadSuggest();
  const nigp = api.providers.find((provider) => provider.id === "nigp");
  const naics = api.providers.find((provider) => provider.id === "naics");
  assert.equal(nigp.enabled, false);
  assert.equal(JSON.stringify(nigp.search("janitorial")), "[]");
  assert.equal(JSON.stringify(nigp.search("910-39")), "[]");
  assert.equal(JSON.stringify(api.createNigpProvider().search("anything")), "[]");
  const catalog = {
    codes: [
      ["334111", "Electronic Computer Manufacturing", "31-33"],
      ["541511", "Custom Computer Programming Services", "54"],
      ["561720", "Janitorial Services", "56"],
    ],
  };
  const hits = naics.search("computer", catalog);
  assert.equal(JSON.stringify(hits.map((hit) => String(hit.code))), JSON.stringify(["334111", "541511"]));
  assert.equal(JSON.stringify(api.search("computer", catalog).map((hit) => String(hit.provider))), JSON.stringify(["naics", "naics"]));
  assert.equal(api.search("910", catalog).some((hit) => String(hit.provider) === "nigp"), false);

  assert.equal(fs.existsSync(path.join(root, "assets/codes/nigp.json")), false);
  const bundle = ["assets/js", "assets/codes"].flatMap((dir) => {
    return fs.readdirSync(path.join(root, dir)).map((file) => fs.readFileSync(path.join(root, dir, file), "utf8"));
  }).join("\n");
  assert.equal(bundle.includes("nigpTitles"), false);
  assert.equal(bundle.includes("NIGP_CODES"), false);
  assert.match(fs.readFileSync(path.join(root, "assets/js/forms.js"), "utf8"), /SUGGEST_WAIT = 250/);
  assert.match(fs.readFileSync(path.join(root, "intake.html"), "utf8"), /name="code_description"/);
  assert.equal(fs.readFileSync(path.join(root, "intake.html"), "utf8").includes('name="uei"'), false);
  assert.equal(fs.readFileSync(path.join(root, "intake.html"), "utf8").includes("budgetRange"), false);
  assert.match(fs.readFileSync(path.join(root, "docs/CODE_SOURCES.md"), "utf8"), /createNigpProvider|nigp` is disabled/);
});
