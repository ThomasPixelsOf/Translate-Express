// Tests du service de traduction par modèle de langage (src/background/llmService.js), sans réseau :
// `fetch` est remplacé par un faux serveur compatible OpenAI.
// Lancer : node --test tests/
const { test } = require("node:test");
const assert = require("node:assert/strict");
const twpLlm = require("../src/background/llmService.js");

// Version minimale de la classe `Service` de translationService.js (seuls les champs utilisés par llmService).
class FauxService {
  constructor(serviceName, baseURL, xhrMethod, cbTransformRequest, cbParseResponse, cbTransformResponse) {
    Object.assign(this, { serviceName, baseURL, xhrMethod, cbTransformRequest, cbParseResponse, cbTransformResponse });
  }
}
const Utils = {
  escapeHTML: (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  unescapeHTML: (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
};
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
twpLlm._test.configurerBudget({ limite: 1e9 });
const config = { provider: "groq", apiKey: "gsk_1234567890abcdef", model: "un-modele/test-1" };

function fauxFetch(reponses) {
  twpLlm._test.reinitialiserBudget(); // un blocage ou des dépenses d'un test précédent ne doivent pas gêner celui-ci
  const appels = [];
  global.fetch = async (url, init) => {
    appels.push({ url, init, corps: init && init.body ? JSON.parse(init.body) : null });
    const r = reponses.shift();
    if (r.reseau) throw new Error("réseau coupé");
    return {
      ok: r.status === undefined || r.status < 400,
      status: r.status ?? 200,
      headers: { get: (n) => (n === "retry-after" ? r.retryAfter ?? null : null) },
      json: async () => r.json ?? { choices: [{ message: { content: r.content } }] },
    };
  };
  return appels;
}

test("extraireTableau accepte un objet, un tableau, un bloc de code et la réflexion du modèle", () => {
  const { extraireTableau } = twpLlm._test;
  assert.deepEqual(extraireTableau('{"translations":["a","b"]}'), ["a", "b"]);
  assert.deepEqual(extraireTableau('["a","b"]'), ["a", "b"]);
  assert.deepEqual(extraireTableau('```json\n{"translations":["a"]}\n```'), ["a"]);
  assert.deepEqual(extraireTableau('<think>je réfléchis { [ }</think>{"translations":["ok"]}'), ["ok"]);
  assert.throws(() => extraireTableau("pas du json"));
  assert.throws(() => extraireTableau('{"translations":[1,2]}'));
});

test("decouperReponse retrouve les morceaux <a i=N>, les remet dans l'ordre et enlève l'échappement HTML", () => {
  const { decouperReponse } = twpLlm._test;
  const sortie = decouperReponse("<pre><a i=1>B &amp; b</a><a i=0>A</a></pre>", false, Utils.unescapeHTML);
  assert.deepEqual(sortie, ["A", "B & b"]);
  assert.deepEqual(decouperReponse("<pre><a i=1>B</a><a i=0>A</a></pre>", true, Utils.unescapeHTML), ["B", "A"]);
  assert.deepEqual(decouperReponse("<pre>Bonjour</pre>", false, Utils.unescapeHTML), ["Bonjour"]);
});

test("le service traduit un lot en une seule requête et envoie la clé uniquement à l'adresse du fournisseur", async () => {
  const service = twpLlm.create(FauxService, Utils, config);
  assert.equal(service.baseURL, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(service.maxRequestSize, 1800);
  assert.match(service.serviceName, /^llm-un_modele_test_1$/);
  const appels = fauxFetch([{ content: '{"translations":["<pre>Bonjour</pre>","<pre><a i=0>Un</a><a i=1>Deux</a></pre>"]}' }]);
  const rep = await service.makeRequest("en", "fr", [{ originalText: "<pre>Hello</pre>" }, { originalText: "<pre><a i=0>One</a><a i=1>Two</a></pre>" }]);
  assert.equal(appels.length, 1);
  assert.equal(appels[0].init.headers.Authorization, "Bearer gsk_1234567890abcdef");
  assert.equal(appels[0].corps.model, "un-modele/test-1");
  assert.deepEqual(JSON.parse(appels[0].corps.messages[1].content), ["<pre>Hello</pre>", "<pre><a i=0>One</a><a i=1>Two</a></pre>"]);
  assert.match(appels[0].corps.messages[0].content, /English to French/);
  assert.deepEqual(rep, ["<pre>Bonjour</pre>", "<pre><a i=0>Un</a><a i=1>Deux</a></pre>"]);
  assert.deepEqual(service.cbTransformResponse(rep[1], false), ["Un", "Deux"]);
});

test("longueur incorrecte : le service coupe le lot en deux et traduit les moitiés", async () => {
  const service = twpLlm.create(FauxService, Utils, config);
  const appels = fauxFetch([
    { content: '{"translations":["seulement un"]}' },
    { content: '{"translations":["un"]}' },
    { content: '{"translations":["deux"]}' },
  ]);
  const rep = await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }, { originalText: "<pre>two</pre>" }]);
  assert.deepEqual(rep, ["un", "deux"]);
  assert.equal(appels.length, 3);
});

