// Test de la bulle et du panneau (src/contentScript/panel.js) dans une page simulée (jsdom).
// jsdom est cherché dans le dossier du projet Tenant s'il n'est pas installé ici ; sans lui, ce fichier est ignoré.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM = null;
for (const chemin of ["jsdom", path.join(__dirname, "..", "node_modules", "jsdom"), "D:/Desktop/Tenant/node_modules/jsdom"]) {
  try { ({ JSDOM } = require(chemin)); break; } catch (e) { /* suivant */ }
}
const ignorer = JSDOM ? false : "jsdom introuvable";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const CODE = fs.readFileSync(path.join(__dirname, "..", "src", "contentScript", "panel.js"), "utf8");

function creerPage({ afficherBulle = "yes" } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <p id="p">Bonjour tout le monde, ceci est un texte de la page.</p>
    <textarea id="t" style="width:300px">Bonjour a tous, voici mon message en francais pour vous.</textarea>
    <input id="mdp" type="password" value="secret-mot-de-passe">
  </body></html>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://exemple.test/" });
  const w = dom.window;
  const envoyes = [];
  w.chrome = {
    runtime: {
      onMessage: { addListener() {} }, lastError: undefined,
      sendMessage: (m, cb) => {
        envoyes.push(m);
        if (cb) setTimeout(() => cb(m.action === "llmLive" ? { ok: true, text: "[traduit] " + m.text } : undefined), 0);
      },
    },
    i18n: { getUILanguage: () => "fr" },
  };
  const reglages = { showTranslateSelectedButton: afficherBulle, targetLanguage: "fr", writeLanguage: "en" };
  const enregistres = [];
  w.twpConfig = {
    get: (k) => (k in reglages ? reglages[k] : null),
    set: (k, v) => { reglages[k] = v; enregistres.push([k, v]); }, onChanged() {},
  };
  w.twpLang = {
    getLanguageList: () => ({ fr: "Français", en: "English" }), TargetLanguages: ["fr", "en"], fixTLanguageCode: (c) => c,
    fillLanguageSelect: (sel) => { for (const c of ["fr", "en"]) { const o = sel.ownerDocument.createElement("option"); o.value = c; o.textContent = c; sel.appendChild(o); } },
  };
  // jsdom ne calcule pas la mise en page : rectangles fournis à la main.
  const rect = { left: 10, right: 200, top: 100, bottom: 130, width: 190, height: 30 };
  w.Range.prototype.getClientRects = () => [rect];
  w.Range.prototype.getBoundingClientRect = () => rect;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 10, right: 310, top: 200, bottom: 260, width: 300, height: 60 });
  w.eval(CODE);
  const doc = w.document;
  return {
    w, doc, envoyes, enregistres,
    bulle: () => doc.querySelector("[data-twp-bubble]"),
    panneau: () => { const h = doc.querySelector("[data-twp-panel]"); return h && h.shadowRoot.querySelector(".panel"); },
    racinePanneau: () => doc.querySelector("[data-twp-panel]").shadowRoot,
    relacher: () => doc.dispatchEvent(new w.MouseEvent("mouseup", { bubbles: true, composed: true, clientX: 100, clientY: 230 })),
  };
}

test("texte de la page sélectionné : la bulle ouvre un panneau en lecture seule près du texte", { skip: ignorer }, async () => {
  const page = creerPage();
  try {
    const texte = page.doc.getElementById("p").firstChild;
    const r = page.doc.createRange(); r.setStart(texte, 0); r.setEnd(texte, 7); // « Bonjour »
    page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
    page.relacher();
    await attendre(40);
    assert.ok(page.bulle(), "la bulle apparaît");
    page.bulle().shadowRoot.querySelector("button").click();
    await attendre(40);
    assert.equal(page.panneau().style.display, "block");
    assert.equal(page.racinePanneau().querySelector(".replace").hidden, true, "pas de Replace pour du texte de page");
    assert.ok(page.envoyes.some((m) => m.action === "llmLive" && m.text === "Bonjour"));
    assert.equal(page.envoyes.filter((m) => m.action === "llmLive").at(-1).targetLanguage, "fr", "texte affiché : traduit dans la langue de LECTURE");
    assert.equal(page.racinePanneau().querySelector(".what").textContent, "Read in");
  } finally { page.w.close(); }
});

