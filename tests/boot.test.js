// Boot test of the service worker (src/bg.js) with fake `chrome` objects: checks that all the files
// load in order, without error, and that the right-click menu is created with the right entries.
// This is not a test in a real browser: it catches missing files and loading errors.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");

function fakeChrome() {
  const menus = [];
  const handlers = { onMessage: [], onClicked: [], onInstalled: [], onStartup: [] };
  const storage = { uiLanguage: "en" }; // the fake browser is French: the menu tests read English texts, chosen explicitly
  const session = {};
  const state = { popups: [], popupFails: false, dockAnswer: true, tabMessages: [], windowsCreated: [], pageStates: {}, activeTab: 1, alarms: [], reloaded: 0, listeners: { onActivated: [], onUpdated: [], onFocusChanged: [], onAlarm: [] } };
  const chrome = {
    runtime: {
      reload: () => { state.reloaded = (state.reloaded || 0) + 1; },
      onMessage: { addListener: (f) => handlers.onMessage.push(f) },
      onInstalled: { addListener: (f) => handlers.onInstalled.push(f) },
      onStartup: { addListener: (f) => handlers.onStartup.push(f) },
      getURL: (p) => "chrome-extension://test" + p,
      sendMessage: () => {},
      lastError: undefined,
    },
    storage: {
      local: {
        get: (cles, cb) => (cb ? cb({ ...storage }) : Promise.resolve({ ...storage })),
        set: (o, cb) => { Object.assign(storage, o); cb && cb(); return Promise.resolve(); },
        remove: (k, cb) => { delete storage[k]; cb && cb(); },
      },
      session: {
        get: (k) => Promise.resolve({ ...session }),
        set: (o) => { Object.assign(session, o); return Promise.resolve(); },
        remove: (k) => { delete session[k]; return Promise.resolve(); },
      },
      onChanged: { addListener: () => {} },
    },
    action: {
      openPopup: () => {
        if (state.popupFails) return Promise.reject(new Error("openPopup is not available"));
        state.popups.push({ ...session.popupRequest });
        return Promise.resolve();
      },
    },
    i18n: { getUILanguage: () => "fr", getMessage: (n) => n, getAcceptLanguages: (cb) => cb(["fr", "fr-FR", "en"]) },
    contextMenus: {
      removeAll: (cb) => { menus.length = 0; cb && cb(); },
      create: (m, cb) => { menus.push(m); cb && cb(); },
      update: (id, p, cb) => { const m = menus.find((x) => x.id === id); if (m) Object.assign(m, p); cb && cb(); },
      onClicked: { addListener: (f) => handlers.onClicked.push(f) },
    },
    alarms: { create: (n, o) => state.alarms.push({ n, o }), onAlarm: { addListener: (f) => state.listeners.onAlarm.push(f) } },
    tabs: {
      sendMessage: (id, msg, opts, cb) => {
        state.tabMessages.push({ id, msg });
        const f = typeof opts === "function" ? opts : cb;
        // Each tab answers with ITS translation state.
        if (msg.action === "getCurrentPageLanguageState") return f && f(state.pageStates[id] || "original");
        if (f) f(state.dockAnswer);
      },
      detectLanguage: (id, cb) => cb("en"),
      query: (q, cb) => cb([{ id: state.activeTab, active: true }]),
      onActivated: { addListener: (f) => state.listeners.onActivated.push(f) },
      onUpdated: { addListener: (f) => state.listeners.onUpdated.push(f) },
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: { addListener: (f) => state.listeners.onFocusChanged.push(f) }, create: (o) => { state.windowsCreated.push(o); return Promise.resolve(); }, getAll: () => Promise.resolve([]), update: () => Promise.resolve() },
  };
  return { chrome, menus, handlers, storage, state };
}

