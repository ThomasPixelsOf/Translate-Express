// Test of the bubble and the panel (src/contentScript/panel.js) in a simulated page (jsdom).
// jsdom is looked up in node_modules; without it, this file is skipped.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
for (const filePath of ["jsdom", path.join(__dirname, "..", "node_modules", "jsdom")]) {
  try { ({ JSDOM } = require(filePath)); break; } catch (e) { /* next */ }
}
const skipReason = JSDOM ? false : "jsdom not found";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = fs.readFileSync(path.join(__dirname, "..", "src", "contentScript", "panel.js"), "utf8");

function createPage({ showBubbleSetting = "yes" } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <p id="p">Bonjour tout le monde, ceci est un text de la page.</p>
    <textarea id="t" style="width:300px">Bonjour a tous, voici mon message en francais pour vous.</textarea>
    <input id="mdp" type="password" value="secret-mot-de-passe">
  </body></html>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://exemple.test/" });
  const w = dom.window;
  const sentMessages = [];
  w.chrome = {
    runtime: {
      onMessage: { addListener() {} }, lastError: undefined, getURL: (p) => "chrome-extension://test" + p,
      sendMessage: (m, cb) => {
        sentMessages.push(m);
        if (cb) setTimeout(() => cb(m.action === "llmLive" ? { ok: true, text: "[translated] " + m.text } : undefined), 0);
      },
    },
    i18n: { getUILanguage: () => "fr" },
  };
  const settings = { showTranslateSelectedButton: showBubbleSetting, targetLanguage: "fr", writeLanguage: "en", uiLanguage: "en" };
  const saved = [];
  w.twpConfig = {
    get: (k) => (k in settings ? settings[k] : null),
    set: (k, v) => { settings[k] = v; saved.push([k, v]); }, onChanged() {},
  };
  w.twpLang = {
    getLanguageList: () => ({ fr: "Français", en: "English" }), TargetLanguages: ["fr", "en"], fixTLanguageCode: (c) => c,
    fillLanguageSelect: (sel) => { for (const c of ["fr", "en"]) { const o = sel.ownerDocument.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); } },
  };
  // jsdom does no layout: rectangles provided by hand.
  const rect = { left: 10, right: 200, top: 100, bottom: 130, width: 190, height: 30 };
  w.Range.prototype.getClientRects = () => [rect];
  w.Range.prototype.getBoundingClientRect = () => rect;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 10, right: 310, top: 200, bottom: 260, width: 300, height: 60 });
  for (const f of ["lib/ui-text.js", "lib/ui/en.js", "lib/ui/fr.js"]) w.eval(fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8") + ";window.twpUi = typeof twpUi !== 'undefined' ? twpUi : window.twpUi;");
  w.eval(CODE);
  const doc = w.document;
  return {
    w, doc, sentMessages, saved,
    bubble: () => doc.querySelector("[data-twp-bubble]"),
    panel: () => { const h = doc.querySelector("[data-twp-panel]"); return h && h.shadowRoot.querySelector(".panel"); },
    panelRoot: () => doc.querySelector("[data-twp-panel]").shadowRoot,
    release: () => doc.dispatchEvent(new w.MouseEvent("mouseup", { bubbles: true, composed: true, clientX: 100, clientY: 230 })),
  };
}

test("selected page text: the bubble opens a read-only panel near the text", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const text = page.doc.getElementById("p").firstChild;
    const r = page.doc.createRange(); r.setStart(text, 0); r.setEnd(text, 7); // "Bonjour"
    page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
    page.release();
    await wait(40);
    assert.ok(page.bubble(), "the bubble appears");
    page.bubble().shadowRoot.querySelector("button").click();
    await wait(40);
    assert.equal(page.panel().style.display, "block");
    assert.equal(page.panelRoot().querySelector(".replace").hidden, true, "no Replace for page text");
    assert.ok(page.sentMessages.some((m) => m.action === "llmLive" && m.text === "Bonjour"));
    assert.equal(page.sentMessages.filter((m) => m.action === "llmLive").at(-1).targetLanguage, "fr", "displayed text: translated into the READING language");
    assert.equal(page.panelRoot().querySelector(".what").textContent, "Read in");
  } finally { page.w.close(); }
});

