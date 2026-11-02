# Translate Express (version 1.0.0): design notes

A fork of TWP (Translate Web Pages, branch `chrome-mv3`, 10.2.5.0) with its own version numbering: 1.0.0. The name "TWP" now only designates the original code.

Built on the `chrome-mv3` branch (version 10.2.5.0) of https://github.com/FilipePS/Traduzir-paginas-web. The first commit of this repository is the exact state of the original project; the following ones are our changes.
The extension keeps only the essentials: no browser popup, no options page, no keyboard shortcuts, no floating button. Everything is done from the **right-click menu**.

## The right-click menu

| Where you click | Entry | Effect |
|---|---|---|
| when you select text | a **bubble with the extension's logo** appears near the selection | a click opens a small floating panel just below the text with the translation (Copy; the Window button opens it in the page's docked panel); the "Show a bubble when I select text" checkbox of the menu turns the bubble off (it disappears by itself after 8 s) |
| on selected text | **Translate selection** | a panel opens near the selection with the translation (Copy) |
| in an input field | **Translate what I'm writing** | panel with the live translation of what you write; **Replace** replaces the field's text (or the selected part) |
| on the page | **Translate this page to ...** / **Show original page** | translates the whole page, then goes back to the original |
| everywhere | **Message window (live translation)** | panel docked to the right edge of the page (width adjustable with the mouse, Escape or x to close): you write, the translation arrives live; Copy (Ctrl+Enter), Insert in the page, Settings link. A separate window only opens if the page forbids the panel (browser page, PDF, site security rules) |
| everywhere | **Read in: ...** | submenu: the language you READ in (pages and displayed text); 11 common languages, French by default |
| everywhere | **Write in: ...** | submenu: the language you WRITE in (typed text, translated for the recipient); English by default; "More languages, Groq key..." opens the full list |
| everywhere | **Dashboard (diagnostics)** | popup window with the diagnostics (see below) |
| everywhere | "Language and Groq key" page (in the same panel) | the list of all languages and the (optional) Groq key field |

Zero configuration: the default target language is French, then the one you choose (it is never overwritten again, even after a restart), source detected. Without a key, the original free translator (Google) is used; with a Groq key, the AI translates (model chosen automatically; optional menu in "Groq key..."). If the AI fails, the panel falls back to the free one.

## Priorities: what is visible first, the rest afterwards (nothing is ignored)

Two priority levels, from the page down to the AI queue:

- **High**: what is on screen and three quarters of a screen below. Sent right away; when scrolling, a text that becomes visible immediately gets high priority.
- **Low**: all the rest of the page (below, above, hidden in an inactive tab). Translated in the background in batches of 1,500 characters, from the closest to the screen to the farthest, hidden last, only when nothing new has arrived on screen for 1.2 s and without ever delaying what is visible: in the AI queue, a background request yields to any visible request waiting for budget. The page therefore ends up fully translated, even without scrolling.

Before, the rest of the page was only translated when scrolling to it, and all requests went through in order of arrival.

## Groq limits: token budget per minute

The free tier limits tokens per minute (about 8,000 for gpt-oss-20b, more for other models) and requests per minute (30). A page translated all at once exceeds the limit: requests are refused (429 error) and the page stays half translated. So the extension counts what each request costs (an estimate, corrected by the real consumption returned by Groq), only sends it if the sliding minute has room, and reads the real limit from the response headers (85 % of the announced value; 6,000 to be cautious before the first answer). The page is therefore translated in waves, without errors. On a 429 error of a few seconds, the extension waits for the indicated delay; beyond 40 s (daily quota), it gives up right away and the page is translated by Google. The instruction sent with each request is short, so as not to waste tokens.

### Saturated token budget

If a request would have to wait more than 12 s (visible text) or 2.5 s (background text) for room in the token budget, it fails right away and the block goes to Google (event `llm.budget-skip`). The page's stall guard waits 90 s (`diagStuckMs`) so as not to send twice pieces that are simply waiting their turn.

## Block structure: start translated, end in English

A block of several pieces is sent as `<a i=0>…</a><a i=1>…</a>`. Before, only the number of blocks was checked: if the model merged or forgot a piece, the following ones shifted or stayed in English without any error. Now every block is checked (number of pieces and numbers 0 to n-1) and translated again piece by piece if it is wrong; on the page side, pieces left untranslated in an answered block are retried (up to 6 times).