function boot() {
  const faux = fakeChrome();
  const sandbox = {
    chrome: faux.chrome,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextDecoder, TextEncoder, URL, URLSearchParams, AbortController, Intl,
    fetch: async () => { throw new Error("no network in this test"); },
    indexedDB: { open: () => ({}), deleteDatabase: () => ({}) },
    navigator: { userAgent: "Chrome/156", language: "fr" },
    structuredClone, EventTarget, Event, CustomEvent, Blob, atob, btoa, crypto: globalThis.crypto,
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  sandbox.importScripts = (...files) => {
    for (const f of files) {
      const filePath = path.join(SRC, f);
      assert.ok(fs.existsSync(filePath), "missing file: " + f);
      vm.runInContext(fs.readFileSync(filePath, "utf8"), sandbox, { filename: f });
    }
  };
  return { sandbox, ...faux };
}

// Loads the files in the exact order of bg.js.
function loadBackground(sandbox) {
  const rows = fs.readFileSync(path.join(SRC, "bg.js"), "utf8").split(/\r?\n/).filter((l) => l.startsWith("importScripts"));
  sandbox.importScripts(...rows.map((l) => l.match(/"(.+)"/)[1]));
}

test("the manifest is valid and only references files that exist", () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.name, "Translate Express");
  assert.match(m.version, /^1[.][0-9]+[.][0-9]+$/, "the extension's own numbering, distinct from TWP's");
  assert.equal(m.background.service_worker, "bg.js");
  // All the page scripts are ONE group: two groups are injected at different moments and a frame (the editing area of a
  // rich-text editor...) could get the second without the first ("twpConfig is not defined").
  assert.equal(m.content_scripts.length, 1);
  const js = m.content_scripts[0].js;
  assert.ok(js.indexOf("/lib/config.js") < js.indexOf("/contentScript/pageTranslator.js"), "the libraries come before the scripts that use them");
  assert.ok(js.indexOf("/lib/ui-text.js") < js.indexOf("/contentScript/panel.js"));
  const files = [
    m.background.service_worker,
    ...Object.values(m.icons),
    ...m.content_scripts.flatMap((c) => c.js),
    ...(m.options_ui ? [m.options_ui.page] : []), // a missing options page prevents the whole extension from loading
    ...(m.action && m.action.default_popup ? [m.action.default_popup] : []),
  ];
  for (const f of files) assert.ok(fs.existsSync(path.join(SRC, f)), "referenced but missing: " + f);
  assert.deepEqual(m.permissions.sort(), ["alarms", "contextMenus", "storage"]);
  assert.equal(m.action.default_popup, "popup/popup.html", "the toolbar icon opens the popup (message window, settings, dashboard)");
  assert.equal(m.options_ui, undefined, "no separate options page: the settings are a view of the popup");
  assert.equal(m.commands, undefined);
});

test("the service worker loads without error and creates the right-click menu", async () => {
  const { sandbox, menus, handlers } = boot();
  assert.doesNotThrow(() => loadBackground(sandbox));
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const ids = menus.map((m) => m.id);
  for (const id of ["twp-selection", "twp-field", "twp-page", "twp-composer", "twp-bubble", "twp-lang", "twp-write", "twp-key"]) assert.ok(ids.includes(id), "missing entry: " + id);
  assert.ok(ids.includes("twp-lang-en") && ids.includes("twp-lang-fr"), "langues courantes absentes");
  assert.equal(menus.filter((m) => m.type === "radio" && m.checked).length, 2, "one language checked for reading, one for writing");
  assert.match(menus.find((m) => m.id === "twp-page").title, /^Translate this page to /);
  assert.ok(handlers.onClicked.length >= 1);
});

test("the menu switches to \"Show original page\" when the page is translated", async () => {
  const { sandbox, menus, handlers } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 1, active: true }, frameId: 0 }, () => {}));
  assert.equal(menus.find((m) => m.id === "twp-page").title, "Show original page");
});

