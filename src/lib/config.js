"use strict";

const twpConfig = (function () {
  /** @type {function[]} */
  const observers = [];
  const defaultTargetLanguages = ["en", "es", "de"];
  // Settings holding secrets (the API key lives in customServices). Scripts injected in web pages never load them
  // nor write them: only the service worker and the extension's own pages need the key.
  const SECRET_KEYS = ["customServices"];
  const inWebPage = typeof location !== "undefined" && /^(https?|file|ftp):$/.test(location.protocol);
  /**
   * all configName available
   * @typedef {"uiLanguage" | "pageTranslatorService" | "enabledServices" | "targetLanguage" | "targetLanguageChosen" | "targetLanguageFixed" | "writeLanguage" | "diagnostics" | "targetLanguages" | "alwaysTranslateSites" | "neverTranslateSites" | "alwaysTranslateLangs" | "neverTranslateLangs" | "showTranslateSelectedButton" | "translateTag_pre" | "enableIframePageTranslation" | "translateDynamicallyCreatedContent" | "autoTranslateWhenClickingALink" | "enableDiskCache" | "useAlternativeService" | "customServices" | "proxyServers"} DefaultConfigNames
   */
  const defaultConfig = {
    uiLanguage: "default",
    pageTranslatorService: "google", // google yandex bing
    enabledServices: ["google"],
    targetLanguage: "fr", // default language; replaced only by a choice of the user
    // Two languages: the one you READ in (targetLanguage: pages and displayed text) and the one you WRITE in
    // (writeLanguage: text typed in a field, translated for the recipient).
    writeLanguage: "en",
    diagnostics: "yes", // journal de diagnostic (tableau de bord) ; "no" le coupe
    targetLanguageFixed: "no", // "yes" once the language was reset after an old default (one-time repair)
    targetLanguageChosen: "no", // "yes" as soon as the user chooses the language themselves: it is no longer detected
    targetLanguages: [], // "en", "es", "de"
    alwaysTranslateSites: [],
    neverTranslateSites: [],
    alwaysTranslateLangs: [],
    neverTranslateLangs: [],
    showTranslateSelectedButton: "yes",
    translateTag_pre: "yes",
    enableIframePageTranslation: "yes",
    translateDynamicallyCreatedContent: "yes",
    autoTranslateWhenClickingALink: "no",
    enableDiskCache: "no",
    useAlternativeService: "yes",
    customServices: [],
    proxyServers: {},
  };
  const config = structuredClone(defaultConfig);

  let onReadyObservers = [];
  let configIsReady = false;
  let onReadyResolvePromise;
  const onReadyPromise = new Promise(
    (resolve) => (onReadyResolvePromise = resolve)
  );

  /**
   * this function is executed when de config is ready
   */
  function readyConfig() {
    configIsReady = true;
    onReadyObservers.forEach((callback) => callback());
    onReadyObservers = [];
    onReadyResolvePromise();
  }

  const twpConfig = {};

  /**
   * create a listener to run when the settings are ready
   * @param {function} callback
   * @returns {Promise}
   */
  twpConfig.onReady = function (callback = null) {
    if (callback) {
      if (configIsReady) {
        callback();
      } else {
        onReadyObservers.push(callback);
      }
    }
    return onReadyPromise;
  };

  /**
   * get the value of a config
   * @example
   * twpConfig.get("targetLanguages")
   * // returns ["en", "es", "de"]
   * @param {DefaultConfigNames} name
   * @returns {*} value
   */
  twpConfig.get = function (name) {
    return config[name];
  };

  /**
   * set the value of a config
   * @example
   * twpConfig.set("diagnostics", "no")
   * @param {DefaultConfigNames} name
   * @param {*} value
   */
  twpConfig.set = function (name, value) {
    if (inWebPage && SECRET_KEYS.includes(name)) return;
    // @ts-ignore
    config[name] = value;
    const obj = {};
    obj[name] = toObjectOrArrayIfTypeIsMapOrSet(value);
    chrome.storage.local.set(obj);
    observers.forEach((callback) => callback(name, value));
  };

  /**
   * create a listener to run when a config changes
   * @param {function} callback
   */
  twpConfig.onChanged = function (callback) {
    observers.push(callback);
  };

  // listen to storage changes
  chrome.storage.onChanged.addListener((changes, areaName) => {
    twpConfig.onReady(function () {
      if (areaName === "local") {
        for (const name in changes) {
          if (inWebPage && SECRET_KEYS.includes(name)) continue;
          const newValue = changes[name].newValue;
          if (config[name] !== newValue) {
            config[name] = fixObjectType(name, newValue);
            observers.forEach((callback) => callback(name, newValue));
          }
        }
      }
    });
  });

  // load config
  chrome.i18n.getAcceptLanguages((acceptedLanguages) => {
    // In a web page, ask only for the non-secret settings: the key is never even read there.
    const wanted = inWebPage ? Object.keys(defaultConfig).filter((k) => !SECRET_KEYS.includes(k)) : null;
    chrome.storage.local.get(wanted, (onGot) => {
      // load config; convert object/array to map/set if necessary
      for (const name in onGot) {
        config[name] = fixObjectType(name, onGot[name]);
      }

      // if there are any targetLanguage undefined, replace them
      if (config.targetLanguages.some((tl) => !tl)) {
        config.targetLanguages = [...defaultTargetLanguages];
        chrome.storage.local.set({
          targetLanguages: config.targetLanguages,
        });
      }

      // Probably at this point it doesn't have 3 target languages.

      // try to get the 3 target languages through the user defined languages in the browser configuration.
      for (let lang of acceptedLanguages) {
        if (config.targetLanguages.length >= 3) break;
        lang = twpLang.fixTLanguageCode(lang);
        if (lang && config.targetLanguages.indexOf(lang) === -1) {
          config.targetLanguages.push(lang);
        }
      }

      // then try to use de array defaultTargetLanguages ["en", "es", "de"]
      for (const lang in defaultTargetLanguages) {
        if (config.targetLanguages.length >= 3) break;
        if (
          config.targetLanguages.indexOf(defaultTargetLanguages[lang]) === -1
        ) {
          config.targetLanguages.push(defaultTargetLanguages[lang]);
        }
      }

      // if targetLanguages is bigger than 3 remove the surplus
      while (config.targetLanguages.length > 3) config.targetLanguages.pop();

      /*
      // remove the duplicates languages
      config.targetLanguages = [... new Set(config.targetLanguages)]
      //*
      // then try to use de array defaultTargetLanguages ["en", "es", "de"]
      for (const lang of defaultTargetLanguages) {
        if (config.targetLanguages.length >= 3) break;
        if (config.targetLanguages.indexOf(lang) === -1) {
          config.targetLanguages.push(lang);
        }
      }
      //*/

      // Target language: only replaced if it does not exist. (Before: it was also replaced as soon as it
      // was not among the browser's first three languages, which cancelled any choice at every restart.)
      if (!config.targetLanguage) {
        config.targetLanguage = config.targetLanguages[0];
      }

      // fix targetLanguages
      config.targetLanguages = config.targetLanguages.map((lang) =>
        twpLang.fixTLanguageCode(lang)
      );
      // fix neverTranslateLangs
      config.neverTranslateLangs = config.neverTranslateLangs.map((lang) =>
        twpLang.fixTLanguageCode(lang)
      );
      // fix alwaysTranslateLangs
      config.alwaysTranslateLangs = config.alwaysTranslateLangs.map((lang) =>
        twpLang.fixTLanguageCode(lang)
      );
      // fix targetLanguage
      config.targetLanguage = twpLang.fixTLanguageCode(config.targetLanguage);

      // A valid language chosen by the user is kept, even outside the browser's three languages.
      if (!config.targetLanguage) {
        config.targetLanguage = config.targetLanguages[0];
      }
      readyConfig();
    });
  });

  /**
   * Add a new lang to the targetLanguages and remove the last target language. If the language is already in the targetLanguages then move it to the first position
   * @example
   * addTargetLanguage("de")
   * @param {string} lang - langCode
   * @returns
   */
  function addTargetLanguage(lang) {
    const targetLanguages = twpConfig.get("targetLanguages");
    lang = twpLang.fixTLanguageCode(lang);
    if (!lang) return;

    const index = targetLanguages.indexOf(lang);
    if (index === -1) {
      targetLanguages.unshift(lang);
      targetLanguages.pop();
    } else {
      targetLanguages.splice(index, 1);
      targetLanguages.unshift(lang);
    }

    twpConfig.set("targetLanguages", targetLanguages);
  }

  /**
   * set lang as target language for page translation only (not text translation)
   *
   * if the lang in not in targetLanguages then call addTargetLanguage
   * @example
   * twpConfig.setTargetLanguage("de",  true)
   * @param {string} lang - langCode
   * @param {boolean} forTextToo - also call setTargetLanguageTextTranslation
   * @returns
   */
  twpConfig.setTargetLanguage = function (lang, forTextToo = false) {
    const targetLanguages = twpConfig.get("targetLanguages");
    lang = twpLang.fixTLanguageCode(lang);
    if (!lang) return;

    if (targetLanguages.indexOf(lang) === -1 || forTextToo) {
      addTargetLanguage(lang);
    }

    twpConfig.set("targetLanguage", lang);

    if (forTextToo) {
      twpConfig.setTargetLanguageTextTranslation(lang);
    }
  };

  /**
   * convert object to map or set if necessary, otherwise return the value itself
   * @example
   * fixObjectType("customDictionary", {})
   * // returns Map
   * fixObjectType("targetLanguages", ["en", "es", "de"])
   * // return ["en", "es", "de"] -- Array
   * @param {string} key
   * @param {*} value
   * @returns {Map | Set | *}
   */
  function fixObjectType(key, value) {
    if (defaultConfig[key] instanceof Map) {
      return new Map(Object.entries(value));
    } else if (defaultConfig[key] instanceof Set) {
      return new Set(value);
    } else {
      return value;
    }
  }

  /**
   * convert map and set to object and array respectively, otherwise return the value itself
   * @example
   * toObjectOrArrayIfTypeIsMapOrSet(new Map())
   * // returns {}
   * toObjectOrArrayIfTypeIsMapOrSet({})
   * // returns {}
   * @param {Map | Set | *} value
   * @returns {Object | Array | *}
   */
  function toObjectOrArrayIfTypeIsMapOrSet(value) {
    if (value instanceof Map) {
      return Object.fromEntries(value);
    } else if (value instanceof Set) {
      return Array.from(value);
    } else {
      return value;
    }
  }

  return twpConfig;
})();