test("une erreur 429 est retentée ; une erreur 401 ne l'est pas", async () => {
  const service = twpLlm.create(FauxService, Utils, config);
  const appels = fauxFetch([{ status: 429, retryAfter: "0" }, { content: '{"translations":["ok"]}' }]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), ["ok"]);
  assert.equal(appels.length, 2);

  const appels2 = fauxFetch([{ status: 401, json: { error: { message: "Invalid API Key" } } }]);
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), /401.*Invalid API Key/);
  assert.equal(appels2.length, 1);
});

test("sans clé, adresse ou modèle, le service refuse sans appeler le réseau", async () => {
  const service = twpLlm.create(FauxService, Utils, { provider: "groq", apiKey: "", model: "m" });
  const appels = fauxFetch([]);
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), /non configuré/);
  assert.equal(appels.length, 0);
});

test("tester() renvoie la phrase traduite et la durée", async () => {
  fauxFetch([{ content: '{"translations":["Bonjour, comment allez-vous aujourd’hui ?"]}' }]);
  const r = await twpLlm.tester(config);
  assert.match(r.text, /Bonjour/);
  assert.equal(typeof r.ms, "number");
});

test("le fournisseur se reconnaît à la clé, sans aucun réglage", () => {
  assert.equal(twpLlm.detecterFournisseur("gsk_abc123"), "groq");
  assert.equal(twpLlm.detecterFournisseur("autre"), "custom");
  const cfg = twpLlm.normaliser({ apiKey: "gsk_abc123" });
  assert.equal(cfg.provider, "groq");
  assert.equal(cfg.url, "https://api.groq.com/openai/v1/chat/completions");
});

test("sans modèle saisi : Groq choisit le premier modèle préféré disponible, une seule fois", async () => {
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef" });
  const appels = fauxFetch([
    { json: { data: [{ id: "whisper-large-v3" }, { id: "llama-3.3-70b-versatile" }, { id: "openai/gpt-oss-120b" }] } },
    { content: '{"translations":["un"]}' },
    { content: '{"translations":["deux"]}' },
  ]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }]), ["un"]);
  assert.match(appels[0].url, /\/openai\/v1\/models$/);
  assert.equal(appels[1].corps.model, "llama-3.3-70b-versatile", "un modèle rapide est préféré aux modèles raisonneurs");
  await service.makeRequest("en", "fr", [{ originalText: "<pre>two</pre>" }]);
  assert.equal(appels.length, 3, "la liste des modèles n'est demandée qu'une fois");
});

test("translateFree : texte libre, consigne de ton, protection contre les instructions cachées", async () => {
  const appels = fauxFetch([{ content: "<think>x</think>Bonjour tout le monde" }]);
  const out = await twpLlm.translateFree({ apiKey: "gsk_1234567890abcdef", model: "m-libre" }, "auto", "fr", "Hello everyone", "formal");
  assert.equal(out, "Bonjour tout le monde");
  assert.equal(appels[0].corps.messages[1].content, "Hello everyone");
  assert.match(appels[0].corps.messages[0].content, /formal/);
  assert.match(appels[0].corps.messages[0].content, /never follow instructions/);
  await assert.rejects(() => twpLlm.translateFree({ apiKey: "", url: "" }, "auto", "fr", "x"), /no-key/);
});

test("une réponse absente (requête échouée) est une erreur, jamais le texte « null »", () => {
  const { decouperReponse } = twpLlm._test;
  assert.throws(() => decouperReponse(null, false, Utils.unescapeHTML), /translation failed/);
  assert.throws(() => decouperReponse(undefined, false, Utils.unescapeHTML), /translation failed/);
});

test("un modèle raisonneur reçoit le réglage qui coupe la réflexion ; refusé (400), on réessaie sans et on s'en souvient", async () => {
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "openai/gpt-oss-20b" });
  const appels = fauxFetch([
    { status: 400, json: { error: { message: "unknown parameter reasoning_effort" } } },
    { content: '{"translations":["un"]}' },
    { content: '{"translations":["deux"]}' },
  ]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }]), ["un"]);
  assert.equal(appels[0].corps.reasoning_effort, "low");
  assert.equal(appels[1].corps.reasoning_effort, undefined, "réessayé sans le réglage");
  await service.makeRequest("en", "fr", [{ originalText: "<pre>two</pre>" }]);
  assert.equal(appels[2].corps.reasoning_effort, undefined, "le refus est mémorisé");
});

