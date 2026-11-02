"use strict";

/**
 * This mark cannot contain words, like <customskipword>12</customskipword>34
 *
 * Google will reorder as <customskipword>1234</customskipword>
 *
 * Under certain circumstances，Google broken the translation, returned startMark0 in some cases
 * */
const startMark = "@%";
const endMark = "#$";
const startMark0 = "@ %";
const endMark0 = "# $";

const bingMarkFrontPart = '<mstrans:dictionary translation="';
const bingMarkSecondPart = '"></mstrans:dictionary>';

let currentIndex;
let compressionMap;

/**
 * ## custom dictionary functional preprocessing
 *
 * ### How to achieve:
 * 1. For Google and Yandex, this feature is not officially supported,
 *    we convert matching keywords to a string of special signs to skip translation,
 *    before sending to the translation engine,
 *    and after the results come back, call `handleCustomWords` to restore the words.
 * 2. For Bing, this feature is officially supported,
 *    we don't need to call `handleCustomWords`, Bing absorb these marks.
 *    And bing does not have the language restrictions in the third point below.
 *
 *  ### Notes:
 *  1. For English words, ignore case when matching.
 *  2. CustomDictionary must be sorted , we want to match the keyword "Spring Boot" first then the keyword "Spring"
 *  3. For the word "app" , We don't want to "Happy" also matched.
 *     So we match only isolated words, by checking the two characters before and after the keyword.
 *     But this will also cause this method to not work for Chinese, Burmese and other languages without spaces.
 * */
function filterKeywordsInText(
  textContext,
  sortedCustomDictionary,
  currentPageTranslatorService
) {
  if (sortedCustomDictionary.size > 0) {
    for (let keyWord of sortedCustomDictionary.keys()) {
      while (true) {
        let index = textContext.toLowerCase().indexOf(keyWord);
        if (index === -1) {
          break;
        } else {
          textContext = removeExtraDelimiter(textContext);
          let previousIndex = index - 1;
          let nextIndex = index + keyWord.length;
          let previousChar =
            previousIndex === -1 ? "\n" : textContext.charAt(previousIndex);
          let nextChar =
            nextIndex === textContext.length
              ? "\n"
              : textContext.charAt(nextIndex);
          let placeholderText = "";
          let keyWordWithCase = textContext.substring(
            index,
            index + keyWord.length
          );
          if (
            isPunctuationOrDelimiter(previousChar) &&
            isPunctuationOrDelimiter(nextChar)
          ) {
            /**
             * Bing's translation engine, officially provides custom dictionary function,
             * so it has its own separate tags.
             * At the same time we add a space before and after the word to make it look a little more comfortable.
             * */
            if (currentPageTranslatorService === "bing") {
              let customValue = sortedCustomDictionary.get(keyWord);
              if (customValue === "") customValue = keyWordWithCase;
              customValue =
                " " +
                customValue.substring(0, 1) +
                "#n%o#" +
                customValue.substring(1) +
                " ";
              placeholderText =
                bingMarkFrontPart + customValue + bingMarkSecondPart;
            } else {
              placeholderText =
                startMark + handleHitKeywords(keyWordWithCase, true) + endMark;
            }
          } else {
            placeholderText = "#n%o#";
            for (let c of Array.from(keyWordWithCase)) {
              placeholderText += c;
              placeholderText += "#n%o#";
            }
          }
          let frontPart = textContext.substring(0, index);
          let backPart = textContext.substring(index + keyWord.length);
          textContext = frontPart + placeholderText + backPart;
        }
      }
      textContext = textContext.replaceAll("#n%o#", "");
    }
  }
  return textContext;
}

/**
 *  handle the keywords in translatedText, replace it if there is a custom replacement value.
 *  When encountering Google Translate reordering, the original text contains our mark, etc.
 *  we will catch these exceptions and call the text translation method to retranslate this section.
 *
 * Note:
 *  1. Bing's translation engine has its own separate tags,and the engine digests these tags internally,
 *  we don't need to call the method below.
 **/
async function handleCustomWords(
  translated,
  originalText,
  customDictionary,
  currentPageTranslatorService,
  currentSourceLanguage,
  currentTargetLanguage
) {
  try {
    if (customDictionary.size > 0 && currentPageTranslatorService !== "bing") {
      // If the translation is a single word and exists in the dictionary, return it directly
      let customValue = customDictionary.get(originalText.trim());
      if (customValue) return customValue;

      translated = removeExtraDelimiter(translated);
      translated = translated.replaceAll(startMark0, startMark);
      translated = translated.replaceAll(endMark0, endMark);

      while (true) {
        let startIndex = translated.indexOf(startMark);
        let endIndex = translated.indexOf(endMark);
        if (startIndex === -1 && endIndex === -1) {
          break;
        } else {
          let placeholderText = translated.substring(
            startIndex + startMark.length,
            endIndex
          );
          // At this point placeholderText is actually currentIndex , the real value is in compressionMap
          let keyWord = handleHitKeywords(placeholderText, false);
          if (keyWord === "undefined") {
            throw new Error("undefined");
          }
          let frontPart = translated.substring(0, startIndex);
          let backPart = translated.substring(endIndex + endMark.length);
          let customValue = customDictionary.get(keyWord.toLowerCase());
          customValue = customValue === "" ? keyWord : customValue;
          // Highlight custom words, make it have a space before and after it
          frontPart = isPunctuationOrDelimiter(
            frontPart.charAt(frontPart.length - 1)
          )
            ? frontPart
            : frontPart + " ";
          backPart = isPunctuationOrDelimiter(backPart.charAt(0))
            ? backPart
            : " " + backPart;
          translated = frontPart + customValue + backPart;
        }
      }
    }
  } catch (e) {
    return await backgroundTranslateSingleText(
      currentPageTranslatorService,
      currentSourceLanguage,
      currentTargetLanguage,
      originalText
    );
  }

  return translated;
}

/**
 *
 * True : Store the keyword in the Map and return the index
 *
 * False : Extract keywords by index
 * */
function handleHitKeywords(value, mode) {
  if (mode) {
    if (currentIndex === undefined) {
      currentIndex = 1;
      compressionMap = new Map();
      compressionMap.set(currentIndex, value);
    } else {
      compressionMap.set(++currentIndex, value);
    }
    return String(currentIndex);
  } else {
    return String(compressionMap.get(Number(value)));
  }
}

/**
 * any kind of punctuation character (including international e.g. Chinese and Spanish punctuation), and spaces, newlines
 *
 * source: https://github.com/slevithan/xregexp/blob/41f4cd3fc0a8540c3c71969a0f81d1f00e9056a9/src/addons/unicode/unicode-categories.js#L142
 *
 * note: XRegExp unicode output taken from http://jsbin.com/uFiNeDOn/3/edit?js,console (see chrome console.log), then converted back to JS escaped unicode here http://rishida.net/tools/conversion/, then tested on http://regexpal.com/
 *
 * suggested by: https://stackoverflow.com/a/7578937
 *
 * added: extra characters like "$", "\uFFE5" [yen symbol], "^", "+", "=" which are not consider punctuation in the XRegExp regex (they are currency or mathmatical characters)
 *
 * added: Chinese Punctuation: \u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e
 *
 * added: special html space symbol: &nbsp; &ensp; &emsp; &thinsp; &zwnj; &zwj; -> \u00A0|\u2002|\u2003|\u2009|\u200C|\u200D
 * @see https://stackoverflow.com/a/21396529/19616126
 * */
