// Service de traduction par modèle de langage (API compatible OpenAI : Groq, OpenRouter, ou une adresse personnalisée).
// Fichier ajouté par notre branche : le dépôt d'origine ne le contient pas, ce qui garde les fusions simples.
// translationService.js n'appelle que `twpLlm.create(...)` (voir les lignes marquées « LLM » dans ce fichier).
//
// Principe : le service reçoit des textes au même format que celui de Google (`<pre><a i=0>…</a><a i=1>…</a></pre>`),
// les envoie au modèle en une seule requête (tableau JSON) et récupère un tableau JSON de même longueur.
// Si le modèle se trompe de longueur, on retraduit les textes un par un.
// La clé d'API reste dans le stockage de l'extension (twpConfig, customServices) et n'est envoyée qu'à l'adresse choisie.

var twpLlm = (function () {
  const PROVIDERS = {
    groq: { label: "Groq", url: "https://api.groq.com/openai/v1/chat/completions" },
    openrouter: { label: "OpenRouter", url: "https://openrouter.ai/api/v1/chat/completions" },
    custom: { label: "Custom (OpenAI-compatible)", url: "" },
  };

  const MAX_CONCURRENT = 3; // requêtes simultanées vers le fournisseur (les offres gratuites limitent le débit)
  const MAX_RETRIES = 4; // nouvelles tentatives sur 429 / 5xx
  const TIMEOUT_MS = 60000;
  const BATCH_CHARS = 3000; // taille d'un lot ; Google reste à 800

  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  // File d'attente simple : au plus MAX_CONCURRENT appels en cours, les autres patientent.
  let enCours = 0;
  const fileAttente = [];
  async function creneau() {
    if (enCours < MAX_CONCURRENT) {
      enCours++;
      return;
    }
    await new Promise((r) => fileAttente.push(r));
  }
  function libererCreneau() {
    const suivant = fileAttente.shift();
    if (suivant) suivant();
    else enCours--;
  }

  function nomLangue(code) {
    if (!code || code === "auto") return "the source language (auto-detect it)";
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
    } catch (e) {
      return code;
    }
  }

  function retirerReflexion(texte) {
    // Certains modèles « raisonneurs » renvoient leur réflexion entre <think> et </think>.
    return String(texte).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  }

  // Extrait le tableau de traductions d'une réponse (JSON pur, JSON dans un bloc de code, ou objet {translations:[…]}).
  function extraireTableau(contenu) {
    let t = retirerReflexion(contenu);
    const bloc = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (bloc) t = bloc[1].trim();
    const debutObj = t.indexOf("{");
    const debutTab = t.indexOf("[");
    let json = t;
    if (debutObj !== -1 && (debutTab === -1 || debutObj < debutTab)) json = t.slice(debutObj, t.lastIndexOf("}") + 1);
    else if (debutTab !== -1) json = t.slice(debutTab, t.lastIndexOf("]") + 1);
    const v = JSON.parse(json);
    const tab = Array.isArray(v) ? v : v.translations;
    if (!Array.isArray(tab) || !tab.every((x) => typeof x === "string")) throw new Error("réponse du modèle inattendue");
    return tab;
  }

  async function appeler(cfg, messages) {
    let derniereErreur = null;
    for (let essai = 0; essai <= MAX_RETRIES; essai++) {
      await creneau();
      const ctrl = new AbortController();
      const minuterie = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let attente = 0;
      try {
        const res = await fetch(cfg.url, {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + cfg.apiKey,
          },
          body: JSON.stringify({ model: cfg.model, messages, temperature: 0, stream: false }),
        });
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get("retry-after"));
          attente = (retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** essai) + Math.random() * 300;
          derniereErreur = new Error("HTTP " + res.status);
        } else if (!res.ok) {
          let detail = "";
          try {
            detail = (await res.json())?.error?.message || "";
          } catch (e) {}
          // Une erreur 4xx (clé refusée, modèle inconnu...) ne se corrige pas en réessayant.
          const err = new Error("HTTP " + res.status + (detail ? " : " + detail : ""));
          err.definitive = true;
          throw err;
        } else {
          const data = await res.json();
          const contenu = data?.choices?.[0]?.message?.content;
          if (typeof contenu !== "string") throw new Error("réponse sans contenu");
          return contenu;
        }
      } catch (e) {
        if (e.definitive) throw e;
        derniereErreur = e;
        attente = 1000 * 2 ** essai;
      } finally {
        clearTimeout(minuterie);
        libererCreneau();
      }
      if (essai < MAX_RETRIES) await attendre(attente);
    }
    throw derniereErreur || new Error("échec de la requête");
  }

  function consigne(src, tgt) {
    return (
      "You are a professional translator. Translate each string of the JSON array provided by the user from " +
      nomLangue(src) +
      " to " +
      nomLangue(tgt) +
      ". Rules: keep every HTML tag and attribute exactly as is (for example <pre>, <a i=0>, </a>, <b>); translate only the human-readable text between tags; " +
      "do not translate code, URLs, e-mail addresses, numbers or product and brand names; keep the same meaning, tone and punctuation. " +
      'Reply with ONLY a JSON object of the form {"translations": ["...", "..."]} containing exactly as many strings as the input array, in the same order. No explanation.'
    );
  }

  async function traduireLot(cfg, src, tgt, textes) {
    const messages = [
      { role: "system", content: consigne(src, tgt) },
      { role: "user", content: JSON.stringify(textes) },
    ];
    try {
      const tab = extraireTableau(await appeler(cfg, messages));
      if (tab.length === textes.length) return tab;
    } catch (e) {
      if (e.definitive) throw e;
    }
    // Longueur ou format incorrects : on retraduit un texte à la fois.
    if (textes.length === 1) throw new Error("le modèle n'a pas renvoyé une traduction exploitable");
    const resultats = [];
    for (const texte of textes) resultats.push((await traduireLot(cfg, src, tgt, [texte]))[0]);
    return resultats;
  }

  // Découpe la réponse `<pre><a i=0>…</a><a i=1>…</a></pre>` en un tableau de textes, comme le fait le service Google.
  function decouperReponse(texte, dontSortResults, unescapeHTML) {
    let t = String(texte);
    if (t.indexOf("<pre") !== -1) {
      t = t.replace("</pre>", "");
      t = t.slice(t.indexOf(">") + 1);
    }
    const morceaux = [];
    const re = /<a i=(\d+)>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(t)) !== null) morceaux.push({ i: Number(m[1]), t: m[2] });
    if (morceaux.length === 0) return [unescapeHTML(t)];
    if (!dontSortResults) morceaux.sort((a, b) => a.i - b.i);
    return morceaux.map((x) => unescapeHTML(x.t));
  }

  /**
   * @param {typeof Service} Service classe de base de translationService.js
   * @param {{escapeHTML:Function, unescapeHTML:Function}} Utils
   * @param {{provider?:string, url?:string, apiKey:string, model:string}} config
   */
  function create(Service, Utils, config) {
    const provider = PROVIDERS[config.provider] || PROVIDERS.custom;
    const cfg = {
      url: (config.url || provider.url || "").trim(),
      apiKey: String(config.apiKey || "").trim(),
      model: String(config.model || "").trim(),
    };
    // Le nom sert de clé du cache de traductions : on y met le modèle pour ne pas mélanger deux modèles.
    const nomCache = "llm-" + (cfg.model.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) || "default");

    return new (class extends Service {
      constructor() {
        super(
          nomCache,
          cfg.url,
          "POST",
          function cbTransformRequest(sourceArray) {
            sourceArray = sourceArray.map((text) => Utils.escapeHTML(text));
            if (sourceArray.length > 1) sourceArray = sourceArray.map((text, index) => `<a i=${index}>${text}</a>`);
            return `<pre>${sourceArray.join("")}</pre>`;
          },
          function cbParseResponse(response) {
            return response.map((text) => ({ text, detectedLanguage: null }));
          },
          function cbTransformResponse(result, dontSortResults) {
            return decouperReponse(result, dontSortResults, Utils.unescapeHTML);
          },
          null,
          null,
          null,
        );
        this.maxRequestSize = BATCH_CHARS;
      }

      async makeRequest(sourceLanguage, targetLanguage, requests) {
        if (!cfg.apiKey || !cfg.model || !cfg.url) throw new Error("service LLM non configuré (adresse, clé ou modèle manquant)");
        return await traduireLot(
          cfg,
          sourceLanguage,
          targetLanguage,
          requests.map((info) => info.originalText),
        );
      }
    })();
  }

  // Essai de la configuration (bouton « Test » de la page d'options) : traduit une courte phrase.
  async function tester(config) {
    const provider = PROVIDERS[config.provider] || PROVIDERS.custom;
    const cfg = {
      url: (config.url || provider.url || "").trim(),
      apiKey: String(config.apiKey || "").trim(),
      model: String(config.model || "").trim(),
    };
    if (!cfg.url || !cfg.apiKey || !cfg.model) throw new Error("address, API key and model are required");
    const t0 = Date.now();
    const res = await traduireLot(cfg, "en", "fr", ["Hello, how are you today?"]);
    return { text: res[0], ms: Date.now() - t0 };
  }

  return { create, tester, PROVIDERS, _test: { extraireTableau, decouperReponse, retirerReflexion } };
})();

if (typeof module !== "undefined") module.exports = twpLlm;
