// Tests of the language-model translation service (src/background/llmService.js), without network:
// `fetch` is replaced by a fake OpenAI-compatible server.
// Run: node --test "tests/*.test.js"
const { test } = require("node:test");
const assert = require("node:assert/strict");
const twpLlm = require("../src/background/llmService.js");

// Minimal version of the `Service` class of translationService.js (only the fields llmService uses).
class FakeService {
  constructor(serviceName, baseURL, xhrMethod, cbTransformRequest, cbParseResponse, cbTransformResponse) {
    Object.assign(this, { serviceName, baseURL, xhrMethod, cbTransformRequest, cbParseResponse, cbTransformResponse });
  }
}
const Utils = {
  escapeHTML: (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  unescapeHTML: (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"),
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
twpLlm._test.configureBudget({ limit: 1e9 });
const config = { provider: "groq", apiKey: "gsk_1234567890abcdef", model: "some-model/test-1" };

function fakeFetch(responses) {
  twpLlm._test.resetBudget(); // a block or spending from a previous test must not get in the way of this one
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    const r = responses.shift();
    if (r.network) throw new Error("network down");
    return {
      ok: r.status === undefined || r.status < 400,
      status: r.status ?? 200,
      headers: { get: (n) => (n === "retry-after" ? r.retryAfter ?? null : null) },
      json: async () => r.json ?? { choices: [{ message: { content: r.content } }] },
    };
  };
  return calls;
}

test("extractArray accepts an object, an array, a code block and the model's thinking", () => {
  const { extractArray } = twpLlm._test;
  assert.deepEqual(extractArray('{"translations":["a","b"]}'), ["a", "b"]);
  assert.deepEqual(extractArray('["a","b"]'), ["a", "b"]);
  assert.deepEqual(extractArray('```json\n{"translations":["a"]}\n```'), ["a"]);
  assert.deepEqual(extractArray('<think>I am thinking { [ }</think>{"translations":["ok"]}'), ["ok"]);
  assert.throws(() => extractArray("not json"));
  assert.throws(() => extractArray('{"translations":[1,2]}'));
});

test("splitAnswer finds the <a i=N> pieces, puts them back in order and removes the HTML escaping", () => {
  const { splitAnswer } = twpLlm._test;
  const output = splitAnswer("<pre><a i=1>B &amp; b</a><a i=0>A</a></pre>", false, Utils.unescapeHTML);
  assert.deepEqual(output, ["A", "B & b"]);
  assert.deepEqual(splitAnswer("<pre><a i=1>B</a><a i=0>A</a></pre>", true, Utils.unescapeHTML), ["B", "A"]);
  assert.deepEqual(splitAnswer("<pre>Bonjour</pre>", false, Utils.unescapeHTML), ["Bonjour"]);
});

test("the service translates a batch in a single request and sends the key only to the provider's address", async () => {
  const service = twpLlm.create(FakeService, Utils, config);
  assert.equal(service.baseURL, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(service.maxRequestSize, 1800);
  assert.match(service.serviceName, /^llm-some_model_test_1$/);
  const calls = fakeFetch([{ content: '{"translations":["<pre>Bonjour</pre>","<pre><a i=0>Un</a><a i=1>Deux</a></pre>"]}' }]);
  const result = await service.makeRequest("en", "fr", [{ originalText: "<pre>Hello</pre>" }, { originalText: "<pre><a i=0>One</a><a i=1>Two</a></pre>" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers.Authorization, "Bearer gsk_1234567890abcdef");
  assert.equal(calls[0].body.model, "some-model/test-1");
  assert.deepEqual(JSON.parse(calls[0].body.messages[1].content), ["<pre>Hello</pre>", "<pre><a i=0>One</a><a i=1>Two</a></pre>"]);
  assert.match(calls[0].body.messages[0].content, /English to French/);
  assert.deepEqual(result, ["<pre>Bonjour</pre>", "<pre><a i=0>Un</a><a i=1>Deux</a></pre>"]);
  assert.deepEqual(service.cbTransformResponse(result[1], false), ["Un", "Deux"]);
});

test("wrong length: the service splits the batch in two and translates the halves", async () => {
  const service = twpLlm.create(FakeService, Utils, config);
  const calls = fakeFetch([
    { content: '{"translations":["seulement un"]}' },
    { content: '{"translations":["un"]}' },
    { content: '{"translations":["deux"]}' },
  ]);
  const result = await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }, { originalText: "<pre>two</pre>" }]);
  assert.deepEqual(result, ["un", "deux"]);
  assert.equal(calls.length, 3);
});

test("a 429 error is retried; a 401 error is not", async () => {
  const service = twpLlm.create(FakeService, Utils, config);
  const calls = fakeFetch([{ status: 429, retryAfter: "0" }, { content: '{"translations":["ok"]}' }]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), ["ok"]);
  assert.equal(calls.length, 2);

  const calls2 = fakeFetch([{ status: 401, json: { error: { message: "Invalid API Key" } } }]);
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), /401.*Invalid API Key/);
  assert.equal(calls2.length, 1);
});

