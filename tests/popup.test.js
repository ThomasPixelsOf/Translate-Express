// Test of the toolbar popup page (src/popup/popup.js) in a simulated page (jsdom).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
for (const where of ["jsdom", path.join(__dirname, "..", "node_modules", "jsdom")]) {
  try { ({ JSDOM } = require(where)); break; } catch (e) { /* try the next place */ }
}
const skipReason = JSDOM ? false : "jsdom not found";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SRC = path.join(__dirname, "..", "src");

function createPopup(sessionData = {}) {
  const html = fs.readFileSync(path.join(SRC, "popup", "popup.html"), "utf8").replace(/<script[^>]*><\/script>/g, "");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://ext.example/popup/popup.html" });
  const w = dom.window;
  const session = { ...sessionData };
  const removed = [];
  w.close = () => { w.closed = true; };
  w.twpConfig = { get: () => "en", onReady: (cb) => cb(), onChanged: (cb) => { w.configChanged = cb; } };
  for (const f of ["lib/ui-text.js", "lib/ui/en.js", "lib/ui/fr.js"]) w.eval(fs.readFileSync(path.join(SRC, f), "utf8") + ";window.twpUi = typeof twpUi !== 'undefined' ? twpUi : window.twpUi;");
  w.chrome = {
    i18n: { getUILanguage: () => "fr" },
    tabs: { query: async () => [{ id: 5, lastAccessed: 10 }, { id: 9, lastAccessed: 99 }] },
    storage: {
      session: {
        get: async () => ({ ...session }),
        set: async (o) => { Object.assign(session, o); },
        remove: async (k) => { removed.push(k); delete session[k]; },
      },
      onChanged: { addListener: (f) => { w.storageChanged = f; } },
    },
  };
  w.eval(fs.readFileSync(path.join(SRC, "popup", "popup.js"), "utf8"));
  const doc = w.document;
  return {
    w, doc, session, removed,
    frame: () => doc.getElementById("frame").getAttribute("src"),
    on: () => doc.querySelector("nav button.on").dataset.view,
    click: (view) => doc.querySelector(`nav button[data-view=${view}]`).click(),
  };
}

test("the popup opens on the message view by default, acting on the most recently used page", { skip: skipReason }, async () => {
  const p = createPopup();
  try {
    await wait(30);
    assert.equal(p.on(), "translate");
    assert.equal(p.frame(), "/composer/composer.html?tab=9");
  } finally { p.w.close(); }
});

test("the menu choice is honored once: settings with the key field focused", { skip: skipReason }, async () => {
  const p = createPopup({ popupRequest: { view: "settings", focus: "key" } });
  try {
    await wait(30);
    assert.equal(p.on(), "settings");
    assert.equal(p.frame(), "/setup/setup.html?focus=key");
    assert.ok(p.removed.includes("popupRequest"), "the request is consumed so it is not replayed");
  } finally { p.w.close(); }
});

test("the tabs switch between the message, settings and dashboard views", { skip: skipReason }, async () => {
  const p = createPopup();
  try {
    await wait(30);
    p.click("dashboard");
    assert.equal(p.on(), "dashboard");
    assert.equal(p.frame(), "/dashboard/dashboard.html?tab=9");
    p.click("settings");
    assert.equal(p.frame(), "/setup/setup.html");
    p.click("translate");
    assert.equal(p.frame(), "/composer/composer.html?tab=9");
    assert.equal(p.session.popupLastView, "translate", "the last view is remembered");
  } finally { p.w.close(); }
});

test("pages inside the popup can switch view or close it; other origins are ignored", { skip: skipReason }, async () => {
  const p = createPopup();
  try {
    await wait(30);
    const post = (origin, data) => p.w.dispatchEvent(new p.w.MessageEvent("message", { origin, data }));
    post("https://evil.example", { twp: "view", view: "dashboard" });
    assert.equal(p.on(), "translate", "a message from another origin is ignored");
    post("https://ext.example", { twp: "view", view: "settings", focus: "key" });
    assert.equal(p.frame(), "/setup/setup.html?focus=key");
    post("https://ext.example", { twp: "close" });
    assert.equal(p.w.closed, true);
  } finally { p.w.close(); }
});

test("a menu request arriving while the popup is already open switches its view", { skip: skipReason }, async () => {
  const p = createPopup();
  try {
    await wait(30);
    p.w.storageChanged({ popupRequest: { newValue: { view: "dashboard" } } }, "session");
    assert.equal(p.on(), "dashboard");
    p.w.storageChanged({ popupRequest: { newValue: { view: "translate" } } }, "local");
    assert.equal(p.on(), "dashboard", "only session storage counts");
  } finally { p.w.close(); }
});
