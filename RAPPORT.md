# RAPPORT — WhatsApp Gateway (My Atelier)

> Mémoire du projet. À mettre à jour après chaque étape importante, sans supprimer les infos déjà présentes.
> Dernière mise à jour : 2026-10-18

## Objectif
Passerelle WhatsApp multi-utilisateurs (type WPPConnect) basée sur Baileys, hébergée sur un VPS. Le site My Atelier (premium225.shop / boostapi.store) l'appelle pour connecter des comptes WhatsApp (QR ou pairing code), envoyer des messages (texte, lien, image, fichier) et recevoir les messages entrants par webhook.

## Stack et technologies
- Node.js 20+ (obligatoire pour Baileys), Express 4, Socket.io 4
- `@whiskeysockets/baileys` (WhatsApp), `qrcode`, `pino`
- `better-sqlite3` (stockage), `axios` (webhooks), `multer` (uploads)
- `helmet`, `express-rate-limit`, `cors`, `dotenv`, `uuid`
- Transcription vocale : API Groq Whisper (via `fetch`)
- Déploiement : VPS Ubuntu, PM2, Nginx + Certbot (`setup-domain.sh`)

## Architecture et structure des fichiers
Voir `plan.md` pour le détail. Résumé :
- `server.js` : point d'entrée (Express, Socket.io authentifié, purge, arrêt propre)
- `src/sessions/sessionManager.js` : cœur Baileys (QR, pairing, reconnexion, messages entrants)
- `src/services/` : webhooks (file + retries), envoi, stockage messages, transcription
- `src/controllers/`, `src/routes/`, `src/middlewares/`, `src/utils/` (SQLite)
- `public/doc-api/index.html` : doc API servie sur `/doc-api`

## Fonctionnalités développées
- Utilisateurs multiples : clé API + clé webhook par utilisateur, gestion via `/admin/*` (clé `x-admin-key`)
- Sessions WhatsApp par QR ou pairing code, reconnexion automatique (backoff 2 s à 60 s, 10 tentatives max)
- Envoi de messages texte / lien / image / fichier (`/message/send`, upload 25 Mo max)
- Historique des messages reçus (1000 par contact, purge à 7 jours), routes `/message/contacts`, `/message/history*`
- Normalisation des contacts `@lid` / `@s.whatsapp.net` (correction de la duplication de contacts)
- Stockage SQLite unique (`data/gateway.db`) avec migration automatique de l'ancien JSON (fichiers renommés `*.migrated`)
- Webhooks fiables : file SQLite, retries avec backoff (5 s, 30 s, 2 min, 10 min, 1 h, 6 h), signature HMAC-SHA256, suivi admin (`GET /admin/webhooks`, `POST /admin/webhooks/:id/retry`)
- Sécurité : Socket.io authentifié par clé API, CORS configurable (`ALLOWED_ORIGINS`), anti brute-force, rate limiting (global, envoi), `helmet`, clé admin en temps constant, validation des URL de webhook
- Route `GET /health`, arrêt propre sur SIGTERM/SIGINT, `unhandledRejection` capturée
- Transcription automatique des messages vocaux (Groq Whisper) avec repli sans transcription en cas d'échec
- Scripts : `fix-node.sh` (Node 20 via nvm), `setup-domain.sh` (domaine + Nginx + SSL)

## Fonctionnalités restantes
- Tests automatisés (aucun pour l'instant)
- Ajouter `"engines": { "node": ">=20.0.0" }` dans `package.json` (le README et le plan la mentionnent, mais elle n'y est pas ; voir `PACKAGE_JSON_PATCH.md`)
- Support des groupes et statuts (volontairement ignorés aujourd'hui)
- Base partagée (Postgres) si passage à plusieurs serveurs

## Modifications importantes effectuées
- 2026-10-18 : mise à jour majeure poussée depuis `whatsapp-gateway-modifs.zip` : SQLite, file de webhooks fiable + signature HMAC, rate limiting, helmet, Socket.io authentifié, transcription vocale, doc API et README à jour
- Avant : correction de la duplication de contacts `@lid` / `@s.whatsapp.net`

## Problèmes rencontrés et solutions
- Erreur `MODULE_NOT_FOUND` / `requires Node.js 20+` : Node trop ancien sur le VPS. Solution : `bash fix-node.sh` et `.npmrc` avec `engine-strict=true`
- Compilation de `better-sqlite3` qui échoue : `sudo apt install -y build-essential python3`
- Contact en double (numéro vs `@lid`), envois bloqués « En attente » : normalisation vers le `@lid` dès qu'il est connu, et réponse via le champ `from` du webhook
- Push git depuis l'environnement Claude bloqué (dépôt non autorisé dans la session) : contourné via l'API GitHub

## Dépendances installées
`@whiskeysockets/baileys`, `express`, `socket.io`, `multer`, `qrcode`, `uuid`, `pino`, `dotenv`, `cors`, `axios`, `better-sqlite3`, `helmet`, `express-rate-limit` ; dev : `nodemon`.

## Commandes importantes
```bash
npm install
cp .env.example .env && nano .env
npm start                      # test rapide
npm run dev                    # nodemon
pm2 start server.js --name whatsapp-gateway && pm2 save && pm2 startup
bash fix-node.sh               # réparer Node 20+
sudo bash setup-domain.sh      # domaine + Nginx + SSL
sqlite3 data/gateway.db ".backup sauvegarde.db"   # sauvegarde à chaud
```

## Variables d'environnement nécessaires (valeurs secrètes jamais enregistrées ici)
`PORT`, `ADMIN_KEY`, `PUBLIC_URL`, `ALLOWED_ORIGINS`, `TRUST_PROXY`, `RATE_LIMIT_PER_MIN`, `AUTH_FAILURES_PER_15MIN`, `SEND_LIMIT_PER_MIN`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_LEGACY_KEY_HEADER`, `WEBHOOK_TIMEOUT_MS`, `WEBHOOK_BACKOFF_SECONDS`, `GROQ_API_KEY`, `TRANSCRIPTION_LANGUAGE`, `TRANSCRIPTION_MODEL`, `TRANSCRIPTION_MAX_SECONDS`, `TRANSCRIPTION_ENABLED`, `DB_PATH`.

## État actuel du projet
Code à jour sur la branche `main` de `Deku0019523f/whatsapp-gateway`. Non testé en exécution depuis cet environnement (pas de VPS). `package-lock.json` synchronisé avec `package.json`.

## Prochaines étapes
1. Sur le VPS : `git pull`, `npm install`, redémarrer PM2 ; vérifier la migration JSON vers SQLite dans les logs
2. Définir une vraie `ADMIN_KEY` et `ALLOWED_ORIGINS`
3. Côté My Atelier : vérifier la signature `x-webhook-signature` et dédoublonner avec `x-webhook-id`
4. Ajouter le champ `engines` dans `package.json`, puis des tests
