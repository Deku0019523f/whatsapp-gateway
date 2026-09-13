# Correction de la version Node.js dans package.json

Baileys exige Node.js 20+. Pour éviter que ce problème revienne (installation
sur un nouveau VPS, autre contributeur, etc.), ajoute un champ `engines` dans
`package.json`, à la racine du projet, juste après `"version"` :

```json
{
  "name": "whatsapp-gateway",
  "version": "1.0.0",
  "engines": {
    "node": ">=20.0.0"
  },
  ...
}
```

Ce champ ne bloque pas l'installation par défaut, mais :
- `npm install` affiche un avertissement clair si la version de Node ne convient pas
- des plateformes comme Render.com ou Railway l'utilisent pour choisir automatiquement la bonne version de Node au déploiement

## Pour forcer le blocage (recommandé sur un VPS partagé)

Ajoute aussi ce fichier `.npmrc` à la racine du projet :

```
engine-strict=true
```

Avec `engine-strict=true`, `npm install` **refuse** de s'exécuter si la
version de Node ne correspond pas à `engines.node` — ça évite de repartir sur
la même erreur `MODULE_NOT_FOUND` si quelqu'un relance le projet avec un Node
trop ancien.

## Sur ce VPS

Le Node système reste en 12.x ; la version 20 a été installée séparément via
`nvm` et PM2 pointe dessus. Le champ `engines` sert surtout de garde-fou pour
l'avenir (autre VPS, autre développeur) — utilise `fix-node.sh` pour
installer/réparer Node 20 quand il en manque.
