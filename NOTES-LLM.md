# Translate Express (version 1.0.0)

Extension personnelle basée sur TWP (Translate Web Pages, branche `chrome-mv3` 10.2.5.0) ; numérotation de version propre : 1.0.0. Le nom « TWP » ne sert plus que pour désigner le code d'origine.


Bâtie sur la branche `chrome-mv3` (version 10.2.5.0) de https://github.com/FilipePS/Traduzir-paginas-web. Le premier commit de ce dépôt est l'état exact du projet d'origine ; les suivants sont nos modifications.
L'extension ne garde que l'essentiel : pas de popup du navigateur, pas de page d'options, pas de raccourcis clavier, pas de bouton flottant. Tout se fait par le **menu du clic droit**.

## Le menu du clic droit

| Où on clique | Entrée | Effet |
|---|---|---|
| quand on sélectionne du texte | une **bulle « A »** apparaît près de la sélection | un clic ouvre un petit panneau flottant juste sous le texte avec la traduction (Copy ; le bouton Window l'ouvre dans le volet de la page) ; case « Show a bubble when I select text » du menu pour couper la bulle (elle s'efface seule après 8 s) |
| sur du texte sélectionné | **Translate selection** | un panneau s'ouvre près de la sélection avec la traduction (Copy) |
| dans un champ de saisie | **Translate what I'm writing** | panneau avec la traduction en direct de ce qu'on écrit ; **Replace** remplace le texte du champ (ou la partie sélectionnée) |
| sur la page | **Translate this page to ...** / **Show original page** | traduit toute la page, puis revient à l'original |
| partout | **Message window (live translation)** | volet collé au bord droit de la page (largeur réglable à la souris, Échap ou × pour fermer) : on écrit, la traduction arrive en direct ; Copy (Ctrl+Entrée), Insert in the page, lien Settings. Une fenêtre séparée s'ouvre seulement si la page interdit le volet (page du navigateur, PDF, règles de sécurité du site) |
| partout | **Read in: ...** | sous-menu : la langue dans laquelle on LIT (pages et texte affiché) ; 11 langues courantes, le français par défaut |
| partout | **Write in: ...** | sous-menu : la langue dans laquelle on ÉCRIT (texte tapé, traduit pour le destinataire) ; l'anglais par défaut ; « More languages, Groq key... » ouvre la liste complète |
| partout | page « Language and Groq key » (dans le même volet) | la liste de toutes les langues et le champ de la clé Groq (facultatif) |

Zéro réglage : langue cible par défaut = le français, puis celle qu'on choisit (elle n'est plus jamais écrasée, même après un redémarrage), source détectée. Sans clé, le traducteur gratuit d'origine (Google) sert ; avec une clé Groq, l'IA traduit (modèle choisi automatiquement ; menu facultatif dans « Groq key... »). Si l'IA échoue, le panneau retombe sur le gratuit.

## Priorités : le visible d'abord, le reste ensuite (rien n'est ignoré)

Deux niveaux de priorité, de la page jusqu'à la file d'attente de l'IA :

- **Haute** : ce qui est à l'écran et trois quarts d'écran en dessous. Envoyé tout de suite ; quand on défile, un texte qui devient visible passe aussitôt en haute priorité.
- **Basse** : tout le reste de la page (en dessous, au-dessus, masqué dans un onglet inactif). Traduit en tâche de fond par lots de 1 500 caractères, du plus proche de l'écran au plus lointain, le masqué en dernier, seulement quand rien de nouveau n'arrive à l'écran depuis 1,2 s et sans jamais retarder le visible : dans la file de l'IA, une requête de fond cède la place à toute requête visible en attente de budget. La page finit donc entièrement traduite, même sans défiler.

Avant, le reste de la page n'était traduit que lorsqu'on défilait jusqu'à lui, et toutes les requêtes passaient dans l'ordre d'arrivée.

## Limites de Groq : budget de jetons par minute

L'offre gratuite limite les jetons par minute (environ 8 000 pour gpt-oss-20b, plus pour d'autres modèles) et les requêtes par minute (30). Une page traduite d'un coup dépasse la limite : les requêtes sont refusées (erreur 429) et la page reste à moitié traduite. L'extension compte donc ce que chaque requête coûte (estimation, corrigée par la consommation réelle renvoyée par Groq), ne l'envoie que si la minute glissante a la place, et lit la limite réelle dans les en-têtes de réponse (85 % de la valeur annoncée ; 6 000 par prudence avant la première réponse). La page se traduit donc par vagues, sans erreur. Sur une erreur 429 de quelques secondes, l'extension attend le délai indiqué ; au-delà de 40 s (quota du jour), elle abandonne tout de suite et la page est traduite par Google. La consigne envoyée à chaque requête est courte, pour ne pas gaspiller de jetons.

## Structure des blocs : début traduit, fin en anglais

