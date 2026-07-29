# WhatsApp Gateway — My Atelier

Passerelle WhatsApp multi-utilisateurs (type WPPConnect) basée sur Baileys, à héberger sur ton VPS.

## Installation sur le VPS

```bash
git clone https://github.com/Deku0019523f/whatsapp-gateway.git
cd whatsapp-gateway
npm install
cp .env.example .env
nano .env   # renseigner ADMIN_KEY et PUBLIC_URL
```

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

Ouvre le port choisi (par défaut 3000) sur ton pare-feu VPS (`ufw allow 3000`), ou mets Nginx devant en reverse proxy si tu veux servir ça en HTTPS sur un sous-domaine (recommandé pour la prod).

## Documentation API

Une fois lancé, la doc est disponible sur :

```
http://IP_DE_TON_VPS:3000/doc-api
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
└── data/users.json               # base des utilisateurs/clés (généré au runtime)
```

## Notes importantes

- `data/users.json` et `auth_sessions/` contiennent des données sensibles (clés API, credentials WhatsApp) : à ne jamais commiter, à sauvegarder régulièrement.
- Le stockage JSON convient pour démarrer ; si le nombre d'utilisateurs grossit, prévoir une migration vers une vraie base (SQLite/Postgres).
- Pense à mettre Nginx + certbot devant le gateway pour du HTTPS en production.
