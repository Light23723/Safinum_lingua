# Safinum Lingua — extension navigateur (MVP 0.2)

Prototype d'extension Chromium (Google Chrome et Microsoft Edge) pour l'environnement `https://safinum.cm/hackathon-test`.

## Nouveauté de la version 0.2

Le fichier `glossaire.json` est inclus directement dans le dossier de l'extension. Il est chargé automatiquement par le script de contenu et par la fenêtre de l'extension : aucune importation manuelle n'est nécessaire après installation.

Le glossaire embarqué contient les 11 entrées du fichier fourni par l'équipe. Les textes et équivalents ont été conservés tels quels. Leur présence dans le fichier ne signifie pas qu'ils ont tous été validés par un spécialiste du Duala ; les expressions bancaires doivent encore être relues par des locuteurs compétents avant une démonstration officielle.

## Installation / mise à jour dans Edge

1. Décompresser `safinum-lingua-extension-v0.2.zip`.
2. Ouvrir `edge://extensions`.
3. Si la version 0.1 est déjà chargée, cliquer sur **Recharger** dans sa carte après avoir remplacé le dossier par le nouveau dossier, ou retirer l'ancienne version puis charger le nouveau dossier.
4. Activer le **Mode développeur** si nécessaire.
5. Cliquer sur **Charger l'extension non empaquetée**.
6. Sélectionner le dossier `safinum-lingua-extension` qui contient `manifest.json`.
7. Ouvrir ou actualiser `https://safinum.cm/hackathon-test`.
8. Cliquer sur l'icône Safinum Lingua : le glossaire embarqué doit apparaître dans « Glossaire actif ».

## Ajouter des traductions

Depuis la fenêtre de l'extension, renseigner le texte français et sa traduction, puis cliquer sur **Enregistrer la traduction**. Les ajouts sont enregistrés dans `chrome.storage.local` et prennent priorité sur les entrées embarquées. L'import JSON et l'export JSON restent disponibles.

## Fonctionnement

- Remplacement des textes qui correspondent au glossaire local.
- Surveillance du DOM avec `MutationObserver` pour traiter les textes ajoutés après le chargement initial.
- Traduction de certains attributs (`placeholder`, `title`, `aria-label`, `alt`).
- Désactivation et restauration du texte original.
- Aucune requête à un service de traduction externe.

## Sécurité et limites

- Les nœuds contenant au moins un chiffre sont laissés intacts ; les champs de saisie, zones éditables et blocs de code sont exclus.
- L'extension effectue une substitution par correspondance, et non une traduction générative de phrases inconnues.
- Les segments de texte divisés entre plusieurs éléments HTML, les iframes et les Shadow DOM peuvent nécessiter des adaptations.
- Le prototype est prévu uniquement pour un environnement de démonstration ; ne pas l'utiliser pour des transactions réelles ou des données bancaires personnelles.
- Le fichier JSON est chargé depuis les ressources de l'extension, exposé uniquement aux pages `safinum.cm` et `www.safinum.cm` via `web_accessible_resources`.

## Arborescence

```text
safinum-lingua-extension/
├── manifest.json
├── content.js
├── popup.html
├── popup.css
├── popup.js
├── glossaire.json
└── README.md
```
