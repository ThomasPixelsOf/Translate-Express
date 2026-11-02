// Test de démarrage du service worker (src/bg.js) avec de faux objets `chrome` : vérifie que tous les fichiers se
// chargent dans l'ordre, sans erreur, et que le menu du clic droit est créé avec les bonnes entrées.
// Ce n'est pas un test dans un vrai navigateur : il attrape les fichiers manquants et les erreurs de chargement.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");

function fauxChrome() {
  const menus = [];
  const handlers = { onMessage: [], onClicked: [], onInstalled: [], onStartup: [] };
  const stockage = {};
  const etat = { dockAnswer: true, tabMessages: [], windowsCreated: [], pageStates: {}, activeTab: 1, listeners: { onActivated: [], onUpdated: [], onFocusChanged: [] } };
  const chrome = {
    runtime: {
      onMessage: { addListener: (f) => handlers.onMessage.push(f) },
      onInstalled: { addListener: (f) => handlers.onInstalled.push(f) },
      onStartup: { addListener: (f) => handlers.onStartup.push(f) },
      getURL: (p) => "chrome-extension://test" + p,
      sendMessage: () => {},
      lastError: undefined,
    },
    storage: {
      local: {
        get: (cles, cb) => cb && cb({ ...stockage }),
        set: (o, cb) => { Object.assign(stockage, o); cb && cb(); return Promise.resolve(); },
        remove: (k, cb) => { delete stockage[k]; cb && cb(); },
      },
      onChanged: { addListener: () => {} },
    },
    i18n: { getUILanguage: () => "fr", getMessage: (n) => n, getAcceptLanguages: (cb) => cb(["fr", "fr-FR", "en"]) },
    contextMenus: {
      removeAll: (cb) => { menus.length = 0; cb && cb(); },
      create: (m) => menus.push(m),
      update: (id, p, cb) => { const m = menus.find((x) => x.id === id); if (m) Object.assign(m, p); cb && cb(); },
      onClicked: { addListener: (f) => handlers.onClicked.push(f) },
    },
    tabs: {
      sendMessage: (id, msg, opts, cb) => {
        etat.tabMessages.push({ id, msg });
        const f = typeof opts === "function" ? opts : cb;
        // Chaque onglet répond avec SON état de traduction.
        if (msg.action === "getCurrentPageLanguageState") return f && f(etat.pageStates[id] || "original");
        if (f) f(etat.dockAnswer);
      },
      detectLanguage: (id, cb) => cb("en"),
      query: (q, cb) => cb([{ id: etat.activeTab, active: true }]),
      onActivated: { addListener: (f) => etat.listeners.onActivated.push(f) },
      onUpdated: { addListener: (f) => etat.listeners.onUpdated.push(f) },
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: { addListener: (f) => etat.listeners.onFocusChanged.push(f) }, create: (o) => { etat.windowsCreated.push(o); return Promise.resolve(); }, getAll: () => Promise.resolve([]), update: () => Promise.resolve() },
  };
  return { chrome, menus, handlers, stockage, etat };
}

function demarrer() {
  const faux = fauxChrome();
  const sandbox = {
    chrome: faux.chrome,
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    TextDecoder, TextEncoder, URL, URLSearchParams, AbortController, Intl,
    fetch: async () => { throw new Error("pas de réseau dans ce test"); },
    indexedDB: { open: () => ({}), deleteDatabase: () => ({}) },
    navigator: { userAgent: "Chrome/156", language: "fr" },
    structuredClone, EventTarget, Event, CustomEvent, Blob, atob, btoa, crypto: globalThis.crypto,
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  sandbox.importScripts = (...fichiers) => {
    for (const f of fichiers) {
      const chemin = path.join(SRC, f);
      assert.ok(fs.existsSync(chemin), "fichier manquant : " + f);
      vm.runInContext(fs.readFileSync(chemin, "utf8"), sandbox, { filename: f });
    }
  };
  return { sandbox, ...faux };
}

// Charge les fichiers dans l'ordre exact de bg.js.
function chargerBg(sandbox) {
  const lignes = fs.readFileSync(path.join(SRC, "bg.js"), "utf8").split(/\r?\n/).filter((l) => l.startsWith("importScripts"));
  sandbox.importScripts(...lignes.map((l) => l.match(/"(.+)"/)[1]));
}

test("le manifeste est valide et ne référence que des fichiers qui existent", () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, "manifest.json"), "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.background.service_worker, "bg.js");
  const fichiers = [
    ...Object.values(m.icons),
    ...m.content_scripts.flatMap((c) => c.js),
  ];
  for (const f of fichiers) assert.ok(fs.existsSync(path.join(SRC, f)), "référencé mais absent : " + f);
  assert.deepEqual(m.permissions.sort(), ["contextMenus", "storage"]);
  assert.equal(m.action, undefined);
  assert.equal(m.options_ui, undefined);
  assert.equal(m.commands, undefined);
});

