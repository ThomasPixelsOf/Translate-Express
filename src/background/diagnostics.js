"use strict";

// Journal de diagnostic : ce qui se passe pendant une traduction, pour comprendre pourquoi c'est lent ou incomplet.
// Les événements (requêtes à l'IA, attentes de budget, erreurs, envois et résultats de la page, blocages détectés...) sont
// gardés dans un tampon circulaire (les 1000 derniers), conservé dans le stockage de session du navigateur.
// Réglage : « diagnostics » = "no" coupe le journal. La vue « Diagnostics » (clic droit) affiche un résumé, l'état de la
// page et le journal, avec un bouton pour copier le rapport.

var twpDiag = (function () {
  const MAX_EVENTS = 1000;
  const KEY = "diagLog";
  const area = () => (chrome.storage && (chrome.storage.session || chrome.storage.local)) || null;

  let buffer = [];
  let timer = null;
  let enabledCache = true;

  function enabled() {
    try {
      return twpConfig.get("diagnostics") !== "no";
    } catch (e) {
      return enabledCache;
    }
  }

  function persistSoon() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        const a = area();
        if (a) a.set({ [KEY]: buffer });
      } catch (e) {
        /* le journal ne doit jamais gêner la traduction */
      }
    }, 800);
  }

  function push(entry) {
    buffer.push(entry);
    if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
    persistSoon();
  }

  /** Ajoute un événement : type court (« llm.request », « html.call »...) et données. */
  function log(type, data = {}) {
    if (!enabled()) return;
    push({ t: Date.now(), type, ...data });
  }

  // Le service worker s'endort : on recharge le journal au réveil.
  const ready = (async () => {
    try {
      const a = area();
      if (!a) return;
      const stored = await a.get(KEY);
      if (stored && Array.isArray(stored[KEY])) buffer = [...stored[KEY], ...buffer].slice(-MAX_EVENTS);
    } catch (e) {
      /* pas de journal conservé */
    }
  })();

  function clear() {
    buffer = [];
    persistSoon();
  }

  return { log, get: () => buffer.slice(), clear, ready, enabled, MAX_EVENTS };
})();

// Messages : les pages envoient leurs événements ; la vue « Diagnostics » lit, efface et demande l'état d'une page.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "twpLog") {
    const host = sender.tab && sender.tab.url ? safeHost(sender.tab.url) : undefined;
    for (const e of Array.isArray(request.entries) ? request.entries.slice(0, 200) : []) {
      if (e && typeof e.type === "string") twpDiag.log(e.type, { ...e.data, source: "page", host, tab: sender.tab && sender.tab.id });
    }
  } else if (request.action === "twpDiagGet") {
    twpDiag.ready.then(() => sendResponse({ events: twpDiag.get(), enabled: twpDiag.enabled() }));
    return true;
  } else if (request.action === "twpDiagClear") {
    twpDiag.clear();
    sendResponse(true);
  } else if (request.action === "twpDiagPageReport") {
    // L'état détaillé d'une page est connu de son script de page : on lui pose la question (cadre principal).
    chrome.tabs.sendMessage(request.tabId, { action: "twpPageReport" }, { frameId: 0 }, (report) => {
      void chrome.runtime.lastError;
      sendResponse(report || null);
    });
    return true;
  } else if (request.action === "twpDiagScan") {
    chrome.tabs.sendMessage(request.tabId, { action: "twpPageScan" }, { frameId: 0 }, (ok) => {
      void chrome.runtime.lastError;
      sendResponse(!!ok);
    });
    return true;
  }
});

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return undefined;
  }
}
