const path = require('path');
const fs = require('fs');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require('@whiskeysockets/baileys');

const { sendWebhook } = require('../services/webhookService');

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
  return { status: s.status, qr: s.qr || null };
}

async function startSession(userId, io, { mode = 'qr', phoneNumber = null } = {}) {
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
    printQRInTerminal: false,
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
      io.to(userId).emit('connected', { userId });
      sendWebhook(userId, 'connected', { userId });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      s.status = 'disconnected';
      io.to(userId).emit('disconnected', { userId, shouldReconnect });
      sendWebhook(userId, 'disconnected', { userId, shouldReconnect });

      if (shouldReconnect) {
        startSession(userId, io, { mode, phoneNumber });
      } else {
        sessions.delete(userId);
        fs.rmSync(getSessionDir(userId), { recursive: true, force: true });
      }
    }
  });

  // Réception de messages entrants -> webhook
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      sendWebhook(userId, 'message_received', {
        from: msg.key.remoteJid,
        message: msg.message,
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
  fs.rmSync(getSessionDir(userId), { recursive: true, force: true });
  return { status: 'logged_out' };
}

module.exports = {
  startSession,
  logoutSession,
  getStatus,
  getSession,
};