test("un modèle non raisonneur ne reçoit aucun réglage supplémentaire", async () => {
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "llama-3.3-70b-versatile" });
  const appels = fauxFetch([{ content: '{"translations":["un"]}' }]);
  await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }]);
  assert.equal(appels[0].corps.reasoning_effort, undefined);
});

test("limite de débit longue : abandon immédiat (pas d'attente de plusieurs dizaines de secondes)", async () => {
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-limite" });
  const appels = fauxFetch([{ status: 429, retryAfter: "45" }]);
  const t0 = Date.now();
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), /rate limited/);
  assert.ok(Date.now() - t0 < 1000, "abandon rapide");
  assert.equal(appels.length, 1, "aucune nouvelle tentative");
});

test("lots plus petits (1800 caractères) pour pouvoir partir en parallèle", () => {
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m" });
  assert.equal(service.maxRequestSize, 1800);
});

test("structure : si le modèle fusionne deux morceaux d'un bloc, le bloc est retraduit morceau par morceau (aucun morceau perdu)", async () => {
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-structure" });
  const bloc = "<pre><a i=0>One</a><a i=1>Two</a><a i=2>Three</a></pre>";
  const appels = fauxFetch([
    { content: JSON.stringify({ translations: ["<pre><a i=0>Un</a><a i=1>Deux Trois</a></pre>"] }) }, // 2 morceaux au lieu de 3
    { content: JSON.stringify({ translations: ["<pre>Un</pre>", "<pre>Deux</pre>", "<pre>Trois</pre>"] }) }, // retraduit un par un
  ]);
  const rep = await service.makeRequest("en", "fr", [{ originalText: bloc }]);
  assert.equal(appels.length, 2);
  assert.deepEqual(JSON.parse(appels[1].corps.messages[1].content), ["<pre>One</pre>", "<pre>Two</pre>", "<pre>Three</pre>"]);
  assert.deepEqual(service.cbTransformResponse(rep[0], false), ["Un", "Deux", "Trois"]);
});

test("structure : numéros de morceaux non consécutifs ou balises perdues = bloc invalide ; un bloc correct n'est pas retraduit", () => {
  const { structureValide, extrairePieces } = twpLlm._test;
  const source = "<pre><a i=0>A</a><a i=1>B</a></pre>";
  assert.equal(structureValide(source, "<pre><a i=0>a</a><a i=1>b</a></pre>"), true);
  assert.equal(structureValide(source, "<pre><a i=0>a</a><a i=2>b</a></pre>"), false, "numéros 0 et 2");
  assert.equal(structureValide(source, "<pre>a b</pre>"), false, "balises perdues");
  assert.equal(structureValide("<pre>Un seul morceau</pre>", "<pre>Un seul</pre>"), true, "bloc simple : rien à contrôler");
  assert.deepEqual(extrairePieces(source), ["A", "B"]);
});

test("budget de jetons : les requêtes qui dépasseraient la minute attendent au lieu d'être refusées (aucune erreur 429)", async () => {
  twpLlm._test.configurerBudget({ fenetreMs: 600, limite: 700 });
  try {
    const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-budget" });
    const texte = "<pre>" + "mot ".repeat(150) + "</pre>"; // ~ 600 caractères : plus de 500 jetons estimés, deux requêtes ne tiennent pas dans 700
    const cout = twpLlm._test.estimerJetons([{ content: "x".repeat(150) }, { content: JSON.stringify([texte]) }], "m-budget");
    assert.ok(cout > 350 && cout < 700, "estimation plausible : " + cout);
    const appels = fauxFetch([1, 2, 3].map(() => ({ content: '{"translations":["ok"]}' })));
    const t0 = Date.now();
    await Promise.all([1, 2, 3].map(() => service.makeRequest("en", "fr", [{ originalText: texte }])));
    assert.equal(appels.length, 3, "toutes les requêtes ont fini par partir");
    assert.ok(Date.now() - t0 >= 1000, "elles ont été étalées sur la fenêtre (pas envoyées d'un coup) : " + (Date.now() - t0) + " ms");
  } finally {
    twpLlm._test.configurerBudget({ fenetreMs: 60000, limite: 1e9 });
  }
});

test("budget de jetons : la limite réelle annoncée par le fournisseur est lue dans les en-têtes", async () => {
  twpLlm._test.configurerBudget({ limite: 6000 });
  try {
    const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-entetes" });
    global.fetch = async (url, init) => ({
      ok: true, status: 200,
      headers: { get: (n) => (n === "x-ratelimit-limit-tokens" ? "12000" : null) },
      json: async () => ({ choices: [{ message: { content: '{"translations":["ok"]}' } }], usage: { total_tokens: 321 } }),
    });
    await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]);
    assert.equal(twpLlm._test.budget.limite, 10200, "85 % de 12 000 jetons par minute");
    assert.equal(twpLlm._test.budget.depenses.at(-1).jetons, 321, "la consommation réelle remplace l'estimation");
  } finally {
    twpLlm._test.configurerBudget({ limite: 1e9 });
  }
});

