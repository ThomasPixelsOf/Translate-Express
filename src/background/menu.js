"use strict";

// Right-click menu: the only entry point of the extension.
//   selected text           -> "Translate selection"   (panel near the selection)
//   input field             -> "Translate what I'm writing" (panel, with Replace)
//   page                    -> "Translate this page" / "Show original"
//   everywhere              -> "Message window" (write and see the translation live), "Groq key..."
// No settings: target language = browser language, source detected, AI if a Groq key is saved.

// Languages offered directly in the menu; the full list is in "Language and Groq key...".
const COMMON_LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "nl", "ru", "ja", "zh-CN", "ar"];

const MENU = {
  dashboard: "twp-dashboard",
  languagesRead: "twp-languages-read",
  languagesWrite: "twp-languages-write",
  lang: "twp-lang",
  write: "twp-write",
  bubble: "twp-bubble",
  selection: "twp-selection",
  field: "twp-field",
  page: "twp-page",
  composer: "twp-composer",
  key: "twp-key",
};

// The "page translated or not" state belongs to each tab: the tab concerned is asked (never remembered here,
// otherwise a tab would show the state of the previous tab).
function getTabPageState(tabId, callback) {
  if (!tabId) return callback("original");
  chrome.tabs.sendMessage(tabId, { action: "getCurrentPageLanguageState" }, { frameId: 0 }, (state) => {
    void chrome.runtime.lastError;
    callback(state === "translated" ? "translated" : "original");
  });
}

// Default language, as long as the user has not chosen their own: French.
// (Detecting the browser language does not work: a Brave in English with the languages "en,fr" gave English.)
const DEFAULT_TARGET_LANGUAGE = "fr";

function detectBrowserLanguage(done) {
  // One-time repair: an old default put the language back to English on every page, so the saved language is not
  // reliable. Start again from French; a choice made afterwards by the user is kept.
  if (twpConfig.get("targetLanguageFixed") !== "yes") {
    twpConfig.set("targetLanguageChosen", "no");
    twpConfig.set("targetLanguage", DEFAULT_TARGET_LANGUAGE);
    twpConfig.set("targetLanguageFixed", "yes");
  }
  if (twpConfig.get("targetLanguageChosen") !== "yes" && twpConfig.get("targetLanguage") !== DEFAULT_TARGET_LANGUAGE) {
    twpConfig.set("targetLanguage", DEFAULT_TARGET_LANGUAGE);
  }
  done();
}

function writeLanguage() {
  return twpConfig.get("writeLanguage") || "en";
}

function targetLanguage() {
  return twpConfig.get("targetLanguage") || twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) || "en";
}

// AI if a Groq key is saved, otherwise the free translator.
function pageService() {
  const llm = twpConfig.get("customServices").find((cs) => cs.name === "llm");
  return llm && llm.apiKey ? "llm" : "google";
}

function pageMenuTitle(state = "original") {
  return state === "translated"
    ? twpUi.t("menuShowOriginal")
    : twpUi.t("menuTranslatePage", twpLang.codeToLanguage(targetLanguage()));
}

// Only one build at a time: a second request made while one is running is replayed afterwards, otherwise both builds
// would create every entry ("Cannot create item with duplicate id").
let menusBuilding = false;
let menusDirty = false;

