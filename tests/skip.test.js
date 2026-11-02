// Tests du filtre « déjà dans la langue cible » (src/background/skipTargetLanguage.js), sans navigateur ni réseau.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const twpSkip = require("../src/background/skipTargetLanguage.js");

// Faux détecteur : reconnaît quelques mots, comme le ferait le détecteur du navigateur.
const FR = "Bonjour tout le monde, ceci est un paragraphe écrit en français.";
const EN = "Hello everyone, this is a paragraph written in English language.";
const detect = async (text) => {
  if (/bonjour|français|voici/i.test(text)) return { isReliable: true, languages: [{ language: "fr", percentage: 98 }] };
  if (/hello|english/i.test(text)) return { isReliable: true, languages: [{ language: "en", percentage: 96 }] };
  return { isReliable: false, languages: [{ language: "fr", percentage: 40 }] };
};

test("les blocs déjà dans la langue cible sont repérés, les autres non", async () => {
  const res = await twpSkip.alreadyInTarget([[FR], [EN], ["Accueil"], ["Texte incertain sans mot reconnu, assez long pour être testé"]], "fr", detect);
  assert.deepEqual(res, [true, false, false, false]); // court : traduit ; non fiable : traduit
});

test("la comparaison ignore la région (pt et pt-PT) mais distingue le chinois simplifié et traditionnel", () => {
  const s = twpSkip._sameLanguage;
  assert.equal(s("pt", "pt-PT", (c) => c), true);
  assert.equal(s("fr", "en", (c) => c), false);
  assert.equal(s("zh-CN", "zh-TW", (c) => c), false);
  assert.equal(s("zh-CN", "zh-CN", (c) => c), true);
});

test("une page mixte : seul l'anglais part au moteur, le français revient tel quel et l'ordre est conservé", async () => {
  const envoyes = [];
  const moteur = async (blocks) => {
    envoyes.push(blocks);
    return blocks.map((b) => b.map((s) => "[traduit] " + s));
  };
  const page = [[FR], [EN], [FR + " Suite."], ["Hello English", "second morceau English"]];
  const out = await twpSkip.translateSkippingTarget(page, "fr", moteur, detect);
  assert.deepEqual(envoyes, [[[EN], ["Hello English", "second morceau English"]]], "le français n'est pas envoyé");
  assert.deepEqual(out, [[FR], ["[traduit] " + EN], [FR + " Suite."], ["[traduit] Hello English", "[traduit] second morceau English"]]);
});

test("une page entièrement dans la langue cible n'appelle pas le moteur", async () => {
  let appels = 0;
  const out = await twpSkip.translateSkippingTarget([[FR], [FR + " Autre."]], "fr", async () => { appels++; return []; }, detect);
  assert.equal(appels, 0);
  assert.deepEqual(out, [[FR], [FR + " Autre."]]);
});

test("sans détection possible, tout est traduit comme avant", async () => {
  const out = await twpSkip.translateSkippingTarget([[FR], [EN]], "fr", async (b) => b.map((x) => x.map((s) => "T" + s)), async () => null);
  assert.deepEqual(out, [["T" + FR], ["T" + EN]]);
  const echec = await twpSkip.translateSkippingTarget([[FR]], "fr", async (b) => b.map((x) => x.map((s) => "T" + s)), async () => { throw new Error("panne"); });
  assert.deepEqual(echec, [["T" + FR]]);
});

test("un bloc qui contient un peu d'anglais dans du français est considéré comme français", async () => {
  const melange = async () => ({ isReliable: true, languages: [{ language: "fr", percentage: 85 }, { language: "en", percentage: 15 }] });
  assert.deepEqual(await twpSkip.alreadyInTarget([[FR]], "fr", melange), [true]);
  const incertain = async () => ({ isReliable: true, languages: [{ language: "fr", percentage: 55 }, { language: "en", percentage: 45 }] });
  assert.deepEqual(await twpSkip.alreadyInTarget([[FR]], "fr", incertain), [false], "moitié-moitié : on traduit");
});
