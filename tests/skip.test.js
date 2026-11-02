// Tests of the "already in the target language" filter (src/background/skipTargetLanguage.js), without browser or network.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const twpSkip = require("../src/background/skipTargetLanguage.js");

// Fake detector: recognizes a few words, as the browser's detector would.
const FR = "Bonjour tout le monde, ceci est un paragraphe écrit en français.";
const EN = "Hello everyone, this is a paragraph written in English language.";
const detect = async (text) => {
  if (/bonjour|français|voici/i.test(text)) return { isReliable: true, languages: [{ language: "fr", percentage: 98 }] };
  if (/hello|english/i.test(text)) return { isReliable: true, languages: [{ language: "en", percentage: 96 }] };
  return { isReliable: false, languages: [{ language: "fr", percentage: 40 }] };
};

test("blocks already in the target language are spotted, the others are not", async () => {
  const res = await twpSkip.alreadyInTarget([[FR], [EN], ["Accueil"], ["Texte uncertain sans mot reconnu, assez long pour être testé"]], "fr", detect);
  assert.deepEqual(res, [true, false, false, false]); // short: translated; unreliable: translated
});

test("the comparison ignores the region (pt and pt-PT) but tells Simplified and Traditional Chinese apart", () => {
  const s = twpSkip._sameLanguage;
  assert.equal(s("pt", "pt-PT", (c) => c), true);
  assert.equal(s("fr", "en", (c) => c), false);
  assert.equal(s("zh-CN", "zh-TW", (c) => c), false);
  assert.equal(s("zh-CN", "zh-CN", (c) => c), true);
});

test("a mixed page: only English goes to the engine, French comes back as is and the order is kept", async () => {
  const sentMessages = [];
  const engine = async (blocks) => {
    sentMessages.push(blocks);
    return blocks.map((b) => b.map((s) => "[translated] " + s));
  };
  const page = [[FR], [EN], [FR + " Suite."], ["Hello English", "second morceau English"]];
  const out = await twpSkip.translateSkippingTarget(page, "fr", engine, detect);
  assert.deepEqual(sentMessages, [[[EN], ["Hello English", "second morceau English"]]], "French is not sent");
  assert.deepEqual(out, [[FR], ["[translated] " + EN], [FR + " Suite."], ["[translated] Hello English", "[translated] second morceau English"]]);
});

test("a page entirely in the target language does not call the engine", async () => {
  let calls = 0;
  const out = await twpSkip.translateSkippingTarget([[FR], [FR + " Autre."]], "fr", async () => { calls++; return []; }, detect);
  assert.equal(calls, 0);
  assert.deepEqual(out, [[FR], [FR + " Autre."]]);
});

test("without possible detection, everything is translated as before", async () => {
  const out = await twpSkip.translateSkippingTarget([[FR], [EN]], "fr", async (b) => b.map((x) => x.map((s) => "T" + s)), async () => null);
  assert.deepEqual(out, [["T" + FR], ["T" + EN]]);
  const failure = await twpSkip.translateSkippingTarget([[FR]], "fr", async (b) => b.map((x) => x.map((s) => "T" + s)), async () => { throw new Error("panne"); });
  assert.deepEqual(failure, [["T" + FR]]);
});

test("a block with a little English inside French is considered French", async () => {
  const mixed = async () => ({ isReliable: true, languages: [{ language: "fr", percentage: 85 }, { language: "en", percentage: 15 }] });
  assert.deepEqual(await twpSkip.alreadyInTarget([[FR]], "fr", mixed), [true]);
  const uncertain = async () => ({ isReliable: true, languages: [{ language: "fr", percentage: 55 }, { language: "en", percentage: 45 }] });
  assert.deepEqual(await twpSkip.alreadyInTarget([[FR]], "fr", uncertain), [false], "half and half: it is translated");
});

test("a block of several pieces (French and English mixed) is never skipped: the English must not stay untranslated", async () => {
  const res = await twpSkip.alreadyInTarget([[FR, EN], [FR, FR + " Suite."], [FR]], "fr", detect);
  assert.deepEqual(res, [false, false, true], "only the single-piece French block is skipped");
  let sentMessages = 0;
  const out = await twpSkip.translateSkippingTarget([[FR, EN]], "fr", async (b) => { sentMessages++; return b.map((x) => x.map((s) => "T:" + s)); }, detect);
  assert.equal(sentMessages, 1);
  assert.deepEqual(out, [["T:" + FR, "T:" + EN]], "the mixed block is sent whole, the English is translated");
});
