// Translation panel opened from the right-click menu:
//   "Translate selection"          -> translates the selected text (read only)
//   "Translate what I'm writing"   -> translates the content of the input field, live while typing;
//                                       "Replace" replaces the field's text (or the selected part)
// Zero configuration: source detected, target language = the last one chosen, AI (Groq) if a key is saved.
(function () {
  "use strict";
  if (window.__twpPanel) return;
  window.__twpPanel = true;

  const DELAY_MS = 500;

  let field = null; // last input field encountered
  // Selection made in a field at the moment the panel opens (it can disappear when clicking in the panel).
  let savedSelectionText = "";
  let savedSelStart = null;
  let savedSelEnd = null;
  let savedRange = null;
  let lastPointer = null; // last mouse position (to place the bubble near a selection made in a field)
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
  // For a rich editor, the outermost contenteditable element.
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

  // Selected part of the field, if there is one.
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
  // Returns false if the part to replace could not be found again (the text changed in the meantime).
  function replaceInField(el, text, onlySelection) {
    el.focus();
    if (isFormField(el)) {
      if (!onlySelection) {
        setNativeValue(el, text);
        return true;
      }
      let a = el.selectionStart;
      let b = el.selectionEnd;
      if (!(b > a)) {
        // Selection lost: find it again using the remembered positions, if the text is still the same.
        if (savedSelStart !== null && el.value.slice(savedSelStart, savedSelEnd).trim() === savedSelectionText) {
          a = savedSelStart;
          b = savedSelEnd;
        } else {
          return false;
        }
      }
      setNativeValue(el, el.value.slice(0, a) + text + el.value.slice(b));
      el.setSelectionRange(a, a + text.length);
      return true;
    }
    if (!onlySelection) {
      document.execCommand("selectAll");
    } else {
      const sel = window.getSelection();
      if ((!sel || sel.isCollapsed) && savedRange) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }
    if (!document.execCommand("insertText", false, text)) el.textContent = text;
    return true;
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

  // ---- interface (shadow DOM: isolated from the page's styles) ----
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel { position: fixed; z-index: 2147483647; width: 380px; max-width: calc(100vw - 16px); background: #1c1c1e; color: #f2f2f4;
      border: 1px solid #3a3a3e; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 10px; display: none; }
    .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    select, button { font: inherit; border: 1px solid #3a3a3e; border-radius: 6px; padding: 4px 8px; background: transparent; color: inherit; cursor: pointer; }
    select { flex: 1; min-width: 0; color-scheme: dark; }
    option, optgroup { background: #26262a; color: #f2f2f4; }
    optgroup { font-weight: 700; }
    option { font-weight: 400; }
    button.primary { background: #0f62fe; border-color: #0f62fe; color: #fff; }
    button[hidden] { display: none; }
    .out { font-size: 15px; white-space: pre-wrap; max-height: 220px; overflow: auto; border: 1px solid #3a3a3e; border-radius: 6px; padding: 8px; min-height: 52px; margin-bottom: 8px; }
    .what { font-size: 12px; opacity: .75; white-space: nowrap; }
    .status { font-size: 11px; opacity: .7; }
    .err { color: #d93025; opacity: 1; }
    .refresh { margin-left: auto; border: 0; padding: 2px 6px; display: inline-flex; align-items: center; }
    .refresh:hover { color: #4589ff; }
    .refresh + .close { margin-left: 0; }
    .close { margin-left: auto; border: 0; padding: 0 6px; font-size: 16px; }
  `;

  function build() {
    host = document.createElement("div");
    host.setAttribute("data-twp-panel", "");
    host.style.cssText = "all: initial;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>
      <div class="panel" role="dialog" aria-label="Translation">
        <div class="row"><span class="what"></span><select class="lang" aria-label="Target language"></select><span class="status"></span><button class="refresh" aria-label="Translate again" title="Translate again"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg></button><button class="close" aria-label="Close">&times;</button></div>
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
      what: root.querySelector(".what"),
      out: root.querySelector(".out"),
      status: root.querySelector(".status"),
      replace: root.querySelector(".replace"),
      copy: root.querySelector(".copy"),
      win: root.querySelector(".win"),
      refresh: root.querySelector(".refresh"),
      close: root.querySelector(".close"),
    };
    twpLang.fillLanguageSelect(ui.lang);
    // The target language is the same everywhere (menu, page, message window): the one in twpConfig.
    const ui2 = twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) || "en";
    ui.lang.value = currentLanguage() || ui2;
    if (!ui.lang.value) ui.lang.value = "en";

    // A click in the panel must not make the page's field lose its selection or cursor.
    ui.panel.addEventListener("mousedown", (e) => {
      if (e.target.tagName !== "SELECT") e.preventDefault();
    });
    ui.lang.addEventListener("change", () => {
      // Written text: the writing language is changed; read text: the reading language. The two are independent.
      if (mode === "field") {
        twpConfig.set("writeLanguage", ui.lang.value);
      } else {
        twpConfig.set("targetLanguageChosen", "yes");
        twpConfig.set("targetLanguage", ui.lang.value);
      }
      translateNow();
    });
    ui.replace.addEventListener("click", () => {
      const text = ui.out.dataset.text;
      if (!field || !text) return;
      if (replaceInField(field, text, ui.out.dataset.scope === "selection")) show(false);
      else setStatus("The selected text changed: select it again", true);
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
    ui.refresh.addEventListener("click", () => translateNow(true));
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
      const part = fieldSelection(field) || savedSelectionText;
      return part ? { text: part, scope: "selection" } : { text: getText(field), scope: "all" };
    }
    return { text: selectionText, scope: "selection" };
  }

  let anchorOverride = null; // location of the selected text at the moment of the click on the bubble

  function anchorRect() {
    if (anchorOverride && (mode === "selection" || mode === "field")) return anchorOverride;
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
    const pw = Math.min(380, window.innerWidth - 8);
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

  // Written text (input field) = writing language; displayed text (page, selection) = reading language.
  const languageKey = () => (mode === "field" ? "writeLanguage" : "targetLanguage");
  const currentLanguage = () => twpConfig.get(languageKey());

  function show(visible) {
    if (visible && !host) build();
    open = visible;
    if (!ui) return;
    ui.panel.style.display = visible ? "block" : "none";
    if (visible) {
      ui.replace.hidden = mode !== "field";
      ui.what.textContent = mode === "field" ? "Write in" : "Read in";
      ui.lang.value = currentLanguage() || ui.lang.value;
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

  // Translations already obtained (target language + text): closing then reopening the bubble on the same text does not call the AI again.
  // The "Translate again" button ignores this memory. Failures are never kept.
  const memory = new Map();
  const MEMORY_MAX = 200;
  function remember(key, value) {
    memory.delete(key);
    memory.set(key, value);
    if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
  }

  async function translateNow(force) {
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
    const target = ui.lang.value;
    const memoryKey = target + " " + text;
    const kept = force === true ? undefined : memory.get(memoryKey);
    if (kept) {
      ui.out.textContent = kept.text;
      ui.out.dataset.text = kept.text;
      ui.out.dataset.scope = scope;
      setStatus(kept.free ? "Free translator (kept)" : "AI (kept)");
      place();
      return;
    }
    setStatus("Translating...");
    let r = await ask({ action: "llmLive", text, sourceLanguage: "auto", targetLanguage: target });
    if (!r || !r.ok) {
      // No AI key, or the AI failed: original free translator.
      const f = await ask({ action: "translateSingleText", translationService: "google", sourceLanguage: "auto", targetLanguage: target, source: text });
      r = typeof f === "string" ? { ok: true, text: f, free: true } : { ok: false };
    }
    if (mine !== ticket) return;
    if (r.ok) {
      remember(memoryKey, { text: r.text, free: !!r.free });
      ui.out.textContent = r.text;
      ui.out.dataset.text = r.text;
      ui.out.dataset.scope = scope;
      setStatus(r.free ? "Free translator" : "AI");
    } else {
      setStatus("Translation failed", true);
    }
    place();
  }

  twpConfig.onChanged((name, value) => {
    if (name === languageKey() && ui && value && ui.lang.value !== value) {
      ui.lang.value = value;
      if (open) translateNow();
    }
  });

  // ---- bubble on the selected text: a click opens the panel with the translation ----
  let bubble = null; // { host, el, timer }
  const BUBBLE_MIN_CHARS = 2;
  const BUBBLE_MAX_CHARS = 5000;

  function hideBubble() {
    if (!bubble) return;
    clearTimeout(bubble.timer);
    bubble.host.remove();
    bubble = null;
  }

  // Rectangle near the mouse if it is over the field (selection made with the mouse), otherwise the field itself.
  function rectNearPointer(el) {
    const r = el.getBoundingClientRect();
    if (lastPointer && lastPointer.x >= r.left && lastPointer.x <= r.right && lastPointer.y >= r.top && lastPointer.y <= r.bottom) {
      return { left: lastPointer.x, right: lastPointer.x, top: lastPointer.y - 8, bottom: lastPointer.y + 8 };
    }
    return { left: r.left, right: r.left + 1, top: r.bottom - 20, bottom: r.bottom };
  }

  // What is selected and where: { text, rect, field, start, end } or null.
  function readSelection() {
    // In an input field (input, textarea) the browser does not expose the selection through window.getSelection().
    const active = editableRoot(document.activeElement);
    if (active && isFormField(active) && isEditable(active)) {
      const a = active.selectionStart;
      const b = active.selectionEnd;
      if (a == null || b == null || b <= a) return null;
      const text = active.value.slice(a, b).trim();
      if (text.length < BUBBLE_MIN_CHARS) return null;
      return { text: text.slice(0, BUBBLE_MAX_CHARS), rect: rectNearPointer(active), field: active, start: a, end: b };
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    // Not in our own panels; not in a password field.
    if (anchor && anchor.closest && (anchor.closest("[data-twp-panel],[data-twp-bubble]") || anchor.closest("input[type=password]"))) return null;
    const text = sel.toString().trim();
    if (text.length < BUBBLE_MIN_CHARS) return null;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const last = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    if (!last || (!last.width && !last.height)) return null;
    const root = anchor ? editableRoot(anchor) : null;
    return {
      text: text.slice(0, BUBBLE_MAX_CHARS),
      rect: { left: last.left, right: last.right, top: last.top, bottom: last.bottom },
      field: root && isEditable(root) ? root : null, // text selected in a rich editor (Teams, Outlook web...)
      start: null,
      end: null,
    };
  }

  function showBubble() {
    if (twpConfig.get("showTranslateSelectedButton") === "no") return hideBubble();
    const info = readSelection();
    if (!info) return hideBubble();
    const text = info.text;
    const last = info.rect;
    if (!bubble) {
      const host = document.createElement("div");
      host.setAttribute("data-twp-bubble", "");
      host.style.cssText = "all: initial;";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>
        /* The logo itself is the button: no circle around it. */
        button { position: fixed; z-index: 2147483647; width: 18px; height: 18px; padding: 0; border: 0; background: transparent; cursor: pointer; }
        img { width: 18px; height: 18px; display: block; }
        /* Fallback when the logo cannot be loaded. */
        button.letter { border-radius: 4px; background: #4589ff; color: #fff; font: 700 11px/1 system-ui, sans-serif; }
      </style><button title="Translate the selection" aria-label="Translate the selection"></button>`;
      const el = root.querySelector("button");
      // The extension's logo; the letter "A" if the icon cannot be loaded.
      const logo = document.createElement("img");
      logo.alt = "";
      logo.addEventListener("error", () => { logo.remove(); el.classList.add("letter"); el.textContent = "A"; });
      try { logo.src = chrome.runtime.getURL("/icons/icon-32.png"); el.appendChild(logo); } catch (e) { el.classList.add("letter"); el.textContent = "A"; }
      // The selection must survive the click on the bubble.
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", () => {
        // The small panel opens just below the selected text (the "Window" button opens the message window).
        const info = readSelection() || bubble.info;
        anchorOverride = bubble.anchor || null;
        if (info.field) {
          // Text written by the user: the selection is translated and "Replace" replaces it (like DeepL).
          mode = "field";
          field = info.field;
          savedSelectionText = info.text;
          savedSelStart = info.start;
          savedSelEnd = info.end;
          const sel = window.getSelection();
          savedRange = !isFormField(info.field) && sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        } else {
          mode = "selection";
          selectionText = info.text;
          savedSelectionText = "";
        }
        hideBubble();
        show(true);
      });
      document.documentElement.appendChild(host);
      bubble = { host, el, timer: null, text, info };
    }
    bubble.text = text;
    bubble.info = info;
    bubble.anchor = { left: last.left, right: last.right, top: last.top, bottom: last.bottom };
    const size = 18;
    bubble.el.style.left = Math.max(4, Math.min(window.innerWidth - size - 4, last.right + 4)) + "px";
    bubble.el.style.top = Math.max(4, Math.min(window.innerHeight - size - 4, last.bottom + 4)) + "px";
    clearTimeout(bubble.timer);
    bubble.timer = setTimeout(hideBubble, 8000); // the bubble disappears by itself
  }

  // Wait for the end of the gesture (mouse released or key released) before showing the bubble.
  document.addEventListener("mouseup", (e) => {
    if (e.composedPath().some((n) => n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-twp-bubble"))) return;
    setTimeout(showBubble, 10);
  }, true);
  document.addEventListener("keyup", (e) => {
    if (e.shiftKey || e.key === "Shift") setTimeout(showBubble, 10);
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (!e.composedPath().some((n) => n.nodeType === 1 && n.hasAttribute && n.hasAttribute("data-twp-bubble"))) hideBubble();
  }, true);
  document.addEventListener("selectionchange", () => {
    if (bubble && !readSelection()) hideBubble();
  });
  // Mouse position: the bubble is placed near a selection made in a field.
  document.addEventListener("mouseup", (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
  window.addEventListener("scroll", () => hideBubble(), true);

  // ---- events ----
  // The target field is the one that was right-clicked (or had the focus).
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
  // While the panel is open on a field, the translation follows what is being typed.
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
  window.addEventListener("scroll", () => {
    anchorOverride = null; // after scrolling, realign on the current selection
    place();
  }, true);
  window.addEventListener("resize", place);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "twpPanel") {
      mode = request.mode;
      selectionText = request.text || "";
      anchorOverride = null;
      savedSelectionText = "";
      savedSelStart = null;
      savedSelEnd = null;
      savedRange = null;
      if (mode === "field") {
        const active = editableRoot(document.activeElement);
        if (!field || !document.contains(field)) field = isEditable(active) ? active : null;
        if (!field) mode = "selection"; // no field found: translate the selection if there is one
      }
      show(true);
    } else if (request.action === "twpInsertText") {
      // Insertion requested by the message window ("Insert in the page").
      const el = field && document.contains(field) ? field : null;
      if (!el) return; // another frame of the page will answer
      insertAtCaret(el, request.text);
      sendResponse(true);
    }
  });
})();
