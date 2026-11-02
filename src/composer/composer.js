// Fenêtre de message : on écrit à gauche, la traduction arrive en direct à droite.
// Zéro réglage : source détectée, langue cible = dernière utilisée (sinon la langue du navigateur),
// IA (Groq) si une clé est enregistrée, sinon le traducteur gratuit d'origine.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const DELAY_MS = 450;
  const KEY_SOURCE = "composerSource";
  const KEY_TONE = "composerTone";

  const params = new URLSearchParams(location.search);
  const docked = params.get("dock") === "1"; // affiché dans le volet de la page (sinon : fenêtre séparée)
  const toParent = (message) => window.parent.postMessage(message, "*");
  const openerTabId = params.has("tab") ? Number(params.get("tab")) : null;

  let timer = null;
  let ticket = 0; // chaque requête a un numéro : une réponse en retard est ignorée
  let aiAvailable = false;

  function fillLanguages(select, withAuto) {
    const names = twpLang.getLanguageList();
    select.textContent = "";
    if (withAuto) {
      const o = document.createElement("option");
      o.value = "auto";
      o.textContent = "Detect language";
      select.appendChild(o);
    }
    for (const code of twpLang.TargetLanguages) {
      if (!names[code]) continue;
      const o = document.createElement("option");
      o.value = code;
      o.textContent = names[code];
      select.appendChild(o);
    }
  }

  function remembered(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }
  function remember(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {}
  }

  function setStatus(text, error) {
    $("#status").textContent = text;
    $("#status").className = error ? "error" : "";
  }

  function translateViaFreeService(text, source, target) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "translateSingleText", translationService: "google", sourceLanguage: source, targetLanguage: target, source: text },
        (result) => {
          checkedLastError();
          resolve(typeof result === "string" ? { ok: true, text: result } : { ok: false, error: "translation failed" });
        }
      );
    });
  }

  function translateViaAi(text, source, target, tone) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "llmLive", text, sourceLanguage: source, targetLanguage: target, tone }, (r) => {
        checkedLastError();
        resolve(r || { ok: false, error: "no answer" });
      });
    });
  }

  async function run() {
    const text = $("#input").value;
    const mine = ++ticket;
    if (!text.trim()) {
      $("#output").value = "";
      setStatus("");
      return;
    }
    setStatus("Translating...");
    const source = $("#source").value;
    const target = $("#target").value;
    let r;
    if (aiAvailable) {
      r = await translateViaAi(text, source, target, $("#tone").value);
      // Si l'IA échoue (limite atteinte, clé refusée...), on bascule sur le service gratuit au lieu de rester bloqué.
      if (!r.ok && r.error !== "no-key") {
        const fallback = await translateViaFreeService(text, source, target);
        if (fallback.ok) r = { ...fallback, fallback: r.error };
      }
    } else {
      r = await translateViaFreeService(text, source, target);
    }
    if (mine !== ticket) return; // une saisie plus récente a pris le relais
    if (r.ok) {
      $("#output").value = r.text;
      setStatus(r.fallback ? "Free translator (AI: " + r.fallback + ")" : aiAvailable ? "AI" : "Free translator");
    } else {
      setStatus("Translation failed: " + (r.error || "unknown error"), true);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, DELAY_MS);
  }

  function init() {
    fillLanguages($("#source"), true);
    fillLanguages($("#target"), false);
    $("#source").value = remembered(KEY_SOURCE, "auto");
    const ui = twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) || "en";
    $("#target").value = twpConfig.get("targetLanguage") || ui;
    $("#tone").value = remembered(KEY_TONE, "");

    const llm = twpConfig.get("customServices").find((cs) => cs.name === "llm");
    aiAvailable = !!(llm && llm.apiKey);
    $("#tone").hidden = !aiAvailable;
    $("#hint").hidden = aiAvailable;

    $("#input").addEventListener("input", schedule);
    $("#source").onchange = () => {
      remember(KEY_SOURCE, $("#source").value);
      run();
    };
    $("#target").onchange = () => {
      twpConfig.set("targetLanguage", $("#target").value);
      run();
    };
    $("#tone").onchange = () => {
      remember(KEY_TONE, $("#tone").value);
      run();
    };
    $("#swap").onclick = () => {
      const src = $("#source").value === "auto" ? null : $("#source").value;
      if (!src) return; // on ne sait pas vers quelle langue repasser tant que la source n'est pas fixée
      const out = $("#output").value;
      $("#source").value = $("#target").value;
      $("#target").value = src;
      remember(KEY_SOURCE, $("#source").value);
      twpConfig.set("targetLanguage", $("#target").value);
      $("#input").value = out;
      run();
    };
    $("#clear").onclick = () => {
      $("#input").value = "";
      $("#output").value = "";
      setStatus("");
      $("#input").focus();
    };
    $("#copy").onclick = async () => {
      const text = $("#output").value;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        $("#output").select();
        document.execCommand("copy");
      }
      setStatus("Copied");
    };
    if (docked) {
      // Dans le volet : on écrit dans le champ de la page par la page elle-même.
      $("#insert").hidden = false;
      $("#insert").onclick = () => {
        const text = $("#output").value;
        if (text) toParent({ twp: "insert", text });
      };
      window.addEventListener("message", (e) => {
        if (e.source === window.parent && e.data && e.data.twp === "inserted") setStatus(e.data.ok ? "Inserted" : "No text field found in the page: use Copy", !e.data.ok);
      });
      document.body.classList.add("docked");
      $("#settings").hidden = false;
      $("#settings").onclick = (e) => {
        e.preventDefault();
        toParent({ twp: "navigate", view: "setup" });
      };
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") toParent({ twp: "close" });
      });
      toParent({ twp: "ready" });
    } else if (openerTabId !== null) {
      $("#insert").hidden = false;
      $("#insert").onclick = () => {
        const text = $("#output").value;
        if (!text) return;
        chrome.tabs.sendMessage(openerTabId, { action: "twpInsertText", text }, (ok) => {
          checkedLastError();
          setStatus(ok ? "Inserted" : "No text field found in the page: use Copy", !ok);
        });
      };
    }
    // Ctrl+Entrée : copier la traduction
    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        $("#copy").click();
      }
    });
    $("#input").focus();
    loadDraft();
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === "composerDraftUpdated") loadDraft();
    });
  }

  // Texte déjà écrit dans un champ de la page (bouton « Window » du panneau) : repris tel quel, une seule fois.
  function loadDraft() {
    chrome.storage.local.get("composerDraft", (r) => {
      checkedLastError();
      if (r && r.composerDraft) {
        chrome.storage.local.remove("composerDraft");
        $("#input").value = r.composerDraft;
        run();
      }
    });
  }

  twpConfig.onReady(init);
})();