test("text written in a field then selected: bubble, translation into the chosen language, Replace replaces only the selection", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const t = page.doc.getElementById("t");
    t.focus();
    const start = t.value.indexOf("voici");
    const end = t.value.indexOf(" pour vous");
    t.setSelectionRange(start, end); // "voici mon message en francais"
    const selected = t.value.slice(start, end);
    page.release();
    await wait(40);
    assert.ok(page.bubble(), "the bubble also appears for text selected in a field");

    page.bubble().shadowRoot.querySelector("button").click();
    await wait(40);
    assert.equal(page.panel().style.display, "block");
    assert.equal(page.panelRoot().querySelector(".replace").hidden, false, "Replace is offered for a field");
    assert.ok(page.sentMessages.some((m) => m.action === "llmLive" && m.text === selected), "only the selection is translated");
    assert.equal(page.sentMessages.filter((m) => m.action === "llmLive").at(-1).targetLanguage, "en", "written text: translated into the WRITING language");
    assert.equal(page.panelRoot().querySelector(".what").textContent, "Write in");
    assert.equal(page.panelRoot().querySelector(".out").textContent, "[translated] " + selected);

    // the click in the panel makes the field lose its selection: Replace finds it again anyway
    t.setSelectionRange(0, 0);
    page.panelRoot().querySelector(".replace").click();
    assert.equal(t.value, "Bonjour a tous, [translated] " + selected + " pour vous.", "only the selected part is replaced");
    assert.equal(page.panel().style.display, "none", "the panel closes after the replacement");
  } finally { page.w.close(); }
});

test("changing the language in the panel translates the field selection again", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const t = page.doc.getElementById("t");
    t.focus(); t.setSelectionRange(0, 7); // "Bonjour"
    page.release();
    await wait(40);
    page.bubble().shadowRoot.querySelector("button").click();
    await wait(40);
    const before = page.sentMessages.filter((m) => m.action === "llmLive").length;
    const list = page.panelRoot().querySelector(".lang");
    list.value = "fr";
    list.dispatchEvent(new page.w.Event("change"));
    await wait(40);
    const requests = page.sentMessages.filter((m) => m.action === "llmLive");
    assert.ok(requests.length > before, "new translation requested");
    assert.equal(requests.at(-1).targetLanguage, "fr");
    assert.equal(requests.at(-1).text, "Bonjour");
    assert.deepEqual(page.saved.at(-1), ["writeLanguage", "fr"], "on written text, the writing language is changed");
    assert.ok(!page.saved.some(([k]) => k === "targetLanguage"), "the reading language is not touched");
  } finally { page.w.close(); }
});

test("no bubble: password field, selection too short, bubble turned off; it disappears when the selection disappears", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const mdp = page.doc.getElementById("mdp");
    mdp.focus(); mdp.setSelectionRange(0, 10);
    page.release();
    await wait(40);
    assert.ok(!page.bubble(), "never a bubble on a password");

    const t = page.doc.getElementById("t");
    t.focus(); t.setSelectionRange(0, 1);
    page.release();
    await wait(40);
    assert.ok(!page.bubble(), "a single character: no bubble");

    t.setSelectionRange(0, 7);
    page.release();
    await wait(40);
    assert.ok(page.bubble(), "enough selection: bubble");
    t.setSelectionRange(3, 3); // the selection disappears
    page.doc.dispatchEvent(new page.w.Event("selectionchange"));
    await wait(20);
    assert.ok(!page.bubble(), "the bubble disappears with the selection");
  } finally { page.w.close(); }
});

test("bubble turned off in the menu: nothing appears", { skip: skipReason }, async () => {
  const page = createPage({ showBubbleSetting: "no" });
  try {
    const t = page.doc.getElementById("t");
    t.focus(); t.setSelectionRange(0, 7);
    page.release();
    await wait(40);
    assert.ok(!page.bubble());
  } finally { page.w.close(); }
});