Un bloc de plusieurs morceaux est envoyé sous la forme `<a i=0>…</a><a i=1>…</a>`. Avant, seul le nombre de blocs était vérifié : si le modèle fusionnait ou oubliait un morceau, les suivants se décalaient ou restaient en anglais sans erreur. Maintenant chaque bloc est vérifié (nombre de morceaux et numéros 0 à n-1) et retraduit morceau par morceau s'il est faux ; côté page, les morceaux restés sans traduction dans un bloc répondu sont réessayés (jusqu'à 6 fois).

## Vitesse

TWP traduit d'abord ce qui est à l'écran, puis le reste en défilant. Côté IA : le modèle choisi automatiquement est un modèle rapide qui ne « réfléchit » pas avant de répondre (ordre de préférence : llama-3.3-70b-versatile, gpt-oss-20b, llama-3.1-8b-instant, puis les modèles raisonneurs) ; les modèles raisonneurs reçoivent le réglage qui coupe la réflexion (retiré tout seul si le fournisseur le refuse) ; lots de 1800 caractères traduits 4 par 4 en parallèle ; une réponse qui dépasse 20 s est réessayée ; une limite de débit annoncée à plus de 6 s fait abandonner tout de suite l'IA, et la page est traduite par Google au lieu d'attendre ; un lot dont la longueur ne correspond pas est coupé en deux moitiés traduites en parallèle. Le menu « Model » de la page de réglage permet de choisir un autre modèle.

## Plusieurs onglets

L'état « page traduite ou non » est propre à chaque onglet : le titre de l'entrée du menu (« Translate this page to … » ou « Show original page ») est recalculé quand on change d'onglet ou de fenêtre, et un clic agit selon l'état de l'onglet cliqué. Une page qui se recharge redevient « à traduire ». L'état n'est jamais mémorisé dans le service worker : on le demande à l'onglet.

## Rien ne doit rester non traduit : tous les cas de texte qui échappait

Le traducteur d'origine laissait échapper du texte dans plusieurs situations, toutes couvertes maintenant (`pageTranslator.js`, tests dans `tests/page-translation.test.js` sur une page simulée) :

| Situation | Avant | Maintenant |
|---|---|---|
| texte nu ajouté après coup dans un élément existant (AJAX) | ignoré | traduit |
| élément en ligne (span, lien) ajouté après coup | ignoré | traduit |
| texte d'un nœud existant remplacé par la page (React, mises à jour de libellés) | jamais retraduit | retraduit |
| composant isolé (shadow DOM ouvert), y compris ce qui y est ajouté | lu au départ seulement | surveillé et traduit |
| texte normal affiché dans une balise `<code>` (courriel, consignes en police à chasse fixe) | jamais traduit | traduit (le vrai code ne l'est pas) |
| bloc plus haut que l'écran, morceau dont la requête a échoué | jamais traduit | traduit, réessayé |
| message mixte (français et anglais dans le même bloc) | pouvait être sauté en entier par mon filtre de langue | envoyé en entier ; seuls les blocs d'un seul morceau déjà dans la langue cible sont sautés |
| tout ce que rien d'autre n'a vu | restait en version originale | balayage de sécurité toutes les 4 s |

Un texte reste volontairement non traduit dans ces cas : zone éditable (`contenteditable`, pour ne pas toucher à ce que l'utilisateur écrit), contenu de `<textarea>`, éléments marqués `translate="no"` ou `notranslate` par le site, vrai code, cadres d'un autre site non accessibles.

## Résilience : une partie en échec ne bloque pas le reste

Côté moteur (`translationService.js`) : une requête qui échoue ne fait plus échouer tout le lot (son bloc est rendu vide, les autres sont gardés) ; un échec n'est plus mémorisé (avant, la nouvelle tentative du même texte échouait aussitôt) ; les blocs que l'IA n'a pas pu traduire sont confiés à Google bloc par bloc. Côté page (`pageTranslator.js`) : un morceau sans réponse est réessayé jusqu'à 6 fois (2 s, 4 s, 8 s, 16 s, 30 s, 30 s). `tests/boot.test.js` contient deux tests de ce scénario qui échouaient sur le code précédent.

## Texte lu et texte écrit : deux langues

Le texte **affiché** (page, texte sélectionné sur la page) est traduit dans la langue de **lecture** (français par défaut, « Read in »). Le texte **écrit** par l'utilisateur dans un champ (input, zone de texte, éditeur de Teams ou d'Outlook web) est traduit dans la langue d'**écriture** (anglais par défaut, « Write in »), celle du destinataire. Elles sont indépendantes : changer l'une ne touche pas l'autre. Le panneau l'indique (« Read in » ou « Write in »). Pour du texte écrit sélectionné, la bulle apparaît aussi, comme chez DeepL : un clic ouvre le panneau avec la traduction de la sélection dans la langue d'écriture, et « Replace » remplace uniquement la partie sélectionnée, puis le panneau se ferme. La fenêtre de message (écrire et voir la traduction en direct) utilise la langue d'écriture.

## Page entièrement traduite (défauts d'origine corrigés)

Le traducteur d'origine laissait des parties de page en version originale pour deux raisons, corrigées dans `pageTranslator.js` : (1) un morceau était marqué « traduit » avant l'envoi ; si la réponse échouait ou revenait vide, il n'était jamais réessayé — il l'est maintenant, jusqu'à 6 fois avec un délai croissant (2 s à 30 s) ; (2) un morceau plus haut que l'écran (haut au-dessus, bas en dessous) n'était jamais envoyé — tout morceau dont une partie est dans la zone visible l'est maintenant. Le texte est aussi traduit trois quarts d'écran à l'avance sous la zone visible, pour être déjà prêt quand on défile. `tests/page-translation.test.js` simule une page (jsdom) : ces tests échouent sur l'ancien code et réussissent sur le nouveau.

## Pages en plusieurs langues

Les blocs de texte déjà écrits dans la langue cible ne sont pas retraduits : leur langue est détectée localement par le navigateur (sans réseau), et seuls les autres partent au traducteur. Une page moitié française, moitié anglaise, traduite en français, n'envoie que l'anglais ; une page déjà entièrement dans la langue cible n'appelle aucun traducteur. Les blocs de moins de 25 caractères ou dont la langue est incertaine sont traduits normalement (l'IA a aussi la consigne de laisser inchangé ce qui est déjà dans la langue cible). Le code est dans `src/background/skipTargetLanguage.js`.

