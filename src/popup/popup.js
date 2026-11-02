"use strict";

// The toolbar popup (like a VPN extension): one small panel with three views, each one an existing extension page.
//   translate -> composer/composer.html (write, see the translation live, insert it in the page)
//   settings  -> setup/setup.html (languages and Groq key)
//   dashboard -> dashboard/dashboard.html (diagnostics)
// The view to show first comes from the menu through session storage ("popupRequest"), as a popup cannot take parameters.
(function () {
  const frame = document.getElementById("frame");
  const buttons = [...document.querySelectorAll("nav button")];
  let pageTabId = null; // the page the popup acts on (insert the translation, examine the page)
  let current = null;

  // The most recently used normal tab: it works for the real toolbar popup and for the fallback window.
  async function findPageTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, windowType: "normal" });
      tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      return tabs[0] ? tabs[0].id : null;
    } catch (e) {
      return null;
    }
  }

  function urlFor(view, focus) {
    const tab = pageTabId ? "tab=" + pageTabId : "";
    if (view === "settings") return "/setup/setup.html" + (focus ? "?focus=" + focus : "");
    if (view === "dashboard") return "/dashboard/dashboard.html" + (tab ? "?" + tab : "");
    return "/composer/composer.html" + (tab ? "?" + tab : "");
  }

  function show(view, focus) {
    if (!["translate", "settings", "dashboard"].includes(view)) view = "translate";
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.view === view));
    // Same view asked again (e.g. a second click on the same menu entry): keep what is on screen.
    if (view !== current || focus) frame.src = urlFor(view, focus);
    current = view;
    try {
      chrome.storage.session.set({ popupLastView: view });
    } catch (e) {
      /* no session storage */
    }
  }

  buttons.forEach((b) => (b.onclick = () => show(b.dataset.view)));

  // Popup already open (the fallback window) when the menu asks for another view.
  chrome.storage.onChanged.addListener((changes, area) => {
    const request = area === "session" && changes.popupRequest && changes.popupRequest.newValue;
    if (!request) return;
    show(request.view, request.focus);
    chrome.storage.session.remove("popupRequest");
  });

  // Pages inside the popup ask to switch view or to close it.
  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || typeof e.data !== "object") return;
    if (e.data.twp === "view") show(e.data.view, e.data.focus);
    else if (e.data.twp === "close") window.close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });

  (async function start() {
    pageTabId = await findPageTab();
    let request = null;
    let last = null;
    try {
      const stored = await chrome.storage.session.get(["popupRequest", "popupLastView"]);
      request = stored.popupRequest || null;
      last = stored.popupLastView || null;
      if (request) await chrome.storage.session.remove("popupRequest"); // used once
    } catch (e) {
      /* no session storage */
    }
    show((request && request.view) || last || "translate", request && request.focus);
  })();
})();
