// Test of the settings page (src/setup/setup.js), including the interface language setting, in a simulated page (happy-dom).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { available, createWindow, attachFrame } = require("./dom.js");
const skipReason = available ? false : "happy-dom not found";
const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

function createSetup(saved = {}) {
  const html = read("setup/setup.html").replace(/<script[^>]*><\/script>/g, "");
  const w = createWindow(html, { url: "https://ext.example/setup/setup.html?focus=languages" });
  const settings = { uiLanguage: "default", targetLanguage: "fr", writeLanguage: "en", customServices: [], enabledServices: ["google"], pageTranslatorService: "google", ...saved };
  const written = [];
  w.checkedLastError = () => {};
  w.chrome = { i18n: { getUILanguage: () => "en" }, runtime: { sendMessage: () => {} } };
  w.twpConfig = {
    get: (k) => settings[k],
    set: (k, v) => { settings[k] = v; written.push(k); },
    onReady: (cb) => cb(),
    onChanged: () => {},
  };
  const names = { en: "English", fr: "French" };
  w.twpLang = {
    getLanguageList: () => names,
    fixTLanguageCode: (c) => c,
    fillLanguageSelect: (sel) => { for (const c of ["en", "fr"]) { const o = sel.ownerDocument.createElement("option"); o.value = c; o.textContent = names[c]; sel.appendChild(o); } },
  };
  for (const f of ["lib/ui-text.js", "lib/ui/en.js", "lib/ui/fr.js"]) w.eval(read(f) + ";window.twpUi = typeof twpUi !== 'undefined' ? twpUi : window.twpUi;");
  w.eval(read("setup/setup.js"));
  return { w, doc: w.document, settings, written };
}

test("the settings page offers the interface language, defaulting to the browser's", { skip: skipReason }, () => {
  const { doc, settings } = createSetup();
  const options = [...doc.querySelectorAll("#uiLanguage option")].map((o) => [o.value, o.textContent]);
  assert.deepEqual(options, [["default", "Browser language (default)"], ["en", "English"], ["fr", "Français"]]);
  assert.equal(doc.querySelector("#uiLanguage").value, "default");
  assert.equal(doc.querySelector("h1").textContent, "Languages", "texts are filled in the browser's language");
  assert.equal(settings.uiLanguage, "default");
});

test("choosing the interface language saves it and translates the page at once", { skip: skipReason }, () => {
  const { doc, settings, written, w } = createSetup();
  const select = doc.querySelector("#uiLanguage");
  select.value = "fr";
  select.dispatchEvent(new w.Event("change"));
  assert.equal(settings.uiLanguage, "fr");
  assert.ok(written.includes("uiLanguage"));
  assert.equal(doc.querySelector("h1").textContent, "Langues");
  assert.equal(doc.querySelector("#save").textContent, "Enregistrer");
  assert.equal(doc.querySelector("#model option[value='']").textContent, "Automatique (recommandé)");
  assert.equal(doc.querySelector("#status").textContent, "Langue de l'interface enregistrée.");
  assert.equal(doc.querySelector("#uiLanguage option[value=default]").textContent, "Langue du navigateur (par défaut)");
  assert.equal(doc.querySelector("#uiLanguage").value, "fr", "the choice stays selected");
});

test("an interface language already chosen is shown as selected", { skip: skipReason }, () => {
  const { doc } = createSetup({ uiLanguage: "fr" });
  assert.equal(doc.querySelector("#uiLanguage").value, "fr");
  assert.equal(doc.querySelector("#remove").textContent, "Retirer la clé");
});
