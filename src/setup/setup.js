// Seul réglage de l'extension : la clé Groq. Fournisseur reconnu à la clé, modèle automatique (menu facultatif).
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);

  const setStatus = (text, error) => {
    $("#status").textContent = text;
    $("#status").className = error ? "error" : "";
  };
  const llmFromForm = () => ({ name: "llm", provider: "auto", apiKey: $("#key").value.trim(), model: $("#model").value });

  function setModels(models, selected) {
    const select = $("#model");
    select.textContent = "";
    const add = (value, label) => {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      select.appendChild(o);
    };
    add("", "Automatic (recommended)");
    for (const m of models) add(m.id, m.id);
    if (selected && !models.some((m) => m.id === selected)) add(selected, selected);
    select.value = selected || "";
  }

  function loadModels() {
    const llm = llmFromForm();
    if (llm.apiKey.length < 10) return setStatus("Paste your API key first.", true);
    setStatus("Loading models...");
    chrome.runtime.sendMessage({ action: "llmModels", llm }, (r) => {
      checkedLastError();
      if (r && r.ok) {
        setModels(r.models, llm.model);
        setStatus(r.models.length + " models available.");
      } else {
        setStatus("Failed: " + (r ? r.error : "no answer"), true);
      }
    });
  }

  function save() {
    const llm = llmFromForm();
    if (llm.apiKey.length < 10) return setStatus("Paste your API key.", true);
    const others = twpConfig.get("customServices").filter((cs) => cs.name !== "llm");
    twpConfig.set("customServices", [...others, llm]);
    twpConfig.set("enabledServices", [...twpConfig.get("enabledServices").filter((s) => s !== "llm"), "llm"]);
    twpConfig.set("pageTranslatorService", "llm"); // l'IA devient le traducteur de pages
    chrome.runtime.sendMessage({ action: "createLlmService", llm }, checkedLastError);
    setStatus("Testing...");
    chrome.runtime.sendMessage({ action: "testLlmService", llm }, (r) => {
      checkedLastError();
      if (r && r.ok) setStatus("Ready (" + r.model + ", " + r.ms + " ms): " + r.text);
      else setStatus("Saved, but the test failed: " + (r ? r.error : "no answer"), true);
    });
  }

  function remove() {
    twpConfig.set("customServices", twpConfig.get("customServices").filter((cs) => cs.name !== "llm"));
    twpConfig.set("enabledServices", twpConfig.get("enabledServices").filter((s) => s !== "llm"));
    if (twpConfig.get("pageTranslatorService") === "llm") twpConfig.set("pageTranslatorService", "google");
    chrome.runtime.sendMessage({ action: "removeLlmService" }, checkedLastError);
    $("#key").value = "";
    setModels([], "");
    setStatus("Key removed: the free translator is used again.");
  }

  twpConfig.onReady(() => {
    const llm = twpConfig.get("customServices").find((cs) => cs.name === "llm");
    if (llm) {
      $("#key").value = llm.apiKey || "";
      setModels([], llm.model || "");
    }
    $("#save").onclick = save;
    $("#remove").onclick = remove;
    $("#load").onclick = loadModels;
    $("#key").addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });
  });
})();
