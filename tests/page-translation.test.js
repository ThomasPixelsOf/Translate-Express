// Test de la traduction de page (src/contentScript/pageTranslator.js) dans une page simulée (jsdom).
// jsdom est cherché dans le dossier du projet Tenant s'il n'est pas installé ici ; sans lui, ce fichier est ignoré.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null, VirtualConsole = null;
for (const chemin of ["jsdom", path.join(__dirname, "..", "node_modules", "jsdom"), "D:/Desktop/Tenant/node_modules/jsdom"]) {
  try { ({ JSDOM, VirtualConsole } = require(chemin)); break; } catch (e) { /* suivant */ }
}
const SRC = path.join(__dirname, "..", "src");
const lire = (f) => fs.readFileSync(path.join(SRC, f), "utf8");
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Une page de 6 paragraphes positionnés par data-top / data-bottom (jsdom ne fait pas de mise en page).
function creerPage({ echecsAvantSucces = 0 } = {}) {
  const lignes = [
    ["p1", 20, 60], ["p2", 80, 120], ["p3", 140, 180], // à l'écran (hauteur 600)
    ["p4", 700, 740],                                   // juste sous l'écran, dans la marge de prélecture
    ["p5", 3000, 3040],                                 // très loin : ne doit PAS être traduit tout de suite
    ["gros", -2000, 5000],                              // un bloc plus haut que l'écran : il couvre tout l'écran
  ];
  const corps = lignes.map(([id, h, b]) => `<p id="${id}" data-top="${h}" data-bottom="${b}">Texte anglais numero ${id} pour la traduction.</p>`).join("");
  const virtualConsole = new VirtualConsole();
  if (process.env.TWP_DEBUG) for (const ev of ["log", "warn", "error", "jsdomError"]) virtualConsole.on(ev, (...a) => console.log("page", ev, ...a.map((x) => (x && x.message) || x)));
  const dom = new JSDOM(`<!doctype html><html><body>${corps}</body></html>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://exemple.test/", virtualConsole });
  const w = dom.window;
  w.eval(`Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });`);
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    const top = Number(this.getAttribute("data-top") || 0), bottom = Number(this.getAttribute("data-bottom") || 0);
    return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top };
  };

  const demandes = []; // une entrée par appel « translateHTML »
  let echecsRestants = echecsAvantSucces;
  const ecouteurs = [];
  w.chrome = {
    runtime: {
      lastError: undefined,
      inIncognitoContext: false,
      getURL: (p) => p,
      onMessage: { addListener: (f) => ecouteurs.push(f) },
      sendMessage: (m, cb) => {
        if (process.env.TWP_DEBUG) console.log("message ->", m.action);
        const repondre = (r) => cb && setTimeout(() => cb(r), 0);
        if (m.action === "translateHTML") {
          demandes.push(m.sourceArray2d.map((b) => b.join(" ")));
          if (echecsRestants > 0) { echecsRestants--; return repondre(undefined); } // le moteur échoue
          return repondre(m.sourceArray2d.map((b) => b.map((s) => "[fr] " + s)));
        }
        if (m.action === "detectTabLanguage" || m.action === "getMainFrameTabLanguage") return repondre("en");
        if (m.action === "getMainFramePageLanguageState") return repondre("original");
        if (m.action === "getTabHostName") return repondre("exemple.test");
        return repondre(undefined);
      },
    },
    extension: { inIncognitoContext: false },
    i18n: { getUILanguage: () => "fr", getMessage: () => "", detectLanguage: (t, cb) => cb({ isReliable: false, languages: [] }) },
  };
  const defauts = { customDictionary: new Map(), targetLanguages: ["fr"], targetLanguage: "fr", pageTranslatorService: "google", translateTag_pre: "yes", translateDynamicallyCreatedContent: "yes" };
  w.twpConfig = {
    get: (k) => (k in defauts ? defauts[k] : (/Sites|Langs|Languages$/.test(k) ? [] : "no")),
    set() {}, onChanged() {}, onReady: (cb) => cb && cb(),
  };
  w.twpLang = { fixTLanguageCode: (c) => c, codeToLanguage: (c) => c };
  w.twpI18n = { getMessage: () => "" };
  w.platformInfo = { isMobile: { any: false }, isDesktop: { any: true }, isFirefox: false };
  w.checkedLastError = () => {};
  w.fetch = async () => ({ ok: true, text: async () => "" });
  // Les deux scripts dans un même bloc : le second utilise la constante `showOriginal` définie par le premier.
  w.eval([lire("contentScript/showOriginal.js"), lire("contentScript/pageTranslator.js")].join(String.fromCharCode(10)));
  const envoyer = (m) => ecouteurs.forEach((f) => f(m, {}, () => {}));
  const texte = (id) => w.document.getElementById(id).textContent;
  return { w, demandes, envoyer, texte };
}

const ignorer = JSDOM ? false : "jsdom introuvable";

test("page simulée : le texte à l'écran, sous l'écran et un bloc plus haut que l'écran sont traduits ; le texte très éloigné attend", { skip: ignorer, timeout: 20000 }, async () => {
  const page = creerPage();
  const fermer = () => page.w.close();
  try {
  await attendre(150); // le script de page finit son initialisation (réponses asynchrones du fond)
  page.envoyer({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await attendre(1200);
  for (const id of ["p1", "p2", "p3"]) assert.match(page.texte(id), /^\[fr\]/, id + " (à l'écran) doit être traduit");
  assert.match(page.texte("p4"), /^\[fr\]/, "p4 (juste sous l'écran) est prélu");
  assert.match(page.texte("gros"), /^\[fr\]/, "un bloc plus haut que l'écran était ignoré avant la correction");
  assert.doesNotMatch(page.texte("p5"), /^\[fr\]/, "p5 est très loin : traduit seulement quand on s'en approche");
  } finally { fermer(); }
});

test("page simulée : un morceau dont la traduction échoue est réessayé au lieu de rester en version originale", { skip: ignorer, timeout: 30000 }, async () => {
  const page = creerPage({ echecsAvantSucces: 1 });
  const fermer = () => page.w.close();
  try { // le premier appel au moteur échoue
  await attendre(150); // le script de page finit son initialisation (réponses asynchrones du fond)
  page.envoyer({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await attendre(900);
  assert.doesNotMatch(page.texte("p1"), /^\[fr\]/, "après l'échec, rien n'est encore traduit");
  await attendre(4000); // délai de réessai (1,5 s) + marge
  for (const id of ["p1", "p2", "p3", "p4"]) assert.match(page.texte(id), /^\[fr\]/, id + " doit être traduit après le réessai");
  assert.ok(page.demandes.length >= 2, "le moteur a été sollicité de nouveau");
  } finally { fermer(); }
});

test("page simulée : l'original revient intact avec « restorePage »", { skip: ignorer, timeout: 20000 }, async () => {
  const page = creerPage();
  const fermer = () => page.w.close();
  try {
  const avant = page.texte("p1");
  await attendre(150); // le script de page finit son initialisation (réponses asynchrones du fond)
  page.envoyer({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await attendre(1200);
  assert.match(page.texte("p1"), /^\[fr\]/);
  page.envoyer({ action: "restorePage" });
  await attendre(300);
  assert.equal(page.texte("p1"), avant);
  } finally { fermer(); }
});

// ---- Texte qui échappe à la traduction : tous les cas doivent être rattrapés ----
// Page de départ traduite, puis on modifie la page comme le ferait une application (AJAX, React, composants isolés...).
async function pageTraduite(extraBody = "", avantTraduction = () => {}) {
  const page = creerPage();
  if (extraBody) page.w.document.body.insertAdjacentHTML("beforeend", extraBody);
  avantTraduction(page);
  await attendre(150);
  page.envoyer({ action: "translatePage", targetLanguage: "fr", service: "google" });
  await attendre(1200);
  return page;
}
const position = (el, haut = 100, bas = 140) => { el.setAttribute("data-top", String(haut)); el.setAttribute("data-bottom", String(bas)); return el; };
const estTraduit = (txt) => /\[fr\]/.test(txt);

test("texte ajouté après coup : un nœud texte nu ajouté dans un élément existant est traduit", { skip: ignorer, timeout: 30000 }, async () => {
  const page = await pageTraduite();
  try {
    const p = page.w.document.getElementById("p1");
    p.appendChild(page.w.document.createTextNode(" Extra sentence added later by the application."));
    await attendre(3500); // le traducteur relit les ajouts toutes les 2 s
    assert.match(p.textContent, /\[fr\]\s+Extra sentence added later/, "un texte nu ajouté était ignoré avant la correction");
  } finally { page.w.close(); }
});

test("texte ajouté après coup : un élément en ligne (span) ajouté dans un élément existant est traduit", { skip: ignorer, timeout: 30000 }, async () => {
  const page = await pageTraduite();
  try {
    const p = page.w.document.getElementById("p2");
    const span = page.w.document.createElement("span");
    span.textContent = "Inline label appended dynamically";
    p.appendChild(span);
    await attendre(3500);
    assert.match(span.textContent, /\[fr\] Inline label appended/, "un élément en ligne ajouté était ignoré avant la correction");
  } finally { page.w.close(); }
});

test("texte modifié par la page : un nœud déjà traduit dont le texte est remplacé est retraduit", { skip: ignorer, timeout: 30000 }, async () => {
  const page = await pageTraduite();
  try {
    const p = page.w.document.getElementById("p3");
    const noeud = p.firstChild.nodeType === 3 ? p.firstChild : p.firstChild.firstChild; // le texte (éventuellement dans <font>)
    assert.match(p.textContent, /\[fr\]/, "d'abord traduit");
    noeud.data = "Brand new English sentence written by the page.";
    await attendre(3500);
    assert.match(p.textContent, /\[fr\] Brand new English sentence/, "un texte modifié par la page n'était jamais retraduit");
  } finally { page.w.close(); }
});

test("zone isolée (shadow DOM) : le texte qu'elle contient est traduit, y compris ce qui y est ajouté ensuite", { skip: ignorer, timeout: 30000 }, async () => {
  let interieur;
  const page = await pageTraduite("", (pg) => {
    const hote = pg.w.document.createElement("div");
    position(hote, 300, 360);
    pg.w.document.body.appendChild(hote);
    const racine = hote.attachShadow({ mode: "open" });
    interieur = pg.w.document.createElement("p");
    position(interieur, 300, 340);
    interieur.textContent = "Text living inside an isolated component.";
    racine.appendChild(interieur);
  });
  try {
    assert.match(interieur.textContent, /\[fr\]/, "texte présent au départ dans la zone isolée");
    const ajout = page.w.document.createElement("p");
    position(ajout, 350, 380);
    ajout.textContent = "Another sentence added inside the isolated component.";
    interieur.parentNode.appendChild(ajout);
    await attendre(3500);
    assert.match(ajout.textContent, /\[fr\] Another sentence added inside/, "ajout dans une zone isolée");
  } finally { page.w.close(); }
});

test("bloc <code> : du texte normal affiché en police à chasse fixe est traduit, du vrai code ne l'est pas", { skip: ignorer, timeout: 30000 }, async () => {
  const page = await pageTraduite(
    '<code id="prose" data-top="400" data-bottom="440">Instructions for submitting an IT helpdesk request: describe the problem in detail.</code>' +
    '<code id="vrai" data-top="450" data-bottom="470">const total = compute(a, b) ? x[0] : y{1};</code>'
  );
  try {
    assert.match(page.texte("prose"), /^\[fr\]/, "texte normal dans <code> : traduit");
    assert.doesNotMatch(page.texte("vrai"), /\[fr\]/, "vrai code : laissé tel quel");
  } finally { page.w.close(); }
});

test("le balayage de sécurité rattrape un texte que ni l'observateur ni la file n'ont vu", { skip: ignorer, timeout: 30000 }, async () => {
  const page = await pageTraduite();
  try {
    // On insère un paragraphe puis on « oublie » qu'il a été vu : seul le balayage périodique peut le retrouver.
    const p = page.w.document.createElement("p");
    position(p, 200, 240);
    p.textContent = "Paragraph inserted behind the back of every observer.";
    page.w.document.body.appendChild(p);
    await attendre(6500); // balayage toutes les 4 s
    assert.match(p.textContent, /\[fr\] Paragraph inserted/);
  } finally { page.w.close(); }
});

test("pas de boucle : un texte déjà traduit n'est pas renvoyé au traducteur à chaque balayage", { skip: ignorer, timeout: 30000 }, async () => {
  const page = await pageTraduite();
  try {
    await attendre(500);
    const avant = page.demandes.length;
    await attendre(9000); // deux balayages et plusieurs relectures
    assert.equal(page.demandes.length, avant, "aucune nouvelle demande : le texte déjà traduit n'est pas retraduit");
    assert.doesNotMatch(page.texte("p1"), /\[fr\] \[fr\]/, "pas de double traduction");
  } finally { page.w.close(); }
});
