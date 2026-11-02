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
  bubble: "twp-bubble",
  selection: "twp-selection",
  field: "twp-field",
  page: "twp-page",
  composer: "twp-composer",
  key: "twp-key",
};

// L'état « page traduite ou non » appartient à chaque onglet : on le demande à l'onglet concerné (jamais mémorisé ici,
// sinon un onglet afficherait l'état de l'onglet précédent).
function getTabPageState(tabId, callback) {
  if (!tabId) return callback("original");
  chrome.tabs.sendMessage(tabId, { action: "getCurrentPageLanguageState" }, { frameId: 0 }, (state) => {
    void chrome.runtime.lastError;
    callback(state === "translated" ? "translated" : "original");
  });
}

// Langue par défaut, tant que l'utilisateur n'a pas choisi : sa langue à lui, pas forcément celle de l'interface.
// Beaucoup de navigateurs ont l'anglais en tête (interface et langues préférées « en,fr ») alors que la personne lit
// l'anglais comme langue étrangère : on prend la première langue de l'interface ou des langues préférées qui n'est PAS
// l'anglais ; s'il n'y en a pas, l'anglais.
function pickDefaultLanguage(uiLanguage, acceptedLanguages, fix) {
  const codes = [uiLanguage, ...(acceptedLanguages || [])].map((raw) => fix(raw)).filter(Boolean);
  return codes.find((code) => code !== "en") || codes[0];
}

function detectBrowserLanguage(done) {
  if (twpConfig.get("targetLanguageChosen") === "yes") return done();
  chrome.i18n.getAcceptLanguages((accepted) => {
    checkedLastError();
    const code = pickDefaultLanguage(chrome.i18n.getUILanguage(), accepted, twpLang.fixTLanguageCode);
    if (code && twpConfig.get("targetLanguage") !== code) twpConfig.set("targetLanguage", code);
    done();
  });
}

function targetLanguage() {
  return twpConfig.get("targetLanguage") || twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) || "en";
}

// IA si une clé Groq est enregistrée, sinon le traducteur gratuit.
function pageService() {
  const llm = twpConfig.get("customServices").find((cs) => cs.name === "llm");
  return llm && llm.apiKey ? "llm" : "google";
}

function pageMenuTitle(state = "original") {
  return state === "translated"
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

    chrome.contextMenus.create({
      id: MENU.bubble,
      type: "checkbox",
      checked: twpConfig.get("showTranslateSelectedButton") !== "no",
      title: "Show a bubble when I select text",
      contexts: ["all"],
    });

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
    refreshMenuForActiveTab();
  });
}

function updatePageMenuTitle(state) {
  chrome.contextMenus.update(MENU.page, { title: pageMenuTitle(state) }, checkedLastError);
}

// Titre de l'entrée « page » = état de l'onglet affiché.
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

// Volet intégré à la page (collé au bord droit), comme le fait DeepL. Si la page ne peut pas l'accueillir
// (page du navigateur, PDF, script de page absent), on ouvre une fenêtre à la place.
function openDock(tabId, view, draft) {
  const fallback = () => (view === "setup" ? openKeyPage() : openComposer(tabId, draft));
  if (!tabId) return fallback();
  const send = () => {
    chrome.tabs.sendMessage(tabId, { action: "twpDock", view }, { frameId: 0 }, (answer) => {
      if (chrome.runtime.lastError || !answer) fallback();
    });
    // Volet déjà ouvert : il reprend le nouveau texte.
    if (draft) chrome.runtime.sendMessage({ action: "composerDraftUpdated" }, () => void chrome.runtime.lastError);
  };
  if (draft) chrome.storage.local.set({ composerDraft: draft }, send);
  else send();
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
    getTabPageState(tab.id, (state) => {
      chrome.tabs.sendMessage(
        tab.id,
        state === "translated" ? { action: "restorePage" } : { action: "translatePage", targetLanguage: targetLanguage(), service: pageService() },
        checkedLastError
      );
    });
  } else if (info.menuItemId === MENU.composer) {
    openDock(tab.id, "composer");
  } else if (info.menuItemId === MENU.bubble) {
    twpConfig.set("showTranslateSelectedButton", info.checked ? "yes" : "no");
  } else if (info.menuItemId === MENU.key) {
    openDock(tab.id, "setup");
  } else if (String(info.menuItemId).startsWith("twp-lang-")) {
    // Le menu est recréé par le rappel de changement de configuration ci-dessous.
    twpConfig.set("targetLanguageChosen", "yes");
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
  } else if (request.action === "twpOpenComposer") {
    openDock(sender.tab ? sender.tab.id : null, "composer", request.text);
  } else if (request.action === "twpFallbackWindow") {
    // Le volet n'a pas pu s'afficher (règles de la page) : fenêtre séparée.
    if (request.view === "setup") openKeyPage();
    else openComposer(sender.tab ? sender.tab.id : null);
  }
});

chrome.tabs.onActivated.addListener((info) => refreshMenuForTab(info.tabId));
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) refreshMenuForActiveTab(windowId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.active) return;
  if (changeInfo.status === "loading") updatePageMenuTitle("original"); // une page qui se recharge n'est plus traduite
  else if (changeInfo.status === "complete") refreshMenuForTab(tabId);
});

const start = () => twpConfig.onReady(() => detectBrowserLanguage(createMenus));
chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
start();
// Changement de langue (depuis le menu ou la page de réglage) : titres du menu mis à jour.
twpConfig.onChanged((name) => {
  if (name === "targetLanguage") createMenus();
});