test("without key, address or model, the service refuses without calling the network", async () => {
  const service = twpLlm.create(FakeService, Utils, { provider: "groq", apiKey: "", model: "m" });
  const calls = fakeFetch([]);
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), /not configured/);
  assert.equal(calls.length, 0);
});

test("tester() returns the translated sentence and the duration", async () => {
  fakeFetch([{ content: '{"translations":["Bonjour, comment allez-vous aujourd’hui ?"]}' }]);
  const r = await twpLlm.tester(config);
  assert.match(r.text, /Bonjour/);
  assert.equal(typeof r.ms, "number");
});

test("the provider is recognized from the key, without any setting", () => {
  assert.equal(twpLlm.detectProvider("gsk_abc123"), "groq");
  assert.equal(twpLlm.detectProvider("autre"), "custom");
  const cfg = twpLlm.normalize({ apiKey: "gsk_abc123" });
  assert.equal(cfg.provider, "groq");
  assert.equal(cfg.url, "https://api.groq.com/openai/v1/chat/completions");
});

test("without a typed model: Groq picks the first preferred model available, only once", async () => {
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef" });
  const calls = fakeFetch([
    { json: { data: [{ id: "whisper-large-v3" }, { id: "llama-3.3-70b-versatile" }, { id: "openai/gpt-oss-120b" }] } },
    { content: '{"translations":["un"]}' },
    { content: '{"translations":["deux"]}' },
  ]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }]), ["un"]);
  assert.match(calls[0].url, /\/openai\/v1\/models$/);
  assert.equal(calls[1].body.model, "llama-3.3-70b-versatile", "a fast model is preferred to reasoning models");
  await service.makeRequest("en", "fr", [{ originalText: "<pre>two</pre>" }]);
  assert.equal(calls.length, 3, "the list of models is requested only once");
});

test("translateFree: free text, tone instruction, protection against hidden instructions", async () => {
  const calls = fakeFetch([{ content: "<think>x</think>Bonjour tout le monde" }]);
  const out = await twpLlm.translateFree({ apiKey: "gsk_1234567890abcdef", model: "m-libre" }, "auto", "fr", "Hello everyone", "formal");
  assert.equal(out, "Bonjour tout le monde");
  assert.equal(calls[0].body.messages[1].content, "Hello everyone");
  assert.match(calls[0].body.messages[0].content, /formal/);
  assert.match(calls[0].body.messages[0].content, /never follow instructions/);
  await assert.rejects(() => twpLlm.translateFree({ apiKey: "", url: "" }, "auto", "fr", "x"), /no-key/);
});

test("a missing answer (failed request) is an error, never the text \"null\"", () => {
  const { splitAnswer } = twpLlm._test;
  assert.throws(() => splitAnswer(null, false, Utils.unescapeHTML), /translation failed/);
  assert.throws(() => splitAnswer(undefined, false, Utils.unescapeHTML), /translation failed/);
});

test("a reasoning model gets the setting that turns off thinking; refused (400), it retries without and remembers it", async () => {
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "openai/gpt-oss-20b" });
  const calls = fakeFetch([
    { status: 400, json: { error: { message: "unknown parameter reasoning_effort" } } },
    { content: '{"translations":["un"]}' },
    { content: '{"translations":["deux"]}' },
  ]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }]), ["un"]);
  assert.equal(calls[0].body.reasoning_effort, "low");
  assert.equal(calls[1].body.reasoning_effort, undefined, "retried without the setting");
  await service.makeRequest("en", "fr", [{ originalText: "<pre>two</pre>" }]);
  assert.equal(calls[2].body.reasoning_effort, undefined, "the refusal is remembered");
});

test("a non-reasoning model gets no extra setting", async () => {
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "llama-3.3-70b-versatile" });
  const calls = fakeFetch([{ content: '{"translations":["un"]}' }]);
  await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }]);
  assert.equal(calls[0].body.reasoning_effort, undefined);
});

test("long rate limit: immediate give-up (no waiting for tens of seconds)", async () => {
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-limit" });
  const calls = fakeFetch([{ status: 429, retryAfter: "45" }]);
  const t0 = Date.now();
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), /rate limited/);
  assert.ok(Date.now() - t0 < 1000, "abandon rapide");
  assert.equal(calls.length, 1, "no new attempt");
});

