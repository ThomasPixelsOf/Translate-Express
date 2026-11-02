// Pages en plusieurs langues : les blocs de texte déjà écrits dans la langue cible ne sont pas retraduits.
// (Le traducteur de TWP envoyait tout, en laissant le service deviner la langue de chaque bloc : du temps et des appels
// perdus, et avec une IA le risque de voir le français reformulé.)
// La langue de chaque bloc est détectée localement par le navigateur (chrome.i18n.detectLanguage), sans réseau.

var twpSkip = (function () {
  const MIN_CHARS = 25; // en dessous, la détection n'est pas fiable : le bloc est traduit normalement
  const MIN_SHARE = 70; // part minimale (en %) de la langue détectée dans le bloc

  const base = (code) => String(code).split("-")[0].toLowerCase();

  // « pt » et « pt-PT » sont la même langue pour ce filtre ; le chinois simplifié et traditionnel ne le sont pas.
  function sameLanguage(a, b, fix) {
    const x = fix(a) || a;
    const y = fix(b) || b;
    if (!x || !y) return false;
    if (x === y) return true;
    return base(x) === base(y) && base(x) !== "zh";
  }

  /**
   * @param {Array<string[]>} sourceArray2d blocs de texte (chaque bloc = liste de morceaux)
   * @param {string} targetLanguage
   * @param {(text: string) => Promise<{isReliable: boolean, languages: Array<{language: string, percentage: number}>}>} detect
   * @param {(code: string) => string | undefined} fix normalisation des codes de langue (twpLang.fixTLanguageCode)
   * @returns {Promise<boolean[]>} true quand le bloc est déjà dans la langue cible
   */
  async function alreadyInTarget(sourceArray2d, targetLanguage, detect, fix = (c) => c) {
    return await Promise.all(
      sourceArray2d.map(async (block) => {
        // Un bloc de plusieurs morceaux (texte coupé par des balises, des sauts de ligne...) peut mélanger deux langues :
        // la détection globale donnerait la langue majoritaire et le reste ne serait jamais traduit. On ne filtre donc que
        // les blocs d'un seul morceau ; les autres sont envoyés (le traducteur laisse tel quel ce qui est déjà dans la langue cible).
        if (block.length !== 1) return false;
        const text = block.join(" ").trim();
        if (text.length < MIN_CHARS) return false;
        try {
          const result = await detect(text);
          const top = result && result.isReliable && result.languages && result.languages[0];
          return !!top && top.percentage >= MIN_SHARE && sameLanguage(top.language, targetLanguage, fix);
        } catch (e) {
          return false;
        }
      }),
    );
  }

  // Détecteur du navigateur, sous forme de promesse (absent : rien n'est filtré).
  function browserDetect(text) {
    return new Promise((resolve) => {
      try {
        if (!chrome.i18n || !chrome.i18n.detectLanguage) return resolve(null);
        chrome.i18n.detectLanguage(text, (result) => {
          void chrome.runtime.lastError;
          resolve(result || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  /**
   * Traduit uniquement les blocs qui ne sont pas déjà dans la langue cible ; les autres sont rendus tels quels.
   * @param {(blocks: Array<string[]>) => Promise<Array<string[]>>} translateBlocks
   */
  async function translateSkippingTarget(sourceArray2d, targetLanguage, translateBlocks, detect = browserDetect, fix) {
    const already = await alreadyInTarget(sourceArray2d, targetLanguage, detect, fix);
    const toTranslate = sourceArray2d.filter((_, i) => !already[i]);
    if (toTranslate.length === sourceArray2d.length) return await translateBlocks(sourceArray2d);
    const translated = toTranslate.length ? await translateBlocks(toTranslate) : [];
    let next = 0;
    return sourceArray2d.map((block, i) => (already[i] ? [...block] : translated[next++]));
  }

  return { alreadyInTarget, translateSkippingTarget, browserDetect, _sameLanguage: sameLanguage };
})();

if (typeof module !== "undefined") module.exports = twpSkip;