test("choosing a language in the menu changes the target language everywhere and updates the menu", async () => {
  const { sandbox, menus, handlers } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  assert.match(menus.find((m) => m.id === "twp-lang").title, /Read in: /);
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-lang-de", frameId: 0 }, { id: 1 }));
  assert.equal(vm.runInContext('twpConfig.get("targetLanguage")', sandbox), "de");
  assert.equal(menus.find((m) => m.id === "twp-lang-de").checked, true);
  assert.match(menus.find((m) => m.id === "twp-page").title, /^Translate this page to /);
});

test("\"Message window\", \"Groq key...\", \"More languages...\" and \"Dashboard\" all open the toolbar popup", async () => {
  const { sandbox, handlers, state, storage } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const click = async (id) => {
    handlers.onClicked.forEach((f) => f({ menuItemId: id, frameId: 0 }, { id: 7 }));
    await new Promise((r) => setTimeout(r, 10));
    return state.popups.at(-1);
  };
  assert.deepEqual(await click("twp-composer"), { view: "translate", focus: undefined });
  assert.deepEqual(await click("twp-key"), { view: "settings", focus: "key" });
  assert.deepEqual(await click("twp-languages-read"), { view: "settings", focus: "languages" });
  assert.deepEqual(await click("twp-languages-write"), { view: "settings", focus: "languages" });
  assert.deepEqual(await click("twp-dashboard"), { view: "dashboard", focus: undefined });
  assert.equal(state.popups.length, 5);
  assert.equal(state.windowsCreated.length, 0, "no separate window when the popup can open");
  assert.ok(!state.tabMessages.some((m) => /dock/i.test(JSON.stringify(m.msg))), "nothing is injected in the page");

  // "Window" button of the floating panel: the text written in the field goes to the message view
  handlers.onMessage.forEach((f) => f({ action: "twpOpenComposer", text: "Bonjour" }, { tab: { id: 7 } }, () => {}));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(storage.composerDraft, "Bonjour");
  assert.equal(state.popups.at(-1).view, "translate");
});

test("when the toolbar popup cannot be opened, the same page opens in a small window", async () => {
  const { sandbox, handlers, state } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  state.popupFails = true;
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-composer", frameId: 0 }, { id: 7 }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(state.windowsCreated.length, 1);
  assert.match(state.windowsCreated[0].url, /popup[/]popup[.]html$/);
  assert.equal(state.windowsCreated[0].type, "popup");
});

test("\"More languages...\" is separate from \"Groq key...\", which is a top-level entry", async () => {
  const { sandbox, menus, handlers } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const byId = (id) => menus.find((m) => m.id === id);
  assert.equal(byId("twp-key").title, "Groq key...");
  assert.equal(byId("twp-key").parentId, undefined, "top-level entry");
  assert.equal(byId("twp-languages-read").parentId, "twp-lang");
  assert.equal(byId("twp-languages-write").parentId, "twp-write");
  assert.equal(byId("twp-languages-write").title, "More languages...");
});

test("the selection bubble is on by default and can be turned off from the menu", async () => {
  const { sandbox, menus, handlers } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const bubble = () => menus.find((m) => m.id === "twp-bubble");
  assert.equal(bubble().type, "checkbox");
  assert.equal(bubble().checked, true);
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-bubble", checked: false, frameId: 0 }, { id: 1 }));
  assert.equal(vm.runInContext('twpConfig.get("showTranslateSelectedButton")', sandbox), "no");
});

