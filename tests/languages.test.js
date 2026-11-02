// Tests of the language names and codes (src/lib/languages.js): names come from the browser (Intl.DisplayNames).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(uiLanguage) {
  const sandbox = { Intl, console, twpConfig: { get: () => uiLanguage }, chrome: { i18n: { getUILanguage: () => "en" } } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "lib", "languages.js"), "utf8") + "\n;globalThis.L = twpLang;", sandbox);
  return sandbox.L;
}

test("every language has a real name in English and in French, never its raw code", () => {
  for (const ui of ["en", "fr"]) {
    const L = load(ui);
    const names = L.getLanguageList();
    assert.equal(Object.keys(names).length, L.TargetLanguages.length);
    const raw = Object.entries(names).filter(([code, name]) => !name || name.toLowerCase() === code.toLowerCase() && code.length > 3);
    assert.deepEqual(raw.map(([c]) => c), [], ui + ": codes shown as themselves");
  }
});

test("names are in the interface language, and Chinese reads Simplified / Traditional", () => {
  const en = load("en").getLanguageList();
  const fr = load("fr").getLanguageList();
  assert.equal(en.fr, "French");
  assert.equal(fr.fr, "français");
  assert.equal(en["zh-CN"], "Chinese (Simplified)");
  assert.equal(fr["zh-TW"], "chinois (traditionnel)");
  assert.equal(load("de").getLanguageList().fr, "Französisch", "another interface language works too, from the browser");
});

test("language codes are normalized, and the services know which language they support", () => {
  const L = load("en");
  const fix = (c) => L.fixTLanguageCode(c);
  assert.equal(fix("zh"), "zh-CN");
  assert.equal(fix("zh-Hant"), "zh-TW");
  assert.equal(fix("iw"), "he");
  assert.equal(fix("fr-CA"), "fr-CA");
  assert.equal(fix("de-AT"), "de", "a region we do not list falls back to the language");
  assert.equal(fix("xx"), undefined);
  assert.equal(L.getAlternativeService("fr", "google"), "google");
  assert.equal(L.getAlternativeService("fr", "llm"), "llm");
  assert.equal(L.getAlternativeService("xx", "google"), null);
  assert.equal(L.codeToLanguage("de"), "German");
});