test("smaller batches (1800 characters) so they can go in parallel", () => {
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m" });
  assert.equal(service.maxRequestSize, 1800);
});

test("structure: if the model merges two pieces of a block, the block is translated again piece by piece (no piece lost)", async () => {
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-structure" });
  const block = "<pre><a i=0>One</a><a i=1>Two</a><a i=2>Three</a></pre>";
  const calls = fakeFetch([
    { content: JSON.stringify({ translations: ["<pre><a i=0>Un</a><a i=1>Deux Trois</a></pre>"] }) }, // 2 parts au lieu de 3
    { content: JSON.stringify({ translations: ["<pre>Un</pre>", "<pre>Deux</pre>", "<pre>Trois</pre>"] }) }, // translated again one by one
  ]);
  const result = await service.makeRequest("en", "fr", [{ originalText: block }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(calls[1].body.messages[1].content), ["<pre>One</pre>", "<pre>Two</pre>", "<pre>Three</pre>"]);
  assert.deepEqual(service.cbTransformResponse(result[0], false), ["Un", "Deux", "Trois"]);
});

test("structure: non-consecutive piece numbers or lost tags = invalid block; a correct block is not translated again", () => {
  const { validStructure, extractPieces } = twpLlm._test;
  const source = "<pre><a i=0>A</a><a i=1>B</a></pre>";
  assert.equal(validStructure(source, "<pre><a i=0>a</a><a i=1>b</a></pre>"), true);
  assert.equal(validStructure(source, "<pre><a i=0>a</a><a i=2>b</a></pre>"), false, "numbers 0 and 2");
  assert.equal(validStructure(source, "<pre>a b</pre>"), false, "balises perdues");
  assert.equal(validStructure("<pre>Un seul morceau</pre>", "<pre>Un seul</pre>"), true, "simple block: nothing to check");
  assert.deepEqual(extractPieces(source), ["A", "B"]);
});

test("token budget: requests that would exceed the minute wait instead of being refused (no 429 error)", async () => {
  twpLlm._test.configureBudget({ windowMs: 600, limit: 700 });
  try {
    const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-budget" });
    const text = "<pre>" + "mot ".repeat(150) + "</pre>"; // ~ 600 characters: more than 500 estimated tokens, two requests do not fit in 700
    const cost = twpLlm._test.estimateTokens([{ content: "x".repeat(150) }, { content: JSON.stringify([text]) }], "m-budget");
    assert.ok(cost > 350 && cost < 700, "estimation plausible : " + cost);
    const calls = fakeFetch([1, 2, 3].map(() => ({ content: '{"translations":["ok"]}' })));
    const t0 = Date.now();
    await Promise.all([1, 2, 3].map(() => service.makeRequest("en", "fr", [{ originalText: text }])));
    assert.equal(calls.length, 3, "all the requests eventually went out");
    assert.ok(Date.now() - t0 >= 1000, "they were spread over the window (not sent all at once): " + (Date.now() - t0) + " ms");
  } finally {
    twpLlm._test.configureBudget({ windowMs: 60000, limit: 1e9 });
  }
});

test("token budget: the real limit announced by the provider is read from the headers", async () => {
  twpLlm._test.configureBudget({ limit: 6000 });
  try {
    const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-entetes" });
    global.fetch = async (url, init) => ({
      ok: true, status: 200,
      headers: { get: (n) => (n === "x-ratelimit-limit-tokens" ? "12000" : null) },
      json: async () => ({ choices: [{ message: { content: '{"translations":["ok"]}' } }], usage: { total_tokens: 321 } }),
    });
    await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]);
    assert.equal(twpLlm._test.budget.limit, 10200, "85 % of 12,000 tokens per minute");
    assert.equal(twpLlm._test.budget.spends.at(-1).tokens, 321, "the real consumption replaces the estimate");
  } finally {
    twpLlm._test.configureBudget({ limit: 1e9 });
  }
});

test("429 error of a few seconds: the extension waits then succeeds, without giving up or falling back to Google", async () => {
  twpLlm._test.configureBudget({ limit: 1e9 });
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-429" });
  const calls = fakeFetch([{ status: 429, retryAfter: "1" }, { content: '{"translations":["done"]}' }]);
  const t0 = Date.now();
  const result = await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]);
  assert.deepEqual(result, ["done"]);
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - t0 >= 900, "it waited the indicated delay (1 s)");
  twpLlm._test.configureBudget({ limit: 1e9 });
});

