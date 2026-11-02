"use strict";

// Diagnostic log: what happens during a translation, to understand why it is slow or incomplete.
// Events (AI requests, budget waits, errors, page sends and results, detected stalls...) are
// kept in a circular buffer (the last 1000), stored in the browser's session storage.
// Setting: "diagnostics" = "no" turns the log off. The "Dashboard" (right-click) shows a summary, the state of the
// page and the log, with a button to copy the report.

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
        /* the log must never get in the way of translation */
      }
    }, 800);
  }

  function push(entry) {
    buffer.push(entry);
    if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
    persistSoon();
  }

  /** Adds an event: short type ("llm.request", "html.call"...) and data. */
  function log(type, data = {}) {
    if (!enabled()) return;
    push({ t: Date.now(), type, ...data });
  }

  // The service worker goes to sleep: the log is reloaded on wake-up.
  const ready = (async () => {
    try {
      const a = area();
      if (!a) return;
      const stored = await a.get(KEY);
      if (stored && Array.isArray(stored[KEY])) buffer = [...stored[KEY], ...buffer].slice(-MAX_EVENTS);
    } catch (e) {
      /* no stored log */
    }
  })();

  function clear() {
    buffer = [];
    persistSoon();
  }

  return { log, get: () => buffer.slice(), clear, ready, enabled, MAX_EVENTS };
})();

// Messages: pages send their events; the dashboard reads, clears and asks for the state of a page.
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
    // The detailed state of a page is known to its page script: ask it (main frame).
    pageTabId(request.tabId).then((tabId) => {
      if (!tabId) return sendResponse({ error: "no page to inspect: open the dashboard from a normal page" });
      chrome.tabs.sendMessage(tabId, { action: "twpPageReport" }, { frameId: 0 }, (report) => {
        const err = chrome.runtime.lastError;
        sendResponse(report || { error: "the page does not answer (press F5 on it once, or it is a protected page)" + (err ? " [" + err.message + "]" : "") });
      });
    });
    return true;
  } else if (request.action === "twpDiagScan") {
    pageTabId(request.tabId).then((tabId) => {
      if (!tabId) return sendResponse(false);
      chrome.tabs.sendMessage(tabId, { action: "twpPageScan" }, { frameId: 0 }, (ok) => {
        void chrome.runtime.lastError;
        sendResponse(!!ok);
      });
    });
    return true;
  }
});

// Tab to examine: the requested one, otherwise the most recently used normal page open in the foreground
// (the dashboard is a popup window: "the active tab" would be itself).
async function pageTabId(wanted) {
  if (wanted) return wanted;
  try {
    const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return tabs[0] && tabs[0].id;
  } catch (e) {
    return undefined;
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return undefined;
  }
}