function createMenus() {
  if (menusBuilding) {
    menusDirty = true;
    return;
  }
  menusBuilding = true;
  const finished = () => {
    checkedLastError();
    menusBuilding = false;
    if (menusDirty) {
      menusDirty = false;
      createMenus();
    }
  };
  chrome.contextMenus.removeAll(() => {
    checkedLastError();
    chrome.contextMenus.create({ id: MENU.selection, title: twpUi.t("menuTranslateSelection"), contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.field, title: twpUi.t("menuTranslateField"), contexts: ["editable"] });
    chrome.contextMenus.create({
      id: MENU.page,
      title: pageMenuTitle(),
      contexts: ["page", "frame"],
      documentUrlPatterns: ["http://*/*", "https://*/*", "file://*/*"],
    });
    chrome.contextMenus.create({ id: MENU.composer, title: twpUi.t("menuComposer"), contexts: ["all"] });

    chrome.contextMenus.create({
      id: MENU.bubble,
      type: "checkbox",
      checked: twpConfig.get("showTranslateSelectedButton") !== "no",
      title: twpUi.t("menuShowLogo"),
      contexts: ["all"],
    });

    chrome.contextMenus.create({ id: MENU.dashboard, title: twpUi.t("menuDashboard"), contexts: ["all", "action"] });
    chrome.contextMenus.create({ id: MENU.key, title: twpUi.t("menuGroqKey"), contexts: ["all", "action"] });

    // Two languages: the one you READ in (pages, displayed text) and the one you WRITE in (typed text, translated
    // for the recipient). They are independent: read in French, write in English.
    const known = new Set(twpLang.TargetLanguages);
    const addLanguageMenu = (id, prefix, titleKey, current, moreId, done) => {
      const choices = [...new Set([current, ...COMMON_LANGUAGES])].filter((code) => known.has(code));
      chrome.contextMenus.create({ id, title: twpUi.t(titleKey, twpLang.codeToLanguage(current)), contexts: ["all"] });
      for (const code of choices) {
        chrome.contextMenus.create({
          id: prefix + code,
          parentId: id,
          type: "radio",
          checked: code === current,
          title: twpLang.codeToLanguage(code),
          contexts: ["all"],
        });
      }
      chrome.contextMenus.create({ id: moreId, parentId: id, title: twpUi.t("menuMoreLanguages"), contexts: ["all"] }, done);
    };
    addLanguageMenu(MENU.lang, "twp-lang-", "menuReadIn", targetLanguage(), MENU.languagesRead);
    addLanguageMenu(MENU.write, "twp-write-", "menuWriteIn", writeLanguage(), MENU.languagesWrite, finished); // the last entry created ends the build
    refreshMenuForActiveTab();
  });
}

function updatePageMenuTitle(state) {
  chrome.contextMenus.update(MENU.page, { title: pageMenuTitle(state) }, checkedLastError);
}

// Title of the "page" entry = state of the displayed tab.
function refreshMenuForTab(tabId) {
  getTabPageState(tabId, updatePageMenuTitle);
}
function refreshMenuForActiveTab(windowId) {
  const query = windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId };
  chrome.tabs.query(query, (tabs) => {
    void chrome.runtime.lastError;
    if (tabs && tabs[0]) refreshMenuForTab(tabs[0].id);
  });
}

// Everything opens in the toolbar popup, like a VPN extension: "translate" (message window), "settings" or "dashboard".
// A popup cannot take parameters, so the view to show is left in session storage for popup/popup.js.
async function openPopup(view, { focus, draft } = {}) {
  if (draft) await chrome.storage.local.set({ composerDraft: draft });
  await chrome.storage.session.set({ popupRequest: { view, focus } });
  try {
    await chrome.action.openPopup();
  } catch (e) {
    // openPopup is not available here (no focused window...): the same page in a small window.
    await chrome.windows.create({ url: chrome.runtime.getURL("/popup/popup.html"), type: "popup", width: 580, height: 620 });
  }
  // Popup already showing the message view: it takes the new text.
  if (draft) chrome.runtime.sendMessage({ action: "composerDraftUpdated" }, () => void chrome.runtime.lastError);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU.dashboard) return openPopup("dashboard");
  if (!tab) return;
  const frame = { frameId: info.frameId || 0 };
  if (info.menuItemId === MENU.selection) {
    chrome.tabs.sendMessage(tab.id, { action: "twpPanel", mode: "selection", text: info.selectionText || "" }, frame, checkedLastError);
  } else if (info.menuItemId === MENU.field) {
    chrome.tabs.sendMessage(tab.id, { action: "twpPanel", mode: "field" }, frame, checkedLastError);
  } else if (info.menuItemId === MENU.page) {
    // The whole page (all its frames): translate or go back to the original depending on the current state.
    getTabPageState(tab.id, (state) => {
      chrome.tabs.sendMessage(
        tab.id,
        state === "translated" ? { action: "restorePage" } : { action: "translatePage", targetLanguage: targetLanguage(), service: pageService() },
        checkedLastError
      );
    });
  } else if (info.menuItemId === MENU.composer) {
    openPopup("translate");
  } else if (info.menuItemId === MENU.bubble) {
    twpConfig.set("showTranslateSelectedButton", info.checked ? "yes" : "no");
  } else if (info.menuItemId === MENU.key) {
    openPopup("settings", { focus: "key" });
  } else if (info.menuItemId === MENU.languagesRead || info.menuItemId === MENU.languagesWrite) {
    openPopup("settings", { focus: "languages" });
  } else if (String(info.menuItemId).startsWith("twp-write-")) {
    twpConfig.set("writeLanguage", String(info.menuItemId).slice("twp-write-".length));
  } else if (String(info.menuItemId).startsWith("twp-lang-")) {
    // The menu is rebuilt by the configuration change callback below.
    twpConfig.set("targetLanguageChosen", "yes");
    twpConfig.set("targetLanguage", String(info.menuItemId).slice("twp-lang-".length));
  }
});