test("the language list: common ones first, then all from A to Z, without duplicates", async () => {
  const { sandbox } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  // Minimal fake <select> element: enough to build the list.
  const output = vm.runInContext(`(function () {
    const creer = (tag) => ({ tag, children: [], textContent: "", appendChild(c) { this.children.push(c); } });
    const doc = { createElement: creer };
    const select = Object.assign(creer("select"), { ownerDocument: doc });
    twpLang.fillLanguageSelect(select, { auto: true });
    const groups = select.children.filter((c) => c.tag === "optgroup");
    return JSON.stringify({
      first: select.children[0].value,
      frequentes: groups[0].children.map((o) => o.value),
      all: groups[1].children.map((o) => o.textContent),
    });
  })()`, sandbox);
  const r = JSON.parse(output);
  assert.equal(r.first, "auto");
  assert.deepEqual(r.frequentes.slice(0, 4), ["en", "fr", "de", "es"]);
  const sorted = [...r.all].sort((a, b) => a.localeCompare(b, "fr"));
  assert.deepEqual(r.all, sorted, "all the languages are sorted from A to Z");
  assert.equal(new Set(r.all).size, r.all.length, "each language name is listed once");
  assert.ok(r.all.length > 50);
  assert.ok(!r.all.some((n) => /emoji/i.test(n)), "\"Emoji\" is not a language");
});

// Sends a message to the background as a page script would, and returns the answer (or "NO ANSWER").
function send(handlers, request) {
  return new Promise((resolve) => {
    let done = false;
    const end = (r) => { if (!done) { done = true; resolve(r === undefined ? "EMPTY ANSWER" : r); } };
    for (const f of handlers.onMessage) f(request, { tab: { id: 1, url: "https://x.test/" } }, end);
    setTimeout(() => end("NO ANSWER"), 2000);
  });
}
const llmKey = { name: "llm", provider: "auto", apiKey: "gsk_1234567890abcdef", model: "" };

test("the menu chooses the service: AI with a saved key, Google without a key", async () => {
  const { sandbox, handlers, state } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const clickIt = () => handlers.onClicked.forEach((f) => f({ menuItemId: "twp-page", frameId: 0 }, { id: 3 }));
  clickIt();
  assert.equal(state.tabMessages.at(-1).msg.action, "translatePage");
  assert.equal(state.tabMessages.at(-1).msg.service, "google");
  vm.runInContext("twpConfig.set('customServices', [" + JSON.stringify(llmKey) + "])", sandbox);
  clickIt();
  assert.equal(state.tabMessages.at(-1).msg.service, "llm");
});

test("if the AI fails, the page is translated by Google instead of staying empty (fallback)", async () => {
  const { sandbox, handlers } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  const urls = [];
  sandbox.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "qwen/qwen3.8-27b" }] }) };
    if (String(url).includes("chat/completions")) return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({ error: { message: "Invalid API Key" } }) };
    throw new Error("network down");
  };
  vm.runInContext("twpConfig.set('customServices', [" + JSON.stringify(llmKey) + "])", sandbox);
  await send(handlers, { action: "createLlmService", llm: llmKey });
  await send(handlers, { action: "translateHTML", translationService: "llm", sourceLanguage: "en", targetLanguage: "fr", sourceArray2d: [["Hello"]], dontSortResults: false });
  assert.ok(urls.some((u) => u.includes("chat/completions")), "the AI was tried first");
  assert.ok(urls.some((u) => /translate(-pa)?.googleapis.com/.test(u)), "then Google was tried: " + urls.join(" | "));
});

// Starts the service worker with a given interface language and preferred languages.
async function bootWithLanguages(ui, acceptees, before) {
  const r = boot();
  r.sandbox.chrome.i18n.getUILanguage = () => ui;
  r.sandbox.chrome.i18n.getAcceptLanguages = (cb) => cb(acceptees);
  if (before) before(r);
  loadBackground(r.sandbox);
  await new Promise((res) => setTimeout(res, 80));
  return r;
}
const targetLangOf = (sandbox) => vm.runInContext('twpConfig.get("targetLanguage")', sandbox);

test("a language chosen by the user is never replaced by detection again", async () => {
  const { sandbox } = await bootWithLanguages("fr", ["fr"], ({ storage }) => {
    storage.targetLanguage = "ja"; // outside the first three browser languages
    storage.targetLanguageChosen = "yes";
    storage.targetLanguageFixed = "yes";
  });
  assert.equal(targetLangOf(sandbox), "ja");
});