test("changing the language on displayed text changes the reading language, not the writing one", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const text = page.doc.getElementById("p").firstChild;
    const r = page.doc.createRange(); r.setStart(text, 0); r.setEnd(text, 7);
    page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
    page.release();
    await wait(40);
    page.bubble().shadowRoot.querySelector("button").click();
    await wait(40);
    const list = page.panelRoot().querySelector(".lang");
    list.value = "en";
    list.dispatchEvent(new page.w.Event("change"));
    await wait(40);
    assert.deepEqual(page.saved.filter(([k]) => k === "targetLanguage").at(-1), ["targetLanguage", "en"]);
    assert.ok(!page.saved.some(([k]) => k === "writeLanguage"));
  } finally { page.w.close(); }
});

test("memory: reopening the bubble on the same text does not call the AI again; the refresh button translates again", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const text = page.doc.getElementById("p").firstChild;
    const openIt = async () => {
      const r = page.doc.createRange(); r.setStart(text, 0); r.setEnd(text, 7);
      page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
      page.release();
      await wait(40);
      page.bubble().shadowRoot.querySelector("button").click();
      await wait(40);
    };
    const calls = () => page.sentMessages.filter((m) => m.action === "llmLive").length;
    await openIt();
    assert.equal(calls(), 1);
    page.panelRoot().querySelector(".close").click();
    await openIt();
    assert.equal(calls(), 1, "same text, same language: translation kept in memory");
    assert.match(page.panelRoot().querySelector(".out").textContent, /translated/);
    assert.match(page.panelRoot().querySelector(".status").textContent, /kept/);
    page.panelRoot().querySelector(".refresh").click();
    await wait(40);
    assert.equal(calls(), 2, "the button forces a new translation");
  } finally { page.w.close(); }
});

test("the bubble shows the extension's logo, and falls back to a letter without it", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const node = page.doc.getElementById("p").firstChild;
    const r = page.doc.createRange(); r.setStart(node, 0); r.setEnd(node, 7);
    page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
    page.release();
    await wait(40);
    const img = page.bubble().shadowRoot.querySelector("img");
    assert.ok(img, "the bubble contains the logo");
    assert.match(img.src, /\/icons\/icon-32\.png$/);
    img.dispatchEvent(new page.w.Event("error"));
    assert.equal(page.bubble().shadowRoot.querySelector("img"), null, "icon failed: the image is removed");
    assert.equal(page.bubble().shadowRoot.querySelector("button").textContent, "A", "and the letter takes over");
  } finally { page.w.close(); }
});

test("a selection made without the mouse (Ctrl+A, touch, script) also shows the logo once it settles", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const node = page.doc.getElementById("p").firstChild;
    const r = page.doc.createRange(); r.setStart(node, 0); r.setEnd(node, 7);
    page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
    page.doc.dispatchEvent(new page.w.Event("selectionchange"));
    assert.ok(!page.bubble(), "not at once: the selection may still be changing");
    await wait(450);
    assert.ok(page.bubble(), "the logo appears after the selection has settled");
    page.w.getSelection().removeAllRanges();
    page.doc.dispatchEvent(new page.w.Event("selectionchange"));
    assert.ok(!page.bubble(), "and goes away with the selection");
  } finally { page.w.close(); }
});

test("a page that erases the document's listeners (rich editors rewrite their frame) does not stop the logo", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    // what TinyMCE does to its editing frame: document.open() + write() + close()
    page.doc.open();
    page.doc.write('<html><body><p id="p">Hello again, this is the rewritten page.</p></body></html>');
    page.doc.close();
    await wait(1200); // the listeners are attached again within a second
    const node = page.doc.getElementById("p").firstChild;
    const r = page.doc.createRange(); r.setStart(node, 0); r.setEnd(node, 11);
    page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
    page.release();
    await wait(60);
    assert.ok(page.bubble(), "the logo still appears after the page rewrote its document");
  } finally { page.w.close(); }
});

test("a text field inside a shadow root (web components) gets the logo too", { skip: skipReason }, async () => {
  const page = createPage();
  try {
    const host = page.doc.createElement("div");
    page.doc.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const area = page.doc.createElement("textarea");
    area.value = "Bonjour a tous, voici un message";
    root.appendChild(area);
    area.focus();
    area.setSelectionRange(0, 7);
    assert.equal(page.doc.activeElement, host, "the page-level focus only points at the host");
    page.release();
    await wait(60);
    assert.ok(page.bubble(), "the field inside the shadow root is found through the host");
  } finally { page.w.close(); }
});
