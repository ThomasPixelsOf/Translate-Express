// Test of page translation (src/contentScript/pageTranslator.js) in a simulated page (jsdom).
// jsdom is looked up in node_modules; without it, this file is skipped.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null, VirtualConsole = null;
for (const filePath of ["jsdom", path.join(__dirname, "..", "node_modules", "jsdom")]) {
  try { ({ JSDOM, VirtualConsole } = require(filePath)); break; } catch (e) { /* next */ }
}
const SRC = path.join(__dirname, "..", "src");
const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A page of 6 paragraphs positioned by data-top / data-bottom (jsdom does no layout).
function createPage({ echecsAvantSucces = 0, tronquerPremiereReponse = false } = {}) {
  const rows = [
    ["p1", 20, 60], ["p2", 80, 120], ["p3", 140, 180], // on screen (height 600)
    ["p4", 700, 740],                                   // just below the screen, in the look-ahead margin
    ["p5", 3000, 3040],                                 // very far: must NOT be translated right away
    ["tall", -2000, 5000],                              // a block taller than the screen: it covers the whole screen
  ];
  const body = rows.map(([id, h, b]) => `<p id="${id}" data-top="${h}" data-bottom="${b}">English text number ${id} for translation.</p>`).join("");
  const virtualConsole = new VirtualConsole();
  if (process.env.TWP_DEBUG) for (const ev of ["log", "warn", "error", "jsdomError"]) virtualConsole.on(ev, (...a) => console.log("page", ev, ...a.map((x) => (x && x.message) || x)));
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://exemple.test/", virtualConsole });
  const w = dom.window;
  w.eval(`Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });`);
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute("data-hidden")) return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; // hidden (display:none)
    const top = Number(this.getAttribute("data-top") || 0), bottom = Number(this.getAttribute("data-bottom") || 0);
    return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top };
  };

  const requests = []; // one entry per "translateHTML" call
  const priorities = []; // priority of each call: "high" (visible) or "low" (rest of the page)
  let failuresLeft = echecsAvantSucces;
  let truncate = tronquerPremiereReponse;
  const listeners = [];
  w.chrome = {
    runtime: {
      lastError: undefined,
      inIncognitoContext: false,
      getURL: (p) => p,
      onMessage: { addListener: (f) => listeners.push(f) },
      sendMessage: (m, cb) => {
        if (process.env.TWP_DEBUG) console.log("message ->", m.action);
        const reply = (r) => cb && setTimeout(() => cb(r), 0);
        if (m.action === "translateHTML") {
          requests.push(m.sourceArray2d.map((b) => b.join(" ")));
          priorities.push(m.priority);
          if (failuresLeft > 0) { failuresLeft--; return reply(undefined); } // the engine fails
          if (truncate && m.sourceArray2d.some((b) => b.length > 1)) {
            // The engine only returns the first piece of each block: the following ones are left to translate.
            truncate = false;
            return reply(m.sourceArray2d.map((b) => b.map((s, k) => (k === 0 ? "[fr] " + s : undefined)).filter((x) => x !== undefined)));
          }
          return reply(m.sourceArray2d.map((b) => b.map((s) => "[fr] " + s)));
        }
        if (m.action === "detectTabLanguage" || m.action === "getMainFrameTabLanguage") return reply("en");
        if (m.action === "getMainFramePageLanguageState") return reply("original");
        if (m.action === "getTabHostName") return reply("exemple.test");
        return reply(undefined);
      },
    },
    extension: { inIncognitoContext: false },
    i18n: { getUILanguage: () => "fr", getMessage: () => "", detectLanguage: (t, cb) => cb({ isReliable: false, languages: [] }) },
  };
  const defaults = { customDictionary: new Map(), targetLanguages: ["fr"], targetLanguage: "fr", pageTranslatorService: "google", translateTag_pre: "yes", translateDynamicallyCreatedContent: "yes" };
  w.twpConfig = {
    get: (k) => (k in defaults ? defaults[k] : (/Sites|Langs|Languages$/.test(k) ? [] : "no")),
    set() {}, onChanged() {}, onReady: (cb) => cb && cb(),
  };
  w.twpLang = { fixTLanguageCode: (c) => c, codeToLanguage: (c) => c };
  w.twpI18n = { getMessage: () => "" };
  w.platformInfo = { isMobile: { any: false }, isDesktop: { any: true }, isFirefox: false };
  w.checkedLastError = () => {};
  w.fetch = async () => ({ ok: true, text: async () => "" });
  // Both scripts in the same block: the second uses the `showOriginal` constant defined by the first.
  w.eval([read("contentScript/showOriginal.js"), read("contentScript/pageTranslator.js")].join(String.fromCharCode(10)));
  const send = (m) => listeners.forEach((f) => f(m, {}, () => {}));
  const text = (id) => w.document.getElementById(id).textContent;
  return { w, requests, priorities, send, text };
}