test("choosing a language in the menu saves it as the user's choice", async () => {
  const { sandbox, handlers } = await bootWithLanguages("fr", ["fr"]);
  handlers.onInstalled.forEach((f) => f());
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-lang-ja", frameId: 0 }, { id: 1 }));
  assert.equal(vm.runInContext('twpConfig.get("targetLanguageChosen")', sandbox), "yes");
  assert.equal(targetLangOf(sandbox), "ja");
});

test("multi-tab: the menu follows the displayed tab, not the previous tab", async () => {
  const { sandbox, menus, handlers, state } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const title = () => menus.find((m) => m.id === "twp-page").title;
  state.pageStates = { 1: "translated", 2: "original" };

  state.listeners.onActivated.forEach((f) => f({ tabId: 1 })); // tab 1: translated
  assert.equal(title(), "Show original page");
  state.listeners.onActivated.forEach((f) => f({ tabId: 2 })); // tab 2: never translated
  assert.match(title(), /^Translate this page to /, "tab 2 must not inherit the state of tab 1");
  state.listeners.onActivated.forEach((f) => f({ tabId: 1 }));
  assert.equal(title(), "Show original page");
});

test("multi-tab: the click acts according to the state of the clicked tab", async () => {
  const { sandbox, handlers, state } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  state.pageStates = { 1: "translated", 2: "original" };
  const clickIt = (id) => handlers.onClicked.forEach((f) => f({ menuItemId: "twp-page", frameId: 0 }, { id }));
  clickIt(2);
  assert.equal(state.tabMessages.at(-1).msg.action, "translatePage", "tab 2 not translated: translate");
  clickIt(1);
  assert.equal(state.tabMessages.at(-1).msg.action, "restorePage", "tab 1 translated: go back to the original");
});

test("multi-tab: a message from a background tab does not change the title, a reloaded page becomes \"to translate\" again", async () => {
  const { sandbox, menus, handlers, state } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const title = () => menus.find((m) => m.id === "twp-page").title;
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 9, active: false }, frameId: 0 }, () => {}));
  assert.match(title(), /^Translate this page to /, "tab not displayed: title unchanged");
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 1, active: true }, frameId: 3 }, () => {}));
  assert.match(title(), /^Translate this page to /, "subframe: ignored");
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 1, active: true }, frameId: 0 }, () => {}));
  assert.equal(title(), "Show original page");
  state.listeners.onUpdated.forEach((f) => f(1, { status: "loading" }, { id: 1, active: true })); // the page reloads
  assert.match(title(), /^Translate this page to /);
});

test("default language: French, whatever the browser language", async () => {
  assert.equal(targetLangOf((await bootWithLanguages("en", ["en", "fr"])).sandbox), "fr");
  assert.equal(targetLangOf((await bootWithLanguages("en-US", ["en-US", "en"])).sandbox), "fr");
  assert.equal(targetLangOf((await bootWithLanguages("de", ["de", "en"])).sandbox), "fr");
});

test("a saved old default language (English) is replaced by French as long as the user has chosen nothing", async () => {
  const { sandbox } = await bootWithLanguages("en", ["en"], ({ storage }) => { storage.targetLanguage = "en"; });
  assert.equal(targetLangOf(sandbox), "fr");
});

// Extension files as the browser would serve them (read from the src folder).
function serveFiles(sandbox, changes = {}) {
  sandbox.fetch = async (url) => {
    const filePath = String(url).replace("chrome-extension://test", "");
    const answerText = filePath in changes ? changes[filePath] : fs.readFileSync(path.join(SRC, filePath), "utf8");
    return { ok: true, text: async () => answerText };
  };
}