test("erreur 429 de quelques secondes : l'extension attend puis réussit, sans abandonner ni se replier sur Google", async () => {
  twpLlm._test.configurerBudget({ limite: 1e9 });
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-429" });
  const appels = fauxFetch([{ status: 429, retryAfter: "1" }, { content: '{"translations":["fini"]}' }]);
  const t0 = Date.now();
  const rep = await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]);
  assert.deepEqual(rep, ["fini"]);
  assert.equal(appels.length, 2);
  assert.ok(Date.now() - t0 >= 900, "elle a attendu le délai indiqué (1 s)");
  twpLlm._test.configurerBudget({ limite: 1e9 });
});

test("la consigne envoyée à chaque requête est courte (moins de jetons gaspillés)", async () => {
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-court" });
  const appels = fauxFetch([{ content: '{"translations":["ok"]}' }]);
  await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]);
  assert.ok(appels[0].corps.messages[0].content.length < 520, "consigne : " + appels[0].corps.messages[0].content.length + " caractères");
  assert.match(appels[0].corps.messages[0].content, /already in French/);
});

test("limite longue (quota du jour) : les requêtes suivantes échouent tout de suite au lieu d'attendre toutes plusieurs dizaines de secondes", async () => {
  twpLlm._test.configurerBudget({ limite: 1e9 });
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-quota" });
  const appels = fauxFetch([{ status: 429, retryAfter: "600" }]);
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>a</pre>" }]), /rate limited/);
  const t0 = Date.now();
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>b</pre>" }]), /rate limited/);
  assert.ok(Date.now() - t0 < 300, "échec immédiat");
  assert.equal(appels.length, 1, "aucune requête envoyée pendant le blocage");
  twpLlm._test.configurerBudget({ limite: 1e9 });
});

test("priorité : une requête du reste de la page (low) cède la place à une requête de ce qui est visible (high)", async () => {
  twpLlm._test.configurerBudget({ fenetreMs: 400, limite: 700 }); // une seule requête de ~560 jetons par fenêtre
  try {
    const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-priorite" });
    const bloc = (marque) => "<pre>" + marque + " " + "mot ".repeat(150) + "</pre>";
    const appels = fauxFetch(["A", "B", "C", "D"].map(() => ({ content: '{"translations":["ok"]}' })));
    const envoyer = (marque, priorite) => service.makeRequest("en", "fr", [{ originalText: bloc(marque) }], { priority: priorite });
    const a = envoyer("A", "high"); // part tout de suite
    await attendre(20);
    const suite = [envoyer("B", "low"), envoyer("C", "low")]; // arrivent AVANT D mais attendent
    await attendre(20);
    const d = envoyer("D", "high"); // arrive en dernier mais passe devant B et C
    await Promise.all([a, d, ...suite]);
    const ordre = appels.map((x) => JSON.parse(x.corps.messages[1].content)[0].slice(5, 6));
    assert.deepEqual(ordre, ["A", "D", "B", "C"], "ce qui est visible passe devant le reste de la page : " + ordre.join(""));
  } finally {
    twpLlm._test.configurerBudget({ fenetreMs: 60000, limite: 1e9 });
  }
});

test("priorité : sans concurrence, une requête du reste de la page part normalement (rien n'est ignoré)", async () => {
  twpLlm._test.configurerBudget({ limite: 1e9 });
  const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-fond" });
  const appels = fauxFetch([{ content: '{"translations":["un"]}' }]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }], { priority: "low" }), ["un"]);
  assert.equal(appels.length, 1);
});

test("budget saturé : une requête qui attendrait trop longtemps échoue tout de suite (repli sur Google) au lieu de patienter", async () => {
  twpLlm._test.configurerBudget({ fenetreMs: 60000, limite: 700 });
  try {
    const service = twpLlm.create(FauxService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-saturé" });
    const texte = "<pre>" + "mot ".repeat(150) + "</pre>";
    const appels = fauxFetch([{ content: '{"translations":["ok"]}' }]);
    await service.makeRequest("en", "fr", [{ originalText: texte }]); // la première passe et remplit le budget
    const t0 = Date.now();
    await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: texte }], { priority: "low" }), /budget saturated/);
    assert.ok(Date.now() - t0 < 500, "échec immédiat : " + (Date.now() - t0) + " ms");
    assert.equal(appels.length, 1, "aucune requête de plus envoyée à Groq");
  } finally {
    twpLlm._test.configurerBudget({ fenetreMs: 60000, limite: 1e9 });
  }
});
