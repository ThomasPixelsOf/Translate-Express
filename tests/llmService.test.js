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
const config = { provider: "groq", apiKey: "gsk_1234567890abcdef", model: "un-modele/test-1" };

function fauxFetch(reponses) {
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
  assert.equal(service.maxRequestSize, 3000);
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

test("longueur incorrecte : le service retraduit les textes un par un", async () => {
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
  assert.equal(appels[1].corps.model, "openai/gpt-oss-120b");
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
