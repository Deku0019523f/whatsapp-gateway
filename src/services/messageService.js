const fs = require('fs');
const { getSession } = require('../sessions/sessionManager');

function toJid(number) {
  if (number.includes('@')) return number;
  return `${number.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
}

async function sendMessage(userId, { to, type, text, filePath, fileName, mimeType, caption }) {
  const session = getSession(userId);
  if (!session || session.status !== 'connected') {
    throw new Error('Session WhatsApp non connectée pour cet utilisateur');
  }
  const sock = session.sock;
  const jid = toJid(to);

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