test("texte écrit dans un champ puis sélectionné : bulle, traduction dans la langue choisie, Replace remplace seulement la sélection", { skip: ignorer }, async () => {
  const page = creerPage();
  try {
    const t = page.doc.getElementById("t");
    t.focus();
    const debut = t.value.indexOf("voici");
    const fin = t.value.indexOf(" pour vous");
    t.setSelectionRange(debut, fin); // « voici mon message en francais »
    const selectionne = t.value.slice(debut, fin);
    page.relacher();
    await attendre(40);
    assert.ok(page.bulle(), "la bulle apparaît aussi pour un texte sélectionné dans un champ");

    page.bulle().shadowRoot.querySelector("button").click();
    await attendre(40);
    assert.equal(page.panneau().style.display, "block");
    assert.equal(page.racinePanneau().querySelector(".replace").hidden, false, "Replace est proposé pour un champ");
    assert.ok(page.envoyes.some((m) => m.action === "llmLive" && m.text === selectionne), "seule la sélection est traduite");
    assert.equal(page.envoyes.filter((m) => m.action === "llmLive").at(-1).targetLanguage, "en", "texte écrit : traduit dans la langue d'ÉCRITURE");
    assert.equal(page.racinePanneau().querySelector(".what").textContent, "Write in");
    assert.equal(page.racinePanneau().querySelector(".out").textContent, "[traduit] " + selectionne);

    // le clic dans le panneau fait perdre la sélection du champ : Replace la retrouve quand même
    t.setSelectionRange(0, 0);
    page.racinePanneau().querySelector(".replace").click();
    assert.equal(t.value, "Bonjour a tous, [traduit] " + selectionne + " pour vous.", "seule la partie sélectionnée est remplacée");
    assert.equal(page.panneau().style.display, "none", "le panneau se ferme après le remplacement");
  } finally { page.w.close(); }
});

test("changer de langue dans le panneau retraduit la sélection du champ", { skip: ignorer }, async () => {
  const page = creerPage();
  try {
    const t = page.doc.getElementById("t");
    t.focus(); t.setSelectionRange(0, 7); // « Bonjour »
    page.relacher();
    await attendre(40);
    page.bulle().shadowRoot.querySelector("button").click();
    await attendre(40);
    const avant = page.envoyes.filter((m) => m.action === "llmLive").length;
    const liste = page.racinePanneau().querySelector(".lang");
    liste.value = "fr";
    liste.dispatchEvent(new page.w.Event("change"));
    await attendre(40);
    const demandes = page.envoyes.filter((m) => m.action === "llmLive");
    assert.ok(demandes.length > avant, "nouvelle traduction demandée");
    assert.equal(demandes.at(-1).targetLanguage, "fr");
    assert.equal(demandes.at(-1).text, "Bonjour");
    assert.deepEqual(page.enregistres.at(-1), ["writeLanguage", "fr"], "sur du texte écrit, on change la langue d'écriture");
    assert.ok(!page.enregistres.some(([k]) => k === "targetLanguage"), "la langue de lecture n'est pas touchée");
  } finally { page.w.close(); }
});

test("pas de bulle : champ de mot de passe, sélection trop courte, bulle désactivée ; elle disparaît quand la sélection disparaît", { skip: ignorer }, async () => {
  const page = creerPage();
  try {
    const mdp = page.doc.getElementById("mdp");
    mdp.focus(); mdp.setSelectionRange(0, 10);
    page.relacher();
    await attendre(40);
    assert.ok(!page.bulle(), "jamais de bulle sur un mot de passe");

    const t = page.doc.getElementById("t");
    t.focus(); t.setSelectionRange(0, 1);
    page.relacher();
    await attendre(40);
    assert.ok(!page.bulle(), "un seul caractère : pas de bulle");

    t.setSelectionRange(0, 7);
    page.relacher();
    await attendre(40);
    assert.ok(page.bulle(), "sélection suffisante : bulle");
    t.setSelectionRange(3, 3); // la sélection disparaît
    page.doc.dispatchEvent(new page.w.Event("selectionchange"));
    await attendre(20);
    assert.ok(!page.bulle(), "la bulle disparaît avec la sélection");
  } finally { page.w.close(); }
});

test("bulle désactivée dans le menu : rien n'apparaît", { skip: ignorer }, async () => {
  const page = creerPage({ afficherBulle: "no" });
  try {
    const t = page.doc.getElementById("t");
    t.focus(); t.setSelectionRange(0, 7);
    page.relacher();
    await attendre(40);
    assert.ok(!page.bulle());
  } finally { page.w.close(); }
});

test("changer de langue sur du texte affiché change la langue de lecture, pas celle d'écriture", { skip: ignorer }, async () => {
  const page = creerPage();
  try {
    const texte = page.doc.getElementById("p").firstChild;
    const r = page.doc.createRange(); r.setStart(texte, 0); r.setEnd(texte, 7);
    page.w.getSelection().removeAllRanges(); page.w.getSelection().addRange(r);
    page.relacher();
    await attendre(40);
    page.bulle().shadowRoot.querySelector("button").click();
    await attendre(40);
    const liste = page.racinePanneau().querySelector(".lang");
    liste.value = "en";
    liste.dispatchEvent(new page.w.Event("change"));
    await attendre(40);
    assert.deepEqual(page.enregistres.filter(([k]) => k === "targetLanguage").at(-1), ["targetLanguage", "en"]);
    assert.ok(!page.enregistres.some(([k]) => k === "writeLanguage"));
  } finally { page.w.close(); }
});
