# TWP version MV3 : notre fork (traduction par IA Groq, fenêtre de message, traduction dans les champs)

Branche `llm-groq-openrouter` (le nom date du début ; seul Groq est gardé), bâtie sur la branche `chrome-mv3` (version 10.2.5.0) de https://github.com/FilipePS/Traduzir-paginas-web.

Principe : **zéro réglage**. Installée, l'extension marche tout de suite avec les traducteurs gratuits d'origine. Pour la qualité de l'IA : une seule chose à faire, coller sa clé Groq dans les options.

## Ce que l'on peut faire

| Fonction | Comment |
|---|---|
| Traduire la page | comme TWP (Alt+T) ; avec une clé Groq, c'est l'IA qui traduit |
| Fenêtre de message en direct | **Alt+M** : on écrit à gauche, la traduction apparaît à droite pendant la saisie ; langue source détectée, langue cible mémorisée, ton (neutre / formel / informel) avec l'IA, Copier (Ctrl+Entrée), Insérer dans la page |
| Traduire ce qu'on écrit dans un champ | un bouton « A » apparaît dans les champs de saisie (Teams, Outlook web, mails, formulaires) ; un clic ouvre un panneau avec la traduction en direct, **Replace** remplace le texte du champ, **Copy**, **Window** ouvre la fenêtre de message avec le texte |
| Choisir le modèle | options, bloc « AI translation », menu « Model » (automatique par défaut) |

Sans clé, tout passe par le traducteur gratuit ; si l'IA échoue (limite de débit, clé refusée), la fenêtre de message bascule sur le gratuit au lieu de rester bloquée.

## Fichiers ajoutés ou modifiés (le reste est le code d'origine)

| Fichier | Rôle |
|---|---|
| `src/background/llmService.js` (nouveau) | service IA : fournisseur reconnu à la clé (`gsk_`), modèle choisi tout seul parmi ceux de Groq, lots de 3000 caractères, limites de débit (429) réessayées, réponse contrôlée, traduction de texte libre |
| `src/composer/` (nouveau) | la fenêtre de message |
| `src/contentScript/fieldTranslator.js` (nouveau) | le bouton et le panneau dans les champs de saisie |
| `src/background/translationService.js`, `background.js`, `bg.js` | quelques lignes d'accroche (mot-clé « LLM » ou « openComposer ») |
| `src/lib/config.js`, `languages.js` | `llm` compte comme service de traduction de pages |
| `src/options/options.html`, `options.js` | bloc « AI translation (Groq) » : la clé suffit, « Advanced » pour choisir le modèle |
| `src/manifest.json`, `firefox-manifest.json` | script de page et raccourci Alt+M |
| `tests/llmService.test.js` | tests sans réseau : `node --test tests/` |

## Utilisation

1. Brave, `brave://extensions`, activer le mode développeur, « Charger l'extension non empaquetée », choisir `D:\Extension-traduction\depot\src`.
2. (Facultatif) Options, « AI translation (Groq) » : coller la clé `gsk_...`. L'IA devient le traducteur de pages et un test s'affiche.
3. Raccourcis : Alt+T (page), Alt+M (fenêtre de message). Alt+S traduit le texte sélectionné (service d'origine).

La clé reste dans le stockage de l'extension ; elle n'est envoyée qu'à Groq. Le texte traduit part chez Groq : éviter les pages privées ou d'entreprise.

## Mettre à jour depuis le dépôt d'origine

```
cd D:\Extension-traduction\depot
git fetch origin
git merge origin/chrome-mv3
node --test tests/
```

Les conflits ne peuvent venir que des quelques lignes d'accroche. Ensuite, dans `brave://extensions`, bouton « Recharger ».

## À savoir et à faire

- Cause probable des lenteurs de Google : le service d'origine récupère une clé non officielle dans un fichier JavaScript de Google (adresse figée dans le code).
- Pas encore testé dans un vrai navigateur : seuls les tests du service IA (sans réseau) et les vérifications de syntaxe ont tourné.
- À faire : la traduction du texte sélectionné et du popup par l'IA, le texte de page parfois non capté (`pageTranslator.js`), simplifier la page d'options d'origine, traduire l'interface en français.