test("automatic reload: the extension reloads when one of its files changes, and only then", async () => {
  const { sandbox, state } = boot();
  const changes = {};
  serveFiles(sandbox, changes);
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 300)); // initial fingerprint remembered
  assert.equal(state.reloaded, 0, "no reload at the first start");
  assert.deepEqual(state.alarms.map((a) => a.n), ["twp-dev-reload"]);

  const ring = async () => { state.listeners.onAlarm.forEach((f) => f({ name: "twp-dev-reload" })); await new Promise((r) => setTimeout(r, 300)); };
  await ring();
  assert.equal(state.reloaded, 0, "nothing changed: no reload");

  changes["/background/menu.js"] = fs.readFileSync(path.join(SRC, "background/menu.js"), "utf8") + " // modification";
  await ring();
  assert.equal(state.reloaded, 1, "a file changed: reload");
  await ring();
  assert.equal(state.reloaded, 1, "the fingerprint is remembered: a single reload per change");
});

test("automatic reload: the list of watched files covers all the extension's files", () => {
  const { sandbox } = boot();
  loadBackground(sandbox);
  const watched = new Set(JSON.parse(vm.runInContext("JSON.stringify(DEV_FILES)", sandbox)));
  const present = [];
  (function lister(dir) {
    for (const e of fs.readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
      const rel = dir + "/" + e.name;
      if (e.isDirectory()) { if (e.name !== "_locales" && e.name !== "icons") lister(rel); }
      else if (/.(js|html|css|json)$/.test(e.name)) present.push(rel);
    }
  })("");
  const missing = present.filter((f) => !watched.has(f));
  assert.deepEqual(missing, [], "files not watched (add them to DEV_FILES): " + missing.join(", "));
});

test("extension reload: the chosen language is kept, and without a choice the language stays French (never English)", async () => {
  // 1) first session: the user chooses Japanese in the menu
  const session1 = await bootWithLanguages("en", ["en", "fr"]);
  session1.handlers.onInstalled.forEach((f) => f());
  assert.equal(targetLangOf(session1.sandbox), "fr", "by default: French, even with a browser in English");
  session1.handlers.onClicked.forEach((f) => f({ menuItemId: "twp-lang-ja", frameId: 0 }, { id: 1 }));
  const storageAfterChoice = { ...session1.storage };

  // 2) reload: a new service worker, the same storage
  const session2 = await bootWithLanguages("en", ["en", "fr"], ({ storage }) => Object.assign(storage, storageAfterChoice));
  assert.equal(targetLangOf(session2.sandbox), "ja", "le choice survit au rechargement");

  // 3) another user who chose nothing, with an old saved "en" default: back to French
  const session3 = await bootWithLanguages("en", ["en"], ({ storage }) => { storage.targetLanguage = "en"; });
  assert.equal(targetLangOf(session3.sandbox), "fr");
});

test("one-time repair: the state damaged by the old default (English \"chosen\") is put back to French, only once", async () => {
  const damagedState = ({ storage }) => { storage.targetLanguage = "en"; storage.targetLanguageChosen = "yes"; };
  const s1 = await bootWithLanguages("en", ["en", "fr"], damagedState);
  assert.equal(targetLangOf(s1.sandbox), "fr", "put back to French");
  // the user then chooses German: this choice is kept at the following starts
  s1.handlers.onInstalled.forEach((f) => f());
  s1.handlers.onClicked.forEach((f) => f({ menuItemId: "twp-lang-de", frameId: 0 }, { id: 1 }));
  const s2 = await bootWithLanguages("en", ["en", "fr"], ({ storage }) => Object.assign(storage, s1.storage));
  assert.equal(targetLangOf(s2.sandbox), "de", "the repair is not replayed");
});

