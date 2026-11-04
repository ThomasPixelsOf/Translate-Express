// Security tests: the API key must not leak to web pages or to the diagnostic log.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const KEY = "gsk_abcdefghijklmnopqrstuvwxyz123456";

// Loads lib/config.js in a sandbox as a script of the given kind: "https:" = injected in a web page, "chrome-extension:" = extension page.
function loadConfig(protocol, stored) {
  const asked = [];
  const written = [];
  const listeners = [];
  const sandbox = {
    console,
    structuredClone,
    location: { protocol },
    twpLang: { fixTLanguageCode: (c) => c },
    chrome: {
      i18n: { getAcceptLanguages: (cb) => cb(["en"]), getUILanguage: () => "en" },
      storage: {
        local: {
          get: (keys, cb) => {
            asked.push(keys);
            const out = {};
            for (const k of keys || Object.keys(stored)) if (k in stored) out[k] = stored[k];
            cb(out);
          },
          set: (o) => written.push(o),
        },
        onChanged: { addListener: (f) => listeners.push(f) },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(read("lib/config.js") + "\n;globalThis.cfg = twpConfig;", sandbox);
  return { cfg: sandbox.cfg, asked, written, listeners };
}

const stored = () => ({ customServices: [{ name: "llm", apiKey: KEY, model: "" }], targetLanguage: "fr" });

test("a script injected in a web page never reads, receives or writes the API key", async () => {
  const { cfg, asked, written, listeners } = loadConfig("https:", stored());
  await cfg.onReady();
  assert.ok(Array.isArray(asked[0]) && !asked[0].includes("customServices"), "the key is not even requested from storage");
  assert.deepEqual(JSON.parse(JSON.stringify(cfg.get("customServices"))), [], "no key in the page's memory");
  assert.equal(cfg.get("targetLanguage"), "fr", "other settings still load");
  const before = written.length;
  cfg.set("customServices", [{ name: "llm", apiKey: "attacker" }]);
  assert.equal(written.length, before, "a page script cannot overwrite the key");
  listeners.forEach((f) => f({ customServices: { newValue: [{ name: "llm", apiKey: KEY }] } }, "local"));
  assert.deepEqual(JSON.parse(JSON.stringify(cfg.get("customServices"))), [], "a change of the key is not pushed into the page either");
});

test("the extension's own pages and the service worker do get the key", async () => {
  const { cfg } = loadConfig("chrome-extension:", stored());
  await cfg.onReady();
  assert.equal(cfg.get("customServices")[0].apiKey, KEY);
});

test("the diagnostic log masks anything that looks like a key", () => {
  const sandbox = {
    console,
    setTimeout,
    chrome: { storage: { session: { get: async () => ({}), set: () => {} } }, runtime: { onMessage: { addListener() {} } }, tabs: {} },
    twpConfig: { get: () => "yes" },
  };
  vm.createContext(sandbox);
  vm.runInContext(read("background/diagnostics.js") + "\n;globalThis.diag = twpDiag;", sandbox);
  sandbox.diag.log("llm.request", { status: 401, error: `Invalid API key ${KEY} (Authorization: Bearer abcdefghij1234567890)`, ms: 12 });
  const e = sandbox.diag.get().at(-1);
  assert.ok(!e.error.includes(KEY), "the key is masked");
  assert.ok(!/Bearer abcdefghij/.test(e.error), "the bearer token is masked");
  assert.match(e.error, /\[key\]/);
  assert.equal(e.ms, 12, "other fields are untouched");
});

test("no script injected in a web page asks for the key", () => {
  for (const f of ["contentScript/pageTranslator.js", "contentScript/panel.js"]) {
    assert.ok(!/customServices|apiKey/.test(fs.readFileSync(path.join(SRC, f), "latin1")), f + " must not touch the key");
  }
});

test("the manifest has a strict policy for the extension's pages", () => {
  const m = JSON.parse(read("manifest.json"));
  const csp = m.content_security_policy && m.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /base-uri 'none'/);
  assert.ok(!/unsafe-eval|unsafe-inline/.test(csp));
});

test("nothing is exposed to web pages, and the logo in the code is the real icon", () => {
  const m = JSON.parse(read("manifest.json"));
  assert.equal(m.web_accessible_resources, undefined, "no web_accessible_resources: a site cannot detect the extension through them");
  const logo = read("lib/logo.js").match(/"data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
  assert.ok(logo, "lib/logo.js holds a PNG data address");
  assert.ok(Buffer.from(logo[1], "base64").equals(fs.readFileSync(path.join(SRC, "icons", "icon-32.png"))), "it is exactly icons/icon-32.png");
});
