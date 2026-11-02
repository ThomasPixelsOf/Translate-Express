"use strict";

const twpConfig = (function () {
  /** @type {function[]} */
  const observers = [];
  // Settings holding secrets (the API key lives in customServices). Scripts injected in web pages never load them
  // nor write them: only the service worker and the extension's own pages need the key.
  const SECRET_KEYS = ["customServices"];
  const inWebPage = typeof location !== "undefined" && /^(https?|file|ftp):$/.test(location.protocol);
  /**
   * all configName available
   * @typedef {"uiLanguage" | "pageTranslatorService" | "enabledServices" | "targetLanguage" | "targetLanguageChosen" | "targetLanguageFixed" | "writeLanguage" | "diagnostics" | "showTranslateSelectedButton" | "useAlternativeService" | "customServices"} DefaultConfigNames
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
    showTranslateSelectedButton: "yes",
    useAlternativeService: "yes",
    customServices: [],
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
   * twpConfig.get("targetLanguage")
   * // returns "fr"
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
    obj[name] = value;
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
            config[name] = newValue;
            observers.forEach((callback) => callback(name, newValue));
          }
        }
      }
    });
  });

  // load config
  // In a web page, ask only for the non-secret settings: the key is never even read there.
  const wanted = inWebPage ? Object.keys(defaultConfig).filter((k) => !SECRET_KEYS.includes(k)) : null;
  chrome.storage.local.get(wanted, (onGot) => {
    for (const name in onGot) {
      config[name] = onGot[name];
    }

    // Target language: a valid one chosen by the user is always kept; only a missing or invalid one is replaced by the default.
    config.targetLanguage = twpLang.fixTLanguageCode(config.targetLanguage) || defaultConfig.targetLanguage;
    readyConfig();
  });

  return twpConfig;
})();