test("no page script writes the target language on its own (original default that put it back to English on every page)", () => {
  const folder = path.join(SRC, "contentScript");
  for (const f of fs.readdirSync(folder).filter((n) => n.endsWith(".js") && n !== "panel.js")) {
    const code = fs.readFileSync(path.join(folder, f), "utf8");
    assert.ok(!/twpConfig[.]set[(]\s*["']targetLanguage["']/.test(code), f + " writes the target language");
  }
});

test("two languages: reading and writing are independent (menu \"Read in\" and \"Write in\")", async () => {
  const { sandbox, menus, handlers } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  assert.match(menus.find((m) => m.id === "twp-lang").title, /^Read in: /);
  assert.match(menus.find((m) => m.id === "twp-write").title, /^Write in: /);
  const read = (k) => vm.runInContext('twpConfig.get("' + k + '")', sandbox);
  assert.equal(read("targetLanguage"), "fr", "read in French by default");
  assert.equal(read("writeLanguage"), "en", "write in English by default");

  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-write-de", frameId: 0 }, { id: 1 }));
  assert.equal(read("writeLanguage"), "de");
  assert.equal(read("targetLanguage"), "fr", "choosing the writing language does not change the reading language");
  assert.equal(menus.find((m) => m.id === "twp-write-de").checked, true);

  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-lang-es", frameId: 0 }, { id: 1 }));
  assert.equal(read("targetLanguage"), "es");
  assert.equal(read("writeLanguage"), "de", "choosing the reading language does not change the writing language");
});

// ---- Resilience: a failed request must neither make the whole batch fail, nor stay remembered ----
async function bootWithAi(fetchIa) {
  const { sandbox, handlers } = boot();
  loadBackground(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  vm.runInContext("twpConfig.set('customServices', [" + JSON.stringify(llmKey) + "]); twpConfig.set('pageTranslatorService', 'llm');", sandbox);
  sandbox.fetch = async (url, init) => {
    if (String(url).endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "llama-3.3-70b-versatile" }] }) };
    if (String(url).includes("chat/completions")) return fetchIa(JSON.parse(init.body));
    throw new Error("network down: " + url); // Google is unreachable in these tests
  };
  await send(handlers, { action: "createLlmService", llm: llmKey });
  return { sandbox, handlers };
}
const aiAnswer = (translations) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translations: translations }) } }] }) });
const limit = () => ({ ok: false, status: 429, headers: { get: (n) => (n === "retry-after" ? "45" : null) }, json: async () => ({}) });
const translateBlocks = (handlers, blocs) => send(handlers, { action: "translateHTML", translationService: "llm", sourceLanguage: "en", targetLanguage: "fr", sourceArray2d: blocs, dontSortResults: false });

test("resilience: an AI failure is not remembered, retrying the same text succeeds", async () => {
  let calls = 0;
  // First try: key refused (immediate failure, no waiting delay); second try: the AI answers.
  const keyRefused = () => ({ ok: false, status: 401, headers: { get: () => null }, json: async () => ({ error: { message: "Invalid API Key" } }) });
  const { handlers } = await bootWithAi(() => (++calls === 1 ? keyRefused() : aiAnswer(["<pre>Bonjour le monde</pre>"])));
  const first = await translateBlocks(handlers, [["Hello world"]]);
  assert.ok(first === "EMPTY ANSWER" || (Array.isArray(first) && first[0].length === 0), "first try: failure (AI limited, Google off)");
  const second = await translateBlocks(handlers, [["Hello world"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), [["Bonjour le monde"]], "second try: translated (the failure did not stay in memory)");
});

test("resilience: a failed request does not lose the other blocks of the page", async () => {
  // two large blocks: two distinct requests; the second is refused (rate limit)
  const tall = (mot) => [mot + " " + "x".repeat(1200)];
  let calls = 0;
  const { handlers } = await bootWithAi((body) => {
    calls++;
    const texts = JSON.parse(body.messages[1].content);
    return /^<pre>A /.test(texts[0]) ? aiAnswer(texts.map((s) => s.replace("A ", "TRANSLATED-A "))) : limit();
  });
  const answer = await translateBlocks(handlers, [tall("A"), tall("B")]);
  assert.ok(Array.isArray(answer), "the answer is not lost: " + answer);
  const r = JSON.parse(JSON.stringify(answer));
  assert.match(r[0][0], /^TRANSLATED-A /, "the block whose request succeeded is translated");
  assert.deepEqual(r[1], [], "the failed block is returned empty (the page will retry it), without making the rest fail");
});
