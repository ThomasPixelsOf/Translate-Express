// The translation panel is shown by the top page, not inside the small frame where the text was selected
// (a frame, like the editing area of a rich-text editor, would clip it). Simulated with jsdom: a page with an iframe.
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
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

function createPageWithFrame() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><p id="top">Top page.</p><iframe id="editor"></iframe></body></html>', {
    runScripts: "outside-only", pretendToBeVisual: true, url: "https://exemple.test/",
  });
  const top = dom.window;
  const frameEl = top.document.getElementById("editor");
  const child = frameEl.contentWindow;
  child.document.body.innerHTML = '<textarea id="t" style="width:300px">Bonjour a tous, voici un message</textarea>';

  const listeners = new Map(); // window -> chrome.runtime.onMessage listeners
  const sent = [];
  const fakeBackground = (from, message, callback) => {
    sent.push({ from: from === top ? "top" : "frame", message });
    // like a real browser, only the first call of sendResponse counts
    let answered = false;
    const respond = (value) => {
      if (answered) return;
      answered = true;
      callback && callback(value);
    };
    const answer = (win, request) => {
      for (const f of listeners.get(win) || []) {
        if (f(request, {}, respond) === true) return;
      }
      setTimeout(() => respond(undefined), 0);
    };
    if (message.action === "llmLive") return callback && setTimeout(() => callback({ ok: true, text: "[translated] " + message.text }), 0);
    if (message.action === "twpFramePanel") {
      const { action, ...payload } = message;
      return answer(top, { ...payload, action: "twpPanelFromFrame", frameId: 7 });
    }
    if (message.action === "twpReplaceInFrame") return answer(child, { action: "twpReplaceFromPanel", text: message.text, scope: message.scope });
    if (callback) setTimeout(() => callback(undefined), 0);
  };

  for (const w of [top, child]) {
    listeners.set(w, []);
    w.checkedLastError = () => {};
    w.chrome = {
      runtime: {
        id: "test-extension-id", lastError: undefined, getURL: (p) => "chrome-extension://test" + p,
        onMessage: { addListener: (f) => listeners.get(w).push(f) },
        sendMessage: (m, cb) => fakeBackground(w, m, cb),
      },
      i18n: { getUILanguage: () => "en" },
    };
    const settings = { showTranslateSelectedButton: "yes", targetLanguage: "fr", writeLanguage: "en", uiLanguage: "en" };
    w.twpConfig = { get: (k) => settings[k], set: (k, v) => { settings[k] = v; }, onChanged() {} };
    w.twpLang = {
      getLanguageList: () => ({ fr: "Français", en: "English" }), TargetLanguages: ["fr", "en"], fixTLanguageCode: (c) => c,
      fillLanguageSelect: (sel) => { for (const c of ["fr", "en"]) { const o = sel.ownerDocument.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); } },
    };
    // jsdom does no layout: rectangles provided by hand (the frame sits at x=50, y=300 in the top page)
    const rect = { left: 10, right: 200, top: 100, bottom: 130, width: 190, height: 30 };
    w.Range.prototype.getClientRects = () => [rect];
    w.Range.prototype.getBoundingClientRect = () => rect;
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 10, right: 310, top: 200, bottom: 260, width: 300, height: 60 });
    for (const f of ["lib/ui-text.js", "lib/ui/en.js", "lib/ui/fr.js"]) w.eval(read(f) + ";window.twpUi = typeof twpUi !== 'undefined' ? twpUi : window.twpUi;");
  }
  // jsdom does not set `event.source` for postMessage, as a real browser does: do it here
  const deliver = (target, source) => (data) => setTimeout(() => target.dispatchEvent(new target.MessageEvent("message", { data, source, origin: "https://exemple.test" })), 0);
  top.postMessage = deliver(top, child); // called by the frame as window.parent.postMessage
  child.postMessage = deliver(child, top); // called by the top page as event.source.postMessage
  frameEl.getBoundingClientRect = () => ({ left: 50, right: 450, top: 300, bottom: 600, width: 400, height: 300 });
  top.eval(read("contentScript/panel.js"));
  child.eval(read("contentScript/panel.js"));
  return { top, child, frameEl, sent };
}

const hostOf = (w) => w.document.querySelector("[data-twp-panel]");
const panelOf = (w) => hostOf(w) && hostOf(w).shadowRoot.querySelector(".panel");

test("text selected in a frame is translated by a panel shown in the top page, at the right place", { skip: skipReason }, async () => {
  const { top, child } = createPageWithFrame();
  try {
    const t = child.document.getElementById("t");
    t.focus();
    t.setSelectionRange(0, 7); // "Bonjour"
    child.document.dispatchEvent(new child.MouseEvent("mouseup", { bubbles: true, composed: true, clientX: 100, clientY: 230 }));
    await wait(60);
    const bubble = child.document.querySelector("[data-twp-bubble]");
    assert.ok(bubble, "the logo appears in the frame, next to the selection");
    bubble.shadowRoot.querySelector("button").click();
    await wait(500); // the frame asks the top page where it is (up to 400 ms), then the panel is shown
    assert.equal(hostOf(child), null, "nothing is shown inside the frame");
    const panel = panelOf(top);
    assert.ok(panel, "the panel is in the top page");
    assert.equal(panel.style.display, "block");
    // The selection was made in a field with the mouse at (100, 230) inside the frame, which sits at (50, 300) in the top page:
    // the anchor is at (150, 522..538). Not enough room below it (768 - 538 < 260): the panel opens above.
    assert.equal(panel.style.left, "150px", "frame offset (50) + pointer (100)");
    assert.equal(panel.style.bottom, "254px", "above the anchor, whose top is 8 px above the pointer: 768 - (300 + 222) + 8");
    assert.match(panel.querySelector(".out").textContent, /\[translated\] Bonjour/);
    assert.equal(hostOf(top).shadowRoot.querySelector(".replace").hidden, false, "Replace is offered: the selection is in a field");
  } finally { top.close(); }
});

test("Replace in the top page's panel replaces the selection inside the frame", { skip: skipReason }, async () => {
  const { top, child } = createPageWithFrame();
  try {
    const t = child.document.getElementById("t");
    t.focus();
    t.setSelectionRange(0, 7);
    child.document.dispatchEvent(new child.MouseEvent("mouseup", { bubbles: true, composed: true, clientX: 100, clientY: 230 }));
    await wait(60);
    child.document.querySelector("[data-twp-bubble]").shadowRoot.querySelector("button").click();
    await wait(500);
    hostOf(top).shadowRoot.querySelector(".replace").click();
    await wait(60);
    assert.equal(t.value, "[translated] Bonjour a tous, voici un message", "only the selected word was replaced, in the frame");
    assert.equal(panelOf(top).style.display, "none", "the panel closes after the replacement");
  } finally { top.close(); }
});

test("a frame whose position cannot be found falls back to showing the panel itself", { skip: skipReason }, async () => {
  const { top, child } = createPageWithFrame();
  try {
    top.postMessage = () => {}; // the top page never answers (no content script there, or a frame it cannot match)
    const t = child.document.getElementById("t");
    t.focus();
    t.setSelectionRange(0, 7);
    child.document.dispatchEvent(new child.MouseEvent("mouseup", { bubbles: true, composed: true, clientX: 100, clientY: 230 }));
    await wait(60);
    const bubble = child.document.querySelector("[data-twp-bubble]");
    assert.ok(bubble);
    bubble.shadowRoot.querySelector("button").click();
    await wait(700);
    assert.ok(hostOf(child), "the panel is shown in the frame itself, as before");
  } finally { top.close(); }
});
