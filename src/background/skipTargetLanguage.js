// Multilingual pages: blocks of text already written in the target language are not translated again.
// (TWP's translator sent everything, letting the service guess the language of each block: wasted time and calls,
// and with an AI the risk of seeing French reworded.)
// The language of each block is detected locally by the browser (chrome.i18n.detectLanguage), without network.

var twpSkip = (function () {
  const MIN_CHARS = 25; // below this, detection is not reliable: the block is translated normally
  const MIN_SHARE = 70; // minimum share (in %) of the detected language in the block

  const base = (code) => String(code).split("-")[0].toLowerCase();

  // "pt" and "pt-PT" are the same language for this filter; Simplified and Traditional Chinese are not.
  function sameLanguage(a, b, fix) {
    const x = fix(a) || a;
    const y = fix(b) || b;
    if (!x || !y) return false;
    if (x === y) return true;
    return base(x) === base(y) && base(x) !== "zh";
  }

  /**
   * @param {Array<string[]>} sourceArray2d text blocks (each block = list of pieces)
   * @param {string} targetLanguage
   * @param {(text: string) => Promise<{isReliable: boolean, languages: Array<{language: string, percentage: number}>}>} detect
   * @param {(code: string) => string | undefined} fix normalization of language codes (twpLang.fixTLanguageCode)
   * @returns {Promise<boolean[]>} true when the block is already in the target language
   */
  async function alreadyInTarget(sourceArray2d, targetLanguage, detect, fix = (c) => c) {
    return await Promise.all(
      sourceArray2d.map(async (block) => {
        // A block of several pieces (text cut by tags, line breaks...) can mix two languages:
        // global detection would give the majority language and the rest would never be translated. So only
        // single-piece blocks are filtered; the others are sent (the translator leaves as is what is already in the target language).
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

  // Browser detector, as a promise (absent: nothing is filtered).
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
   * Translates only the blocks that are not already in the target language; the others are returned as they are.
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
