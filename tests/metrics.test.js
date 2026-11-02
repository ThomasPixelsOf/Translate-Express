const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../src/dashboard/metrics.js");

const now = 1_000_000;
const req = (o) => ({ t: now - 1000, type: "llm.request", status: 200, ms: 800, waitBudgetMs: 0, waitSlotMs: 0, tokens: 500, estTokens: 520, budgetLimit: 6000, priority: "high", ...o });

test("journal vide : constat « rien enregistré »", () => {
  const s = m.summarize([], now);
  assert.equal(s.verdicts[0].level, "info");
});

test("l'attente du budget de jetons est désignée comme goulot", () => {
  const s = m.summarize([req({ waitBudgetMs: 5000, ms: 700 })], now);
  assert.ok(s.verdicts.some((v) => /token budget/.test(v.text)));
  assert.equal(s.tokens.last60s, 500);
  assert.equal(s.tokens.usedPct, 8);
});

test("429, blocs en échec et pièces abandonnées sont signalés", () => {
  const s = m.summarize([req({ status: 429, abandoned: true }), { t: now, type: "html.call", failedBlocks: 2, googleFallbackOk: 1, ms: 10 }, { t: now, type: "page.gave-up" }], now);
  assert.equal(s.requests.rateLimited, 1);
  assert.equal(s.html.failedBlocks, 2);
  assert.ok(s.verdicts.some((v) => v.level === "error"));
});

test("le rapport texte contient constats et derniers événements", () => {
  const ev = [req({})];
  const txt = m.buildReport(m.summarize(ev, now), null, ev, now);
  assert.match(txt, /## Findings/);
  assert.match(txt, /llm\.request/);
});