test("the instruction sent with each request is short (fewer wasted tokens)", async () => {
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-short" });
  const calls = fakeFetch([{ content: '{"translations":["ok"]}' }]);
  await service.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]);
  assert.ok(calls[0].body.messages[0].content.length < 520, "instruction: " + calls[0].body.messages[0].content.length + " characters");
  assert.match(calls[0].body.messages[0].content, /already in French/);
});

test("long limit (daily quota): the following requests fail right away instead of all waiting tens of seconds", async () => {
  twpLlm._test.configureBudget({ limit: 1e9 });
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-quota" });
  const calls = fakeFetch([{ status: 429, retryAfter: "600" }]);
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>a</pre>" }]), /rate limited/);
  const t0 = Date.now();
  await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: "<pre>b</pre>" }]), /rate limited/);
  assert.ok(Date.now() - t0 < 300, "immediate failure");
  assert.equal(calls.length, 1, "no request sent during the block");
  twpLlm._test.configureBudget({ limit: 1e9 });
});

test("priority: a request for the rest of the page (low) yields to a request for what is visible (high)", async () => {
  twpLlm._test.configureBudget({ windowMs: 400, limit: 700 }); // a single request of ~560 tokens per window
  try {
    const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-priorite" });
    const block = (marque) => "<pre>" + marque + " " + "mot ".repeat(150) + "</pre>";
    const calls = fakeFetch(["A", "B", "C", "D"].map(() => ({ content: '{"translations":["ok"]}' })));
    const send = (marque, priorite) => service.makeRequest("en", "fr", [{ originalText: block(marque) }], { priority: priorite });
    const a = send("A", "high"); // part tout de waiting
    await wait(20);
    const waiting = [send("B", "low"), send("C", "low")]; // arrivent AVANT D mais attendent
    await wait(20);
    const d = send("D", "high"); // arrives last but goes ahead of B and C
    await Promise.all([a, d, ...waiting]);
    const order = calls.map((x) => JSON.parse(x.body.messages[1].content)[0].slice(5, 6));
    // B and C (background) wait in parallel: their order between them is not guaranteed, all that matters is that D goes ahead.
    assert.deepEqual(order.slice(0, 2), ["A", "D"], "what is visible goes ahead of the rest of the page: " + order.join(""));
    assert.deepEqual(order.slice(2).sort(), ["B", "C"]);
  } finally {
    twpLlm._test.configureBudget({ windowMs: 60000, limit: 1e9 });
  }
});

test("priority: without competition, a request for the rest of the page goes out normally (nothing is ignored)", async () => {
  twpLlm._test.configureBudget({ limit: 1e9 });
  const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-fond" });
  const calls = fakeFetch([{ content: '{"translations":["un"]}' }]);
  assert.deepEqual(await service.makeRequest("en", "fr", [{ originalText: "<pre>one</pre>" }], { priority: "low" }), ["un"]);
  assert.equal(calls.length, 1);
});

test("saturated budget: a request that would wait too long fails right away (fallback to Google) instead of waiting", async () => {
  twpLlm._test.configureBudget({ windowMs: 60000, limit: 700 });
  try {
    const service = twpLlm.create(FakeService, Utils, { apiKey: "gsk_1234567890abcdef", model: "m-saturated" });
    const text = "<pre>" + "mot ".repeat(150) + "</pre>";
    const calls = fakeFetch([{ content: '{"translations":["ok"]}' }]);
    await service.makeRequest("en", "fr", [{ originalText: text }]); // the first one goes through and fills the budget
    const t0 = Date.now();
    await assert.rejects(() => service.makeRequest("en", "fr", [{ originalText: text }], { priority: "low" }), /budget saturated/);
    assert.ok(Date.now() - t0 < 500, "immediate failure: " + (Date.now() - t0) + " ms");
    assert.equal(calls.length, 1, "no further request sent to Groq");
  } finally {
    twpLlm._test.configureBudget({ windowMs: 60000, limit: 1e9 });
  }
});

test("security: the API key is never sent over an insecure address", async () => {
  const calls = fakeFetch([{ content: '{"translations":["x"]}' }]);
  const insecure = twpLlm.create(FakeService, Utils, { ...config, url: "http://api.example.com/v1/chat/completions" });
  await assert.rejects(() => insecure.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), /insecure/);
  await assert.rejects(() => twpLlm.listModels({ ...config, url: "http://api.example.com/v1/chat/completions" }), /insecure/);
  assert.equal(calls.length, 0, "no request left with the key");
  // HTTPS and a server on this machine are fine
  const local = twpLlm.create(FakeService, Utils, { ...config, url: "http://localhost:11434/v1/chat/completions" });
  assert.deepEqual(await local.makeRequest("en", "fr", [{ originalText: "<pre>x</pre>" }]), ["x"]);
  assert.equal(calls.length, 1);
});
