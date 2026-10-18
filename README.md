# WhatsApp Gateway — My Atelier

Passerelle WhatsApp multi-utilisateurs (type WPPConnect) basée sur Baileys, à héberger sur ton VPS.

## Prérequis

- **Node.js 20+** (obligatoire — Baileys ne fonctionne pas sur des versions plus anciennes)
- Un VPS Linux (Ubuntu recommandé) avec accès root/sudo
- Pour le stockage SQLite (`better-sqlite3`) : un binaire précompilé est téléchargé automatiquement sur Node 20+. Si l'installation tombe sur une compilation qui échoue, installe les outils de build : `sudo apt install -y build-essential python3`

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

## Stockage (SQLite)

Utilisateurs, clés API, messages reçus et file d'attente des webhooks sont dans un seul fichier SQLite : `data/gateway.db`.

- **Migration automatique** : au premier démarrage, l'ancien `data/users.json` et les fichiers `data/messages/<userId>/<contact>.json` sont importés, puis renommés en `users.json.migrated` et `messages.migrated/` (rien n'est supprimé, tu peux les effacer une fois que tout fonctionne).
- Les routes `/message/history*` renvoient exactement le même format qu'avant.
- La mémoire reste de 1000 messages par conversation, avec purge des messages de plus de 7 jours.
- **Sauvegarde** : copie `data/gateway.db` (ou utilise `sqlite3 data/gateway.db ".backup sauvegarde.db"` pendant que le gateway tourne), en plus de `auth_sessions/`.

## Sécurité

- **Socket.io authentifié** : le front se connecte avec sa clé API, et ne reçoit que les événements de son propre utilisateur :
  ```js
  const socket = io("https://ton-domaine", { auth: { apiKey: "key_..." } });
  socket.on("qr", ({ qr }) => afficherQr(qr));
  ```
  L'ancien `socket.emit("join", userId)` n'est plus nécessaire (et refusé pour un autre userId).
- **CORS / Socket.io** : renseigne `ALLOWED_ORIGINS` dans `.env` (ex. `https://premium225.shop`). Vide = toutes les origines, avec un avertissement au démarrage.
- **Anti brute-force** : au-delà de 20 clés refusées en 15 minutes, l'IP est bloquée temporairement (compteurs séparés pour l'admin, les sessions et les messages).
- **Limites** : 600 requêtes/min par IP, 60 envois de messages/min par utilisateur (protège aussi le numéro WhatsApp). Réglables dans `.env`.
- Clé admin comparée en temps constant, en-têtes de sécurité (`helmet`), corps de requête limité à 1 Mo, URL de webhook validée (http/https), arrêt propre sur `SIGTERM`.
- Route `GET /health` pour la supervision.
- Pense à définir une vraie `ADMIN_KEY` (longue et aléatoire) : le gateway affiche un avertissement tant que la valeur par défaut est présente.

## Webhooks fiables

Chaque événement est écrit dans une file d'attente SQLite avant l'envoi : rien n'est perdu si My Atelier est indisponible ou si le gateway redémarre.

- **Réessais** automatiques avec backoff : 5 s, 30 s, 2 min, 10 min, 1 h, 6 h (8 tentatives par défaut). Pas de réessai sur une erreur 4xx définitive (hors 408/429). Les événements `qr` et `pairing_code`, périmés en quelques secondes, ne sont tentés qu'une fois.
- **Signature HMAC-SHA256** sur chaque requête, avec la `webhookKey` de l'utilisateur. Headers envoyés : `x-webhook-id`, `x-webhook-event`, `x-webhook-attempt`, `x-webhook-timestamp`, `x-webhook-signature` (`sha256=<hex>`). L'ancien header `x-webhook-key` reste envoyé (désactivable avec `WEBHOOK_LEGACY_KEY_HEADER=false`).
- **Vérification côté site** (Node.js) :
  ```js
  const crypto = require("crypto");
  function verifierWebhook(rawBody, headers, webhookKey) {
    const attendu = "sha256=" + crypto.createHmac("sha256", webhookKey)
      .update(headers["x-webhook-timestamp"] + "." + rawBody).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(attendu), Buffer.from(headers["x-webhook-signature"] || ""));
  }
  ```
  Utilise le **corps brut** de la requête (avant tout `JSON.parse`), et rejette les timestamps trop anciens (ex. > 5 min).