// Messages from page scripts (the page translator needs them to know the language and the tab state).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getMainFramePageLanguageState") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "getCurrentPageLanguageState" }, { frameId: 0 }, (state) => {
      checkedLastError();
      sendResponse(state);
    });
    return true;
  } else if (request.action === "getMainFrameTabLanguage") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "getOriginalTabLanguage" }, { frameId: 0 }, (language) => {
      checkedLastError();
      sendResponse(language);
    });
    return true;
  } else if (request.action === "setPageLanguageState") {
    if (sender.tab && sender.tab.active && (sender.frameId === 0 || sender.frameId === undefined)) {
      updatePageMenuTitle(request.pageLanguageState === "translated" ? "translated" : "original");
    }
  } else if (request.action === "detectTabLanguage") {
    if (!sender.tab) {
      sendResponse("und");
      return;
    }
    chrome.tabs.detectLanguage(sender.tab.id, (language) => {
      checkedLastError();
      sendResponse(language);
    });
    return true;
  } else if (request.action === "getTabHostName") {
    sendResponse(new URL(sender.tab.url).hostname);
  } else if (request.action === "thisFrameIsInFocus") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "anotherFrameIsInFocus" }, checkedLastError);
  } else if (request.action === "twpFramePanel") {
    // A frame of the page selected text: the panel is shown by the top page of the tab (so no frame edge can clip it).
    const { action, ...payload } = request;
    chrome.tabs.sendMessage(sender.tab.id, { ...payload, action: "twpPanelFromFrame", frameId: sender.frameId }, { frameId: 0 }, (answer) => {
      void chrome.runtime.lastError;
      sendResponse(!!answer);
    });
    return true;
  } else if (request.action === "twpReplaceInFrame") {
    chrome.tabs.sendMessage(sender.tab.id, { action: "twpReplaceFromPanel", text: request.text, scope: request.scope }, { frameId: request.frameId }, (done) => {
      void chrome.runtime.lastError;
      sendResponse(!!done);
    });
    return true;
  } else if (request.action === "twpOpenComposer") {
    openPopup("translate", { draft: request.text });
  }
});

chrome.tabs.onActivated.addListener((info) => refreshMenuForTab(info.tabId));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshMenuForActiveTab(windowId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.active) return;
  if (changeInfo.status === "loading") updatePageMenuTitle("original"); // a page that reloads is no longer translated
  else if (changeInfo.status === "complete") refreshMenuForTab(tabId);
});

const start = () => twpConfig.onReady(() => detectBrowserLanguage(createMenus));
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
start();
// Language change (from the menu or the settings page): menu titles updated.
twpConfig.onChanged((name) => {
  if (name === "targetLanguage" || name === "writeLanguage" || name === "uiLanguage") createMenus();
});
