# plan.md — Structure détaillée du projet

```
whatsapp-gateway/
├── server.js                         # Point d'entrée : Express, Socket.io (auth par clé API), helmet, CORS,
│                                     #   rate limit global, /health, purge quotidienne, arrêt propre
├── package.json / package-lock.json  # Dépendances (Node >= 20 requis par Baileys)
├── .env.example                      # Modèle de configuration (copier vers .env)
├── .gitignore                        # Ignore .env, auth_sessions/*, data/gateway.db*, uploads/*, node_modules
├── .npmrc                            # engine-strict=true
├── README.md                         # Installation, sécurité, webhooks, transcription, flux d'intégration
├── RAPPORT.md                        # Mémoire du projet (état, historique, prochaines étapes)
├── plan.md                           # Ce fichier
├── PACKAGE_JSON_PATCH.md             # Note : ajouter le champ "engines" à package.json
├── apply-and-push.sh                 # Script d'application/push de modifications
├── fix-node.sh                       # Installe/répare Node 20+ via nvm + relance PM2
├── setup-domain.sh                   # Domaine + Nginx + SSL (Certbot), met à jour PUBLIC_URL
├── auth_sessions/                    # Credentials Baileys par utilisateur (runtime, sensible, ignoré par git)
├── data/                             # gateway.db SQLite (runtime, ignoré par git)
├── uploads/                          # Fichiers temporaires avant envoi WhatsApp (runtime)
├── public/doc-api/index.html         # Documentation API servie sur /doc-api
└── src/
    ├── routes/
    │   ├── adminRoutes.js            # /admin : utilisateurs + suivi/relance des webhooks (x-admin-key)
    │   ├── sessionRoutes.js          # /session : start, status, logout (x-api-key)
    │   └── messageRoutes.js          # /message : send (multer), contacts, history, history/:contact
    ├── controllers/
    │   ├── userController.js         # Création/liste/régénération clé/webhook/suppression, liste webhooks
    │   ├── sessionController.js      # Démarrage (qr/pairing), statut, déconnexion
    │   └── messageController.js      # Envoi et consultation de l'historique
    ├── middlewares/
    │   ├── adminAuth.js              # Vérifie x-admin-key (comparaison temps constant)
    │   ├── apiKeyAuth.js             # Vérifie x-api-key, place req.user
    │   └── rateLimit.js              # Limiteur global, anti brute-force par groupe, limite d'envoi par utilisateur
    ├── sessions/
    │   └── sessionManager.js         # Baileys : QR, pairing, reconnexion, messages entrants,
    │                                 #   normalisation @lid, transcription des vocaux, émission webhooks/socket
    ├── services/
    │   ├── webhookService.js         # File SQLite, worker, retries/backoff, signature HMAC, suivi admin
    │   ├── messageService.js         # Envoi de messages (texte, lien, image, fichier), résolution du JID
    │   ├── messageStoreService.js    # Historique SQLite : sauvegarde, lecture, purge, transcription
    │   └── transcriptionService.js   # Groq Whisper (limites de durée/taille, concurrence max 3)
    └── utils/
        ├── db.js                     # Connexion SQLite (WAL), schéma, migration JSON -> SQLite
        └── store.js                  # CRUD utilisateurs (table users)
```

## Base SQLite (`data/gateway.db`)
| Table | Rôle |
|---|---|
| `users` | user_id, api_key (unique), webhook_url, webhook_key, created_at |
| `messages` | Messages reçus par utilisateur/contact (texte, transcription, JSON brut, timestamp) ; index contact, msg_id, timestamp |
| `webhook_queue` | Événements sortants : status pending/delivered/failed, tentatives, prochain essai, dernière erreur |
| `meta` | Marqueurs internes (ex. `legacy_json_migrated`) |

## API
| Groupe | Routes | Auth |
|---|---|---|
| Admin | `POST/GET /admin/users`, `POST /admin/users/:id/regenerate-key`, `PUT /admin/users/:id/webhook`, `DELETE /admin/users/:id`, `GET /admin/webhooks`, `POST /admin/webhooks/:id/retry` | `x-admin-key` |
| Session | `POST /session/start`, `GET /session/status`, `POST /session/logout` | `x-api-key` |
| Message | `POST /message/send`, `GET /message/contacts`, `GET /message/history`, `GET /message/history/:contact` | `x-api-key` |
| Divers | `GET /` , `GET /health`, `GET /doc-api` | publique |

## Événements sortants (webhook et Socket.io)
`qr`, `pairing_code`, `connected`, `disconnected`, `reconnect_failed`, `message_received` (avec `isVoice` et `transcription` pour les vocaux).
En-têtes webhook : `x-webhook-id`, `x-webhook-event`, `x-webhook-attempt`, `x-webhook-timestamp`, `x-webhook-signature` (`sha256=<hmac>`), et l'ancien `x-webhook-key`.

## Flux d'un message entrant
1. Baileys `messages.upsert` (type notify) puis filtre : ni groupe, ni statut, ni réaction/suppression
2. Normalisation du contact (`@lid` prioritaire), sauvegarde dans `messages`
3. Si vocal : téléchargement puis transcription Groq (échec toléré)
4. `sendWebhook` : écriture dans `webhook_queue`, envoi immédiat, retries si besoin