test("le service worker se charge sans erreur et crée le menu du clic droit", async () => {
  const { sandbox, menus, handlers } = demarrer();
  assert.doesNotThrow(() => chargerBg(sandbox));
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const ids = menus.map((m) => m.id);
  for (const id of ["twp-selection", "twp-field", "twp-page", "twp-composer", "twp-bubble", "twp-lang", "twp-key"]) assert.ok(ids.includes(id), "entrée absente : " + id);
  assert.ok(ids.includes("twp-lang-en") && ids.includes("twp-lang-fr"), "langues courantes absentes");
  assert.equal(menus.filter((m) => m.type === "radio" && m.checked).length, 1, "une seule langue cochée");
  assert.match(menus.find((m) => m.id === "twp-page").title, /^Translate this page to /);
  assert.ok(handlers.onClicked.length >= 1);
});

test("le menu bascule sur « Show original page » quand la page est traduite", async () => {
  const { sandbox, menus, handlers } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 1, active: true }, frameId: 0 }, () => {}));
  assert.equal(menus.find((m) => m.id === "twp-page").title, "Show original page");
});

test("choisir une langue dans le menu change la langue cible partout et met le menu à jour", async () => {
  const { sandbox, menus, handlers } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  assert.match(menus.find((m) => m.id === "twp-lang").title, /Target language: /);
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-lang-de", frameId: 0 }, { id: 1 }));
  assert.equal(vm.runInContext('twpConfig.get("targetLanguage")', sandbox), "de");
  assert.equal(menus.find((m) => m.id === "twp-lang-de").checked, true);
  assert.match(menus.find((m) => m.id === "twp-page").title, /^Translate this page to /);
});

test("« Message window » s'ouvre dans un volet de la page, et en fenêtre seulement si la page ne peut pas l'accueillir", async () => {
  const { sandbox, handlers, etat } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-composer", frameId: 0 }, { id: 7 }));
  assert.deepEqual(JSON.parse(JSON.stringify(etat.tabMessages.at(-1))), { id: 7, msg: { action: "twpDock", view: "composer" } });
  assert.equal(etat.windowsCreated.length, 0, "pas de fenêtre quand le volet répond");

  etat.dockAnswer = undefined; // page qui ne peut pas recevoir le volet (page du navigateur, PDF...)
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-composer", frameId: 0 }, { id: 7 }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(etat.windowsCreated.length, 1);
  assert.match(etat.windowsCreated[0].url, /composer[/]composer[.]html/);

  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-key", frameId: 0 }, { id: 7 }));
  assert.match(etat.windowsCreated.at(-1).url, /setup[/]setup[.]html/);
});

test("la bulle de sélection est active par défaut et se désactive depuis le menu", async () => {
  const { sandbox, menus, handlers } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const bulle = () => menus.find((m) => m.id === "twp-bubble");
  assert.equal(bulle().type, "checkbox");
  assert.equal(bulle().checked, true);
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-bubble", checked: false, frameId: 0 }, { id: 1 }));
  assert.equal(vm.runInContext('twpConfig.get("showTranslateSelectedButton")', sandbox), "no");
});

