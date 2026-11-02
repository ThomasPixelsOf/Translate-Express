"use strict";

// Dashboard (popup window): summary, state of the chosen page, log. The calculations are in metrics.js.
const $ = (id) => document.getElementById(id);
// Inside the toolbar popup: Escape closes it.
if (window.parent !== window) {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.parent.postMessage({ twp: "close" }, location.origin);
  });
}
const tabId = Number(new URLSearchParams(location.search).get("tab")) || null;
let events = [];
let summary = null;
let pageReport = null;

const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (r) => { void chrome.runtime.lastError; resolve(r); }));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const card = (value, label) => '<div class="card"><b>' + esc(value) + "</b><span>" + esc(label) + "</span></div>";

function renderSummary() {
  const s = summary;
  const max = Math.max(1, ...s.buckets);
  const bars = s.buckets.map((v, i) => '<rect x="' + i * (100 / 60) + '" y="' + (100 - (100 * v) / max) + '" width="1.4" height="' + (100 * v) / max + '" fill="#6ea8fe"/>').join("");
  $("summary").innerHTML =
    s.verdicts.map((v) => '<div class="verdict ' + v.level + '">' + esc(v.text) + "</div>").join("") +
    '<div class="cards">' +
    card(s.requests.ok + " / " + s.requests.total, twpUi.t("dashboardAiRequestsOk")) +
    card(twpMetrics.sec(s.requests.avgMs), twpUi.t("dashboardNetworkAvg")) +
    card(twpMetrics.sec(s.waits.avgBudgetMs), twpUi.t("dashboardBudgetWaitAvg")) +
    card(s.requests.rateLimited, twpUi.t("dashboardRateLimited")) +
    card(s.tokens.last60s + (s.tokens.limitPerMinute ? " / " + s.tokens.limitPerMinute : ""), twpUi.t("dashboardTokensLastMinute")) +
    card(s.html.failedBlocks, twpUi.t("dashboardFailedBlocks")) +
    card(s.html.googleFallbackOk, twpUi.t("dashboardRescued")) +
    card(s.guards.gaveUp, twpUi.t("dashboardGivenUp")) +
    "</div><h2>" + twpUi.t("dashboardTokensChart") + "</h2>" +
    '<svg class="chart" viewBox="0 0 100 100" preserveAspectRatio="none">' + bars + "</svg>" +
    "<h2>" + twpUi.t("dashboardRecent") + "</h2><table><tr>" + ["Time", "Site", "Pieces", "Sent", "FirstVisible", "Pending"].map((c) => "<th>" + twpUi.t("dashboardCol" + c) + "</th>").join("") + "</tr>" +
    s.sessions.map((x) => "<tr><td>" + twpMetrics.hhmmss(x.t).slice(0, 8) + "</td><td>" + esc(x.host || "") + "</td><td>" + x.pieces + "</td><td>" + x.sent + "</td><td>" + (x.firstVisibleMs === null ? "-" : twpMetrics.sec(x.firstVisibleMs)) + "</td><td>" + (x.progress ? x.progress.pending : "-") + "</td></tr>").join("") +
    "</table>";
}

function renderPage() {
  const r = pageReport;
  const el = $("page");
  const scan = '<button id="scan">' + twpUi.t("dashboardScanNow") + "</button>";
  if (!r || r.error) return (el.innerHTML = "<p>" + twpUi.t("dashboardNoReport") + (r && r.error ? ": " + esc(r.error) : "") + ".</p>" + scan);
  el.innerHTML =
    "<p>" + esc(r.host) + " - state: <b>" + esc(r.pageState) + "</b>, service " + esc(r.service) + ", target " + esc(r.target) + " " + scan + "</p>" +
    '<div class="cards">' + Object.entries(r.counts || {}).map(([k, v]) => card(v, k)).join("") + "</div>" +
    "<h2>" + twpUi.t("dashboardExcluded") + "</h2><pre>" + esc(JSON.stringify(r.excluded || {})) + "</pre>" +
    Object.entries(r.examples || {}).map(([cat, list]) => "<h2>" + esc(cat) + "</h2>" + list.map((x) => '<div class="ex">"' + esc(x.text) + '" in ' + esc(x.path) + (x.why ? " (" + esc(x.why) + ")" : "") + "</div>").join("")).join("");
  const b = $("scan");
  if (b) b.onclick = async () => { await send({ action: "twpDiagScan", tabId }); setTimeout(load, 800); };
}

function renderLog() {
  const q = $("filter").value.toLowerCase();
  $("events").textContent = events.filter((e) => !q || twpMetrics.eventLine(e).toLowerCase().includes(q)).slice(-300).map(twpMetrics.eventLine).reverse().join("\n");
}

async function load() {
  const res = await send({ action: "twpDiagGet" });
  events = (res && res.events) || [];
  summary = twpMetrics.summarize(events);
  pageReport = await send({ action: "twpDiagPageReport", tabId });
  $("status").textContent = (res && res.enabled === false ? twpUi.t("dashboardLoggingOff") : "") + twpUi.t("dashboardEventsKept", events.length);
  renderSummary();
  renderPage();
  renderLog();
}

document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => {
  document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
  ["summary", "page", "log"].forEach((id) => ($(id).hidden = id !== b.dataset.tab));
}));
$("filter").oninput = renderLog;
$("refresh").onclick = load;
$("clear").onclick = async () => { await send({ action: "twpDiagClear" }); load(); };
$("copy").onclick = async () => {
  await navigator.clipboard.writeText(twpMetrics.buildReport(summary, pageReport, events));
  $("status").textContent = twpUi.t("dashboardReportCopied");
};
twpConfig.onReady(() => {
  twpUi.translateDocument();
  load();
});
twpConfig.onChanged((name) => {
  if (name === "uiLanguage") {
    twpUi.translateDocument();
    load();
  }
});
setInterval(load, 5000);