function isPunctuationOrDelimiter(str) {
  if (typeof str !== "string") return false;
  if (str === "\n" || str === " ") return true;
  const regex =
    /[\$\uFFE5\^\+=`~<>{}\[\]|\u00A0|\u2002|\u2003|\u2009|\u200C|\u200D|\u3002|\uff1f|\uff01|\uff0c|\u3001|\uff1b|\uff1a|\u201c|\u201d|\u2018|\u2019|\uff08|\uff09|\u300a|\u300b|\u3010|\u3011|\u007e!-#%-\x2A,-/:;\x3F@\x5B-\x5D_\x7B}\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u0AF0\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E3B\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]+/g;
  return regex.test(str);
}

/**
 * get a sorted dictionary
 * */
function sortDictionary(customDictionary) {
  return new Map(
    [...customDictionary.entries()].sort(
      (a, b) => String(b[0]).length - String(a[0]).length
    )
  );
}

/**
 * Remove useless newlines, spaces inside, which may affect our semantics
 * */
function removeExtraDelimiter(textContext) {
  textContext = textContext.replaceAll("\n", " ");
  textContext = textContext.replace(/  +/g, " ");
  return textContext;
}

function backgroundTranslateHTML(
  translationService,
  sourceLanguage,
  targetLanguage,
  sourceArray2d,
  dontSortResults,
  priority = "high"
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateHTML",
        translationService,
        sourceLanguage,
        targetLanguage,
        sourceArray2d,
        dontSortResults,
        priority,
      },
      (response) => {
        checkedLastError();
        resolve(response);
      }
    );
  });
}

function backgroundTranslateText(
  translationService,
  sourceLanguage,
  targetLanguage,
  sourceArray
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateText",
        translationService,
        sourceLanguage,
        targetLanguage,
        sourceArray,
      },
      (response) => {
        checkedLastError();
        resolve(response);
      }
    );
  });
}

function backgroundTranslateSingleText(
  translationService,
  sourceLanguage,
  targetLanguage,
  source
) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        action: "translateSingleText",
        translationService,
        sourceLanguage,
        targetLanguage,
        source,
      },
      (response) => {
        checkedLastError();
        resolve(response);
      }
    );
  });
}

var pageTranslator = {};

function getTabHostName() {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "getTabHostName" }, (result) => {
      checkedLastError();
      resolve(result);
    })
  );
}

Promise.all([twpConfig.onReady(), getTabHostName()]).then(function (_) {
  const tabHostName = _[1];
  // "sup" não será traduzido https://github.com/FilipePS/Traduzir-paginas-web/issues/647
  /* prettier-ignore */
  const htmlTagsInlineText = ["#text", "a", "abbr", "acronym", "b", "bdo", "big", "cite", "dfn", "em", "i", "label", "q", "s", "small", "span", "strong", "sub", /*"sup",*/ "u", "tt", "var"];
  /* prettier-ignore */
  const htmlTagsInlineIgnore = ["br", "code", "kbd", "wbr"]; // and input if type is submit or button, and <pre> depending on settings
  /* prettier-ignore */
  const htmlTagsNoTranslate = ["title", "script", "style", "textarea", "svg", "template",
  "math", "mjx-container", "tex-math" // https://github.com/FilipePS/Traduzir-paginas-web/issues/704
  ];

  if (location.hostname === "pdf.translatewebpages.org") {
    const index = htmlTagsInlineText.indexOf("span");
    if (index !== -1) {
      htmlTagsInlineText.splice(index, 1);
    }
  }

  // https://github.com/FilipePS/Traduzir-paginas-web/issues/609
  if (
    twpConfig.get("translateTag_pre") !== "yes" &&
    !(
      document.body.childElementCount === 1 &&
      document.body.firstChild.nodeName.toLocaleLowerCase() === "pre"
    )
  ) {
    htmlTagsInlineIgnore.push("pre");
  }
  twpConfig.onChanged((name, newvalue) => {
    switch (name) {
      case "translateTag_pre":
        const index = htmlTagsInlineIgnore.indexOf("pre");
        if (index !== -1) {
          htmlTagsInlineIgnore.splice(index, 1);
        }
        if (
          newvalue !== "yes" &&
          !(
            document.body.childElementCount === 1 &&
            document.body.firstChild.nodeName.toLocaleLowerCase() === "pre"
          )
        ) {
          htmlTagsInlineIgnore.push("pre");
        }
        break;
      case "dontSortResults":
        dontSortResults = newvalue == "yes" ? true : false;
        break;
      case "pageTranslatorService":
        // Clé Groq enregistrée ou retirée pendant que la page est ouverte : on suit tout de suite.
        currentPageTranslatorService = newvalue;
        break;
    }
  });

  // (Retiré : le code d'origine remettait ici la langue cible sur la première langue du navigateur à CHAQUE chargement de
  // page, ce qui annulait le choix de l'utilisateur. La langue cible n'est modifiée que par l'utilisateur.)

  // Pieces are a set of nodes separated by inline tags that form a sentence or paragraph.
  let piecesToTranslate = [];
  let originalTabLanguage = "und";
  let currentPageLanguage = "und";
  let pageLanguageState = "original";
  let currentSourceLanguage = "auto";
  let currentTargetLanguage = twpConfig.get("targetLanguage");
  let currentPageTranslatorService = twpConfig.get("pageTranslatorService");
  let customDictionary = sortDictionary(twpConfig.get("customDictionary"));
  let dontSortResults =
    twpConfig.get("dontSortResults") == "yes" ? true : false;

  let fooCount = 0;

  let originalPageTitle;

  let attributesToTranslate = [];

  let translateNewNodesTimerHandler;
  let newNodes = [];
  let removedNodes = [];

  let nodesToRestore = [];

  // ================= Diagnostic : journal, rapport de page, garde-fou =================
  // Le journal part vers le service worker par petits paquets (voir background/diagnostics.js) ; le tableau de bord l'affiche.
  const diagEvents = [];
  let diagTimer = null;
  let translatedNodesCount = 0; // nœuds texte que nous avons traduits dans cette page

  function diagLog(type, data) {
    try {
      if (twpConfig.get("diagnostics") === "no") return;
      diagEvents.push({ type, data });
      if (diagEvents.length > 100) diagEvents.shift();
      if (!diagTimer) diagTimer = setTimeout(diagFlush, 1000);
    } catch (e) {
      /* le journal ne doit jamais gêner la traduction */
    }
  }
  function diagFlush() {
    diagTimer = null;
    if (diagEvents.length === 0) return;
    const entries = diagEvents.splice(0);
    try {
      chrome.runtime.sendMessage({ action: "twpLog", entries }, () => void chrome.runtime.lastError);
    } catch (e) {
      /* extension rechargée : on ignore */
    }
  }

  const stuckMs = () => Number(twpConfig.get("diagStuckMs")) || 45000; // un envoi sans réponse au-delà est considéré bloqué

  function elementPath(el) {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let s = n.nodeName.toLowerCase();
      if (n.id) s += "#" + n.id;
      else if (n.classList && n.classList.length) s += "." + n.classList[0];
      parts.unshift(s);
    }
    return parts.join(" > ");
  }

  // Pourquoi ce texte n'est volontairement pas traduit (null = rien ne l'en empêche). Reprend les règles de lecture de la page.
  function excludedReason(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const name = el.nodeName.toLowerCase();
      if (htmlTagsNoTranslate.indexOf(name) !== -1) return "tag <" + name + ">";
      if (el.isContentEditable) return "editable area";
      if (el.classList && el.classList.contains("notranslate")) return "class notranslate (set by the site)";
      if (el.getAttribute && el.getAttribute("translate") === "no") return 'translate="no" (set by the site)';
      if (htmlTagsInlineIgnore.indexOf(name) !== -1 && name !== "br" && name !== "wbr" && !isProseCode(el)) return "code (not prose)";
    }
    return null;
  }

  // Rapport détaillé de l'état de la page : pour chaque texte pas encore traduit, la raison.
  function buildPageReport() {
    const now = Date.now();
    const nodes = [];
    const collect = (root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = walker.nextNode()) && nodes.length < 6000) {
        if (n.nodeType === 3) {
          if (n.nodeValue.trim().length >= 2) nodes.push(n);
        } else if (n.shadowRoot) {
          collect(n.shadowRoot);
        }
      }
    };
    collect(document.body);

    const pieceOf = new Map();
    piecesToTranslate.forEach((ptt) => ptt.nodes.forEach((nd) => pieceOf.set(nd, ptt)));

    const counts = {};
    const excluded = {};
    const examples = {};
    const add = (category, node, extra) => {
      counts[category] = (counts[category] || 0) + 1;
      const list = (examples[category] = examples[category] || []);
      if (list.length < 8) list.push({ text: node.nodeValue.trim().slice(0, 70), path: elementPath(node.parentElement), ...extra });
    };

    for (const node of nodes) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest("script,style,noscript,[data-twp-panel],[data-twp-dock],[data-twp-bubble]")) continue;
      if (writtenText.has(node)) {
        counts.translated = (counts.translated || 0) + 1;
        continue;
      }
      const why = excludedReason(node);
      if (why) {
        excluded[why] = (excluded[why] || 0) + 1;
        add("excluded", node, { why });
        continue;
      }
      const ptt = pieceOf.get(node);
      if (ptt) {
        const dist = Math.round(distanceToScreen(ptt));
        if (!ptt.isTranslated) {
          if ((ptt.retries || 0) > MAX_PIECE_RETRIES) add("retriesExhausted", node, { retries: ptt.retries });
          else if (ptt.retryAt > now) add("waitingRetry", node, { retries: ptt.retries || 0, inMs: ptt.retryAt - now });
          else add("queued", node, { distancePx: dist >= 1e9 ? "hidden" : dist });
        } else if (!ptt.done) {
          add("inFlight", node, { sentMsAgo: ptt.sentAt ? now - ptt.sentAt : null, priority: ptt.priority });
        } else {
          add("answeredUnchanged", node, { note: "the engine answered but the text is the same (already in the target language, or untranslatable)" });
        }
      } else if (seenTextNodes.has(node)) {
        add("seenWithoutPiece", node, {});
      } else {
        add("unseen", node, { note: "not yet picked up: the safety sweep takes it within 4 s" });
      }
    }

    const pieces = piecesToTranslate;
    return {
      url: location.href,
      host: location.hostname,
      pageState: pageLanguageState,
      service: currentPageTranslatorService,
      target: currentTargetLanguage,
      flags: {
        dynamicContent: twpConfig.get("translateDynamicallyCreatedContent"),
        iframes: twpConfig.get("enableIframePageTranslation"),
        diagnostics: twpConfig.get("diagnostics"),
      },
      pieces: {
        total: pieces.length,
        pending: pieces.filter((x) => !x.isTranslated).length,
        inFlight: pieces.filter((x) => x.isTranslated && !x.done && x.sentAt).length,
        done: pieces.filter((x) => x.done).length,
        highInFlight,
        lowInFlight,
      },
      translatedNodes: translatedNodesCount,
      textNodesScanned: nodes.length,
      counts,
      excluded,
      examples,
      frame: window === window.top ? "top" : "sub",
    };
  }

  // Garde-fou : tout ce qui est parti sans réponse depuis trop longtemps est remis dans la file, les compteurs bloqués sont remis
  // à zéro, et un blocage est consigné avec son état.
  let watchdogTimerHandler;
  let lastSentAt = 0;
  let lastProgressKey = "";
  function watchdog() {
    if (pageLanguageState !== "translated") return;
    const now = Date.now();
    let stuck = 0;
    for (const ptt of piecesToTranslate) {
      if (ptt.isTranslated && ptt.sentAt && !ptt.done && now - ptt.sentAt > stuckMs()) {
        ptt.isTranslated = false;
        ptt.sentAt = 0;
        ptt.retries = (ptt.retries || 0) + 1;
        ptt.retryAt = now + 1000;
        stuck++;
      }
    }
    if (stuck) diagLog("guard.stuck-pieces", { pieces: stuck, afterMs: stuckMs() });
    if ((highInFlight > 0 || lowInFlight) && lastSentAt && now - lastSentAt > stuckMs()) {
      diagLog("guard.inflight-reset", { highInFlight, lowInFlight });
      highInFlight = 0;
      lowInFlight = false;
    }
    const pending = piecesToTranslate.filter((x) => !x.isTranslated).length;
    const inFlight = piecesToTranslate.filter((x) => x.isTranslated && !x.done && x.sentAt).length;
    const exhausted = piecesToTranslate.filter((x) => !x.isTranslated && (x.retries || 0) > MAX_PIECE_RETRIES).length;
    if (pending > 0 && highInFlight === 0 && !lowInFlight && lastSentAt && now - lastSentAt > 20000) {
      diagLog("guard.stall", { pending, exhausted, waitingRetry: piecesToTranslate.filter((x) => !x.isTranslated && x.retryAt > now).length });
      lastHighSentAt = 0; // le travail de fond reprend sans attendre
    }
    const key = [piecesToTranslate.length, pending, inFlight, exhausted, translatedNodesCount].join("/");
    if (key !== lastProgressKey) {
      lastProgressKey = key;
      diagLog("page.progress", { pieces: piecesToTranslate.length, pending, inFlight, exhausted, translatedNodes: translatedNodesCount, high: highInFlight, low: lowInFlight });
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "twpPageReport") {
      try {
        sendResponse(buildPageReport());
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e) });
      }
    } else if (request.action === "twpPageScan") {
      lastHighSentAt = 0;
      sweepForMissedText();
      sendResponse(true);
    }
  });

  // Textes déjà pris en charge (collectés, ou écrits par nous). Sert à repérer ceux qui ont échappé à la traduction :
  // texte ajouté après coup, texte modifié par la page, texte dans une zone isolée (shadow DOM)...
  let seenTextNodes = new WeakSet();
  const writtenText = new WeakMap(); // nœud texte -> texte que NOUS y avons écrit (pour ne pas confondre avec un changement de la page)

  function markSeen(node) {
    if (!node) return;
    seenTextNodes.add(node);
    if (node.nodeType === 1) {
      for (const child of node.childNodes) if (child.nodeType === 3) seenTextNodes.add(child);
    }
  }

  // Ajoute à la file seulement les nœuds texte jamais vus ; retourne le nombre de morceaux ajoutés.
  function adoptPieces(newPieces) {
    let added = 0;
    for (const piece of newPieces) {
      const fresh = piece.nodes.filter((n) => !seenTextNodes.has(n));
      if (fresh.length === 0) continue;
      fresh.forEach((n) => seenTextNodes.add(n));
      piece.nodes = fresh;
      piece.isTranslated = false;
      piecesToTranslate.push(piece);
      added++;
    }
    return added;
  }

  function translateNewNodes() {
    try {
      newNodes.forEach((nn) => {
        if (removedNodes.indexOf(nn) != -1) return;
        adoptPieces(getPiecesToTranslate(nn));
      });
    } catch (e) {
      console.error(e);
    } finally {
      newNodes = [];
      removedNodes = [];
    }
  }

  // Balayage de sécurité : toutes les 4 s, on relit la page et on traduit ce qui a échappé à tous les autres mécanismes.
  let sweepTimerHandler;
  function sweepForMissedText() {
    try {
      if (pageLanguageState !== "translated" || !pageIsVisible) return;
      adoptPieces(getPiecesToTranslate(document.body));
    } catch (e) {
      console.error(e);
    }
  }

  const MUTATION_OPTIONS = { childList: true, subtree: true, characterData: true };
  let mutationObserverActive = false;

  const mutationObserver = new MutationObserver(function (mutations) {
    const queue = [];
    const enqueue = (el) => {
      if (el && queue.indexOf(el) == -1) queue.push(el);
    };

    mutations.forEach((mutation) => {
      if (mutation.type === "characterData") {
        // Le texte d'un nœud existant a changé. Si ce n'est pas nous qui l'avons écrit, c'est la page : à retraduire.
        const target = mutation.target;
        if (writtenText.get(target) === target.nodeValue) return;
        seenTextNodes.delete(target);
        if (target.parentNode && !isNoTranslateNode(target.parentNode)) enqueue(target.parentNode);
        return;
      }

      mutation.addedNodes.forEach((addedNode) => {
        if (addedNode.nodeType !== 1 && addedNode.nodeType !== 3) return;
        const nodeName = addedNode.nodeName.toLowerCase();
        if (isNoTranslateNode(addedNode)) return;
        if (htmlTagsInlineText.indexOf(nodeName) == -1) {
          if (htmlTagsInlineIgnore.indexOf(nodeName) == -1) enqueue(addedNode);
        } else if (addedNode.parentNode) {
          // Texte ou élément en ligne ajouté : avant, il était ignoré. On repart de son parent.
          enqueue(addedNode.parentNode);
        }
      });

      mutation.removedNodes.forEach((removedNode) => {
        removedNodes.push(removedNode);
      });
    });

    queue.forEach((el) => {
      if (newNodes.indexOf(el) == -1) newNodes.push(el);
    });
  });

  // Les zones isolées (shadow DOM ouvert) ne sont pas vues par l'observateur de la page : on les surveille une à une.
  function observeShadowRoot(shadowRoot) {
    try {
      if (mutationObserverActive) mutationObserver.observe(shadowRoot, MUTATION_OPTIONS);
    } catch (e) {
      /* zone fermée ou déjà observée */
    }
  }

  function enableMutatinObserver() {
    disableMutatinObserver();
    watchdogTimerHandler = setInterval(watchdog, Number(twpConfig.get("diagWatchdogMs")) || 5000);

    if (twpConfig.get("translateDynamicallyCreatedContent") == "yes") {
      translateNewNodesTimerHandler = setInterval(translateNewNodes, 2000);
      sweepTimerHandler = setInterval(sweepForMissedText, 4000);
      mutationObserverActive = true;
      mutationObserver.observe(document.body, MUTATION_OPTIONS);
    }
  }

  function disableMutatinObserver() {
    clearInterval(translateNewNodesTimerHandler);
    clearInterval(sweepTimerHandler);
    clearInterval(watchdogTimerHandler);
    mutationObserverActive = false;
    newNodes = [];
    removedNodes = [];
    mutationObserver.disconnect();
    mutationObserver.takeRecords();
  }

  let pageIsVisible = document.visibilityState == "visible";
  // isto faz com que partes do youtube não sejam traduzidas
  // new IntersectionObserver(entries => {
  //         if (entries[0].isIntersecting && document.visibilityState == "visible") {
  //             pageIsVisible = true
  //         } else {
  //             pageIsVisible = false
  //         }

  //         if (pageIsVisible && pageLanguageState === "translated") {
  //             enableMutatinObserver()
  //         } else {
  //             disableMutatinObserver()
  //         }
  //     }, {
  //         root: null
  //     })
  //     .observe(document.body)

  const handleVisibilityChange = function () {
    if (document.visibilityState == "visible") {
      pageIsVisible = true;
    } else {
      pageIsVisible = false;
    }

    if (pageIsVisible && pageLanguageState === "translated") {
      enableMutatinObserver();
    } else {
      disableMutatinObserver();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange, false);

  /**
   *
   * @param {HTMLElement} node
   * @returns
   */
  function isNoTranslateNode(node) {
    const nodeName = node.nodeName.toLowerCase();
    const index = htmlTagsNoTranslate.indexOf(nodeName);

    //https://github.com/FilipePS/Traduzir-paginas-web/issues/704
    if (nodeName === "span" && node.classList.contains("mjx-chtml")) {
      return true;
    } else if (index === -1) {
      return false;
    } else {
      // https://github.com/FilipePS/Traduzir-paginas-web/issues/654
      if (
        nodeName === "script" &&
        node.getAttribute("data-spotim-module") === "spotim-launcher" &&
        [...node.childNodes].find((node) => node.nodeType === 1)
      ) {
        return false;
      } else {
        return true;
      }
    }
  }

  // Beaucoup d'applications affichent du texte normal (un courriel, des consignes) dans une balise <code> à chasse fixe.
  // Du vrai code n'est pas traduit ; du texte qui ressemble à des phrases l'est.
  function isProseCode(el) {
    if (el.nodeName.toLowerCase() !== "code") return false;
    const text = el.textContent || "";
    if (text.length < 20) return false;
    const words = text.match(/\p{L}{2,}/gu) || [];
    const symbols = text.match(/[{}();=<>\[\]\\$#*|]/g) || [];
    return words.length >= 4 && symbols.length / text.length < 0.05;
  }

  function getPiecesToTranslate(root = document.documentElement) {
    const piecesToTranslate = [
      {
        isTranslated: false,
        parentElement: null,
        topElement: null,
        bottomElement: null,
        nodes: [],
      },
    ];
    let index = 0;
    let currentParagraphSize = 0;

    const getAllNodes = function (
      node,
      lastHTMLElement = null,
      lastSelectOrDataListElement = null
    ) {
      if (node.nodeType == 1 || node.nodeType == 11) {
        if (node.nodeType == 11) {
          lastHTMLElement = node.host;
          lastSelectOrDataListElement = null;
        } else if (node.nodeType == 1) {
          lastHTMLElement = node;
          const nodeName = node.nodeName.toLowerCase();

          if (nodeName === "select" || nodeName === "datalist")
            lastSelectOrDataListElement = node;

          if (
            (htmlTagsInlineIgnore.indexOf(nodeName) !== -1 && !isProseCode(node)) ||
            isNoTranslateNode(node) ||
            node.classList.contains("notranslate") ||
            node.getAttribute("translate") === "no" ||
            node.isContentEditable ||
            node.classList.contains("CodeMirror") || // https://www.w3schools.com/html/tryit.asp
            node.classList.contains("material-icons") || // https://github.com/FilipePS/Traduzir-paginas-web/issues/481
            node.classList.contains("material-symbols-outlined") ||
            nodeName.startsWith("br-") || // https://github.com/FilipePS/Traduzir-paginas-web/issues/627
            node.getAttribute("id") === "branch-select-menu" || // https://github.com/FilipePS/Traduzir-paginas-web/issues/570
            (location.hostname === "twitter.com" &&
              nodeName === "a" &&
              (node.matches ? node.matches("article a") : true)) // https://github.com/FilipePS/Traduzir-paginas-web/issues/449
          ) {
            if (piecesToTranslate[index].nodes.length > 0) {
              currentParagraphSize = 0;
              piecesToTranslate[index].bottomElement = lastHTMLElement;
              piecesToTranslate.push({
                isTranslated: false,
                parentElement: null,
                topElement: null,
                bottomElement: null,
                nodes: [],
              });
              index++;
            }
            return;
          }
        }

        function getAllChilds(childNodes) {
          Array.from(childNodes).forEach((_node) => {
            const nodeName = _node.nodeName.toLowerCase();

            if (_node.nodeType == 1) {
              lastHTMLElement = _node;
              if (nodeName === "select" || nodeName === "datalist")
                lastSelectOrDataListElement = _node;
            }

            if (htmlTagsInlineText.indexOf(nodeName) == -1) {
              if (piecesToTranslate[index].nodes.length > 0) {
                currentParagraphSize = 0;
                piecesToTranslate[index].bottomElement = lastHTMLElement;
                piecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                });
                index++;
              }

              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);

              if (piecesToTranslate[index].nodes.length > 0) {
                currentParagraphSize = 0;
                piecesToTranslate[index].bottomElement = lastHTMLElement;
                piecesToTranslate.push({
                  isTranslated: false,
                  parentElement: null,
                  topElement: null,
                  bottomElement: null,
                  nodes: [],
                });
                index++;
              }
            } else {
              getAllNodes(_node, lastHTMLElement, lastSelectOrDataListElement);
            }
          });
        }

        getAllChilds(node.childNodes);
        if (!piecesToTranslate[index].bottomElement) {
          piecesToTranslate[index].bottomElement = node;
        }
        if (node.shadowRoot) {
          observeShadowRoot(node.shadowRoot);
          getAllChilds(node.shadowRoot.childNodes);
          if (!piecesToTranslate[index].bottomElement) {
            piecesToTranslate[index].bottomElement = node;
          }
        }
      } else if (node.nodeType == 3) {
        if (node.textContent.trim().length > 0) {
          if (!piecesToTranslate[index].parentElement) {
            if (
              node &&
              node.parentNode &&
              node.parentNode.nodeName.toLowerCase() === "option" &&
              lastSelectOrDataListElement
            ) {
              piecesToTranslate[index].parentElement =
                lastSelectOrDataListElement;
              piecesToTranslate[index].bottomElement =
                lastSelectOrDataListElement;
              piecesToTranslate[index].topElement = lastSelectOrDataListElement;
            } else {
              let temp = node.parentNode;
              const nodeName = temp.nodeName.toLowerCase();
              while (
                temp &&
                temp != root &&
                (htmlTagsInlineText.indexOf(nodeName) != -1 ||
                  htmlTagsInlineIgnore.indexOf(nodeName) != -1)
              ) {
                temp = temp.parentNode;
              }
              if (temp && temp.nodeType === 11) {
                temp = temp.host;
              }
              piecesToTranslate[index].parentElement = temp;
            }
          }
          if (!piecesToTranslate[index].topElement) {
            piecesToTranslate[index].topElement = lastHTMLElement;
          }
          if (currentParagraphSize > 1000) {
            currentParagraphSize = 0;
            piecesToTranslate[index].bottomElement = lastHTMLElement;
            const pieceInfo = {
              isTranslated: false,
              parentElement: null,
              topElement: lastHTMLElement,
              bottomElement: null,
              nodes: [],
            };
            pieceInfo.parentElement = piecesToTranslate[index].parentElement;
            piecesToTranslate.push(pieceInfo);
            index++;
          }
          currentParagraphSize += node.textContent.length;
          piecesToTranslate[index].nodes.push(node);
          piecesToTranslate[index].bottomElement = null;
        }
      }
    };
    getAllNodes(root);

    if (
      piecesToTranslate.length > 0 &&
      piecesToTranslate[piecesToTranslate.length - 1].nodes.length == 0
    ) {
      piecesToTranslate.pop();
    }

    return piecesToTranslate;
  }

  function getAttributesToTranslate(root = document.body) {
    const attributesToTranslate = [];

    const placeholdersElements = root.querySelectorAll(
      "input[placeholder], textarea[placeholder]"
    );
    const altElements = root.querySelectorAll(
      'area[alt], img[alt], input[type="image"][alt]'
    );
    const valueElements = root.querySelectorAll(
      'input[type="button"], input[type="submit"], input[type="reset"]'
    );
    const titleElements = root.querySelectorAll("body [title]");

    function hasNoTranslate(elem) {
      if (
        elem &&
        (elem.classList.contains("notranslate") ||
          elem.getAttribute("translate") === "no")
      ) {
        return true;
      }
    }

    placeholdersElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("placeholder");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "placeholder",
        });
      }
    });

    altElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("alt");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "alt",
        });
      }
    });

    valueElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("value");
      if (e.type == "submit" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Submit Query",
          attrName: "value",
        });
      } else if (e.type == "reset" && !txt) {
        attributesToTranslate.push({
          node: e,
          original: "Reset",
          attrName: "value",
        });
      } else if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "value",
        });
      }
    });

    titleElements.forEach((e) => {
      if (hasNoTranslate(e)) return;

      const txt = e.getAttribute("title");
      if (txt && txt.trim()) {
        attributesToTranslate.push({
          node: e,
          original: txt,
          attrName: "title",
        });
      }
    });

    return attributesToTranslate;
  }

  // encapsular o texto faz com que do video suma
  // ao utilizar função como Pai.removeChild(filho)
  // pode ser gerado um erro ao encapsular
  function encapsulateTextNode(node) {
    const fontNode = document.createElement("font");
    fontNode.setAttribute("style", "vertical-align: inherit;");
    fontNode.textContent = node.textContent;

    node.replaceWith(fontNode);
    markSeen(fontNode); // le texte qu'il contient est déjà pris en charge : ne pas le renvoyer comme « nouveau »

    return fontNode;
  }

  function translateTextContent(node, parentNode, text, toRestore) {
    toRestore.translatedText = text;

    if (location.hostname === "pdf.translatewebpages.org") {
      if (
        parentNode &&
        parentNode.nodeName.toLowerCase() === "span" &&
        parentNode.getAttribute("role") === "presentation"
      ) {
        const oldClientWidth = node.parentNode.clientWidth;
        node.textContent = text;
        const newClientWidth = node.parentNode.clientWidth;
        const transformMatch = parentNode.style.transform.match(
          /[0-9]+[\.]{1,1}[0-9]*/
        );
        const currentScaleX = transformMatch
          ? parseFloat(transformMatch[0])
          : 1.0;
        toRestore.originalScale = currentScaleX;
        parentNode.style.transform = `scaleX(${
          currentScaleX *
          Math.min(currentScaleX, oldClientWidth / newClientWidth)
        })`;
      } else {
        node.textContent = text;
      }
    } else {
      node.textContent = text;
    }

    markSeen(node);
    translatedNodesCount++;
    const writtenNode = node.nodeType === 3 ? node : node.firstChild;
    if (writtenNode && writtenNode.nodeType === 3) writtenText.set(writtenNode, writtenNode.nodeValue);
  }

  // Nombre de nouvelles tentatives d'un morceau dont la traduction a échoué (réponse absente ou vide).
  const MAX_PIECE_RETRIES = 6; // délais : 2 s, 4 s, 8 s, 16 s, 30 s, 30 s (couvre une limite de débit d'une trentaine de secondes)

  // Le code d'origine marquait un morceau « traduit » avant d'envoyer la demande : si la réponse échouait, le morceau
  // restait en version originale pour toujours (une partie de la page traduite, le reste non). Maintenant un morceau
  // sans réponse est remis dans la file et réessayé après un délai croissant.
  function scheduleRetryOfFailedPieces(piecesToTranslateNow, results) {
    piecesToTranslateNow.forEach((ptt, i) => {
      const r = Array.isArray(results) ? results[i] : null;
      const answered = Array.isArray(r) && r.some((x) => typeof x === "string" && x.length > 0);
      if (answered) return;
      ptt.retries = (ptt.retries || 0) + 1;
      if (ptt.retries <= MAX_PIECE_RETRIES) {
        ptt.isTranslated = false;
        ptt.retryAt = Date.now() + Math.min(30000, 2000 * 2 ** (ptt.retries - 1));
        diagLog("page.retry", { reason: "no answer", attempt: ptt.retries });
      } else {
        diagLog("page.gave-up", { attempts: ptt.retries, chars: ptt.nodes.reduce((m, nd) => m + nd.textContent.length, 0) });
      }
    });
  }

  // Le moteur peut répondre pour une partie seulement des nœuds d'un morceau (réponse tronquée, balises perdues) : les nœuds
  // restés sans traduction forment un nouveau morceau, réessayé après un court délai.
  function retryNodesWithoutTranslation(piecesToTranslateNow, results) {
    if (!Array.isArray(results)) return;
    piecesToTranslateNow.forEach((ptt, i) => {
      const r = results[i];
      if (!Array.isArray(r) || !r.some((x) => typeof x === "string" && x.length > 0)) return; // échec total : déjà géré
      const missing = ptt.nodes.filter((_, j) => !(typeof r[j] === "string" && r[j].length > 0));
      const tries = ptt.partialRetries || 0;
      if (missing.length === 0 || tries >= MAX_PIECE_RETRIES) return;
      diagLog("page.retry", { reason: "partial answer", missingNodes: missing.length, of: ptt.nodes.length });
      piecesToTranslate.push({
        isTranslated: false,
        parentElement: ptt.parentElement,
        topElement: ptt.topElement,
        bottomElement: ptt.bottomElement,
        nodes: missing,
        partialRetries: tries + 1,
        retryAt: Date.now() + 1500 * (tries + 1),
      });
    });
  }

  function translateResults(piecesToTranslateNow, results) {
    if (!Array.isArray(results)) return;
    results = results.map((r) => (Array.isArray(r) ? r : [])); // morceau sans réponse : ignoré, réessayé plus tard
    if (dontSortResults) {
      for (let i = 0; i < results.length; i++) {
        for (let j = 0; j < results[i].length; j++) {
          if (piecesToTranslateNow[i].nodes[j]) {
            const nodes = piecesToTranslateNow[i].nodes;
            let translated = results[i][j] + " ";
            // In some case, results items count is over original node count
            // Rest results append to last node
            if (
              piecesToTranslateNow[i].nodes.length - 1 === j &&
              results[i].length > j
            ) {
              const restResults = results[i].slice(j + 1);
              translated += restResults.join(" ");
            }

            const originalTextNode = nodes[j];
            const parentNode = nodes[j].parentNode;
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
              originalScale: null,
              parentNode,
            };
            nodesToRestore.push(toRestore);

            const originalText = originalTextNode.textContent;
            handleCustomWords(
              translated,
              nodes[j].textContent,
              customDictionary,
              currentPageTranslatorService,
              currentSourceLanguage,
              currentTargetLanguage
            ).then((results) => {
              // results = `${originalText.match(/^\s*/)[0]}${results.trim()}${
              //   originalText.match(/\s*$/)[0]
              // }`;
              translateTextContent(nodes[j], parentNode, results, toRestore);
            });
          }
        }
      }
    } else {
      for (const i in piecesToTranslateNow) {
        for (const j in piecesToTranslateNow[i].nodes) {
          if (results[i][j]) {
            const nodes = piecesToTranslateNow[i].nodes;
            const translated = results[i][j] + " ";

            const originalTextNode = nodes[j];
            const parentNode = nodes[j].parentNode;
            if (showOriginal.isEnabled) {
              nodes[j] = encapsulateTextNode(nodes[j]);
              showOriginal.add(nodes[j]);
            }

            const toRestore = {
              node: nodes[j],
              original: originalTextNode,
              originalText: originalTextNode.textContent,
              translatedText: translated,
              parentNode,
            };
            nodesToRestore.push(toRestore);

            const originalText = originalTextNode.textContent;
            handleCustomWords(
              translated,
              nodes[j].textContent,
              customDictionary,
              currentPageTranslatorService,
              currentSourceLanguage,
              currentTargetLanguage
            ).then((results) => {
              // results = `${originalText.match(/^\s*/)[0]}${results.trim()}${
              //   originalText.match(/\s*$/)[0]
              // }`;
              translateTextContent(nodes[j], parentNode, results, toRestore);
            });
          }
        }
      }
    }

    mutationObserver.takeRecords();
  }

  function translateAttributes(attributesToTranslateNow, results) {
    for (const i in attributesToTranslateNow) {
      const ati = attributesToTranslateNow[i];
      ati.node.setAttribute(ati.attrName, results[i]);
    }
  }

  // ---- Priorités : ce qui est visible d'abord, le reste de la page ensuite ----
  // « high » : ce qui est à l'écran (et un peu en dessous) ; envoyé tout de suite, passe devant dans la file de l'IA.
  // « low »  : tout le reste de la page (en dessous, au-dessus, masqué) ; traduit en tâche de fond, du plus proche de
  //            l'écran au plus lointain, seulement quand rien de nouveau n'arrive à l'écran. Rien n'est ignoré :
  //            la page finit entièrement traduite, même sans défiler.
  let highInFlight = 0;
  let lastHighSentAt = 0;
  let lowInFlight = false;
  const LOW_IDLE_MS = 1200; // délai sans nouveauté à l'écran avant de s'occuper du reste
  const LOW_BATCH_CHARS = 1500; // taille d'un lot de fond (un lot à la fois)

  function sendPieces(piecesNow, priority, currentFooCount) {
    const tEnvoi = Date.now();
    lastSentAt = tEnvoi;
    if (priority === "high") {
      highInFlight++;
      lastHighSentAt = tEnvoi;
    } else {
      lowInFlight = true;
    }
    piecesNow.forEach((ptt) => {
      ptt.sentAt = tEnvoi;
      ptt.done = false;
      ptt.priority = priority;
    });
    diagLog("page.send", {
      priority,
      pieces: piecesNow.length,
      chars: piecesNow.reduce((n, ptt) => n + ptt.nodes.reduce((m, nd) => m + nd.textContent.length, 0), 0),
    });
    backgroundTranslateHTML(
      currentPageTranslatorService,
      currentSourceLanguage,
      currentTargetLanguage,
      piecesNow.map((ptt) =>
        ptt.nodes.map((node) => filterKeywordsInText(node.textContent, customDictionary, currentPageTranslatorService))
      ),
      dontSortResults,
      priority
    )
      .then((results) => {
        piecesNow.forEach((ptt) => (ptt.done = true));
        diagLog("page.result", {
          priority,
          pieces: piecesNow.length,
          answered: Array.isArray(results) ? results.filter((r) => Array.isArray(r) && r.some((x) => typeof x === "string" && x.length > 0)).length : 0,
          ms: Date.now() - tEnvoi,
        });
        if (pageLanguageState === "translated" && currentFooCount === fooCount) {
          scheduleRetryOfFailedPieces(piecesNow, results);
          retryNodesWithoutTranslation(piecesNow, results);
          translateResults(piecesNow, results);
        }
      })
      .finally(() => {
        if (priority === "high") highInFlight--;
        else lowInFlight = false;
      });
  }

  // Distance d'un morceau à la zone visible (0 = visible, grand = loin ; masqué = en dernier).
  function distanceToScreen(ptt) {
    const el = ptt.topElement || ptt.bottomElement;
    if (!el || !el.getBoundingClientRect) return 1e9;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return 1e9; // masqué (onglet inactif, display:none) : tout à la fin
    if (r.top > window.innerHeight) return r.top - window.innerHeight;
    if (r.bottom < 0) return -r.bottom;
    return 0;
  }

  // Le prochain lot du reste de la page : les morceaux non traduits les plus proches de l'écran.
  function pickBackgroundPieces() {
    const now = Date.now();
    const candidates = piecesToTranslate
      .filter((ptt) => !ptt.isTranslated && !(ptt.retryAt > now))
      .map((ptt) => ({ ptt, distance: distanceToScreen(ptt) }))
      .sort((a, b) => a.distance - b.distance);
    const batch = [];
    let chars = 0;
    for (const { ptt } of candidates) {
      batch.push(ptt);
      chars += ptt.nodes.reduce((sum, n) => sum + n.textContent.length, 0);
      if (chars >= LOW_BATCH_CHARS) break;
    }
    batch.forEach((ptt) => (ptt.isTranslated = true));
    return batch;
  }

  function translationRoutine() {
    try {
      if (piecesToTranslate && pageIsVisible) {
        (function () {
          if (piecesToTranslate.length < 1) return;
          const innerHeight = window.innerHeight;
          // On traduit aussi trois quarts d'écran sous la zone visible : le texte est déjà traduit quand on défile.
          const margin = Math.round(innerHeight * 0.75);
          const now = Date.now();

          // Un morceau plus haut que l'écran (haut au-dessus, bas en dessous) n'était jamais envoyé : on traduit tout morceau
          // dont une partie, même petite, se trouve dans la zone visible (écran + marge).
          function overlapsScreen(ptt) {
            if (!ptt.topElement || !ptt.bottomElement) return false;
            const a = ptt.topElement.getBoundingClientRect();
            const b = ptt.bottomElement.getBoundingClientRect();
            const start = Math.min(a.top, b.top);
            const end = Math.max(a.bottom, b.bottom);
            return end > start && start < innerHeight + margin && end > 0;
          }

          function isInScreen(element) {
            const rect = element.getBoundingClientRect();
            if (
              (rect.top > 0 && rect.top <= innerHeight) ||
              (rect.bottom > 0 && rect.bottom <= innerHeight)
            ) {
              return true;
            }
            return false;
          }

          function topIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.top > 0 && rect.top <= innerHeight + margin) {
              return true;
            }
            return false;
          }

          function bottomIsInScreen(element) {
            if (!element) {
              // debugger;
              return false;
            }
            const rect = element.getBoundingClientRect();
            if (rect.bottom > 0 && rect.bottom <= innerHeight + margin) {
              return true;
            }
            return false;
          }

          const currentFooCount = fooCount;

          const piecesToTranslateNow = [];
          piecesToTranslate.forEach((ptt) => {
            if (!ptt.isTranslated && !(ptt.retryAt > now)) {
              if (
                bottomIsInScreen(ptt.topElement) ||
                topIsInScreen(ptt.bottomElement) ||
                overlapsScreen(ptt)
              ) {
                ptt.isTranslated = true;
                piecesToTranslateNow.push(ptt);
              }
            }
          });

          const attributesToTranslateNow = [];
          attributesToTranslate.forEach((ati) => {
            if (!ati.isTranslated) {
              if (isInScreen(ati.node)) {
                ati.isTranslated = true;
                attributesToTranslateNow.push(ati);
              }
            }
          });

          if (piecesToTranslateNow.length > 0) {
            sendPieces(piecesToTranslateNow, "high", currentFooCount);
          } else if (highInFlight === 0 && !lowInFlight && Date.now() - lastHighSentAt > LOW_IDLE_MS) {
            // Rien de nouveau à l'écran : on avance sur le reste de la page, du plus proche au plus lointain.
            const backgroundPieces = pickBackgroundPieces();
            if (backgroundPieces.length > 0) sendPieces(backgroundPieces, "low", currentFooCount);
          }

          if (attributesToTranslateNow.length > 0) {
            backgroundTranslateText(
              currentPageTranslatorService,
              currentSourceLanguage,
              currentTargetLanguage,
              attributesToTranslateNow.map((ati) => ati.original)
            ).then((results) => {
              if (
                pageLanguageState === "translated" &&
                currentFooCount === fooCount
              ) {
                translateAttributes(attributesToTranslateNow, results);
              }
            });
          }
        })();
      }
    } catch (e) {
      console.error(e);
    }

    clearTimeout(translationRoutine_handler);
    translationRoutine_handler = setTimeout(translationRoutine, 300);
  }

  translationRoutine();

  function translatePageTitle() {
    const title = document.querySelector("title");
    if (
      title &&
      (title.classList.contains("notranslate") ||
        title.getAttribute("translate") === "no")
    ) {
      return;
    }
    if (document.title.trim().length < 1) return;
    originalPageTitle = document.title;

    backgroundTranslateSingleText(
      currentPageTranslatorService,
      currentSourceLanguage,
      currentTargetLanguage,
      originalPageTitle
    ).then((result) => {
      if (result) {
        document.title = result;
      }
    });
  }

  const pageLanguageStateObservers = [];

  pageTranslator.onPageLanguageStateChange = function (callback) {
    pageLanguageStateObservers.push(callback);
  };

  var translationRoutine_handler = null;

  pageTranslator.translatePage = function (targetLanguage) {
    fooCount++;
    pageTranslator.restorePage();
    showOriginal.enable();
    chrome.runtime.sendMessage(
      { action: "removeTranslationsWithError" },
      checkedLastError
    );

    if (targetLanguage) {
      currentTargetLanguage = targetLanguage;
    }

    customDictionary = sortDictionary(twpConfig.get("customDictionary"));

    // https://github.com/FilipePS/Traduzir-paginas-web/issues/619
    if (
      location.hostname === "sberbank.com" ||
      location.hostname === "www.sberbank.com"
    ) {
      document.body.classList.remove("notranslate");
    }

    if (location.hostname === "pdf.translatewebpages.org") {
      document.getElementById("scaleSelect").value = "1.5";
      document.getElementById("scaleSelect").dispatchEvent(new Event("change"));
    }

    piecesToTranslate = getPiecesToTranslate();
    seenTextNodes = new WeakSet();
    piecesToTranslate.forEach((ptt) => ptt.nodes.forEach((n) => seenTextNodes.add(n)));
    translatedNodesCount = 0;
    lastSentAt = 0;
    lastProgressKey = "";
    diagLog("page.start", {
      pieces: piecesToTranslate.length,
      nodes: piecesToTranslate.reduce((n, ptt) => n + ptt.nodes.length, 0),
      service: currentPageTranslatorService,
      target: currentTargetLanguage,
      host: location.hostname,
    });
    attributesToTranslate = getAttributesToTranslate();

    pageLanguageState = "translated";
    chrome.runtime.sendMessage(
      {
        action: "setPageLanguageState",
        pageLanguageState,
      },
      checkedLastError
    );
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = currentTargetLanguage;

    translatePageTitle();

    enableMutatinObserver();

    translationRoutine();
  };

  pageTranslator.restorePage = function () {
    fooCount++;
    piecesToTranslate = [];

    showOriginal.disable();
    disableMutatinObserver();

    pageLanguageState = "original";
    chrome.runtime.sendMessage(
      {
        action: "setPageLanguageState",
        pageLanguageState,
      },
      checkedLastError
    );
    pageLanguageStateObservers.forEach((callback) =>
      callback(pageLanguageState)
    );
    currentPageLanguage = originalTabLanguage;

    if (originalPageTitle) {
      document.title = originalPageTitle;
    }
    originalPageTitle = null;

    for (const ntr of nodesToRestore) {
      if (ntr.node === ntr.original) {
        if (ntr.node.textContent === ntr.translatedText) {
          ntr.node.textContent = ntr.originalText;
        }
      } else {
        ntr.node.replaceWith(ntr.original);
      }
      if (ntr.originalScale) {
        ntr.parentNode.style.transform = `scaleX(${ntr.originalScale}`;
      }
    }
    nodesToRestore = [];

    //TODO não restaurar atributos que foram modificados
    for (const ati of attributesToTranslate) {
      if (ati.isTranslated) {
        ati.node.setAttribute(ati.attrName, ati.original);
      }
    }
    attributesToTranslate = [];
  };

  pageTranslator.swapTranslationService = function (newServiceName) {
    currentPageTranslatorService = newServiceName;
    if (pageLanguageState === "translated") {
      pageTranslator.translatePage();
    }
  };

  pageTranslator.improveTranslation = function (info) {
    currentPageTranslatorService = info.pageTranslatorService;
    dontSortResults = info.dontSortResults === "yes" ? true : false;
    currentSourceLanguage = info.sourceLanguage;
    if (pageLanguageState === "translated") {
      pageTranslator.translatePage(info.targetLanguage);
    }
  };

  let alreadyGotTheLanguage = false;
  const observers = [];

  pageTranslator.onGetOriginalTabLanguage = function (callback) {
    if (alreadyGotTheLanguage) {
      callback(originalTabLanguage);
    } else {
      observers.push(callback);
    }
  };

  let textContentLanguageDetectionPromise = null;

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "translatePage") {
      // Le menu précise le service à utiliser (IA si une clé est enregistrée, sinon Google).
      if (request.service) currentPageTranslatorService = request.service;
      if (request.targetLanguage === "original") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage(request.targetLanguage);
      }
    } else if (request.action === "restorePage") {
      pageTranslator.restorePage();
    } else if (request.action === "getOriginalTabLanguage") {
      pageTranslator.onGetOriginalTabLanguage(function () {
        sendResponse(originalTabLanguage);
      });
      return true;
    } else if (request.action === "getCurrentPageLanguage") {
      sendResponse(currentPageLanguage);
    } else if (request.action === "getCurrentPageLanguageState") {
      sendResponse(pageLanguageState);
    } else if (request.action === "getCurrentPageTranslatorService") {
      sendResponse(currentPageTranslatorService);
    } else if (request.action === "swapTranslationService") {
      pageTranslator.swapTranslationService(request.newServiceName);
    } else if (request.action === "toggle-translation") {
      if (pageLanguageState === "translated") {
        pageTranslator.restorePage();
      } else {
        pageTranslator.translatePage();
      }
    } else if (request.action === "autoTranslateBecauseClickedALink") {
      if (twpConfig.get("autoTranslateWhenClickingALink") === "yes") {
        pageTranslator.onGetOriginalTabLanguage(function () {
          if (
            pageLanguageState === "original" &&
            originalTabLanguage !== currentTargetLanguage &&
            twpConfig
              .get("neverTranslateLangs")
              .indexOf(originalTabLanguage) === -1 &&
            twpConfig.get("neverTranslateSites").indexOf(tabHostName) === -1
          ) {
            pageTranslator.translatePage();
          }
        });
      }
    } else if (request.action === "restorePagesWithServiceNames") {
      if (request.serviceNames.includes(currentPageTranslatorService)) {
        pageTranslator.restorePage();
        currentPageTranslatorService = request.newServiceName;
      }
    } else if (request.action === "improveTranslation") {
      pageTranslator.improveTranslation(request);
    } else if (request.action === "getCurrentSourceLanguage") {
      sendResponse(currentSourceLanguage);
    } else if (request.action === "getDontSortResults") {
      sendResponse(dontSortResults);
    } else if (request.action === "cleanUp") {
      pageTranslator.restorePage();
    } else if (request.action === "currentTargetLanguage") {
      sendResponse(currentTargetLanguage);
    } else if (request.action === "detectLanguageUsingTextContent") {
      if (textContentLanguageDetectionPromise) {
        textContentLanguageDetectionPromise.then((result) =>
          sendResponse(result)
        );
      } else {
        textContentLanguageDetectionPromise = new Promise((resolve) => {
          chrome.i18n.detectLanguage(
            document.body.innerText.trim().slice(0, 1000),
            (result) => {
              // checkedLastError();
              if (
                result &&
                result.languages &&
                result.languages.length > 0
              ) {
                resolve(result.languages[0].language);
                sendResponse(result.languages[0].language);
              } else {
                sendResponse("und");
              }
            }
          );
        });
      }
      return true;
    }
  });

  // Requests the detection of the tab language in the background
  if (window.self === window.top) {
    // is main frame
    const onTabVisible = function () {
      chrome.runtime.sendMessage(
        {
          action: "detectTabLanguage",
        },
        (result) => {
          checkedLastError();

          result = result || "und";
          if (result === "und") {
            originalTabLanguage = result;
            if (
              (twpConfig.get("alwaysTranslateSites").indexOf(tabHostName) !==
                -1 ||
                (location.hostname === "pdf.translatewebpages.org" &&
                  twpConfig.get("neverTranslateSites").indexOf(tabHostName) ===
                    -1)) &&
              !platformInfo.isMobile.any
            ) {
              pageTranslator.translatePage();
            }
          } else {
            const langCode = twpLang.fixTLanguageCode(result);
            if (langCode) {
              originalTabLanguage = langCode;
            }
            if (
              (location.hostname === "pdftohtml.translatewebpages.org" &&
                location.href.indexOf("?autotranslate") !== -1 &&
                twpConfig.get("neverTranslateSites").indexOf(tabHostName) ===
                  -1) ||
              (location.hostname === "pdf.translatewebpages.org" &&
                twpConfig.get("neverTranslateSites").indexOf(tabHostName) ===
                  -1)
            ) {
              pageTranslator.translatePage();
            } else {
              if (
                location.hostname !== "translate.googleusercontent.com" &&
                location.hostname !== "translate.google.com" &&
                location.hostname !== "translate.yandex.com" &&
                location.hostname !== "www.deepl.com" &&
                location.hostname !== "translated.turbopages.org" &&
                !location.hostname.endsWith("translate.goog") &&
                location.hostname !== "sberbank.com" &&
                location.hostname !== "www.sberbank.com" // https://github.com/FilipePS/Traduzir-paginas-web/issues/619
              ) {
                if (
                  pageLanguageState === "original" &&
                  // !platformInfo.isMobile.any &&
                  !chrome.extension.inIncognitoContext
                ) {
                  if (
                    twpConfig
                      .get("neverTranslateSites")
                      .indexOf(tabHostName) === -1
                  ) {
                    if (
                      langCode &&
                      langCode !== currentTargetLanguage &&
                      twpConfig
                        .get("alwaysTranslateLangs")
                        .indexOf(langCode) !== -1
                    ) {
                      pageTranslator.translatePage();
                    } else if (
                      twpConfig
                        .get("alwaysTranslateSites")
                        .indexOf(tabHostName) !== -1 &&
                      !platformInfo.isMobile.any
                    ) {
                      pageTranslator.translatePage();
                    }
                  }
                }
              }
            }
          }

          observers.forEach((callback) => callback(originalTabLanguage));
          alreadyGotTheLanguage = true;
        }
      );
    };
    setTimeout(function () {
      if (document.visibilityState == "visible") {
        onTabVisible();
      } else {
        const handleVisibilityChange = function () {
          if (document.visibilityState == "visible") {
            document.removeEventListener(
              "visibilitychange",
              handleVisibilityChange
            );
            onTabVisible();
          }
        };
        document.addEventListener(
          "visibilitychange",
          handleVisibilityChange,
          false
        );
      }
    }, 150);
  } else {
    // is subframe (iframe)
    chrome.runtime.sendMessage(
      {
        action: "getMainFrameTabLanguage",
      },
      (result) => {
        checkedLastError();

        originalTabLanguage = result || "und";
        observers.forEach((callback) => callback(originalTabLanguage));
        alreadyGotTheLanguage = true;
      }
    );

    chrome.runtime.sendMessage(
      {
        action: "getMainFramePageLanguageState",
      },
      (result) => {
        checkedLastError();

        if (
          result === "translated" &&
          pageLanguageState === "original" &&
          twpConfig.get("enableIframePageTranslation") === "yes"
        ) {
          pageTranslator.translatePage();
        }
      }
    );
  }

  showOriginal.enabledObserverSubscribe(function () {
    if (pageLanguageState !== "original") {
      pageTranslator.translatePage();
    }
  });
});
