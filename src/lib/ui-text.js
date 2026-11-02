"use strict";

// Texts of the extension's own interface, in the language chosen in the settings ("uiLanguage"; "default" = the browser's
// language when it is available, otherwise English). Each language is a file lib/ui/<code>.js that registers its texts;
// adding a language = adding one file (and listing it where the scripts are loaded).
//
// Loaded everywhere the interface shows text: service worker (menu), content scripts (panel), popup pages.
// The texts are plain JavaScript, so no file is fetched: it also works on pages with a strict Content Security Policy.
var twpUi = (function () {
  const messages = {}; // language code -> { key: text }
  const names = {}; // language code -> name in its own language

  /**
   * @param {string} code language code, lower case ("en", "fr", "pt-br"...)
   * @param {string} name the language's own name ("English", "Français"...)
   * @param {Object<string,string>} texts
   */
  function register(code, name, texts) {
    messages[code.toLowerCase()] = texts;
    names[code.toLowerCase()] = name;
  }

  function browserLanguage() {
    try {
      return String(chrome.i18n.getUILanguage() || "en").toLowerCase();
    } catch (e) {
      return "en";
    }
  }

  /** The language in use now. */
  function language() {
    let chosen = "default";
    try {
      chosen = String(twpConfig.get("uiLanguage") || "default").toLowerCase();
    } catch (e) {
      /* configuration not ready yet */
    }
    if (chosen !== "default" && messages[chosen]) return chosen;
    const browser = browserLanguage();
    if (messages[browser]) return browser;
    const base = browser.split("-")[0];
    return messages[base] ? base : "en";
  }

  /**
   * The text for a key in the current language (English when it is missing there), with $1, $2... replaced.
   * @param {string} key
   * @param {...(string|number)} substitutions
   */
  function t(key, ...substitutions) {
    const own = messages[language()] || {};
    let text = own[key] !== undefined ? own[key] : messages.en && messages.en[key] !== undefined ? messages.en[key] : key;
    substitutions.forEach((value, i) => {
      text = text.split("$" + (i + 1)).join(String(value));
    });
    return text;
  }

  /** Fills every element marked with data-ui (text), data-ui-title, data-ui-placeholder or data-ui-aria (attributes). */
  function translateDocument(root = document) {
    for (const el of root.querySelectorAll("[data-ui]")) el.textContent = t(el.getAttribute("data-ui"));
    for (const [attr, target] of [["data-ui-title", "title"], ["data-ui-placeholder", "placeholder"], ["data-ui-aria", "aria-label"]]) {
      for (const el of root.querySelectorAll("[" + attr + "]")) el.setAttribute(target, t(el.getAttribute(attr)));
    }
    if (root === document && document.documentElement && document.body && document.body.hasAttribute("data-ui-document-title")) {
      document.title = t(document.body.getAttribute("data-ui-document-title"));
    }
  }

  /** The available languages: [{ code, name }]. */
  function languages() {
    return Object.keys(messages)
      .sort()
      .map((code) => ({ code, name: names[code] }));
  }

  return { register, t, language, languages, translateDocument, _messages: messages };
})();

if (typeof module !== "undefined") module.exports = twpUi;
