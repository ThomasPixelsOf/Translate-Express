# Translate Express

A small browser extension (Chrome, Brave, Edge - Manifest V3) that translates web pages, selected text and what you write, with zero configuration.

It is a fork of [TWP - Translate Web Pages](https://github.com/FilipePS/Traduzir-paginas-web) (version 10.2.5.0, branch `chrome-mv3`) by FilipePS, reduced to the essentials and extended. All credit for the page-translation engine goes to the original project and its contributors.

## What it does

- **Right-click menu**: translate selection, translate what you are writing, translate this page / show the original, message window, Groq key, dashboard. The extension's icon opens the same popup.
- **Selection bubble and small floating panel** next to the selected text (like DeepL), with a copy button, a "Translate again" button and, in text fields, a Replace button. Translations already obtained are kept in memory.
- **Two languages**: "Read in" (default French) for text you read, "Write in" (default English) for text you write. Both are remembered.
- **Complete page translation**: dynamic content, text changed in place, shadow DOM, tall blocks, `<code>` that contains prose, pages that mix languages. Visible text first, the rest in the background.
- **Optional AI translation with Groq**: paste a Groq API key (stored only in the extension's local storage) and pick a model, or leave the default. Without a key, it uses Google Translate. A token budget keeps within the free tier's limit and falls back to Google when Groq is saturated.
- **Toolbar popup** (like a VPN extension): the message window, the settings (languages, Groq key) and a diagnostics dashboard that shows why a page is slow or incomplete, with a copyable report.
- Dark theme everywhere.

## Install (unpacked)

1. Clone this repository.
2. Open `chrome://extensions` (or `brave://extensions`), enable Developer mode.
3. "Load unpacked" and select the `src` folder.

While developing, the extension reloads itself within about 30 seconds of a file change (reload open pages with F5).

## Tests

```
node --test "tests/*.test.js"
```

The page and panel tests use [jsdom](https://github.com/jsdom/jsdom); install it first (`npm install jsdom`) or those tests are skipped.

## More

- [NOTES-LLM.md](NOTES-LLM.md): design notes (menu, languages, priorities, token budget, resilience, diagnostics, update procedure).
- [PRIVACY](PRIVACY): what is sent where.

## License

[Mozilla Public License 2.0](LICENSE), inherited from the original project. Modified files keep their original notices.
