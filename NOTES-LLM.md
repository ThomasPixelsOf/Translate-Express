# TWP minimal : le menu du clic droit, et rien d'autre

Branche `minimal`, bâtie sur la branche `chrome-mv3` (version 10.2.5.0) de https://github.com/FilipePS/Traduzir-paginas-web.
L'extension ne garde que l'essentiel : pas de popup, pas de page d'options, pas de raccourcis clavier, pas de bouton flottant. Tout se fait par le **menu du clic droit**.

## Le menu du clic droit

| Où on clique | Entrée | Effet |
|---|---|---|
| sur du texte sélectionné | **Translate selection** | un panneau s'ouvre près de la sélection avec la traduction (Copy) |
| dans un champ de saisie | **Translate what I'm writing** | panneau avec la traduction en direct de ce qu'on écrit ; **Replace** remplace le texte du champ (ou la partie sélectionnée) |
| sur la page | **Translate this page to ...** / **Show original page** | traduit toute la page, puis revient à l'original |
| partout | **Message window (live translation)** | volet collé au bord droit de la page (largeur réglable à la souris, Échap ou × pour fermer) : on écrit, la traduction arrive en direct ; Copy (Ctrl+Entrée), Insert in the page, lien Settings. Une fenêtre séparée s'ouvre seulement si la page interdit le volet (page du navigateur, PDF, règles de sécurité du site) |
| partout | **Target language: ...** | sous-menu : choisir la langue de traduction (11 langues courantes cochables) ; « More languages, Groq key... » ouvre la page complète |
| partout | page « Language and Groq key » (dans le même volet) | la liste de toutes les langues et le champ de la clé Groq (facultatif) |

Zéro réglage : langue cible = langue du navigateur au départ, puis celle qu'on choisit (une seule pour la page, le panneau et la fenêtre de message), source détectée. Sans clé, le traducteur gratuit d'origine (Google) sert ; avec une clé Groq, l'IA traduit (modèle choisi automatiquement ; menu facultatif dans « Groq key... »). Si l'IA échoue, le panneau retombe sur le gratuit.

## Ce qui a été retiré

Popup, page d'options, raccourcis, bouton flottant, traduction au survol, synthèse vocale, services Bing, Yandex, DeepL et LibreTranslate, polyfill, feuille de style W3, 40 langues d'interface (restent l'anglais et le français), outils de construction (gulp, webpack), dons, notes de version. Le code est dans l'historique Git (branche `llm-groq-openrouter` pour la version précédente).

## Ce qui reste (tout le code utile)

| Fichier | Rôle |
|---|---|
| `src/manifest.json` | permissions `storage` et `contextMenus` seulement |
| `src/bg.js`, `src/background/menu.js` | menu du clic droit, ouverture des fenêtres, messages des pages |
| `src/background/translationService.js`, `translationCache.js` | moteur de traduction (Google gratuit + IA) et cache |
| `src/background/llmService.js` | service Groq : fournisseur reconnu à la clé `gsk_`, modèle automatique, limites de débit, contrôle de la réponse |
| `src/contentScript/pageTranslator.js`, `showOriginal.js` | traduction de page d'origine (TWP) |
| `src/contentScript/panel.js` | le panneau (sélection et champs de saisie) |
| `src/composer/` | la fenêtre de message |
| `src/setup/` | la page « Groq key... » |
| `src/lib/` | configuration, langues, utilitaires d'origine |
| `tests/` | tests sans réseau : `node --test tests/` |

## Utilisation

1. Brave, `brave://extensions`, mode développeur, « Charger l'extension non empaquetée », dossier `D:\Extension-traduction\depot\src`.
2. Clic droit, **Groq key...**, coller la clé `gsk_...`, Save.
3. Clic droit sur une page, un texte ou un champ.

La clé reste dans le stockage de l'extension ; elle n'est envoyée qu'à Groq. Le texte traduit part chez Groq : éviter les pages privées ou d'entreprise.

## Mettre à jour depuis le dépôt d'origine

```
cd D:\Extension-traduction\depot
git fetch origin
git merge origin/chrome-mv3
node --test tests/
```

Comme beaucoup de fichiers ont été supprimés, la fusion peut signaler des conflits sur les fichiers d'origine que nous avons retirés ou modifiés (`translationService.js`, `languages.js`, `config.js`, `manifest.json`) : garder notre version et ne reprendre que ce qui touche `pageTranslator.js`, `showOriginal.js` et la logique de traduction de Google.

## À savoir

- Les tests (13) vérifient le service IA, le manifeste, le démarrage du service worker et la création du menu avec de faux objets `chrome` ; ils ne remplacent pas un essai dans Brave.
- Cause probable des lenteurs de Google : le service d'origine récupère une clé non officielle dans un fichier JavaScript de Google (adresse figée dans le code).
- Pas encore fait : le texte de page parfois non capté (`pageTranslator.js`), la traduction de l'interface.
