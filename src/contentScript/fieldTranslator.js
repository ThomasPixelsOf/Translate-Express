// Traduction de ce qu'on écrit, directement dans les champs de saisie (Teams, Outlook web, mails, formulaires) :
// un petit bouton apparaît près du champ actif ; un clic ouvre un panneau avec la traduction en direct,
// « Replace » remplace le texte du champ, « Copy » le copie, « Window » ouvre la fenêtre de message.
// Zéro réglage : langue cible = la dernière choisie, source détectée, IA (Groq) si une clé est enregistrée.
(function () {
  "use strict";
  if (window.__twpFieldTranslator) return;
  window.__twpFieldTranslator = true;

  const KEY_TARGET = "twpFieldTarget";
  const DELAY_MS = 500;
  const MIN_CHARS = 2;

  let field = null; // champ actif
  let host = null; // élément porteur du shadow DOM (bouton + panneau)
  let ui = null;
  let panelOpen = false;
  let timer = null;
  let ticket = 0;
  let hideTimer = null;

  // ---- champs de saisie ----
  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === "TEXTAREA") return !el.readOnly && !el.disabled;
    if (el.tagName === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "email", "url", ""].includes(type) && !el.readOnly && !el.disabled;
    }
    return false;
  }
  // Le champ réellement éditable (dans le cas d'un éditeur riche, l'élément contenteditable le plus externe).
  function editableRoot(el) {
    if (el && el.isContentEditable) {
      let root = el;
      while (root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
      return root;
    }
    return el;
  }
  function getText(el) {
    return "value" in el && el.tagName !== "DIV" ? el.value : el.innerText;
  }
  function setText(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text); // compatible avec React, Vue...
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll");
      if (!document.execCommand("insertText", false, text)) el.textContent = text;
    }
  }
  function insertAtCaret(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const a = el.selectionStart ?? el.value.length;
      const b = el.selectionEnd ?? el.value.length;
      setText(el, el.value.slice(0, a) + text + el.value.slice(b));
      el.setSelectionRange(a + text.length, a + text.length);
    } else if (!document.execCommand("insertText", false, text)) {
      el.textContent += text;
    }
  }

  // ---- interface (shadow DOM, isolée des styles de la page) ----
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .btn { position: fixed; z-index: 2147483647; width: 28px; height: 28px; border-radius: 14px; border: 1px solid #c8c8d0;
      background: #0f62fe; color: #fff; cursor: pointer; font-weight: 700; font-size: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.3); padding: 0; }
    .btn:hover { background: #0353e9; }
    .panel { position: fixed; z-index: 2147483647; width: 340px; max-width: calc(100vw - 16px); background: #fff; color: #1d1d1f;
      border: 1px solid #c8c8d0; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 10px; display: none; }
    @media (prefers-color-scheme: dark) { .panel { background: #1c1c1e; color: #f2f2f4; border-color: #3a3a3e; } }
    .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    select, button.a { font: inherit; border: 1px solid #c8c8d0; border-radius: 6px; padding: 4px 8px; background: transparent; color: inherit; cursor: pointer; }
    select { flex: 1; min-width: 0; }
    button.a.primary { background: #0f62fe; border-color: #0f62fe; color: #fff; }
    .out { white-space: pre-wrap; max-height: 180px; overflow: auto; border: 1px solid #c8c8d0; border-radius: 6px; padding: 8px; min-height: 52px; margin-bottom: 8px; }
    .status { font-size: 11px; opacity: .7; margin-left: auto; }
    .err { color: #d93025; opacity: 1; }
  `;

  function build() {
    host = document.createElement("div");
    host.setAttribute("data-twp-field", "");
    host.style.cssText = "all: initial;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <button class="btn" title="Translate what you write" aria-label="Translate what you write">A</button>
      <div class="panel" role="dialog" aria-label="Translate what you write">
        <div class="row"><select class="lang" aria-label="Target language"></select><span class="status"></span></div>
        <div class="out" aria-live="polite"></div>
        <div class="row" style="margin-bottom:0">
          <button class="a primary replace">Replace</button>
          <button class="a copy">Copy</button>
          <button class="a win" style="margin-left:auto">Window</button>
        </div>
      </div>`;
    ui = {
      btn: root.querySelector(".btn"),
      panel: root.querySelector(".panel"),
      lang: root.querySelector(".lang"),
      out: root.querySelector(".out"),
      status: root.querySelector(".status"),
      replace: root.querySelector(".replace"),
      copy: root.querySelector(".copy"),
      win: root.querySelector(".win"),
    };
    const names = twpLang.getLanguageList();
    for (const code of twpLang.TargetLanguages) {
      if (!names[code]) continue;
      const o = document.createElement("option");
      o.value = code;
      o.textContent = names[code];
      ui.lang.appendChild(o);
    }
    let saved = null;
    try { saved = localStorage.getItem(KEY_TARGET); } catch (e) {}
    ui.lang.value = saved || (twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) === "en" ? "fr" : "en");
    if (!ui.lang.value) ui.lang.value = "en";

    // On garde le focus dans le champ quand on clique sur le bouton, sinon l'éditeur perdrait sa sélection.
    ui.btn.addEventListener("mousedown", (e) => e.preventDefault());
    ui.btn.addEventListener("click", () => togglePanel());
    ui.lang.addEventListener("change", () => {
      try { localStorage.setItem(KEY_TARGET, ui.lang.value); } catch (e) {}
      translateNow();
    });
    ui.replace.addEventListener("click", () => {
      if (field && ui.out.dataset.text) setText(field, ui.out.dataset.text);
    });
    ui.copy.addEventListener("click", async () => {
      const text = ui.out.dataset.text || "";
      if (!text) return;
      try { await navigator.clipboard.writeText(text); } catch (e) {}
      setStatus("Copied");
    });
    ui.win.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "twpOpenComposer", text: field ? getText(field) : "" });
    });
    document.documentElement.appendChild(host);
  }

  function setStatus(text, error) {
    ui.status.textContent = text;
    ui.status.className = "status" + (error ? " err" : "");
  }

  function placeUi() {
    if (!field || !ui) return;
    const r = field.getBoundingClientRect();
    const size = 28;
    const left = Math.max(4, Math.min(window.innerWidth - size - 4, r.right - size - 6));
    const top = Math.max(4, Math.min(window.innerHeight - size - 4, r.bottom - size - 6));
    ui.btn.style.left = left + "px";
    ui.btn.style.top = top + "px";
    if (panelOpen) {
      const pw = Math.min(340, window.innerWidth - 8);
      ui.panel.style.left = Math.max(4, Math.min(window.innerWidth - pw - 4, r.right - pw)) + "px";
      const below = r.bottom + 8;
      const room = window.innerHeight - below;
      if (room > 220) { ui.panel.style.top = below + "px"; ui.panel.style.bottom = "auto"; }
      else { ui.panel.style.bottom = Math.max(4, window.innerHeight - r.top + 8) + "px"; ui.panel.style.top = "auto"; }
    }
  }

  function showButton() {
    if (!host) build();
    clearTimeout(hideTimer);
    ui.btn.style.display = "block";
    placeUi();
  }
  function hideAll() {
    if (!ui || panelOpen) return;
    ui.btn.style.display = "none";
  }
  function togglePanel(force) {
    panelOpen = force !== undefined ? force : !panelOpen;
    ui.panel.style.display = panelOpen ? "block" : "none";
    if (panelOpen) {
      placeUi();
      translateNow();
    }
  }

  // ---- traduction en direct ----
  function ask(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (r) => {
          void chrome.runtime.lastError;
          resolve(r);
        });
      } catch (e) {
        resolve(undefined);
      }
    });
  }

  async function translateNow() {
    clearTimeout(timer);
    if (!field || !panelOpen) return;
    const text = getText(field);
    const mine = ++ticket;
    if (text.trim().length < MIN_CHARS) {
      ui.out.textContent = "";
      ui.out.dataset.text = "";
      setStatus("");
      return;
    }
    setStatus("Translating...");
    const target = ui.lang.value;
    let r = await ask({ action: "llmLive", text, sourceLanguage: "auto", targetLanguage: target });
    if (!r || !r.ok) {
      // Pas de clé IA (ou échec) : traducteur gratuit d'origine.
      const f = await ask({ action: "translateSingleText", translationService: "google", sourceLanguage: "auto", targetLanguage: target, source: text });
      r = typeof f === "string" ? { ok: true, text: f, free: true } : r && r.ok === false ? r : { ok: false, error: "translation failed" };
    }
    if (mine !== ticket) return;
    if (r.ok) {
      ui.out.textContent = r.text;
      ui.out.dataset.text = r.text;
      setStatus(r.free ? "Free translator" : "AI");
    } else {
      setStatus("Translation failed", true);
    }
  }
  function scheduleTranslate() {
    clearTimeout(timer);
    timer = setTimeout(translateNow, DELAY_MS);
  }

  // ---- événements de la page ----
  document.addEventListener("focusin", (e) => {
    const el = editableRoot(e.target);
    if (el === host) return;
    if (!isEditable(el)) return;
    field = el;
    if (getText(el).trim().length >= MIN_CHARS) showButton();
  }, true);

  document.addEventListener("input", (e) => {
    const el = editableRoot(e.target);
    if (el !== field) return;
    if (getText(el).trim().length >= MIN_CHARS) {
      showButton();
      if (panelOpen) scheduleTranslate();
    } else if (!panelOpen) {
      hideAll();
    }
  }, true);

  document.addEventListener("focusout", () => {
    hideTimer = setTimeout(() => {
      const active = document.activeElement;
      if (active === host) return;
      if (!isEditable(editableRoot(active))) {
        if (panelOpen) return; // le panneau reste ouvert tant qu'on ne le ferme pas
        hideAll();
      }
    }, 250);
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen) togglePanel(false);
  }, true);

  document.addEventListener("mousedown", (e) => {
    if (panelOpen && host && !e.composedPath().includes(host) && !isEditable(editableRoot(e.target))) togglePanel(false);
  }, true);

  window.addEventListener("scroll", () => placeUi(), true);
  window.addEventListener("resize", () => placeUi());

  // Insertion demandée par la fenêtre de message (bouton « Insert in the page »).
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== "twpInsertText") return;
    const el = field && document.contains(field) ? field : null;
    if (!el) return; // un autre cadre de la page répondra
    insertAtCaret(el, request.text);
    sendResponse(true);
  });
})();
