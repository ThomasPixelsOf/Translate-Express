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
    tabs: { sendMessage: () => {}, detectLanguage: (id, cb) => cb("en"), query: (q, cb) => cb([]) },
    windows: { create: () => Promise.resolve(), getAll: () => Promise.resolve([]), update: () => Promise.resolve() },
  };
  return { chrome, menus, handlers, stockage };
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
    structuredClone, EventTarget, Event, Blob, atob, btoa, crypto: globalThis.crypto,
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
  for (const id of ["twp-selection", "twp-field", "twp-page", "twp-composer", "twp-lang", "twp-key"]) assert.ok(ids.includes(id), "entrée absente : " + id);
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
  handlers.onMessage.forEach((f) => f({ action: "setPageLanguageState", pageLanguageState: "translated" }, { tab: { id: 1 } }, () => {}));
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
