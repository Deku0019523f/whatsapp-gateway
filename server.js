require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { Server } = require('socket.io');

const adminRoutes = require('./src/routes/adminRoutes');
const sessionRoutes = require('./src/routes/sessionRoutes');
const messageRoutes = require('./src/routes/messageRoutes');
const { purgeOldMessages } = require('./src/services/messageStoreService');
const { startWebhookWorker, stopWebhookWorker, drainWebhooks } = require('./src/services/webhookService');
const { getUserByApiKey } = require('./src/utils/store');
const { getDb, closeDb } = require('./src/utils/db');
const { globalLimiter } = require('./src/middlewares/rateLimit');

// Ouvre la base SQLite (crée les tables et importe l'ancien stockage JSON si besoin)
getDb();

// Origines navigateur autorisées (CORS HTTP + Socket.io), séparées par des virgules.
// Ex. ALLOWED_ORIGINS=https://premium225.shop,https://www.premium225.shop
// Non défini = toutes les origines (comportement historique) : à restreindre en production.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.length ? allowedOrigins : '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });

// Derrière Nginx (setup-domain.sh), l'IP réelle du client vient de X-Forwarded-For.
// 'loopback' = on ne fait confiance à ce header que s'il vient du Nginx local.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.set('io', io);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: corsOrigin }));
app.use(globalLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Doc API statique
app.use('/doc-api', express.static(path.join(__dirname, 'public/doc-api')));

app.use('/admin', adminRoutes);
app.use('/session', sessionRoutes);
app.use('/message', messageRoutes);

app.get('/', (req, res) => {
  res.json({ success: true, service: 'whatsapp-gateway-atelier', doc: '/doc-api' });
});

// Sonde de santé (monitoring, PM2, Nginx...) : vérifie aussi que la base répond
app.get('/health', (req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({ success: true, status: 'ok', uptime: Math.round(process.uptime()) });
  } catch (err) {
    res.status(503).json({ success: false, status: 'database_unavailable' });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route introuvable' });
});

// Gestionnaire d'erreurs global (JSON invalide, corps trop gros, exception non prévue...)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Corps JSON invalide' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Corps de requête trop volumineux' });
  }
  console.error('[erreur]', err);
  res.status(err.statusCode || 500).json({ success: false, error: 'Erreur interne du serveur' });
});

// Socket.io : connexion authentifiée par la clé API de l'utilisateur.
// Le client fournit sa clé à la connexion :
//   io(URL, { auth: { apiKey: "key_..." } })
// Le serveur déduit lui-même le userId et place le socket dans SA room uniquement :
// impossible d'écouter le QR / les événements d'un autre utilisateur.
io.use((socket, next) => {
  authFailureLimiterForSockets(socket, (err) => {
    if (err) return next(err);
    const key = socket.handshake.auth?.apiKey || socket.handshake.headers['x-api-key'];
    const user = getUserByApiKey(key);
    if (!user) {
      recordSocketFailure(socket);
      return next(new Error('unauthorized'));
    }
    socket.data.userId = user.userId;
    next();
  });
});

// Anti brute-force pour les connexions Socket.io (même seuil que l'API REST :
// 20 échecs par IP sur 15 minutes). express-rate-limit ne couvre que HTTP, donc petit
// compteur dédié ici.
const socketFailures = new Map(); // ip -> { count, resetAt }
const SOCKET_FAILURE_LIMIT = Number(process.env.AUTH_FAILURES_PER_15MIN) || 20;
const SOCKET_WINDOW_MS = 15 * 60 * 1000;

function socketIp(socket) {
  if (app.get('trust proxy') && socket.handshake.headers['x-forwarded-for']) {
    const remote = socket.handshake.address || '';
    if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') {
      return String(socket.handshake.headers['x-forwarded-for']).split(',')[0].trim();
    }
  }
  return socket.handshake.address;
}

function authFailureLimiterForSockets(socket, cb) {
  const ip = socketIp(socket);
  const entry = socketFailures.get(ip);
  if (entry && entry.resetAt > Date.now() && entry.count >= SOCKET_FAILURE_LIMIT) {
    return cb(new Error('too_many_attempts'));
  }
  cb();
}

function recordSocketFailure(socket) {
  const ip = socketIp(socket);
  const now = Date.now();
  const entry = socketFailures.get(ip);
  if (!entry || entry.resetAt <= now) {
    socketFailures.set(ip, { count: 1, resetAt: now + SOCKET_WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of socketFailures) if (entry.resetAt <= now) socketFailures.delete(ip);
}, SOCKET_WINDOW_MS).unref();

io.on('connection', (socket) => {
  const { userId } = socket.data;
  socket.join(userId);

  // Compatibilité avec l'ancien client (socket.emit("join", userId)) : accepté seulement
  // pour son propre userId, toute autre valeur est refusée.
  socket.on('join', (requested) => {
    if (requested && requested !== userId) {
      socket.emit('error', { message: 'Accès refusé à cette room' });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WhatsApp Gateway démarré sur le port ${PORT}`);
  console.log(`Documentation API : http://localhost:${PORT}/doc-api`);

  if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY === 'change_this_admin_key') {
    console.warn('[sécurité] ADMIN_KEY absente ou égale à la valeur par défaut : définis une clé secrète longue dans .env');
  }
  if (!allowedOrigins.length) {
    console.warn('[sécurité] ALLOWED_ORIGINS non défini : toutes les origines navigateur sont acceptées (CORS/Socket.io)');
  }
  if (process.env.GROQ_API_KEY) {
    console.log('[transcription] messages vocaux : transcription automatique activée');
  }
});

startWebhookWorker();

// Purge des messages de plus de 7 jours : au démarrage, puis chaque jour
function runMessagePurge() {
  const stats = purgeOldMessages(7);
  console.log(
    `[purge] utilisateurs traités: ${stats.usersProcessed}, fichiers supprimés: ${stats.filesDeleted}, messages supprimés: ${stats.messagesDeleted}`
  );
}
runMessagePurge();
setInterval(runMessagePurge, 24 * 60 * 60 * 1000);

// Arrêt propre (PM2 restart/stop) : on laisse finir les webhooks en cours puis on ferme la base
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[arrêt] ${signal} reçu, arrêt en cours...`);
  stopWebhookWorker();
  io.close();
  server.close();
  await drainWebhooks(5000);
  closeDb();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Une promesse rejetée non gérée ne doit pas tuer le gateway (et toutes les sessions WhatsApp)
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
