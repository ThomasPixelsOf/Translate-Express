// The simulated browser page for the tests that need a DOM: happy-dom, which works with Node and with Bun.
// It is looked up in node_modules; without it, those tests are skipped.
const path = require("node:path");
const vm = require("node:vm");

let HappyDom = null;
for (const where of ["happy-dom", path.join(__dirname, "..", "node_modules", "happy-dom")]) {
  try {
    HappyDom = require(where);
    break;
  } catch (e) {
    /* try the next place */
  }
}

const STANDARD_GLOBALS = [
  "Object", "Function", "Array", "String", "Number", "Boolean", "Symbol", "BigInt", "Math", "JSON", "Date", "RegExp", "Error", "TypeError",
  "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "Promise", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "Proxy",
  "Reflect", "Intl", "ArrayBuffer", "DataView", "Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array", "Int32Array",
  "Float32Array", "Float64Array", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI",
  "decodeURI", "escape", "unescape", "structuredClone", "queueMicrotask", "console", "globalThis", "NaN", "Infinity", "undefined",
];

/**
 * A page: a window with the given HTML, in which scripts run with `window.eval(code)` as content scripts do (the page's
 * window is the global object, so what the test puts on the window is visible to the script as a plain name).
 * happy-dom does no layout, like any simulated page: the tests provide rectangles by hand.
 */
function createWindow(html, { url = "https://exemple.test/" } = {}) {
  const w = new HappyDom.Window({ url, width: 1024, height: 768 });
  w.document.write(html);
  // Node gives a page's context the standard JavaScript objects; Bun does not, so they are put on the window when missing
  for (const name of STANDARD_GLOBALS) if (typeof w[name] === "undefined" && typeof globalThis[name] !== "undefined") w[name] = globalThis[name];
  vm.createContext(w);
  w.eval = (code) => vm.runInContext(String(code), w);
  // closing the page cancels its timers and observers (the page scripts use intervals), so the test process can end
  w.close = () => w.happyDOM.close();
  return w;
}

/** A frame: its own window, tied to the page that holds it (`top`, `parent` and the iframe's `contentWindow`), as a real iframe is. */
function attachFrame(topWindow, frameElement, frameHtml = "") {
  const child = createWindow(frameHtml, { url: topWindow.location.href });
  for (const name of ["top", "parent"]) Object.defineProperty(child, name, { value: topWindow, configurable: true });
  Object.defineProperty(frameElement, "contentWindow", { value: child, configurable: true });
  // closing the page closes its frame too (the frame's page scripts have timers of their own)
  const closeTop = topWindow.close;
  topWindow.close = () => {
    child.close();
    return closeTop();
  };
  return child;
}

module.exports = { available: !!HappyDom, createWindow, attachFrame };
