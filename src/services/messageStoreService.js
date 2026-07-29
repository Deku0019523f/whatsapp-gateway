const fs = require('fs');
const path = require('path');

const MESSAGES_DIR = path.join(__dirname, '../../data/messages');

// Crée (si besoin) et renvoie le dossier de l'utilisateur connecté
function getUserDir(userId) {
  const dir = path.join(MESSAGES_DIR, userId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

// Un fichier par client (numéro), nettoyé pour être un nom de fichier sûr
function getContactFile(userId, contact) {
  const safeContact = String(contact).replace(/[^0-9]/g, '') || 'inconnu';
  return path.join(getUserDir(userId), `${safeContact}.json`);
}

function readContactMessages(userId, contact) {
  const file = getContactFile(userId, contact);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (err) {
    console.error(`Fichier messages corrompu pour ${userId}/${contact}, réinitialisation :`, err.message);
    return [];
  }
}

function writeContactMessages(userId, contact, messages) {
  fs.writeFileSync(getContactFile(userId, contact), JSON.stringify(messages, null, 2));
}

// Extrait le texte lisible d'un message Baileys, quel que soit son type
function extractText(message) {
  if (!message) return null;
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return message.imageMessage.caption;
  if (message.videoMessage?.caption) return message.videoMessage.caption;
  if (message.documentMessage?.caption) return message.documentMessage.caption;
  return null;
}

// Ajoute un message reçu au fichier du contact correspondant
function saveIncomingMessage(userId, contact, msg) {
  const messages = readContactMessages(userId, contact);
  const entry = {
    id: msg.key.id,
    from: msg.key.remoteJid,
    text: extractText(msg.message),
    message: msg.message,
    timestamp: msg.messageTimestamp,
  };
  messages.push(entry);
  writeContactMessages(userId, contact, messages);
  return entry;
}

function listContacts(userId) {
  const dir = getUserDir(userId);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

function getMessages(userId, contact) {
  return readContactMessages(userId, contact);
}

function getAllMessages(userId) {
  const result = {};
  for (const contact of listContacts(userId)) {
    result[contact] = readContactMessages(userId, contact);
  }
  return result;
}

// Supprime, pour tous les utilisateurs, les messages plus vieux que maxAgeDays.
// Si un fichier contact n'a plus aucun message après purge, le fichier est supprimé.
function purgeOldMessages(maxAgeDays = 7) {
  const stats = { usersProcessed: 0, filesDeleted: 0, messagesDeleted: 0 };
  if (!fs.existsSync(MESSAGES_DIR)) return stats;

  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const userDirs = fs.readdirSync(MESSAGES_DIR).filter((d) => {
    return fs.statSync(path.join(MESSAGES_DIR, d)).isDirectory();
  });

  for (const userId of userDirs) {
    stats.usersProcessed += 1;
    const dir = path.join(MESSAGES_DIR, userId);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      const filePath = path.join(dir, file);
      let messages;
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        messages = raw.trim() ? JSON.parse(raw) : [];
      } catch (err) {
        continue; // fichier illisible/corrompu : on n'y touche pas ici
      }

      const kept = messages.filter((m) => {
        const ts = Number(m.timestamp) * 1000; // messageTimestamp WhatsApp est en secondes
        if (!ts) return true; // pas de timestamp exploitable -> on garde par prudence
        return now - ts <= maxAgeMs;
      });

      stats.messagesDeleted += messages.length - kept.length;

      if (kept.length === 0) {
        fs.unlinkSync(filePath);
        stats.filesDeleted += 1;
      } else if (kept.length !== messages.length) {
        fs.writeFileSync(filePath, JSON.stringify(kept, null, 2));
      }
    }
  }

  return stats;
}

module.exports = {
  getUserDir,
  saveIncomingMessage,
  listContacts,
  getMessages,
  getAllMessages,
  purgeOldMessages,
};
