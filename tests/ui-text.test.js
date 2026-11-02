// Tests of the interface texts (src/lib/ui-text.js and src/lib/ui/*.js) and of the interface language setting.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

// A sandbox with the interface texts and a given configuration / browser language.
function loadUi({ uiLanguage = "default", browser = "en" } = {}) {
  const sandbox = {
    console,
    twpConfig: { get: (k) => (k === "uiLanguage" ? uiLanguage : null) },
    chrome: { i18n: { getUILanguage: () => browser } },
  };
  vm.createContext(sandbox);
  for (const f of ["lib/ui-text.js", "lib/ui/en.js", "lib/ui/fr.js"]) vm.runInContext(read(f) + (f === "lib/ui-text.js" ? "\n;globalThis.twpUi = twpUi;" : ""), sandbox);
  return { ui: sandbox.twpUi, sandbox };
}

const languageFiles = () => fs.readdirSync(path.join(SRC, "lib", "ui")).filter((f) => f.endsWith(".js"));

test("every language has exactly the same keys as English", () => {
  const { ui } = loadUi();
  const reference = Object.keys(ui._messages.en).sort();
  assert.ok(reference.length > 100, "the reference language is complete");
  for (const code of Object.keys(ui._messages)) {
    assert.deepEqual(Object.keys(ui._messages[code]).sort(), reference, "keys of " + code);
    // placeholders ($1, $2...) must be the same as in English
    for (const key of reference) {
      const holders = (s) => (s.match(/\$\d/g) || []).sort().join();
      assert.equal(holders(ui._messages[code][key]), holders(ui._messages.en[key]), code + "." + key + ": placeholders");
    }
  }
});

test("every language file is loaded where the interface shows text", () => {
  const codes = languageFiles().map((f) => "/lib/ui/" + f);
  const manifest = JSON.parse(read("manifest.json"));
  const contentScripts = manifest.content_scripts.flatMap((c) => c.js);
  const bg = read("bg.js");
  for (const file of codes) {
    assert.ok(contentScripts.includes(file), file + " is a content script (panel)");
    assert.ok(bg.includes('"' + file + '"'), file + " is loaded by the service worker (menu)");
    for (const page of ["popup/popup.html", "composer/composer.html", "setup/setup.html", "dashboard/dashboard.html"]) {
      assert.ok(read(page).includes('src="' + file + '"'), file + " is loaded by " + page);
    }
  }
});

test("no text key used by the code is missing, and none is left unused", () => {
  const { ui } = loadUi();
  const have = new Set(Object.keys(ui._messages.en));
  const used = new Set();
  const files = ["background/menu.js", "contentScript/panel.js", "composer/composer.js", "composer/composer.html", "setup/setup.js", "setup/setup.html",
    "popup/popup.js", "popup/popup.html", "dashboard/dashboard.js", "dashboard/dashboard.html", "lib/languages.js"];
  for (const f of files) {
    const text = fs.readFileSync(path.join(SRC, f), "latin1");
    for (const m of text.matchAll(/twpUi\.t\(\s*"(\w+)"\s*[,)]/g)) used.add(m[1]);
    for (const m of text.matchAll(/data-ui(?:-title|-placeholder|-aria)?="(\w+)"/g)) used.add(m[1]);
    // keys chosen by a condition, e.g. twpUi.t(mode === "field" ? "panelWriteIn" : "panelReadIn"), or passed as an argument
    for (const m of text.matchAll(/"(\w+)"/g)) if (have.has(m[1])) used.add(m[1]);
  }
  for (const c of ["Time", "Site", "Pieces", "Sent", "FirstVisible", "Pending"]) used.add("dashboardCol" + c);
  const missing = [...used].filter((k) => !have.has(k));
  assert.deepEqual(missing, [], "keys used but not defined: " + missing.join(", "));
  const unused = [...have].filter((k) => !used.has(k));
  assert.deepEqual(unused, [], "texts defined but never used: " + unused.join(", "));
});

test("the language in use: the chosen one, else the browser's, else English", () => {
  assert.equal(loadUi({ uiLanguage: "fr", browser: "en-US" }).ui.language(), "fr");
  assert.equal(loadUi({ uiLanguage: "en", browser: "fr" }).ui.language(), "en", "a choice beats the browser");
  assert.equal(loadUi({ uiLanguage: "default", browser: "fr-CA" }).ui.language(), "fr", "the browser language, region ignored");
  assert.equal(loadUi({ uiLanguage: "default", browser: "ja" }).ui.language(), "en", "unsupported: English");
  assert.equal(loadUi({ uiLanguage: "xx", browser: "fr" }).ui.language(), "fr", "an unknown choice follows the browser");
});

test("texts are translated, with substitutions, and fall back to English then to the key", () => {
  const { ui, sandbox } = loadUi({ uiLanguage: "fr" });
  assert.equal(ui.t("menuTranslatePage", "anglais"), "Traduire cette page en anglais");
  assert.equal(ui.t("setupReady", "m1", 120, "Bonjour"), "Prêt (m1, 120 ms) : Bonjour");
  delete ui._messages.fr.panelCopy;
  assert.equal(ui.t("panelCopy"), "Copy", "missing in French: English");
  assert.equal(ui.t("noSuchKey"), "noSuchKey", "missing everywhere: the key itself");
  assert.equal(JSON.stringify(ui.languages().map((l) => l.code)), '["en","fr"]');
  assert.equal(JSON.stringify(ui.languages().map((l) => l.name)), '["English","Français"]');
  void sandbox;
});
