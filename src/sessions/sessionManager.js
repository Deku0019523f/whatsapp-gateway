const path = require('path');
const fs = require('fs');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  isJidGroup,
  isJidStatusBroadcast,
  isLidUser,
  jidDecode,
  jidNormalizedUser,
} = require('@whiskeysockets/baileys');

const { sendWebhook } = require('../services/webhookService');
const { getUserDir, saveIncomingMessage } = require('../services/messageStoreService');

const AUTH_DIR = path.join(__dirname, '../../auth_sessions');

// sessions en mémoire : userId -> { sock, status, qr, phone }
const sessions = new Map();

function getSessionDir(userId) {
  return path.join(AUTH_DIR, userId);
}

function getSession(userId) {
  return sessions.get(userId);
}

function getStatus(userId) {
  const s = sessions.get(userId);
  if (!s) return { status: 'disconnected' };
  return {
    status: s.status,
    qr: s.qr || null,
    pairingCode: s.pairingCode || null,
    account: s.account || null, // { name, number, photoUrl } une fois connecté
  };
}

// Format international E.164 sans le "+" : ex. 2250700000000, 33612345678
const INTL_PHONE_REGEX = /^[1-9]\d{6,14}$/;

// Reconnexion avec backoff exponentiel (2s, 4s, 8s... plafonné à 60s), max 10 tentatives
const MAX_RECONNECT_ATTEMPTS = 10;
const reconnectAttempts = new Map(); // userId -> nombre de tentatives

async function startSession(userId, io, { mode = 'qr', phoneNumber = null } = {}) {
  if (mode === 'pairing' && phoneNumber && !INTL_PHONE_REGEX.test(phoneNumber)) {
    throw Object.assign(
      new Error('Numéro invalide : format international requis, sans le "+" (ex: 2250700000000)'),
      { statusCode: 400 }
    );
  }

  if (!fs.existsSync(getSessionDir(userId))) {
    fs.mkdirSync(getSessionDir(userId), { recursive: true });
  }

  // Si une session existe déjà et est connectée, ne rien refaire
  const existing = sessions.get(userId);
  if (existing && existing.status === 'connected') {
    return { status: 'already_connected' };
  }

  const { state, saveCreds } = await useMultiFileAuthState(getSessionDir(userId));
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '22.04.4'],
  });

  sessions.set(userId, { sock, status: 'connecting', qr: null, phone: phoneNumber });

  // Mode pairing code : respecter le délai avant de le demander
  if (mode === 'pairing' && phoneNumber && !state.creds.registered) {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
        const s = sessions.get(userId);
        if (s) s.pairingCode = code;
        io.to(userId).emit('pairing_code', { userId, code });
        sendWebhook(userId, 'pairing_code', { code });
      } catch (err) {
        io.to(userId).emit('error', { userId, message: 'Erreur génération pairing code' });
      }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const s = sessions.get(userId);
    if (!s) return;

    if (qr && mode === 'qr') {
      s.qr = await QRCode.toDataURL(qr);
      s.status = 'qr_pending';
      io.to(userId).emit('qr', { userId, qr: s.qr });
      sendWebhook(userId, 'qr', { qr: s.qr });
    }

    if (connection === 'open') {
      s.status = 'connected';
      s.qr = null;
      s.pairingCode = null;
      reconnectAttempts.delete(userId);
      getUserDir(userId); // crée data/messages/<userId>/ si besoin

      // Récupère nom, numéro et photo de profil du compte connecté
      const rawJid = sock.user?.id || '';
      const number = jidDecode(rawJid)?.user || null;
      const name = sock.user?.name || sock.user?.notify || null;
      let photoUrl = null;
      try {
        photoUrl = await sock.profilePictureUrl(sock.user.id, 'image');
      } catch (e) {
        photoUrl = null; // pas de photo de profil ou non accessible
      }

      const account = { name, number, photoUrl };
      s.account = account;

      io.to(userId).emit('connected', { userId, account });
      sendWebhook(userId, 'connected', { userId, account });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      s.status = 'disconnected';
      io.to(userId).emit('disconnected', { userId, shouldReconnect });
      sendWebhook(userId, 'disconnected', { userId, shouldReconnect });

      if (shouldReconnect) {
        const attempts = (reconnectAttempts.get(userId) || 0) + 1;
        if (attempts > MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts.delete(userId);
          sessions.delete(userId);
          io.to(userId).emit('reconnect_failed', { userId, attempts: attempts - 1 });
          sendWebhook(userId, 'reconnect_failed', { attempts: attempts - 1 });
          return;
        }
        reconnectAttempts.set(userId, attempts);
        const delay = Math.min(2000 * 2 ** (attempts - 1), 60000); // 2s,4s,8s...max 60s
        setTimeout(() => {
          startSession(userId, io, { mode, phoneNumber }).catch((err) => {
            io.to(userId).emit('error', { userId, message: err.message });
          });
        }, delay);
      } else {
        reconnectAttempts.delete(userId);
        sessions.delete(userId);
        fs.rmSync(getSessionDir(userId), { recursive: true, force: true });
      }
    }
  });

  // Réception de messages entrants -> webhook
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const remoteJid = msg.key.remoteJid;
      if (!msg.message || msg.key.fromMe || !remoteJid) continue;
      // Hors périmètre pour une conversation client 1-à-1 : groupes et statuts/stories
      if (isJidGroup(remoteJid) || isJidStatusBroadcast(remoteJid)) continue;
      // Pas un vrai message client : suppression, édition ou réaction (emoji) sur un message existant
      if (msg.message.protocolMessage || msg.message.reactionMessage) continue;

      // WhatsApp masque parfois le numéro réel derrière un identifiant @lid (confidentialité
      // du numéro, déploiement en cours côté WhatsApp). Quand Baileys parvient à le résoudre,
      // le vrai numéro est exposé dans msg.key.senderPn : on l'utilise en priorité pour que
      // le contact stocké reste un numéro exploitable pour répondre via /message/send.
      const resolvedJid = isLidUser(remoteJid) && msg.key.senderPn ? msg.key.senderPn : remoteJid;
      const normalized = jidNormalizedUser(resolvedJid);
      const decoded = jidDecode(normalized);
      const contact = decoded ? decoded.user : normalized.split('@')[0];

      const saved = saveIncomingMessage(userId, contact, msg);
      sendWebhook(userId, 'message_received', {
        from: normalized,
        message: msg.message,
        text: saved.text,
        timestamp: msg.messageTimestamp,
      });
    }
  });

  return { status: 'starting' };
}

async function logoutSession(userId) {
  const s = sessions.get(userId);
  if (s && s.sock) {
    try {
      await s.sock.logout();
    } catch (e) {
      // ignore
    }
  }
  sessions.delete(userId);
  reconnectAttempts.delete(userId);
  fs.rmSync(getSessionDir(userId), { recursive: true, force: true });
  return { status: 'logged_out' };
}

module.exports = {
  startSession,
  logoutSession,
  getStatus,
  getSession,
};
