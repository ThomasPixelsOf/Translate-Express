"use strict";

// Languages: the codes the extension can translate into, their names, and which translation service handles which.
const twpLang = (function () {
  // The target languages: those of Google Translate.
  const LANGUAGE_CODES = [
    "aa", "ab", "ace", "ach", "af", "ak", "alz", "am", "ar", "as", "av", "awa",
    "ay", "az", "ba", "bal", "ban", "bbc", "bci", "be", "bem", "ber", "ber-Latn", "bew",
    "bg", "bho", "bik", "bm", "bm-Nkoo", "bn", "bo", "br", "brx", "bs", "bts", "btx",
    "bua", "ca", "ce", "ceb", "cgg", "ch", "chk", "chm", "ckb", "cnh", "co", "crh",
    "crh-Latn", "crs", "cs", "cv", "cy", "da", "de", "din", "doi", "dov", "dsb", "dv",
    "dyu", "dz", "ee", "el", "en", "eo", "es", "es-MX", "et", "eu", "fa", "ff",
    "fi", "fj", "fo", "fon", "fr", "fr-CA", "fur", "fy", "ga", "gaa", "gd", "gl",
    "gn", "gom", "gu", "gv", "ha", "haw", "he", "hi", "hil", "hmn", "hne", "hr",
    "hrx", "hsb", "ht", "hu", "hy", "iba", "id", "ig", "ikt", "ilo", "is", "it",
    "iu", "iu-Latn", "ja", "jam", "jv", "ka", "kac", "kazlat", "kek", "kg", "kha", "kk",
    "kl", "km", "kn", "ko", "kr", "kri", "ks", "ktu", "ku", "kv", "ky", "la",
    "lb", "lg", "li", "lij", "lmo", "ln", "lo", "lt", "ltg", "lua", "luo", "lus",
    "lv", "lzh", "mad", "mai", "mak", "mam", "mfe", "mg", "mh", "mhr", "mi", "min",
    "mk", "ml", "mn", "mn-Mong", "mni-Mtei", "mr", "mrj", "ms", "ms-Arab", "mt", "mwr", "my",
    "ndc-ZW", "ne", "new", "nhe", "nl", "no", "nr", "nso", "nus", "ny", "nya", "oc",
    "om", "or", "os", "otq", "pa", "pa-Arab", "pag", "pam", "pap", "pl", "prs", "ps",
    "pt", "pt-PT", "qu", "rn", "ro", "rom", "ru", "run", "rw", "sa", "sah", "sat",
    "sat-Latn", "scn", "sd", "se", "sg", "shn", "si", "sjn", "sk", "sl", "sm", "sn",
    "so", "sq", "sr", "sr-Latn", "ss", "st", "su", "sus", "sv", "sw", "szl", "ta",
    "tcy", "te", "tet", "tg", "th", "ti", "tiv", "tk", "tl", "tlh-Latn", "tlh-Piqd", "tn",
    "to", "tpi", "tr", "trp", "ts", "tt", "tum", "ty", "tyv", "udm", "ug", "uk",
    "ur", "uz", "uzbcyr", "ve", "vec", "vi", "war", "wo", "xh", "yi", "yo", "yua",
    "yue", "zap", "zh-CN", "zh-TW", "zu",
  ];

  // The names come from the browser (Intl.DisplayNames), in the interface language. These are the codes the browser cannot
  // name, plus the two Chinese ones, whose browser names ("Chinese (China)") are less clear than "Simplified" and
  // "Traditional". Written in English and in French; any other interface language shows the English name for them.
  const NAME_OVERRIDES = {
    en: {
      "zh-CN": "Chinese (Simplified)",
      "zh-TW": "Chinese (Traditional)",
      alz: "Alur",
      bci: "Baoulé",
      ber: "Tamazight (Tifinagh)",
      "ber-Latn": "Tamazight",
      bts: "Batak Simalungun",
      btx: "Batak Karo",
      cnh: "Hakha Chin",
      dov: "Dombe",
      hne: "Chhattisgarhi",
      hrx: "Hunsrik",
      kazlat: "Kazakh (Latin)",
      ktu: "Kituba",
      mam: "Mam",
      "ndc-ZW": "Ndau",
      nhe: "Nahuatl (Eastern Huasteca)",
      otq: "Querétaro Otomi",
      sjn: "Elvish (Sindarin)",
      trp: "Kokborok",
      uzbcyr: "Uzbek (Cyrillic)",
      yua: "Yucatec Maya",
    },
    fr: {
      "zh-CN": "chinois (simplifié)",
      "zh-TW": "chinois (traditionnel)",
      alz: "alur",
      bci: "baoulé",
      ber: "tamazight (tifinagh)",
      "ber-Latn": "tamazight",
      bts: "batak simalungun",
      btx: "batak karo",
      cnh: "hakha chin",
      dov: "dombe",
      fon: "fon",
      hne: "chhattisgarhi",
      hrx: "hunsrik",
      kazlat: "kazakh (latin)",
      kek: "q'eqchi'",
      ktu: "kituba",
      luo: "luo",
      mam: "mam",
      "ndc-ZW": "ndau",
      nhe: "nahuatl (huasteca oriental)",
      otq: "otomi de querétaro",
      sjn: "elfique (sindarin)",
      tiv: "tiv",
      trp: "kok borok",
      uzbcyr: "ouzbek (cyrillique)",
      yua: "maya yucatèque",
    },
  };

  const twpLang = {};

  twpLang.TargetLanguages = LANGUAGE_CODES;

  twpLang.SupportedLanguages = {
    google: [
      "ab", "ace", "ach", "aa", "af", "sq", "alz", "am", "ar", "hy", "as", "av",
      "awa", "ay", "az", "ban", "bal", "bm", "bci", "ba", "eu", "btx", "bts", "bbc",
      "be", "bem", "bn", "bew", "bho", "bik", "bs", "br", "bg", "bua", "yue", "ca",
      "ceb", "ch", "ce", "ny", "zh-CN", "zh-TW", "chk", "cv", "co", "crh", "crh-Latn", "hr",
      "cs", "da", "prs", "dv", "din", "doi", "dov", "nl", "dyu", "dz", "en", "eo",
      "et", "ee", "fo", "fj", "tl", "fi", "fon", "fr", "fr-CA", "fy", "fur", "ff",
      "gaa", "gl", "ka", "de", "el", "gn", "gu", "ht", "cnh", "ha", "haw", "he",
      "hil", "hi", "hmn", "hu", "hrx", "iba", "is", "ig", "ilo", "id", "iu-Latn", "iu",
      "ga", "it", "jam", "ja", "jv", "kac", "kl", "kn", "kr", "pam", "kk", "kha",
      "km", "cgg", "kg", "rw", "ktu", "trp", "kv", "gom", "ko", "kri", "ku", "ckb",
      "ky", "lo", "ltg", "la", "lv", "lij", "li", "ln", "lt", "lmo", "lg", "luo",
      "lb", "mk", "mad", "mai", "mak", "mg", "ms", "ms-Arab", "ml", "mt", "mam", "gv",
      "mi", "mr", "mh", "mwr", "mfe", "chm", "mni-Mtei", "min", "lus", "mn", "my", "nhe",
      "ndc-ZW", "nr", "new", "ne", "bm-Nkoo", "no", "nus", "oc", "or", "om", "os", "pag",
      "pap", "ps", "fa", "pl", "pt", "pt-PT", "pa", "pa-Arab", "qu", "kek", "rom", "ro",
      "rn", "ru", "se", "sm", "sg", "sa", "sat-Latn", "sat", "gd", "nso", "sr", "st",
      "crs", "shn", "sn", "scn", "szl", "sd", "si", "sk", "sl", "so", "es", "es-MX",
      "su", "sus", "sw", "ss", "sv", "ty", "tg", "ber-Latn", "ber", "ta", "tt", "te",
      "tet", "th", "bo", "ti", "tiv", "tpi", "to", "lua", "ts", "tn", "tcy", "tum",
      "tr", "tk", "tyv", "ak", "udm", "uk", "ur", "ug", "uz", "ve", "vec", "vi",
      "war", "cy", "wo", "xh", "sah", "yi", "yo", "yua", "zap", "zu",
    ],
    // A language model can translate into every language we offer.
    llm: LANGUAGE_CODES.slice(),
  };

  const namesCache = {};

  /**
   * The names of the languages, in the interface language: { code: name }.
   * @returns {Object<string,string>}
   */
  twpLang.getLanguageList = function () {
    const chosen = twpConfig.get("uiLanguage");
    const uiLanguage = (chosen && chosen !== "default" ? chosen : chrome.i18n.getUILanguage()) || "en";
    if (namesCache[uiLanguage]) return namesCache[uiLanguage];

    const displayNamesFor = (locale) => {
      try {
        return new Intl.DisplayNames([locale], { type: "language" });
      } catch (e) {
        return null;
      }
    };
    const displayNames = displayNamesFor(uiLanguage);
    const englishNames = displayNamesFor("en"); // for the codes the interface language's names do not cover
    const overrides = NAME_OVERRIDES[uiLanguage.split("-")[0].toLowerCase()] || {}; // only the languages written above have their own
    const names = {};
    for (const code of LANGUAGE_CODES) {
      let name = overrides[code];
      if (!name && displayNames) {
        try {
          name = displayNames.of(code);
        } catch (e) {
          name = null;
        }
      }
      if (!name || name === code) name = NAME_OVERRIDES.en[code] || (englishNames && englishNames.of(code));
      names[code] = name || code;
    }
    namesCache[uiLanguage] = names;
    return names;
  };

  const FREQUENT_LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "nl", "ru", "ja", "zh-CN", "ko", "ar", "tr", "pl"];

  /**
   * Fills a dropdown: "Detect language" (optional), then the common languages, then all the languages sorted from A to Z
   * for the interface language. A language name shared by two codes is listed once. The options have explicit colors:
   * readable on light and dark backgrounds.
   * @param {HTMLSelectElement} select
   * @param {{auto?: boolean}} options
   */
  twpLang.fillLanguageSelect = function (select, options = {}) {
    const names = twpLang.getLanguageList();
    const known = twpLang.TargetLanguages.filter((code) => names[code]);
    const collator = new Intl.Collator(chrome.i18n.getUILanguage());
    const doc = select.ownerDocument;
    const add = (parent, value, label) => {
      const o = doc.createElement("option");
      o.value = value;
      o.textContent = label;
      parent.appendChild(o);
    };
    select.textContent = "";
    if (options.auto) add(select, "auto", "Detect language");
    const frequent = doc.createElement("optgroup");
    frequent.label = "Frequent languages";
    for (const code of FREQUENT_LANGUAGES) if (known.includes(code)) add(frequent, code, names[code]);
    select.appendChild(frequent);
    const all = doc.createElement("optgroup");
    all.label = "All languages (A-Z)";
    const listedNames = new Set();
    for (const code of [...known].sort((a, b) => collator.compare(names[a], names[b]))) {
      if (listedNames.has(names[code])) continue;
      listedNames.add(names[code]);
      add(all, code, names[code]);
    }
    select.appendChild(all);
  };

  /**
   * The service that will translate into `lang`: the one asked for if it supports the language, otherwise nothing.
   * @param {string} lang
   * @param {string} serviceName
   * @returns {string|null}
   */
  twpLang.getAlternativeService = function (lang, serviceName) {
    lang = twpLang.fixTLanguageCode(lang);
    const supported = twpLang.SupportedLanguages[serviceName];
    return supported && supported.indexOf(lang) !== -1 ? serviceName : null;
  };

  /**
   * The name of a language code, in the interface language ("und" = unknown).
   * @example
   * twpLang.codeToLanguage("de") // "German"
   */
  twpLang.codeToLanguage = function (langCode) {
    if (langCode === "und") {
      return typeof twpUi !== "undefined" ? twpUi.t("languageUnknown") : "Unknown";
    }
    langCode = twpLang.fixTLanguageCode(langCode);
    return langCode ? twpLang.getLanguageList()[langCode] : "";
  };

  /**
   * Normalizes a language code to one of ours (the region is dropped when only the language is known), or undefined.
   * @param {string} langCode
   * @returns {string|undefined}
   */
  twpLang.fixTLanguageCode = function (langCode) {
    if (typeof langCode !== "string") return;

    if (langCode === "zh") return "zh-CN";
    if (langCode === "zh-Hant") return "zh-TW";
    if (langCode === "iw") return "he";
    if (langCode === "jw") return "jv";

    if (LANGUAGE_CODES.indexOf(langCode) === -1) {
      if (langCode.indexOf("-") === -1) return;
      langCode = langCode.split("-")[0];
      if (LANGUAGE_CODES.indexOf(langCode) === -1) return;
    }
    return langCode;
  };

  return twpLang;
})();
