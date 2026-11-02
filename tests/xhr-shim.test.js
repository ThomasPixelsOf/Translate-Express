// Tests of the minimal XMLHttpRequest built on fetch (src/lib/XMLHttpRequestShim.js), which the Google service relies on.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(fetchImpl) {
  const sandbox = { console, AbortController, setTimeout, clearTimeout, fetch: fetchImpl };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src", "lib", "XMLHttpRequestShim.js"), "utf8") + "\n;globalThis.X = XMLHttpRequestShim;", sandbox);
  return sandbox.X;
}
const respond = (body, status = 200) => async () => ({ status, json: async () => JSON.parse(body), text: async () => body });
const settled = (xhr) => new Promise((resolve) => { for (const n of ["load", "error", "abort", "timeout"]) xhr["on" + n] = () => resolve(n); });

test("a JSON answer is parsed into response, and the callbacks can be set after send", async () => {
  const X = load(respond('{"a":[1,2]}', 200));
  const xhr = new X();
  xhr.open("GET", "https://example.test/x");
  xhr.responseType = "json";
  xhr.send();
  assert.equal(await settled(xhr), "load");
  assert.deepEqual(JSON.parse(JSON.stringify(xhr.response)), { a: [1, 2] });
  assert.equal(xhr.status, 200);
});

test("a text answer is available as response and responseText; a body that is not JSON gives a null response", async () => {
  const text = new (load(respond('"hello"')))();
  text.open("GET", "https://example.test/x");
  text.send();
  assert.equal(await settled(text), "load");
  assert.equal(text.responseText, '"hello"');
  assert.equal(text.response, '"hello"');

  const bad = new (load(async () => ({ status: 429, json: async () => { throw new Error("<!DOCTYPE"); }, text: async () => "<html>" })))();
  bad.open("GET", "https://example.test/x");
  bad.responseType = "json";
  bad.send();
  assert.equal(await settled(bad), "load", "the page answered, the caller checks the content");
  assert.equal(bad.response, null);
  assert.equal(bad.status, 429);
});

test("method, address, headers and body reach fetch; repeated headers are joined", async () => {
  let seen;
  const X = load(async (url, init) => { seen = { url, init }; return { status: 200, json: async () => ({}), text: async () => "" }; });
  const xhr = new X();
  xhr.open("POST", "https://example.test/y");
  xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
  xhr.setRequestHeader("X-Test", "a");
  xhr.setRequestHeader("x-test", "b");
  xhr.send("q=1");
  await settled(xhr);
  assert.equal(seen.url, "https://example.test/y");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.body, "q=1");
  assert.equal(seen.init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(seen.init.headers["x-test"], "a, b");
  assert.equal(seen.init.headers.accept, "*/*");
});

test("a network failure calls onerror; a request that takes longer than the timeout calls ontimeout", async () => {
  const failing = new (load(async () => { throw new Error("offline"); }))();
  failing.open("GET", "https://example.test/x");
  failing.send();
  assert.equal(await settled(failing), "error");

  const slow = new (load((url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))))();
  slow.open("GET", "https://example.test/x");
  slow.timeout = 30;
  slow.send();
  assert.equal(await settled(slow), "timeout");
});
