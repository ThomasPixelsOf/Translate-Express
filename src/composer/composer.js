// Message window: you write on the left, the translation arrives live on the right.
// Zero configuration: source detected, target language = last one used (otherwise the browser language),
// AI (Groq) if a key is saved, otherwise the original free translator.
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const DELAY_MS = 450;
  const KEY_SOURCE = "composerSource";
  const KEY_TONE = "composerTone";

  const params = new URLSearchParams(location.search);
  const openerTabId = params.has("tab") ? Number(params.get("tab")) : null;

  let timer = null;
  let ticket = 0; // each request has a number: a late answer is ignored
  let aiAvailable = false;

  const fillLanguages = (select, withAuto) => twpLang.fillLanguageSelect(select, { auto: withAuto });

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
    setStatus(twpUi.t("composerTranslating"));
    const source = $("#source").value;
    const target = $("#target").value;
    let r;
    if (aiAvailable) {
      r = await translateViaAi(text, source, target, $("#tone").value);
      // If the AI fails (limit reached, key refused...), switch to the free service instead of staying blocked.
      if (!r.ok && r.error !== "no-key") {
        const fallback = await translateViaFreeService(text, source, target);
        if (fallback.ok) r = { ...fallback, fallback: r.error };
      }
    } else {
      r = await translateViaFreeService(text, source, target);
    }
    if (mine !== ticket) return; // a more recent input took over
    if (r.ok) {
      $("#output").value = r.text;
      setStatus(r.fallback ? twpUi.t("composerFreeFallback", r.fallback) : twpUi.t(aiAvailable ? "composerAi" : "composerFree"));
    } else {
      setStatus(twpUi.t("composerFailed", r.error || twpUi.t("composerUnknownError")), true);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, DELAY_MS);
  }

  function init() {
    twpUi.translateDocument();
    twpConfig.onChanged((name) => {
      if (name === "uiLanguage") twpUi.translateDocument();
    });
    fillLanguages($("#source"), true);
    fillLanguages($("#target"), false);
    $("#source").value = remembered(KEY_SOURCE, "auto");
    // The message window is for writing: its target language is the writing language.
    $("#target").value = twpConfig.get("writeLanguage") || "en";
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
      twpConfig.set("writeLanguage", $("#target").value);
      run();
    };
    $("#tone").onchange = () => {
      remember(KEY_TONE, $("#tone").value);
      run();
    };
    $("#swap").onclick = () => {
      const src = $("#source").value === "auto" ? null : $("#source").value;
      if (!src) return; // we do not know which language to switch back to until the source is set
      const out = $("#output").value;
      $("#source").value = $("#target").value;
      $("#target").value = src;
      remember(KEY_SOURCE, $("#source").value);
      twpConfig.set("writeLanguage", $("#target").value);
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
      setStatus(twpUi.t("composerCopied"));
    };
    if (openerTabId !== null) {
      $("#insert").hidden = false;
      $("#insert").onclick = () => {
        const text = $("#output").value;
        if (!text) return;
        chrome.tabs.sendMessage(openerTabId, { action: "twpInsertText", text }, (ok) => {
          checkedLastError();
          setStatus(twpUi.t(ok ? "composerInserted" : "composerNoField"), !ok);
        });
      };
    }
  // Inside the toolbar popup: Escape closes it.
  if (window.parent !== window) {
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") window.parent.postMessage({ twp: "close" }, location.origin);
    });
  }
    // "add a Groq key": switch the popup to its settings view.
    $("#goKey").onclick = (e) => {
      e.preventDefault();
      window.parent.postMessage({ twp: "view", view: "settings", focus: "key" }, location.origin);
    };
    // Ctrl+Enter: copy the translation
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

  // Text already written in a page field ("Window" button of the panel): taken over as is, only once.
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
