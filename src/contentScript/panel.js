// Panneau de traduction ouvert depuis le menu du clic droit :
//   « Translate selection »          -> traduit le texte sélectionné (lecture seule)
//   « Translate what I'm writing »   -> traduit le contenu du champ de saisie, en direct pendant qu'on écrit ;
//                                       « Replace » remplace le texte du champ (ou la partie sélectionnée)
// Zéro réglage : source détectée, langue cible = la dernière choisie, IA (Groq) si une clé est enregistrée.
(function () {
  "use strict";
  if (window.__twpPanel) return;
  window.__twpPanel = true;

  const KEY_TARGET = "twpPanelTarget";
  const DELAY_MS = 500;

  let field = null; // dernier champ de saisie rencontré
  let mode = null; // "selection" | "field"
  let selectionText = "";
  let host = null;
  let ui = null;
  let open = false;
  let timer = null;
  let ticket = 0;

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
  // Pour un éditeur riche, l'élément contenteditable le plus externe.
  function editableRoot(el) {
    if (el && el.isContentEditable) {
      let root = el;
      while (root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
      return root;
    }
    return el;
  }
  const isFormField = (el) => el.tagName === "TEXTAREA" || el.tagName === "INPUT";
  const getText = (el) => (isFormField(el) ? el.value : el.innerText);

  // Partie sélectionnée dans le champ, si elle existe.
  function fieldSelection(el) {
    if (isFormField(el)) {
      const a = el.selectionStart;
      const b = el.selectionEnd;
      return a != null && b != null && b > a ? el.value.slice(a, b) : "";
    }
    const sel = window.getSelection();
    return sel && !sel.isCollapsed && el.contains(sel.anchorNode) ? sel.toString() : "";
  }

  function setNativeValue(el, text) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, text); // compatible avec React, Vue...
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function replaceInField(el, text, onlySelection) {
    el.focus();
    if (isFormField(el)) {
      if (onlySelection && el.selectionEnd > el.selectionStart) {
        const a = el.selectionStart;
        setNativeValue(el, el.value.slice(0, a) + text + el.value.slice(el.selectionEnd));
        el.setSelectionRange(a, a + text.length);
      } else {
        setNativeValue(el, text);
      }
    } else {
      if (!onlySelection) document.execCommand("selectAll");
      if (!document.execCommand("insertText", false, text)) el.textContent = text;
    }
  }
  function insertAtCaret(el, text) {
    el.focus();
    if (isFormField(el)) {
      const a = el.selectionStart ?? el.value.length;
      const b = el.selectionEnd ?? el.value.length;
      setNativeValue(el, el.value.slice(0, a) + text + el.value.slice(b));
      el.setSelectionRange(a + text.length, a + text.length);
    } else if (!document.execCommand("insertText", false, text)) {
      el.textContent += text;
    }
  }

  // ---- interface (shadow DOM : isolée des styles de la page) ----
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel { position: fixed; z-index: 2147483647; width: 360px; max-width: calc(100vw - 16px); background: #fff; color: #1d1d1f;
      border: 1px solid #c8c8d0; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 10px; display: none; }
    @media (prefers-color-scheme: dark) { .panel { background: #1c1c1e; color: #f2f2f4; border-color: #3a3a3e; } }
    .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    select, button { font: inherit; border: 1px solid #c8c8d0; border-radius: 6px; padding: 4px 8px; background: transparent; color: inherit; cursor: pointer; }
    select { flex: 1; min-width: 0; }
    button.primary { background: #0f62fe; border-color: #0f62fe; color: #fff; }
    button[hidden] { display: none; }
    .out { white-space: pre-wrap; max-height: 220px; overflow: auto; border: 1px solid #c8c8d0; border-radius: 6px; padding: 8px; min-height: 52px; margin-bottom: 8px; }
    .status { font-size: 11px; opacity: .7; }
    .err { color: #d93025; opacity: 1; }
    .close { margin-left: auto; border: 0; padding: 0 6px; font-size: 16px; }
  `;

  function build() {
    host = document.createElement("div");
    host.setAttribute("data-twp-panel", "");
    host.style.cssText = "all: initial;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <div class="panel" role="dialog" aria-label="Translation">
        <div class="row"><select class="lang" aria-label="Target language"></select><span class="status"></span><button class="close" aria-label="Close">&times;</button></div>
        <div class="out" aria-live="polite"></div>
        <div class="row" style="margin-bottom:0">
          <button class="primary replace" hidden>Replace</button>
          <button class="copy">Copy</button>
          <button class="win" style="margin-left:auto">Window</button>
        </div>
      </div>`;
    ui = {
      panel: root.querySelector(".panel"),
      lang: root.querySelector(".lang"),
      out: root.querySelector(".out"),
      status: root.querySelector(".status"),
      replace: root.querySelector(".replace"),
      copy: root.querySelector(".copy"),
      win: root.querySelector(".win"),
      close: root.querySelector(".close"),
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
    try {
      saved = localStorage.getItem(KEY_TARGET);
    } catch (e) {}
    const ui2 = twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) || "en";
    ui.lang.value = saved || twpConfig.get("targetLanguage") || ui2;
    if (!ui.lang.value) ui.lang.value = "en";

    // Un clic dans le panneau ne doit pas faire perdre sa sélection ou son curseur au champ de la page.
    ui.panel.addEventListener("mousedown", (e) => {
      if (e.target.tagName !== "SELECT") e.preventDefault();
    });
    ui.lang.addEventListener("change", () => {
      try {
        localStorage.setItem(KEY_TARGET, ui.lang.value);
      } catch (e) {}
      translateNow();
    });
    ui.replace.addEventListener("click", () => {
      const text = ui.out.dataset.text;
      if (field && text) replaceInField(field, text, ui.out.dataset.scope === "selection");
    });
    ui.copy.addEventListener("click", async () => {
      const text = ui.out.dataset.text || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setStatus("Copied");
      } catch (e) {
        setStatus("Copy failed", true);
      }
    });
    ui.win.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "twpOpenComposer", text: currentSource().text });
    });
    ui.close.addEventListener("click", () => show(false));
    document.documentElement.appendChild(host);
  }

  function setStatus(text, error) {
    ui.status.textContent = text;
    ui.status.className = "status" + (error ? " err" : "");
  }

  // Ce qu'il faut traduire en ce moment.
  function currentSource() {
    if (mode === "field" && field && document.contains(field)) {
      const part = fieldSelection(field);
      return part ? { text: part, scope: "selection" } : { text: getText(field), scope: "all" };
    }
    return { text: selectionText, scope: "selection" };
  }

  function anchorRect() {
    if (mode === "field" && field && document.contains(field)) return field.getBoundingClientRect();
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      if (r.width || r.height) return r;
    }
    return { left: window.innerWidth / 2 - 180, right: window.innerWidth / 2 + 180, top: 80, bottom: 80 };
  }

  function place() {
    if (!open) return;
    const r = anchorRect();
    const pw = Math.min(360, window.innerWidth - 8);
    ui.panel.style.left = Math.max(4, Math.min(window.innerWidth - pw - 4, r.left)) + "px";
    const below = r.bottom + 8;
    if (window.innerHeight - below > 260) {
      ui.panel.style.top = below + "px";
      ui.panel.style.bottom = "auto";
    } else {
      ui.panel.style.bottom = Math.max(4, window.innerHeight - r.top + 8) + "px";
      ui.panel.style.top = "auto";
    }
  }

  function show(visible) {
    if (visible && !host) build();
    open = visible;
    if (!ui) return;
    ui.panel.style.display = visible ? "block" : "none";
    if (visible) {
      ui.replace.hidden = mode !== "field";
      place();
      translateNow();
    }
  }

  // ---- traduction ----
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
    if (!open) return;
    const { text, scope } = currentSource();
    const mine = ++ticket;
    if (!text.trim()) {
      ui.out.textContent = "";
      ui.out.dataset.text = "";
      setStatus(mode === "field" ? "The field is empty" : "");
      return;
    }
    setStatus("Translating...");
    const target = ui.lang.value;
    let r = await ask({ action: "llmLive", text, sourceLanguage: "auto", targetLanguage: target });
    if (!r || !r.ok) {
      // Pas de clé IA, ou échec de l'IA : traducteur gratuit d'origine.
      const f = await ask({ action: "translateSingleText", translationService: "google", sourceLanguage: "auto", targetLanguage: target, source: text });
      r = typeof f === "string" ? { ok: true, text: f, free: true } : { ok: false };
    }
    if (mine !== ticket) return;
    if (r.ok) {
      ui.out.textContent = r.text;
      ui.out.dataset.text = r.text;
      ui.out.dataset.scope = scope;
      setStatus(r.free ? "Free translator" : "AI");
    } else {
      setStatus("Translation failed", true);
    }
    place();
  }

  // ---- événements ----
  // Le champ visé est celui sur lequel on fait le clic droit (ou qui avait le focus).
  document.addEventListener(
    "contextmenu",
    (e) => {
      const el = editableRoot(e.target);
      if (isEditable(el)) field = el;
    },
    true
  );
  document.addEventListener(
    "focusin",
    (e) => {
      const el = editableRoot(e.target);
      if (isEditable(el) && el !== host) field = el;
    },
    true
  );
  // Pendant que le panneau est ouvert sur un champ, la traduction suit ce qu'on écrit.
  document.addEventListener(
    "input",
    (e) => {
      if (open && mode === "field" && editableRoot(e.target) === field) {
        clearTimeout(timer);
        timer = setTimeout(translateNow, DELAY_MS);
      }
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && open) show(false);
    },
    true
  );
  document.addEventListener(
    "mousedown",
    (e) => {
      if (open && host && !e.composedPath().includes(host)) show(false);
    },
    true
  );
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "twpPanel") {
      mode = request.mode;
      selectionText = request.text || "";
      if (mode === "field") {
        const active = editableRoot(document.activeElement);
        if (!field || !document.contains(field)) field = isEditable(active) ? active : null;
        if (!field) mode = "selection"; // pas de champ trouvé : on traduit la sélection s'il y en a une
      }
      show(true);
    } else if (request.action === "twpInsertText") {
      // Insertion demandée par la fenêtre de message (« Insert in the page »).
      const el = field && document.contains(field) ? field : null;
      if (!el) return; // un autre cadre de la page répondra
      insertAtCaret(el, request.text);
      sendResponse(true);
    }
  });
})();
