"use strict";

// Rechargement automatique pendant le développement : l'extension surveille ses propres fichiers (Chrome et Brave les
// relisent sur le disque pour une extension non empaquetée) et se recharge toute seule quand l'un d'eux change.
// Plus besoin de cliquer sur « Recharger » dans brave://extensions : il reste à rafraîchir (F5) la page testée, car les
// onglets déjà ouverts gardent l'ancien script de page.
//
// Délai : jusqu'à 30 secondes (le réveil du service worker se fait par une alarme, 30 s minimum dans Chrome).
// Pour désactiver : retirer la ligne « devReload.js » de bg.js (et la permission « alarms » du manifeste).

const DEV_FILES = [
  "/background/devReload.js", "/background/diagnostics.js", "/background/llmService.js", "/background/menu.js", "/background/skipTargetLanguage.js", "/background/translationCache.js",
  "/background/translationService.js", "/bg.js", "/composer/composer.css", "/composer/composer.html", "/composer/composer.js",
  "/contentScript/css/showOriginal.css", "/contentScript/pageTranslator.js", "/contentScript/panel.js", "/contentScript/showOriginal.js",
  "/lib/XMLHttpRequestShim.js", "/lib/checkedLastError.js", "/lib/config.js", "/lib/i18n.js", "/lib/languages.js", "/lib/platformInfo.js",
  "/dashboard/dashboard.css", "/dashboard/dashboard.html", "/dashboard/dashboard.js", "/dashboard/metrics.js",
  "/lib/stuff.js", "/manifest.json", "/setup/setup.css", "/setup/setup.html", "/setup/setup.js",
];
const DEV_ALARM = "twp-dev-reload";
const DEV_STORAGE_KEY = "devFilesStamp";

// Empreinte de tous les fichiers : change dès qu'un seul octet change.
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

// Compare avec l'empreinte mémorisée (elle survit au sommeil du service worker) ; différente : on recharge.
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
  return false; // premier démarrage : on mémorise seulement
}

chrome.alarms.create(DEV_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DEV_ALARM) devCheckForChanges().catch((e) => console.warn("devReload:", e));
});
devCheckForChanges().catch(() => {});
