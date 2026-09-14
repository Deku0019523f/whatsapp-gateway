const fs = require('fs');
const { getSession } = require('../sessions/sessionManager');
const { getLastCanonicalJid } = require('./messageStoreService');

// Si "number" contient déjà un "@", on l'utilise tel quel (JID complet fourni
// explicitement). Sinon, on cherche d'abord dans l'historique la dernière adresse
// réellement utilisée pour ce contact (@s.whatsapp.net ou @lid) : WhatsApp bascule
// certains contacts sur @lid, et leur envoyer un message au format @s.whatsapp.net
// par défaut reste bloqué en "En attente" indéfiniment. On ne retombe sur le format
// numéro classique que si le contact est totalement inconnu (premier envoi à froid).
function toJid(userId, number) {
  if (number.includes('@')) return number;
  const digits = number.replace(/[^0-9]/g, '');
  const known = getLastCanonicalJid(userId, digits);
  if (known) return known;
  return `${digits}@s.whatsapp.net`;
}

async function sendMessage(userId, { to, type, text, filePath, fileName, mimeType, caption }) {
  const session = getSession(userId);
  if (!session || session.status !== 'connected') {
    throw new Error('Session WhatsApp non connectée pour cet utilisateur');
  }
  const sock = session.sock;
  const jid = toJid(userId, to);

  switch (type) {
    case 'text':
    case 'link':
      return sock.sendMessage(jid, { text });

    case 'image':
      return sock.sendMessage(jid, {
        image: fs.readFileSync(filePath),
        caption: caption || '',
      });

    case 'file':
      return sock.sendMessage(jid, {
        document: fs.readFileSync(filePath),
        fileName: fileName || 'fichier',
        mimetype: mimeType || 'application/octet-stream',
      });

    default:
      throw new Error(`Type de message non supporté : ${type}`);
  }
}

module.exports = { sendMessage };
