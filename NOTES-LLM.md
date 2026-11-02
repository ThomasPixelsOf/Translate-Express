# TWP en version MV3 avec traduction par IA (Groq / OpenRouter)

Notre branche : `llm-groq-openrouter`, bâtie sur la branche `chrome-mv3` de https://github.com/FilipePS/Traduzir-paginas-web.

## Ce qui a été ajouté (tout le reste est le code d'origine)

| Fichier | Rôle |
|---|---|
| `src/background/llmService.js` (nouveau) | le service « AI » : envoie les textes au modèle, gère les limites de débit (429), les erreurs et le contrôle de la réponse |
| `src/background/translationService.js` | quelques lignes d'accroche (repérées par le mot « LLM ») et la taille de lot propre à chaque service |
| `src/bg.js`, `src/firefox-manifest.json` | chargement de `llmService.js` |
| `src/lib/config.js`, `src/lib/languages.js` | `llm` compte comme service de traduction de pages, avec toutes les langues cibles |
| `src/options/options.html`, `options.js` | bloc « AI translation of pages » : fournisseur, clé, modèle, Enregistrer / Test / Supprimer |
| `tests/llmService.test.js` | tests sans réseau : `node --test tests/` |

## Utilisation

1. Brave, `brave://extensions`, activer le mode développeur, « Charger l'extension non empaquetée », choisir le dossier `D:\Extension-traduction\depot\src`.
2. Options de l'extension, bloc « AI translation of pages » : choisir Groq ou OpenRouter, coller sa clé, saisir le nom du modèle, « Test », puis « Save AI service ».
3. Choisir « AI (Groq / OpenRouter) » comme « Page translation service ».

La clé reste dans le stockage de l'extension de ce navigateur ; elle n'est envoyée qu'au fournisseur choisi. Le texte des pages traduites part chez ce fournisseur : ne pas traduire de pages privées ou d'entreprise avec un fournisseur dont on n'accepte pas les conditions.

## Mettre à jour depuis le dépôt d'origine

```
cd D:\Extension-traduction\depot
git fetch origin
git merge origin/chrome-mv3
node --test tests/
```

Les conflits ne peuvent venir que des quelques lignes d'accroche de `translationService.js` ; `llmService.js` n'existe pas chez eux.
Ensuite, dans `brave://extensions`, bouton « Recharger » de l'extension.

## À savoir

- Le service Google d'origine récupère une clé non officielle dans un fichier JavaScript de Google (adresse figée dans le code). Quand Google change ce fichier ou limite cette clé, la traduction devient lente ou incomplète : c'est la cause probable des lenteurs récentes et une raison de plus d'utiliser un modèle.
- Les traductions déjà faites sont gardées en cache par modèle : changer de modèle ne réutilise pas celles d'un autre.
- La traduction du texte sélectionné et celle du popup utilisent toujours Google ou Bing ; seule la traduction de pages complètes passe par l'IA.