## Ce qui a été retiré

Popup, page d'options, raccourcis, bouton flottant, traduction au survol, synthèse vocale, services Bing, Yandex, DeepL et LibreTranslate, polyfill, feuille de style W3, 40 langues d'interface (restent l'anglais et le français), outils de construction (gulp, webpack), dons, notes de version. Le code retiré se retrouve dans le premier commit de ce dépôt (le projet d'origine tel quel).

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

## Rechargement automatique (développement)

`src/background/devReload.js` surveille les fichiers de l'extension (Chrome et Brave les relisent sur le disque) et la recharge toute seule quand l'un d'eux change, au plus 30 secondes après : plus besoin du bouton « Recharger » de brave://extensions. Il reste à rafraîchir (F5) la page testée, car un onglet déjà ouvert garde l'ancien script de page. La langue choisie et la clé Groq sont dans le stockage de l'extension : un rechargement ne les efface pas. Pour désactiver : retirer la ligne `devReload.js` de `src/bg.js` et la permission `alarms` du manifeste.

## Diagnostics et tableau de bord

Un journal (1000 derniers événements, stockage de session) enregistre les requêtes à l'IA (durée, attente du budget, jetons, 429), les appels de traduction, les envois et résultats de la page et les garde-fous (morceaux bloqués, blocage détecté). Réglage `diagnostics` = "no" pour le couper. Le tableau de bord s'ouvre en fenêtre popup (clic droit, « Dashboard (diagnostics) », aussi dans le menu de l'icône) : résumé avec constats en clair, état de la page (pourquoi chaque texte n'est pas traduit), journal filtrable, bouton « Copy report ». Calculs dans `src/dashboard/metrics.js` (testés).

## Budget de jetons saturé

Si une requête devait attendre plus de 12 s (texte visible) ou 2,5 s (fond de page) la place dans le budget de jetons, elle échoue tout de suite et le bloc part chez Google (événement `llm.budget-skip`). Le garde-fou de blocage de la page attend 90 s (`diagStuckMs`) pour ne pas renvoyer en double des morceaux qui patientent.

## Thème

Tout est sombre en permanence (message, réglages, tableau de bord, bulle, panneaux), quel que soit le thème du navigateur.

## Mettre à jour depuis le dépôt d'origine

Notre historique ne contient pas celui du projet d'origine (seulement son état 10.2.5.0 dans le premier commit), donc `git merge` ne s'applique pas. Pour reprendre une correction du projet d'origine :

```
git remote add upstream https://github.com/FilipePS/Traduzir-paginas-web.git
git fetch upstream chrome-mv3
git diff <premier-commit> upstream/chrome-mv3 -- src/contentScript/pageTranslator.js src/contentScript/showOriginal.js
node --test tests/
```

`<premier-commit>` est le tout premier commit de ce dépôt (`git rev-list --max-parents=0 HEAD`). Le diff montre ce qui a changé dans le projet d'origine depuis notre base ; on reprend à la main ce qui touche `pageTranslator.js`, `showOriginal.js` et la logique de traduction de Google, en gardant notre version du reste (beaucoup de fichiers ont été supprimés ou réécrits : `translationService.js`, `languages.js`, `config.js`, `manifest.json`).

## À savoir

- Les tests (80) vérifient le service IA, le manifeste, le démarrage du service worker, le menu, la bulle, la traduction de page et le tableau de bord, avec de faux objets `chrome` ; 20 d'entre eux (page et bulle) demandent jsdom et sont ignorés s'il n'est pas installé. Ils ne remplacent pas un essai dans Brave.
- Cause probable des lenteurs de Google : le service d'origine récupère une clé non officielle dans un fichier JavaScript de Google (adresse figée dans le code).
- Pas fait : la traduction de l'interface de l'extension elle-même (anglais seulement) et le renvoi automatique à Groq des textes revenus à l'identique.
