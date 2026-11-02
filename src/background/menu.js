"use strict";

// Menu du clic droit : c'est la seule porte d'entrée de l'extension.
//   texte sélectionné        -> « Translate selection »   (panneau près de la sélection)
//   champ de saisie          -> « Translate what I'm writing » (panneau, avec Replace)
//   page                     -> « Translate this page » / « Show original »
//   partout                  -> « Message window » (écrire et voir la traduction en direct), « Groq key… »
// Aucun réglage : langue cible = langue du navigateur, source détectée, IA si une clé Groq est enregistrée.

// Langues proposées directement dans le menu ; la liste complète est dans « Language and Groq key... ».
const COMMON_LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "nl", "ru", "ja", "zh-CN", "ar"];

const MENU = {
  lang: "twp-lang",
  selection: "twp-selection",
  field: "twp-field",
  page: "twp-page",
  composer: "twp-composer",
  key: "twp-key",
};

let pageLanguageState = "original";

function targetLanguage() {
  return twpConfig.get("targetLanguage") || twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) || "en";
}

function pageMenuTitle() {
  return pageLanguageState === "translated"
    ? "Show original page"
    : "Translate this page to " + twpLang.codeToLanguage(targetLanguage());
}

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    checkedLastError();
    chrome.contextMenus.create({ id: MENU.selection, title: "Translate selection", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU.field, title: "Translate what I'm writing", contexts: ["editable"] });
    chrome.contextMenus.create({
      id: MENU.page,
      title: pageMenuTitle(),
      contexts: ["page", "frame"],
      documentUrlPatterns: ["http://*/*", "https://*/*", "file://*/*"],
    });
    chrome.contextMenus.create({ id: MENU.composer, title: "Message window (live translation)", contexts: ["all"] });

    // Langue cible : une seule pour toute l'extension (page, panneau, fenêtre de message).
    const current = targetLanguage();
    const known = new Set(twpLang.TargetLanguages);
    const choices = [...new Set([current, ...COMMON_LANGUAGES])].filter((code) => known.has(code));
    chrome.contextMenus.create({
      id: MENU.lang,
      title: "Target language: " + twpLang.codeToLanguage(current),
      contexts: ["all"],
    });
    for (const code of choices) {
      chrome.contextMenus.create({
        id: "twp-lang-" + code,
        parentId: MENU.lang,
        type: "radio",
        checked: code === current,
        title: twpLang.codeToLanguage(code),
        contexts: ["all"],
      });
    }
    chrome.contextMenus.create({ id: MENU.key, parentId: MENU.lang, title: "More languages, Groq key...", contexts: ["all"] });
  });
}

function updatePageMenuTitle() {
  chrome.contextMenus.update(MENU.page, { title: pageMenuTitle() }, checkedLastError);
}

// Fenêtre de message (traduction en direct) : une seule fenêtre ; si elle existe déjà on la remet devant.
async function openComposer(tabId, draft) {
  const url = chrome.runtime.getURL("/composer/composer.html");
  if (draft) await chrome.storage.local.set({ composerDraft: draft });
  const windows = await chrome.windows.getAll({ populate: true });
  const existing = windows.find((w) => w.type === "popup" && w.tabs && w.tabs.some((t) => t.url && t.url.startsWith(url)));
  if (existing) {
    await chrome.windows.update(existing.id, { focused: true });
    if (draft) chrome.runtime.sendMessage({ action: "composerDraftUpdated" }, () => void chrome.runtime.lastError);
    return;
  }
  await chrome.windows.create({ url: url + (tabId ? "?tab=" + tabId : ""), type: "popup", width: 900, height: 520 });
}

function openKeyPage() {
  const url = chrome.runtime.getURL("/setup/setup.html");
  chrome.windows.create({ url, type: "popup", width: 520, height: 420 });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  const frame = { frameId: info.frameId || 0 };
  if (info.menuItemId === MENU.selection) {
    chrome.tabs.sendMessage(tab.id, { action: "twpPanel", mode: "selection", text: info.selectionText || "" }, frame, checkedLastError);
  } else if (info.menuItemId === MENU.field) {
    chrome.tabs.sendMessage(tab.id, { action: "twpPanel", mode: "field" }, frame, checkedLastError);
  } else if (info.menuItemId === MENU.page) {
    // La page entière (tous ses cadres) : traduire ou revenir à l'original selon l'état courant.
    chrome.tabs.sendMessage(
      tab.id,
      pageLanguageState === "translated" ? { action: "restorePage" } : { action: "translatePage", targetLanguage: targetLanguage() },
      checkedLastError
    );
  } else if (info.menuItemId === MENU.composer) {
    openComposer(tab.id);
  } else if (info.menuItemId === MENU.key) {
    openKeyPage();
  } else if (String(info.menuItemId).startsWith("twp-lang-")) {
    // Le menu est recréé par le rappel de changement de configuration ci-dessous.
    twpConfig.set("targetLanguage", String(info.menuItemId).slice("twp-lang-".length));
  }
});

// Messages des scripts de page (le traducteur de pages en a besoin pour connaître la langue et l'état de l'onglet).
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
    pageLanguageState = request.pageLanguageState;
    updatePageMenuTitle();
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
  } else if (request.action === "twpOpenComposer") {
    openComposer(sender.tab ? sender.tab.id : null, request.text);
  }
});

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);
twpConfig.onReady(createMenus);
// Changement de langue (depuis le menu ou la page de réglage) : titres du menu mis à jour.
twpConfig.onChanged((name) => {
  if (name === "targetLanguage") createMenus();
});
