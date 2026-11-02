"use strict";

// Automatic reload during development: the extension watches its own files (Chrome and Brave
// re-read them from disk for an unpacked extension) and reloads itself when one of them changes.
// No more clicking "Reload" in brave://extensions: the tested page still has to be refreshed (F5), because
// tabs already open keep the old page script.
//
// Delay: up to 30 seconds (the service worker wakes up through an alarm, 30 s minimum in Chrome).
// To turn off: remove the "devReload.js" line from bg.js (and the "alarms" permission from the manifest).

const DEV_FILES = [
  "/background/devReload.js", "/background/diagnostics.js", "/background/llmService.js", "/background/menu.js", "/background/skipTargetLanguage.js",
  "/background/translationService.js", "/bg.js", "/composer/composer.css", "/composer/composer.html", "/composer/composer.js",
  "/contentScript/css/showOriginal.css", "/contentScript/pageTranslator.js", "/contentScript/panel.js", "/contentScript/showOriginal.js",
  "/lib/XMLHttpRequestShim.js", "/lib/checkedLastError.js", "/lib/config.js", "/lib/ui-text.js", "/lib/ui/en.js", "/lib/ui/fr.js", "/lib/languages.js", "/lib/platformInfo.js",
  "/popup/popup.css", "/popup/popup.html", "/popup/popup.js", "/dashboard/dashboard.css", "/dashboard/dashboard.html", "/dashboard/dashboard.js", "/dashboard/metrics.js",
  "/lib/stuff.js", "/manifest.json", "/setup/setup.css", "/setup/setup.html", "/setup/setup.js",
];
const DEV_ALARM = "twp-dev-reload";
const DEV_STORAGE_KEY = "devFilesStamp";

// Fingerprint of all the files: changes as soon as a single byte changes.
async function devFilesStamp() {
  const parts = [];
  for (const file of DEV_FILES) {
    try {
      const res = await fetch(chrome.runtime.getURL(file), { cache: "no-store" });
      parts.push(file + ":" + (await res.text()));
    } catch (e) {
      parts.push(file + ":absent");
    }
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n")));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Compare with the remembered fingerprint (it survives the service worker's sleep); different: reload.
async function devCheckForChanges() {
  const stamp = await devFilesStamp();
  const stored = await chrome.storage.local.get(DEV_STORAGE_KEY);
  const previous = stored && stored[DEV_STORAGE_KEY];
  if (previous === stamp) return false;
  await chrome.storage.local.set({ [DEV_STORAGE_KEY]: stamp });
  if (previous) {
    chrome.runtime.reload();
    return true;
  }
  return false; // first start: only remember it
}

chrome.alarms.create(DEV_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DEV_ALARM) devCheckForChanges().catch((e) => console.warn("devReload:", e));
});
devCheckForChanges().catch(() => {});
