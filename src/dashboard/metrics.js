// Calculs du tableau de bord à partir du journal de diagnostic (événements de background/diagnostics.js) : fichier pur,
// sans accès au navigateur, donc testable. Utilisé par dashboard.js.
var twpMetrics = (function () {
  const avg = (a) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : 0);
  const max = (a) => (a.length ? Math.max(...a) : 0);
  const percentile = (a, p) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  const sec = (ms) => (ms / 1000).toFixed(1) + " s";
  const count = (events, type) => events.filter((e) => e.type === type).length;
  const sum = (events, type, key) => events.filter((e) => e.type === type).reduce((s, e) => s + (e[key] || 0), 0);

  function summarize(events, now = Date.now()) {
    const llm = events.filter((e) => e.type === "llm.request");
    const ok = llm.filter((e) => e.status === 200);
    const limited = llm.filter((e) => e.status === 429);
    const errors = llm.filter((e) => e.status !== 200 && e.status !== 429);
    const html = events.filter((e) => e.type === "html.call");
    const tokensOf = (e) => e.tokens || e.estTokens || 0;

    const tokensLast60s = ok.filter((e) => now - e.t < 60000).reduce((s, e) => s + tokensOf(e), 0);
    const budgetLimit = llm.length ? llm[llm.length - 1].budgetLimit || 0 : 0;

    // Jetons par tranche de 10 s sur les 10 dernières minutes (pour le graphique)
    const buckets = Array.from({ length: 60 }, () => 0);
    for (const e of ok) {
      const age = now - e.t;
      if (age >= 0 && age < 600000) buckets[59 - Math.floor(age / 10000)] += tokensOf(e);
    }

    // Une « session » = une traduction de page (page.start) avec ses envois et résultats
    const sessions = [];
    for (const e of events) {
      if (e.type === "page.start") sessions.push({ t: e.t, host: e.host, pieces: e.pieces, tab: e.tab, sent: 0, results: 0, firstVisibleMs: null, lastResultMs: null, progress: null });
      const s = sessions[sessions.length - 1];
      if (!s || e.tab !== s.tab) continue;
      if (e.type === "page.send") s.sent++;
      else if (e.type === "page.result") {
        s.results++;
        if (e.priority === "high" && s.firstVisibleMs === null) s.firstVisibleMs = e.t - s.t;
        s.lastResultMs = e.t - s.t;
      } else if (e.type === "page.progress") s.progress = e;
    }

    const pairs = ok.filter((e) => e.tokens && e.estTokens);
    const r = {
      requests: {
        total: llm.length,
        ok: ok.length,
        rateLimited: limited.length,
        errors: errors.length,
        abandoned: limited.filter((e) => e.abandoned).length,
        avgMs: avg(ok.map((e) => e.ms)),
        p95Ms: percentile(ok.map((e) => e.ms), 95),
        maxMs: max(ok.map((e) => e.ms)),
        highPriority: ok.filter((e) => e.priority !== "low").length,
        lowPriority: ok.filter((e) => e.priority === "low").length,
      },
      waits: {
        avgBudgetMs: avg(llm.map((e) => e.waitBudgetMs || 0)),
        maxBudgetMs: max(llm.map((e) => e.waitBudgetMs || 0)),
        avgSlotMs: avg(llm.map((e) => e.waitSlotMs || 0)),
        maxSlotMs: max(llm.map((e) => e.waitSlotMs || 0)),
      },
      tokens: {
        last60s: tokensLast60s,
        limitPerMinute: budgetLimit,
        usedPct: budgetLimit ? Math.round((100 * tokensLast60s) / budgetLimit) : 0,
        total: ok.reduce((s, e) => s + tokensOf(e), 0),
        estimationErrorPct: pairs.length ? Math.round((100 * pairs.reduce((s, e) => s + (e.estTokens - e.tokens), 0)) / pairs.reduce((s, e) => s + e.tokens, 0)) : 0,
      },
      html: {
        calls: html.length,
        avgMs: avg(html.map((e) => e.ms)),
        maxMs: max(html.map((e) => e.ms)),
        failedBlocks: sum(events, "html.call", "failedBlocks"),
        googleFallbackOk: sum(events, "html.call", "googleFallbackOk"),
        skippedAlreadyTarget: sum(events, "html.call", "skippedAlreadyTarget"),
      },
      structure: { invalidBlocks: sum(events, "llm.structure", "invalidBlocks"), splits: count(events, "llm.split") },
      guards: {
        stuckPieces: sum(events, "guard.stuck-pieces", "pieces"),
        inflightReset: count(events, "guard.inflight-reset"),
        stall: count(events, "guard.stall"),
        gaveUp: count(events, "page.gave-up"),
        retries: count(events, "page.retry"),
      },
      sessions: sessions.slice(-8).reverse(),
      buckets,
      verdicts: [],
      events: events.length,
    };

    // Constats en clair : ce qui explique la lenteur ou le texte qui manque
    const v = r.verdicts;
    if (r.requests.total === 0 && r.html.calls === 0) v.push({ level: "info", text: "No translation recorded yet. Translate a page, then refresh." });
    if (r.waits.avgBudgetMs > 1500 && r.waits.avgBudgetMs >= r.requests.avgMs)
      v.push({ level: "warn", text: "Most of the time is spent waiting for the token budget (" + sec(r.waits.avgBudgetMs) + " on average, " + sec(r.waits.maxBudgetMs) + " at most): Groq's per-minute limit is the bottleneck." });
    if (r.requests.rateLimited > 0)
      v.push({ level: "warn", text: r.requests.rateLimited + " request(s) refused by Groq (rate limit)" + (r.requests.abandoned ? ", " + r.requests.abandoned + " abandoned (daily quota?)" : "") + ". Those blocks wait or go to Google." });
    if (r.requests.avgMs > 4000) v.push({ level: "warn", text: "Groq answers slowly (" + sec(r.requests.avgMs) + " on average, " + sec(r.requests.p95Ms) + " for the slowest 5 %). Try a faster model." });
    if (r.waits.avgSlotMs > 1500) v.push({ level: "warn", text: "Requests wait for a free slot (" + sec(r.waits.avgSlotMs) + " on average): too many in parallel." });
    if (r.tokens.estimationErrorPct > 40) v.push({ level: "info", text: "The token estimate is " + r.tokens.estimationErrorPct + " % above the real usage: the budget is too cautious and slows translation." });
    if (r.tokens.estimationErrorPct < -25) v.push({ level: "warn", text: "The token estimate is " + Math.abs(r.tokens.estimationErrorPct) + " % below the real usage: the budget may be exceeded." });
    if (r.html.failedBlocks > 0) v.push({ level: "warn", text: r.html.failedBlocks + " block(s) failed on the AI" + (r.html.googleFallbackOk ? "; " + r.html.googleFallbackOk + " rescued by Google" : "") + "." });
    if (r.structure.invalidBlocks > 0) v.push({ level: "warn", text: "The model broke the structure of " + r.structure.invalidBlocks + " block(s): they were translated again piece by piece, costing extra requests." });
    if (r.guards.gaveUp > 0) v.push({ level: "error", text: r.guards.gaveUp + " piece(s) given up after all retries: they stay untranslated." });
    if (r.guards.stuckPieces > 0 || r.guards.inflightReset > 0) v.push({ level: "error", text: "Guard: " + r.guards.stuckPieces + " piece(s) stuck without answer were put back in the queue." });
    if (r.guards.stall > 0) v.push({ level: "warn", text: "Guard: the translation stalled " + r.guards.stall + " time(s) and was restarted." });
    const last = r.sessions[0];
    if (last && last.firstVisibleMs !== null && last.firstVisibleMs > 6000) v.push({ level: "warn", text: "On " + (last.host || "the last page") + ", the first visible text took " + sec(last.firstVisibleMs) + " to appear." });
    if (last && last.progress && last.progress.pending > 0 && now - last.t > 60000)
      v.push({ level: "warn", text: "On " + (last.host || "the last page") + ", " + last.progress.pending + " piece(s) still waiting after " + sec(now - last.t) + ". See the \"This page\" tab for the reason of each one." });
    if (v.length === 0) v.push({ level: "ok", text: "Nothing abnormal in the log." });
    return r;
  }

  const hhmmss = (t) => new Date(t).toISOString().slice(11, 23);

  function eventLine(e) {
    const { t, type, ...rest } = e;
    const detail = Object.entries(rest)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([k, value]) => k + "=" + (typeof value === "object" ? JSON.stringify(value) : value))
      .join(" ");
    return hhmmss(t) + " " + type + (detail ? " " + detail : "");
  }

  /** Rapport texte à copier-coller (constats, chiffres, état de la page, derniers événements). */
  function buildReport(s, pageReport, events, now = Date.now()) {
    const out = ["# Translate Express - diagnostic report (" + new Date(now).toISOString() + ")", "", "## Findings"];
    s.verdicts.forEach((x) => out.push("- [" + x.level + "] " + x.text));
    out.push("", "## Requests to the AI");
    out.push("total=" + s.requests.total + " ok=" + s.requests.ok + " rateLimited=" + s.requests.rateLimited + " errors=" + s.requests.errors + " abandoned=" + s.requests.abandoned + " high=" + s.requests.highPriority + " low=" + s.requests.lowPriority);
    out.push("network ms: avg=" + s.requests.avgMs + " p95=" + s.requests.p95Ms + " max=" + s.requests.maxMs);
    out.push("waiting ms: budget avg=" + s.waits.avgBudgetMs + " max=" + s.waits.maxBudgetMs + " | slot avg=" + s.waits.avgSlotMs + " max=" + s.waits.maxSlotMs);
    out.push("tokens: last60s=" + s.tokens.last60s + " limit/min=" + s.tokens.limitPerMinute + " (" + s.tokens.usedPct + " %) total=" + s.tokens.total + " estimateError=" + s.tokens.estimationErrorPct + " %");
    out.push("", "## Translation calls");
    out.push("calls=" + s.html.calls + " avgMs=" + s.html.avgMs + " maxMs=" + s.html.maxMs + " failedBlocks=" + s.html.failedBlocks + " googleRescued=" + s.html.googleFallbackOk + " skippedAlreadyTarget=" + s.html.skippedAlreadyTarget);
    out.push("structure: invalidBlocks=" + s.structure.invalidBlocks + " splits=" + s.structure.splits);
    out.push("guards: " + JSON.stringify(s.guards));
    out.push("", "## Recent page translations");
    s.sessions.forEach((x) => out.push(hhmmss(x.t) + " " + x.host + " pieces=" + x.pieces + " sent=" + x.sent + " results=" + x.results + " firstVisibleMs=" + x.firstVisibleMs + " lastResultMs=" + x.lastResultMs + (x.progress ? " pending=" + x.progress.pending : "")));
    if (pageReport && !pageReport.error) {
      out.push("", "## State of the current page (" + pageReport.host + ")");
      out.push(JSON.stringify({ state: pageReport.pageState, counts: pageReport.counts, excluded: pageReport.excluded, pieces: pageReport.pieces, flags: pageReport.flags }));
      for (const [cat, list] of Object.entries(pageReport.examples || {})) {
        out.push("examples " + cat + ":");
        list.forEach((x) => out.push("  - \"" + x.text + "\" in " + x.path + (x.why ? " (" + x.why + ")" : "")));
      }
    }
    if (pageReport && pageReport.error) out.push("", "## State of the current page: unavailable - " + pageReport.error);
    out.push("", "## Last events");
    events.slice(-60).forEach((e) => out.push(eventLine(e)));
    return out.join("\n");
  }

  return { summarize, buildReport, eventLine, hhmmss, sec };
})();

if (typeof module !== "undefined") module.exports = twpMetrics;