test("la liste des langues : courantes d'abord, puis toutes de A à Z, sans doublon", async () => {
  const { sandbox } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  // Faux élément <select> minimal : suffisant pour construire la liste.
  const sortie = vm.runInContext(`(function () {
    const creer = (tag) => ({ tag, children: [], textContent: "", appendChild(c) { this.children.push(c); } });
    const doc = { createElement: creer };
    const select = Object.assign(creer("select"), { ownerDocument: doc });
    twpLang.fillLanguageSelect(select, { auto: true });
    const groupes = select.children.filter((c) => c.tag === "optgroup");
    return JSON.stringify({
      premier: select.children[0].value,
      frequentes: groupes[0].children.map((o) => o.value),
      toutes: groupes[1].children.map((o) => o.textContent),
    });
  })()`, sandbox);
  const r = JSON.parse(sortie);
  assert.equal(r.premier, "auto");
  assert.deepEqual(r.frequentes.slice(0, 4), ["en", "fr", "de", "es"]);
  const triees = [...r.toutes].sort((a, b) => a.localeCompare(b, "fr"));
  assert.deepEqual(r.toutes, triees, "toutes les langues sont triées de A à Z");
  assert.equal(new Set(r.toutes).size, r.toutes.length, "pas de doublon");
  assert.ok(r.toutes.length > 50);
  assert.ok(!r.toutes.some((n) => /emoji/i.test(n)), "« Emoji » n'est pas une langue");
});

// Envoie un message au fond comme le ferait un script de page, et renvoie la réponse (ou "PAS DE REPONSE").
function envoyer(handlers, request) {
  return new Promise((resolve) => {
    let fini = false;
    const fin = (r) => { if (!fini) { fini = true; resolve(r === undefined ? "REPONSE VIDE" : r); } };
    for (const f of handlers.onMessage) f(request, { tab: { id: 1, url: "https://x.test/" } }, fin);
    setTimeout(() => fin("PAS DE REPONSE"), 2000);
  });
}
const cleLlm = { name: "llm", provider: "auto", apiKey: "gsk_1234567890abcdef", model: "" };

test("le menu choisit le service : IA avec une clé enregistrée, Google sans clé", async () => {
  const { sandbox, handlers, etat } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const cliquer = () => handlers.onClicked.forEach((f) => f({ menuItemId: "twp-page", frameId: 0 }, { id: 3 }));
  cliquer();
  assert.equal(etat.tabMessages.at(-1).msg.action, "translatePage");
  assert.equal(etat.tabMessages.at(-1).msg.service, "google");
  vm.runInContext("twpConfig.set('customServices', [" + JSON.stringify(cleLlm) + "])", sandbox);
  cliquer();
  assert.equal(etat.tabMessages.at(-1).msg.service, "llm");
});

test("si l'IA échoue, la page est traduite par Google au lieu de rester vide (repli)", async () => {
  const { sandbox, handlers } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  vm.runInContext("translationCache.get = async () => null; translationCache.set = async () => {};", sandbox);
  const urls = [];
  sandbox.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "qwen/qwen3.8-27b" }] }) };
    if (String(url).includes("chat/completions")) return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({ error: { message: "Invalid API Key" } }) };
    throw new Error("réseau coupé");
  };
  vm.runInContext("twpConfig.set('customServices', [" + JSON.stringify(cleLlm) + "])", sandbox);
  await envoyer(handlers, { action: "createLlmService", llm: cleLlm });
  await envoyer(handlers, { action: "translateHTML", translationService: "llm", sourceLanguage: "en", targetLanguage: "fr", sourceArray2d: [["Hello"]], dontSortResults: false });
  assert.ok(urls.some((u) => u.includes("chat/completions")), "l'IA a d'abord été essayée");
  assert.ok(urls.some((u) => /translate(-pa)?.googleapis.com/.test(u)), "puis Google a été essayé : " + urls.join(" | "));
});

// Démarre le service worker avec une langue d'interface et des langues préférées données.
async function demarrerAvecLangues(ui, acceptees, avant) {
  const r = demarrer();
  r.sandbox.chrome.i18n.getUILanguage = () => ui;
  r.sandbox.chrome.i18n.getAcceptLanguages = (cb) => cb(acceptees);
  if (avant) avant(r);
  chargerBg(r.sandbox);
  await new Promise((res) => setTimeout(res, 80));
  return r;
}
const langueCible = (sandbox) => vm.runInContext('twpConfig.get("targetLanguage")', sandbox);

test("langue par défaut : la première langue non anglaise, même si l'interface et les langues préférées commencent par l'anglais", async () => {
  // C'est le cas réel : Brave en anglais avec les langues préférées « en,fr ».
  const { sandbox } = await demarrerAvecLangues("en", ["en", "fr"]);
  assert.equal(langueCible(sandbox), "fr");
});

