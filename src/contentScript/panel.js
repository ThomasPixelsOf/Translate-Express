// Panneau de traduction ouvert depuis le menu du clic droit :
//   « Translate selection »          -> traduit le texte sélectionné (lecture seule)
//   « Translate what I'm writing »   -> traduit le contenu du champ de saisie, en direct pendant qu'on écrit ;
//                                       « Replace » remplace le texte du champ (ou la partie sélectionnée)
// Zéro réglage : source détectée, langue cible = la dernière choisie, IA (Groq) si une clé est enregistrée.
(function () {
  "use strict";
  if (window.__twpPanel) return;
  window.__twpPanel = true;

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
    * { box-sizing: border-box; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
    .panel { position: fixed; z-index: 2147483647; width: 380px; max-width: calc(100vw - 16px); background: #fff; color: #1d1d1f;
      border: 1px solid #c8c8d0; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 10px; display: none; }
    @media (prefers-color-scheme: dark) { .panel { background: #1c1c1e; color: #f2f2f4; border-color: #3a3a3e; } }
    .row { display: flex; gap: 6px; align-items: center; margin-bottom: 8px; }
    select, button { font: inherit; border: 1px solid #c8c8d0; border-radius: 6px; padding: 4px 8px; background: transparent; color: inherit; cursor: pointer; }
    select { flex: 1; min-width: 0; color-scheme: light dark; }
    option, optgroup { background: #fff; color: #1d1d1f; }
    @media (prefers-color-scheme: dark) { option, optgroup { background: #26262a; color: #f2f2f4; } }
    optgroup { font-weight: 700; }
    option { font-weight: 400; }
    button.primary { background: #0f62fe; border-color: #0f62fe; color: #fff; }
    button[hidden] { display: none; }
    .out { font-size: 15px; white-space: pre-wrap; max-height: 220px; overflow: auto; border: 1px solid #c8c8d0; border-radius: 6px; padding: 8px; min-height: 52px; margin-bottom: 8px; }
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
    twpLang.fillLanguageSelect(ui.lang);
    // La langue cible est la même partout (menu, page, fenêtre de message) : celle de twpConfig.
    const ui2 = twpLang.fixTLanguageCode(chrome.i18n.getUILanguage()) || "en";
    ui.lang.value = twpConfig.get("targetLanguage") || ui2;
    if (!ui.lang.value) ui.lang.value = "en";

    // Un clic dans le panneau ne doit pas faire perdre sa sélection ou son curseur au champ de la page.
    ui.panel.addEventListener("mousedown", (e) => {
      if (e.target.tagName !== "SELECT") e.preventDefault();
    });
    ui.lang.addEventListener("change", () => {
      twpConfig.set("targetLanguage", ui.lang.value);
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

  let anchorOverride = null; // emplacement du texte sélectionné au moment du clic sur la bulle

  function anchorRect() {
    if (mode === "selection" && anchorOverride) return anchorOverride;
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

  twpConfig.onChanged((name, value) => {
    if (name === "targetLanguage" && ui && value && ui.lang.value !== value) {
      ui.lang.value = value;
      if (open) translateNow();
    }
  });

  // ---- volet collé au bord droit (fenêtre de message et réglages) ----
  let dock = null; // { host, frame, readyTimer }
  const DOCK_WIDTH_KEY = "twpDockWidth";

  function closeDock() {
    if (!dock) return;
    clearTimeout(dock.readyTimer);
    dock.host.remove();
    dock = null;
  }

  function openDockPanel(view) {
    if (window !== window.top) return false;
    closeDock();
    const host = document.createElement("div");
    host.setAttribute("data-twp-dock", "");
    host.style.cssText = "all: initial;";
    const root = host.attachShadow({ mode: "open" });
    let width = 400;
    try {
      width = Math.min(Math.max(Number(localStorage.getItem(DOCK_WIDTH_KEY)) || 400, 320), Math.floor(window.innerWidth * 0.8));
    } catch (e) {}
    root.innerHTML = `<style>
      .dock { position: fixed; top: 0; right: 0; height: 100vh; width: ${width}px; z-index: 2147483647; display: flex; background: #fff;
        box-shadow: -4px 0 18px rgba(0,0,0,.28); border-left: 1px solid #c8c8d0; }
      @media (prefers-color-scheme: dark) { .dock { background: #1c1c1e; border-left-color: #3a3a3e; } }
      .grip { width: 6px; cursor: ew-resize; background: transparent; flex: none; }
      .grip:hover { background: rgba(15,98,254,.35); }
      iframe { flex: 1; border: 0; min-width: 0; height: 100%; color-scheme: normal; }
      .x { position: absolute; top: 6px; right: 8px; z-index: 1; width: 26px; height: 26px; border-radius: 13px; border: 0; cursor: pointer;
        background: rgba(128,128,128,.25); color: inherit; font: 16px/1 system-ui, sans-serif; }
    </style>
    <div class="dock"><div class="grip" title="Drag to resize"></div>
      <iframe title="Translation"></iframe><button class="x" aria-label="Close">&times;</button></div>`;
    const frame = root.querySelector("iframe");
    const dockEl = root.querySelector(".dock");
    const page = view === "setup" ? "/setup/setup.html" : "/composer/composer.html";
    frame.src = chrome.runtime.getURL(page + "?dock=1");
    root.querySelector(".x").addEventListener("click", closeDock);

    // Redimensionnement à la souris ; la largeur choisie est mémorisée.
    root.querySelector(".grip").addEventListener("mousedown", (down) => {
      down.preventDefault();
      frame.style.pointerEvents = "none";
      const move = (e) => {
        width = Math.min(Math.max(window.innerWidth - e.clientX, 320), Math.floor(window.innerWidth * 0.8));
        dockEl.style.width = width + "px";
      };
      const up = () => {
        document.removeEventListener("mousemove", move, true);
        document.removeEventListener("mouseup", up, true);
        frame.style.pointerEvents = "";
        try { localStorage.setItem(DOCK_WIDTH_KEY, String(width)); } catch (e) {}
      };
      document.addEventListener("mousemove", move, true);
      document.addEventListener("mouseup", up, true);
    });

    document.documentElement.appendChild(host);
    dock = { host, frame, view, readyTimer: null };
    // Si la page interdit d'afficher le volet (en-têtes de sécurité), il ne dira jamais « prêt » : fenêtre séparée.
    dock.readyTimer = setTimeout(() => {
      closeDock();
      try { chrome.runtime.sendMessage({ action: "twpFallbackWindow", view }); } catch (e) {}
    }, 2500);
    return true;
  }

  // Messages venant du volet (la page du volet est dans un cadre d'une autre origine).
  window.addEventListener("message", (e) => {
    if (!dock || e.source !== dock.frame.contentWindow || !e.data || typeof e.data !== "object") return;
    if (e.data.twp === "ready") {
      clearTimeout(dock.readyTimer);
    } else if (e.data.twp === "close") {
      closeDock();
    } else if (e.data.twp === "navigate" && (e.data.view === "setup" || e.data.view === "composer")) {
      dock.frame.src = chrome.runtime.getURL((e.data.view === "setup" ? "/setup/setup.html" : "/composer/composer.html") + "?dock=1");
      clearTimeout(dock.readyTimer);
    } else if (e.data.twp === "insert" && typeof e.data.text === "string") {
      const el = field && document.contains(field) ? field : null;
      if (el) insertAtCaret(el, e.data.text);
      dock.frame.contentWindow.postMessage({ twp: "inserted", ok: !!el }, "*");
    }
  });

  // ---- bulle sur le texte sélectionné : un clic ouvre le volet avec la traduction ----
  let bubble = null; // { host, el, timer }
  const BUBBLE_MIN_CHARS = 2;
  const BUBBLE_MAX_CHARS = 5000;

  function hideBubble() {
    if (!bubble) return;
    clearTimeout(bubble.timer);
    bubble.host.remove();
    bubble = null;
  }

  function selectedPlainText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    // Pas dans nos propres panneaux ; pas dans un champ de mot de passe.
    if (anchor && anchor.closest && (anchor.closest("[data-twp-panel],[data-twp-dock],[data-twp-bubble]") || anchor.closest("input[type=password]"))) return null;
    const text = sel.toString().trim();
    return text.length >= BUBBLE_MIN_CHARS ? text.slice(0, BUBBLE_MAX_CHARS) : null;
  }

  function showBubble() {
    if (twpConfig.get("showTranslateSelectedButton") === "no") return hideBubble();
    const text = selectedPlainText();
    if (!text) return hideBubble();
    const sel = window.getSelection();
    const rects = sel.getRangeAt(0).getClientRects();
    const last = rects.length ? rects[rects.length - 1] : sel.getRangeAt(0).getBoundingClientRect();
    if (!last || (!last.width && !last.height)) return hideBubble();
    if (!bubble) {
      const host = document.createElement("div");
      host.setAttribute("data-twp-bubble", "");
      host.style.cssText = "all: initial;";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>
        button { position: fixed; z-index: 2147483647; width: 28px; height: 28px; padding: 0; border-radius: 14px; border: 1px solid rgba(0,0,0,.2);
          background: #0f62fe; color: #fff; cursor: pointer; font: 700 12px/1 system-ui, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
        button:hover { background: #0353e9; }
      </style><button title="Translate the selection" aria-label="Translate the selection">A</button>`;
      const el = root.querySelector("button");
      // La sélection doit survivre au clic sur la bulle.
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", () => {
        // Le petit panneau s'ouvre juste sous le texte sélectionné (le bouton « Window » ouvre le volet de la page).
        const current = selectedPlainText() || bubble.text;
        mode = "selection";
        selectionText = current;
        anchorOverride = bubble.anchor || null;
        hideBubble();
        show(true);
      });
      document.documentElement.appendChild(host);
      bubble = { host, el, timer: null, text };
    }
    bubble.text = text;
    bubble.anchor = { left: last.left, right: last.right, top: last.top, bottom: last.bottom };
    const size = 28;
    bubble.el.style.left = Math.max(4, Math.min(window.innerWidth - size - 4, last.right + 4)) + "px";
    bubble.el.style.top = Math.max(4, Math.min(window.innerHeight - size - 4, last.bottom + 4)) + "px";
    clearTimeout(bubble.timer);
    bubble.timer = setTimeout(hideBubble, 8000); // la bulle s'efface toute seule
  }

  // On attend la fin du geste (souris relâchée ou touche relâchée) avant d'afficher la bulle.
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
    const sel = window.getSelection();
    if (bubble && (!sel || sel.isCollapsed)) hideBubble();
  });
  window.addEventListener("scroll", () => hideBubble(), true);

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
  window.addEventListener("scroll", () => {
    anchorOverride = null; // après un défilement, on se recale sur la sélection actuelle
    place();
  }, true);
  window.addEventListener("resize", place);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "twpPanel") {
      mode = request.mode;
      selectionText = request.text || "";
      anchorOverride = null;
      if (mode === "field") {
        const active = editableRoot(document.activeElement);
        if (!field || !document.contains(field)) field = isEditable(active) ? active : null;
        if (!field) mode = "selection"; // pas de champ trouvé : on traduit la sélection s'il y en a une
      }
      show(true);
    } else if (request.action === "twpDock") {
      sendResponse(openDockPanel(request.view));
    } else if (request.action === "twpInsertText") {
      // Insertion demandée par la fenêtre de message (« Insert in the page »).
      const el = field && document.contains(field) ? field : null;
      if (!el) return; // un autre cadre de la page répondra
      insertAtCaret(el, request.text);
      sendResponse(true);
    }
  });
})();
