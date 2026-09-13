# WhatsApp Gateway — My Atelier

Passerelle WhatsApp multi-utilisateurs (type WPPConnect) basée sur Baileys, à héberger sur ton VPS.

## Prérequis

- **Node.js 20+** (obligatoire — Baileys ne fonctionne pas sur des versions plus anciennes)
- Un VPS Linux (Ubuntu recommandé) avec accès root/sudo

## Installation sur le VPS

```bash
git clone https://github.com/Deku0019523f/whatsapp-gateway.git
cd whatsapp-gateway
npm install
cp .env.example .env
nano .env   # renseigner ADMIN_KEY et PUBLIC_URL
```

Si `npm install` échoue avec une erreur du type `This package requires Node.js 20+`,
ta version de Node est trop ancienne. Lance :

```bash
bash fix-node.sh
```

Ce script installe Node 20+ via `nvm` (sans toucher au Node système, donc sans
casser d'autres projets sur le VPS), réinstalle les dépendances proprement, et
redémarre l'app via PM2 avec le bon interpréteur.

## Lancement

```bash
# test rapide
npm start

# en production, avec PM2
npm install -g pm2
pm2 start server.js --name whatsapp-gateway
pm2 save
pm2 startup
```

Ouvre le port choisi (par défaut 3000) sur ton pare-feu VPS (`ufw allow 3000`),
ou utilise le script ci-dessous pour passer par Nginx + HTTPS (recommandé).

## Rattacher un domaine ou sous-domaine

```bash
sudo bash setup-domain.sh
```

Le script demande :
1. Le nom de domaine ou sous-domaine à rattacher (ex: `api.premium225.shop`)
2. Si tu veux garder l'accès direct sur le port 3000, ou passer par Nginx en
   80/443 avec HTTPS automatique (Let's Encrypt via Certbot)

Il installe Nginx/Certbot si besoin, configure le reverse proxy, obtient le
certificat SSL, met à jour `PUBLIC_URL` dans `.env`, et redémarre l'app.

## Documentation API

Une fois lancé, la doc est disponible sur :

```
http://IP_DE_TON_VPS:3000/doc-api
```

ou, si un domaine a été configuré avec SSL :

```
https://ton-domaine/doc-api
```

## Flux d'intégration côté My Atelier

1. **Créer un utilisateur** sur le gateway (`POST /admin/users` avec `x-admin-key`) → tu récupères `apiKey` et `webhookKey`, à stocker en base côté My Atelier pour cet utilisateur.
2. **Démarrer une session** (`POST /session/start` avec `x-api-key` de l'utilisateur, mode `qr` ou `pairing`).
3. **Recevoir le QR / pairing code** via webhook (vérifié avec `x-webhook-key`) ou via Socket.io.
4. **Envoyer des messages** (`POST /message/send` avec `x-api-key`).

## Structure

```
whatsapp-gateway/
├── server.js                     # point d'entrée (Express + Socket.io)
├── src/
│   ├── sessions/sessionManager.js  # cœur Baileys (QR, pairing, reconnexion)
│   ├── services/                   # webhook + envoi de messages
│   ├── controllers/                # logique des routes
│   ├── middlewares/                 # auth admin / auth clé API
│   └── routes/
├── public/doc-api/               # documentation servie sur /doc-api
├── auth_sessions/                # credentials Baileys par utilisateur (généré au runtime)
├── data/users.json               # base des utilisateurs/clés (généré au runtime)
├── fix-node.sh                   # installe/répare Node 20+ via nvm
├── setup-domain.sh               # configure un domaine + Nginx + SSL
├── .npmrc                        # engine-strict=true (bloque npm install si Node < 20)
└── package.json                  # engines.node >= 20.0.0
```

## Notes importantes

- `data/users.json` et `auth_sessions/` contiennent des données sensibles (clés API, credentials WhatsApp) : à ne jamais commiter, à sauvegarder régulièrement.
- Le stockage JSON convient pour démarrer ; si le nombre d'utilisateurs grossit, prévoir une migration vers une vraie base (SQLite/Postgres).
- Pense à mettre Nginx + certbot devant le gateway pour du HTTPS en production (voir `setup-domain.sh`).
- Le fichier `.npmrc` (`engine-strict=true`) fait échouer `npm install` si Node < 20, pour éviter de reproduire l'erreur `MODULE_NOT_FOUND` liée à une version trop ancienne.