## Speed

TWP translates what is on screen first, then the rest while scrolling. On the AI side: the automatically chosen model is a fast one that does not "think" before answering (order of preference: llama-3.3-70b-versatile, gpt-oss-20b, llama-3.1-8b-instant, then reasoning models); reasoning models get the setting that turns off thinking (removed automatically if the provider refuses it); batches of 1,800 characters translated 4 at a time in parallel; an answer taking more than 20 s is retried; a rate limit announced at more than 6 s makes the AI give up immediately, and the page is translated by Google instead of waiting; a batch whose length does not match is split in two halves translated in parallel. The "Model" menu of the settings page lets you choose another model.

## Several tabs

The "page translated or not" state belongs to each tab: the title of the menu entry ("Translate this page to ..." or "Show original page") is recomputed when changing tab or window, and a click acts according to the state of the clicked tab. A page that reloads becomes "to translate" again. The state is never remembered in the service worker: the tab is asked.

## Nothing must stay untranslated: every case of text that escaped

The original translator let text escape in several situations, all covered now (`pageTranslator.js`, tests in `tests/page-translation.test.js` on a simulated page):

| Situation | Before | Now |
|---|---|---|
| bare text added later in an existing element (AJAX) | ignored | translated |
| inline element (span, link) added later | ignored | translated |
| text of an existing node replaced by the page (React, label updates) | never translated again | translated again |
| isolated component (open shadow DOM), including what is added to it | read at the start only | watched and translated |
| normal text displayed in a `<code>` tag (email, instructions in a fixed-width font) | never translated | translated (real code is not) |
| block taller than the screen, piece whose request failed | never translated | translated, retried |
| mixed message (French and English in the same block) | could be skipped entirely by the language filter | sent whole; only single-piece blocks already in the target language are skipped |
| anything nothing else saw | stayed in the original version | safety sweep every 4 s |

Text deliberately stays untranslated in these cases: editable area (`contenteditable`, so as not to touch what the user writes), `<textarea>` content, elements marked `translate="no"` or `notranslate` by the site, real code, frames of another site that are not accessible.

## Resilience: a failed part does not block the rest

On the engine side (`translationService.js`): a request that fails no longer makes the whole batch fail (its block is returned empty, the others are kept); a failure is no longer remembered (before, retrying the same text failed right away); blocks the AI could not translate are handed to Google block by block. On the page side (`pageTranslator.js`): a piece without an answer is retried up to 6 times (2 s, 4 s, 8 s, 16 s, 30 s, 30 s). `tests/boot.test.js` contains two tests of this scenario that failed on the previous code.

## Read text and written text: two languages

**Displayed** text (page, text selected on the page) is translated into the **reading** language (French by default, "Read in"). Text **written** by the user in a field (input, text area, Teams or Outlook web editor) is translated into the **writing** language (English by default, "Write in"), the recipient's. They are independent: changing one does not touch the other. The panel says which one applies ("Read in" or "Write in"). For selected written text, the bubble also appears, as with DeepL: a click opens the panel with the translation of the selection into the writing language, and "Replace" replaces only the selected part, then the panel closes. The message window (write and see the translation live) uses the writing language.

The bubble's panel keeps the translations it has already obtained (same text and same language): reopening it does not call the AI again. The refresh button ("Translate again") ignores that memory.

## Fully translated page (original defects fixed)

The original translator left parts of the page in their original version for two reasons, fixed in `pageTranslator.js`: (1) a piece was marked "translated" before being sent; if the answer failed or came back empty, it was never retried; it now is, up to 6 times with an increasing delay (2 s to 30 s); (2) a piece taller than the screen (top above, bottom below) was never sent; any piece with a part in the visible area now is. Text is also translated three quarters of a screen ahead below the visible area, to be ready when scrolling. `tests/page-translation.test.js` simulates a page (jsdom): these tests fail on the old code and pass on the new one.

## Multilingual pages

Blocks of text already written in the target language are not translated again: their language is detected locally by the browser (without network), and only the others go to the translator. A half French, half English page translated into French only sends the English; a page already entirely in the target language calls no translator. Blocks shorter than 25 characters or whose language is uncertain are translated normally (the AI is also instructed to leave unchanged what is already in the target language). The code is in `src/background/skipTargetLanguage.js`.

