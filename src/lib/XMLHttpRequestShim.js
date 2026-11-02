"use strict";

// A minimal XMLHttpRequest on top of fetch, for the service worker (which has no XMLHttpRequest). Only what the Google
// service uses: open, setRequestHeader, send, responseType ("json" or text), response, responseText, status, and the
// onload / onerror / onabort / ontimeout callbacks (they can be set after send, they are read when the answer arrives).
const XMLHttpRequestShim = class XMLHttpRequest {
  constructor() {
    this.responseType = "";
    this.response = null;
    this.responseText = "";
    this.status = 0;
    this.timeout = 0;
    this.headers = { accept: "*/*" };
    this.method = "";
    this.url = "";
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name, value) {
    name = String(name).toLowerCase();
    this.headers[name] = name in this.headers ? `${this.headers[name]}, ${value}` : String(value);
  }

  send(body = null) {
    const controller = new AbortController();
    let timedOut = false;
    const timer =
      this.timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, this.timeout)
        : null;
    const fire = (name) => {
      if (typeof this["on" + name] === "function") this["on" + name]({ type: name });
    };
    fetch(this.url, { method: this.method || "GET", signal: controller.signal, headers: this.headers, body })
      .then(
        async (resp) => {
          this.status = resp.status;
          if (this.responseType === "json") {
            try {
              this.response = await resp.json();
            } catch (e) {
              this.response = null; // like a real XMLHttpRequest: a body that is not JSON gives a null response
            }
          } else {
            this.response = this.responseText = await resp.text();
          }
          fire("load");
        },
        (err) => fire(err && err.name === "AbortError" ? (timedOut ? "timeout" : "abort") : "error")
      )
      .finally(() => clearTimeout(timer));
  }
};