test("langue par défaut : l'interface si elle n'est pas en anglais ; l'anglais seulement s'il n'y a rien d'autre", async () => {
  assert.equal(langueCible((await demarrerAvecLangues("de", ["en", "fr"])).sandbox), "de");
  assert.equal(langueCible((await demarrerAvecLangues("fr-CH", ["en-US", "en", "fr-CH", "fr"])).sandbox), "fr");
  assert.equal(langueCible((await demarrerAvecLangues("en-US", ["en-US", "en"])).sandbox), "en");
});

test("langue par défaut : à défaut d'interface reconnue, la première langue préférée", async () => {
  const { sandbox } = await demarrerAvecLangues("xx", ["de-CH", "en"]);
  assert.equal(langueCible(sandbox), "de");
});

test("une langue choisie par l'utilisateur n'est plus jamais remplacée par la détection", async () => {
  const { sandbox } = await demarrerAvecLangues("fr", ["fr"], ({ stockage }) => {
    stockage.targetLanguage = "ja"; // hors des trois premières langues du navigateur
    stockage.targetLanguageChosen = "yes";
  });
  assert.equal(langueCible(sandbox), "ja");
});

test("choisir une langue dans le menu l'enregistre comme choix de l'utilisateur", async () => {
  const { sandbox, handlers } = await demarrerAvecLangues("fr", ["fr"]);
  handlers.onInstalled.forEach((f) => f());
  handlers.onClicked.forEach((f) => f({ menuItemId: "twp-lang-ja", frameId: 0 }, { id: 1 }));
  assert.equal(vm.runInContext('twpConfig.get("targetLanguageChosen")', sandbox), "yes");
  assert.equal(langueCible(sandbox), "ja");
});

test("multi-onglets : le menu suit l'onglet affiché, pas l'onglet précédent", async () => {
  const { sandbox, menus, handlers, etat } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const titre = () => menus.find((m) => m.id === "twp-page").title;
  etat.pageStates = { 1: "translated", 2: "original" };

  etat.listeners.onActivated.forEach((f) => f({ tabId: 1 })); // onglet 1 : traduit
  assert.equal(titre(), "Show original page");
  etat.listeners.onActivated.forEach((f) => f({ tabId: 2 })); // onglet 2 : jamais traduit
  assert.match(titre(), /^Translate this page to /, "l'onglet 2 ne doit pas hériter de l'état de l'onglet 1");
  etat.listeners.onActivated.forEach((f) => f({ tabId: 1 }));
  assert.equal(titre(), "Show original page");
});

test("multi-onglets : le clic agit selon l'état de l'onglet cliqué", async () => {
  const { sandbox, handlers, etat } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  etat.pageStates = { 1: "translated", 2: "original" };
  const cliquer = (id) => handlers.onClicked.forEach((f) => f({ menuItemId: "twp-page", frameId: 0 }, { id }));
  cliquer(2);
  assert.equal(etat.tabMessages.at(-1).msg.action, "translatePage", "onglet 2 non traduit : on traduit");
  cliquer(1);
  assert.equal(etat.tabMessages.at(-1).msg.action, "restorePage", "onglet 1 traduit : on revient à l'original");
});

test("multi-onglets : un message d'un onglet en arrière-plan ne change pas le titre, une page rechargée redevient « à traduire »", async () => {
  const { sandbox, menus, handlers, etat } = demarrer();
  chargerBg(sandbox);
  await new Promise((r) => setTimeout(r, 50));
  handlers.onInstalled.forEach((f) => f());
  const titre = () => menus.find((m) => m.id === "twp-page").title;
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 9, active: false }, frameId: 0 }, () => {}));
  assert.match(titre(), /^Translate this page to /, "onglet non affiché : titre inchangé");
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 1, active: true }, frameId: 3 }, () => {}));
  assert.match(titre(), /^Translate this page to /, "sous-cadre : ignoré");
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 1, active: true }, frameId: 0 }, () => {}));
  assert.equal(titre(), "Show original page");
  etat.listeners.onUpdated.forEach((f) => f(1, { status: "loading" }, { id: 1, active: true })); // la page se recharge
  assert.match(titre(), /^Translate this page to /);
});