## Diagnostics and dashboard

A log (last 1,000 events, session storage) records the requests to the AI (duration, budget wait, tokens, 429), the translation calls, the sends and results of the page, and the guards (stuck pieces, detected stalls). Setting `diagnostics` = "no" turns it off. The dashboard opens in a popup window (right-click, "Dashboard (diagnostics)", also in the toolbar icon menu): a summary with findings in plain words, the state of the page (why each text is not translated, including text written back unchanged), a filterable log, and a "Copy report" button. Calculations are in `src/dashboard/metrics.js` (tested).

## Theme

Everything is dark at all times (message window, settings, dashboard, bubble, panels), whatever the browser theme.

## What was removed

Popup, options page, shortcuts, floating button, translation on hover, text to speech, the Bing, Yandex, DeepL and LibreTranslate services, polyfill, W3 style sheet, 40 interface languages (English and French remain), build tools (gulp, webpack), donations, release notes. The removed code can be found in the first commit of this repository (the original project as is).

## What remains (all the useful code)

| File | Role |
|---|---|
| `src/manifest.json` | permissions `storage`, `contextMenus` and `alarms` (automatic reload) |
| `src/bg.js`, `src/background/menu.js` | right-click menu, window opening, page messages |
| `src/background/translationService.js`, `translationCache.js` | translation engine (free Google + AI) and cache |
| `src/background/llmService.js` | Groq service: provider recognized from the `gsk_` key, automatic model, rate limits, answer checking |
| `src/background/skipTargetLanguage.js` | skips blocks already in the target language |
| `src/background/diagnostics.js`, `src/dashboard/` | diagnostic log and dashboard |
| `src/background/devReload.js` | automatic reload during development |
| `src/contentScript/pageTranslator.js`, `showOriginal.js` | original page translation (TWP), with our fixes |
| `src/contentScript/panel.js` | the panel and bubble (selection and input fields) |
| `src/composer/` | the message window |
| `src/setup/` | the "Groq key..." page |
| `src/lib/` | configuration, languages, original utilities |
| `tests/` | tests without network: `node --test "tests/*.test.js"` |

## Usage

1. Brave or Chrome: `brave://extensions`, developer mode, "Load unpacked", the `src` folder of this repository.
2. Right-click, **Groq key...**, paste the `gsk_...` key, Save.
3. Right-click on a page, a text or a field.

The key stays in the extension's storage; it is only sent to Groq. The translated text goes to Groq: avoid private or company pages.

## Automatic reload (development)

`src/background/devReload.js` watches the extension's files (Chrome and Brave re-read them from disk) and reloads the extension by itself when one of them changes, within 30 seconds: no more "Reload" button in brave://extensions. The tested page still has to be refreshed (F5), because a tab that is already open keeps the old page script. The chosen language and the Groq key are in the extension's storage: a reload does not erase them. To turn it off: remove the `devReload.js` line from `src/bg.js` and the `alarms` permission from the manifest.

## Updating from the original repository

Our history does not contain the original project's (only its 10.2.5.0 state in the first commit), so `git merge` does not apply. To take a fix from the original project:

```
git remote add upstream https://github.com/FilipePS/Traduzir-paginas-web.git
git fetch upstream chrome-mv3
git diff <first-commit> upstream/chrome-mv3 -- src/contentScript/pageTranslator.js src/contentScript/showOriginal.js
node --test "tests/*.test.js"
```

`<first-commit>` is the very first commit of this repository (`git rev-list --max-parents=0 HEAD`). The diff shows what changed in the original project since our base; what touches `pageTranslator.js`, `showOriginal.js` and Google's translation logic is taken by hand, keeping our version of the rest (many files were removed or rewritten: `translationService.js`, `languages.js`, `config.js`, `manifest.json`).

## Good to know

- The tests (80) check the AI service, the manifest, the service worker start, the menu, the bubble, page translation and the dashboard, with fake `chrome` objects; 20 of them (page and bubble) need jsdom and are skipped if it is not installed. They do not replace a try in the browser.
- Probable cause of Google's slowness: the original service fetches an unofficial key from a JavaScript file of Google (address hard-coded).
- Not done: translating the extension's own interface (English only) and automatically sending back to Groq the texts that came back unchanged.