- **Livraison "au moins une fois"** : en cas de réessai, un même événement peut arriver deux fois ; dédoublonne avec `x-webhook-id`. L'ordre n'est pas garanti après un réessai : utilise `timestamp` pour trier.
- **Suivi admin** : `GET /admin/webhooks?status=failed` liste les livraisons (compteurs inclus) et `POST /admin/webhooks/:id/retry` relance une livraison échouée.

## Transcription des messages vocaux

Si `GROQ_API_KEY` est renseignée dans `.env`, chaque message vocal (ou fichier audio de moins de `TRANSCRIPTION_MAX_SECONDS`, 5 min par défaut) est transcrit automatiquement avec Groq Whisper avant l'envoi du webhook :

- l'événement `message_received` contient alors `text` = la transcription, `transcription` et `isVoice` ;
- la transcription est aussi enregistrée dans l'historique (`/message/history*` : champs `text` et `transcription`) ;
- si Groq est indisponible, le vocal est quand même transmis (sans texte) : un message n'est jamais perdu.

`TRANSCRIPTION_LANGUAGE=fr` guide la reconnaissance ; laisse vide pour la détection automatique.

## Flux d'intégration côté My Atelier

1. **Créer un utilisateur** sur le gateway (`POST /admin/users` avec `x-admin-key`) → tu récupères `apiKey` et `webhookKey`, à stocker en base côté My Atelier pour cet utilisateur.
2. **Démarrer une session** (`POST /session/start` avec `x-api-key` de l'utilisateur, mode `qr` ou `pairing`).
3. **Recevoir le QR / pairing code** via webhook (vérifié avec la signature `x-webhook-signature`) ou via Socket.io (authentifié par la clé API).
4. **Envoyer des messages** (`POST /message/send` avec `x-api-key`).

## Structure

```
whatsapp-gateway/
├── server.js                     # point d'entrée (Express + Socket.io)
├── src/
│   ├── sessions/sessionManager.js  # cœur Baileys (QR, pairing, reconnexion)
│   ├── services/                   # webhooks (file + retries), envoi, stockage messages, transcription
│   ├── controllers/                # logique des routes
│   ├── middlewares/                 # auth admin / auth clé API / rate limit
│   ├── utils/                      # SQLite (db.js) + utilisateurs (store.js)
│   └── routes/
├── public/doc-api/               # documentation servie sur /doc-api
├── auth_sessions/                # credentials Baileys par utilisateur (généré au runtime)
├── data/gateway.db               # base SQLite : utilisateurs, clés, messages, file de webhooks (générée au runtime)
├── fix-node.sh                   # installe/répare Node 20+ via nvm
├── setup-domain.sh               # configure un domaine + Nginx + SSL
├── .npmrc                        # engine-strict=true (bloque npm install si Node < 20)
└── package.json                  # engines.node >= 20.0.0
```

## Notes importantes

- `data/gateway.db` et `auth_sessions/` contiennent des données sensibles (clés API, messages, credentials WhatsApp) : à ne jamais commiter, à sauvegarder régulièrement.
- SQLite suffit largement pour un gateway sur un seul VPS ; si tu passes un jour sur plusieurs serveurs, il faudra une base partagée (Postgres).
- Pense à mettre Nginx + certbot devant le gateway pour du HTTPS en production (voir `setup-domain.sh`).
- Le fichier `.npmrc` (`engine-strict=true`) fait échouer `npm install` si Node < 20, pour éviter de reproduire l'erreur `MODULE_NOT_FOUND` liée à une version trop ancienne.