const skipReason = JSDOM ? false : "jsdom introuvable";

test("simulated page: text on screen, below the screen and a block taller than the screen are translated; very distant text is translated afterwards", { skip: skipReason, timeout: 30000 }, async () => {
  const page = createPage();
  const shut = () => page.w.close();
  try {
  await wait(150); // the page script finishes its initialization (asynchronous answers from the background)
  page.send({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await wait(1200);
  for (const id of ["p1", "p2", "p3"]) assert.match(page.text(id), /^\[fr\]/, id + " (on screen) must be translated");
  assert.match(page.text("p4"), /^\[fr\]/, "p4 (just below the screen) is preloaded");
  assert.match(page.text("tall"), /^\[fr\]/, "a block taller than the screen was ignored before the fix");
  assert.doesNotMatch(page.text("p5"), /^\[fr\]/, "p5 is very far: not translated immediately (what is visible goes first)");
    await wait(5000);
    assert.match(page.text("p5"), /^\[fr\]/, "but it is translated afterwards, in the background, without scrolling");
  } finally { shut(); }
});

test("simulated page: a piece whose translation fails is retried instead of staying in its original version", { skip: skipReason, timeout: 30000 }, async () => {
  const page = createPage({ echecsAvantSucces: 1 });
  const shut = () => page.w.close();
  try { // the first call to the engine fails
  await wait(150); // the page script finishes its initialization (asynchronous answers from the background)
  page.send({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await wait(900);
  assert.doesNotMatch(page.text("p1"), /^\[fr\]/, "after the failure, nothing is translated yet");
  await wait(4000); // retry delay (1.5 s) + margin
  for (const id of ["p1", "p2", "p3", "p4"]) assert.match(page.text(id), /^\[fr\]/, id + " must be translated after the retry");
  assert.ok(page.requests.length >= 2, "the engine was called again");
  } finally { shut(); }
});

test("simulated page: the original comes back intact with \"restorePage\"", { skip: skipReason, timeout: 20000 }, async () => {
  const page = createPage();
  const shut = () => page.w.close();
  try {
  const before = page.text("p1");
  await wait(150); // the page script finishes its initialization (asynchronous answers from the background)
  page.send({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await wait(1200);
  assert.match(page.text("p1"), /^\[fr\]/);
  page.send({ action: "restorePage" });
  await wait(300);
  assert.equal(page.text("p1"), before);
  } finally { shut(); }
});

// ---- Text that escapes translation: all the cases must be caught ----
// Page translated at the start, then the page is modified as an application would (AJAX, React, isolated components...).
async function pageTranslated(extraBody = "", avantTraduction = () => {}) {
  const page = createPage();
  if (extraBody) page.w.document.body.insertAdjacentHTML("beforeend", extraBody);
  avantTraduction(page);
  await wait(150);
  page.send({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await wait(1200);
  return page;
}
const position = (el, haut = 100, lowCalls = 140) => { el.setAttribute("data-top", String(haut)); el.setAttribute("data-bottom", String(lowCalls)); return el; };
const estTraduit = (txt) => /\[fr\]/.test(txt);

test("text added later: a bare text node added in an existing element is translated", { skip: skipReason, timeout: 30000 }, async () => {
  const page = await pageTranslated();
  try {
    const p = page.w.document.getElementById("p1");
    p.appendChild(page.w.document.createTextNode(" Extra sentence added later by the application."));
    await wait(3500); // the translator re-reads additions every 2 s
    assert.match(p.textContent, /\[fr\]\s+Extra sentence added later/, "bare text was ignored before the fix");
  } finally { page.w.close(); }
});

test("text added later: an inline element (span) added in an existing element is translated", { skip: skipReason, timeout: 30000 }, async () => {
  const page = await pageTranslated();
  try {
    const p = page.w.document.getElementById("p2");
    const span = page.w.document.createElement("span");
    span.textContent = "Inline label appended dynamically";
    p.appendChild(span);
    await wait(3500);
    assert.match(span.textContent, /\[fr\] Inline label appended/, "an added inline element was ignored before the fix");
  } finally { page.w.close(); }
});

test("text modified by the page: an already translated node whose text is replaced is translated again", { skip: skipReason, timeout: 30000 }, async () => {
  const page = await pageTranslated();
  try {
    const p = page.w.document.getElementById("p3");
    const node = p.firstChild.nodeType === 3 ? p.firstChild : p.firstChild.firstChild; // the text (possibly inside <font>)
    assert.match(p.textContent, /\[fr\]/, "translated first");
    node.data = "Brand new English sentence written by the page.";
    await wait(3500);
    assert.match(p.textContent, /\[fr\] Brand new English sentence/, "text modified by the page was never translated again");
  } finally { page.w.close(); }
});

test("isolated area (shadow DOM): the text it contains is translated, including what is added afterwards", { skip: skipReason, timeout: 30000 }, async () => {
  let inside;
  const page = await pageTranslated("", (pg) => {
    const host = pg.w.document.createElement("div");
    position(host, 300, 360);
    pg.w.document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    inside = pg.w.document.createElement("p");
    position(inside, 300, 340);
    inside.textContent = "Text living inside an isolated component.";
    root.appendChild(inside);
  });
  try {
    assert.match(inside.textContent, /\[fr\]/, "text present at the start in the isolated area");
    const added = page.w.document.createElement("p");
    position(added, 350, 380);
    added.textContent = "Another sentence added inside the isolated component.";
    inside.parentNode.appendChild(added);
    await wait(3500);
    assert.match(added.textContent, /\[fr\] Another sentence added inside/, "addition in an isolated area");
  } finally { page.w.close(); }
});

test("<code> block: normal text displayed in a fixed-width font is translated, real code is not", { skip: skipReason, timeout: 30000 }, async () => {
  const page = await pageTranslated(
    '<code id="prose" data-top="400" data-bottom="440">Instructions for submitting an IT helpdesk request: describe the problem in detail.</code>' +
    '<code id="real" data-top="450" data-bottom="470">const total = compute(a, b) ? x[0] : y{1};</code>'
  );
  try {
    assert.match(page.text("prose"), /^\[fr\]/, "normal text in <code>: translated");
    assert.doesNotMatch(page.text("real"), /\[fr\]/, "real code: left as is");
  } finally { page.w.close(); }
});

test("the safety sweep catches text that neither the observer nor the queue saw", { skip: skipReason, timeout: 30000 }, async () => {
  const page = await pageTranslated();
  try {
    // A paragraph is inserted then "forgotten" as seen: only the periodic sweep can find it again.
    const p = page.w.document.createElement("p");
    position(p, 200, 240);
    p.textContent = "Paragraph inserted behind the back of every observer.";
    page.w.document.body.appendChild(p);
    await wait(6500); // balayage all les 4 s
    assert.match(p.textContent, /\[fr\] Paragraph inserted/);
  } finally { page.w.close(); }
});

test("no loop: already translated text is not sent back to the translator at every sweep", { skip: skipReason, timeout: 30000 }, async () => {
  const page = await pageTranslated();
  try {
    await wait(500);
    const before = page.requests.length;
    await wait(9000); // deux balayages et plusieurs relectures
    assert.equal(page.requests.length, before, "no new request: already translated text is not translated again");
    assert.doesNotMatch(page.text("p1"), /\[fr\] \[fr\]/, "no double translation");
  } finally { page.w.close(); }
});

test("truncated answer: pieces of the same block left untranslated are retried (start translated, end not)", { skip: skipReason, timeout: 30000 }, async () => {
  const page = createPage({ tronquerPremiereReponse: true });
  try {
    page.w.document.body.insertAdjacentHTML("beforeend", '<p id="mix" data-top="300" data-bottom="340">First sentence here <b>bold part</b> and the final words.</p>');
    await wait(150);
    page.send({ action: "translatePage", targetLanguage: "fr", service: "google" });
    await wait(900);
    const after1 = page.text("mix");
    assert.match(after1, /\[fr\] First sentence/, "the start is translated");
    assert.doesNotMatch(after1, /\[fr\]\s+and the final words/, "the end is not translated yet (truncated answer)");
    await wait(4500); // retry of the missing pieces
    assert.match(page.text("mix"), /\[fr\] bold part/, "middle piece translated after the retry");
    assert.match(page.text("mix"), /\[fr\]\s+and the final words/, "the end is translated after the retry");
  } finally { page.w.close(); }
});

test("priority: what is visible is sent first (high), then the rest from the closest to the farthest (low), hidden last; nothing is ignored", { skip: skipReason, timeout: 40000 }, async () => {
  const page = createPage();
  try {
    const doc = page.w.document;
    // three off-screen paragraphs, added in disorder: the farthest first, then a hidden one, then the closest
    doc.body.insertAdjacentHTML("beforeend",
      '<p id="far" data-top="9000" data-bottom="9040">Far away paragraph number two.</p>' +
      '<p id="hidden" data-hidden="1">Hidden paragraph inside an inactive tab.</p>' +
      '<p id="near" data-top="2500" data-bottom="2540">Closer paragraph number one.</p>');
    await wait(150);
    page.send({ action: "translatePage", targetLanguage: "fr", service: "google" });
    await wait(9000);
    // 1) the first request is the visible one, with high priority
    assert.equal(page.priorities[0], "high");
    assert.ok(page.requests[0].some((s) => /number p1/.test(s)), "what is visible goes first");
    // 2) the rest then goes out with low priority, in order: close, far, hidden
    const lowCalls = [];
    page.requests.forEach((d, i) => { if (page.priorities[i] === "low") d.forEach((s) => lowCalls.push(s)); });
    const rank = (mot) => lowCalls.findIndex((s) => s.includes(mot));
    assert.ok(rank("Closer paragraph") >= 0 && rank("Far away") >= 0 && rank("Hidden paragraph") >= 0, "everything is translated in the background: " + JSON.stringify(lowCalls));
    assert.ok(rank("Closer paragraph") < rank("Far away"), "the closest to the screen first");
    assert.ok(rank("Far away") < rank("Hidden paragraph"), "the hidden one last");
    // 3) nothing stayed in its original version
    for (const id of ["p1", "p5", "near", "far", "hidden"]) assert.match(page.text(id), /^\[fr\]/, id + " ends up translated");
  } finally { page.w.close(); }
});

test("priority: when scrolling to a waiting text, it immediately gets high priority", { skip: skipReason, timeout: 40000 }, async () => {
  const page = createPage();
  try {
    const doc = page.w.document;
    doc.body.insertAdjacentHTML("beforeend", '<p id="later" data-top="4000" data-bottom="4040">Paragraph that will be scrolled into view.</p>');
    await wait(150);
    page.send({ action: "translatePage", targetLanguage: "fr", service: "google" });
    await wait(700); // the visible text has left; "later" waits (very far, not yet in the background)
    assert.doesNotMatch(page.text("later"), /^\[fr\]/);
    // The user scrolls: the paragraph arrives on screen.
    doc.getElementById("later").setAttribute("data-top", "200");
    doc.getElementById("later").setAttribute("data-bottom", "240");
    await wait(900);
    assert.match(page.text("later"), /^\[fr\]/, "translated quickly once visible");
    const i = page.requests.findIndex((d) => d.some((s) => /scrolled into view/.test(s)));
    assert.equal(page.priorities[i], "high", "a text that becomes visible is handled with high priority");
  } finally { page.w.close(); }
});
