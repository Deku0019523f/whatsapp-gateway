const { getDb, toNum } = require('../utils/db');

// Stockage des messages reçus dans SQLite (table "messages").
// Même API qu'avant (saveIncomingMessage, getMessages, listContacts, ...) : les
// routes /message/history* renvoient exactement le même format.

// Mémoire max conservée par conversation (par contact) : les plus anciens sont
// écartés dès qu'une nouvelle réception dépasse ce nombre.
const MAX_MESSAGES_PER_CONTACT = 1000;

// Identifiant de contact = chiffres uniquement (numéro ou identifiant @lid)
function normalizeContact(contact) {
  return String(contact).replace(/[^0-9]/g, '') || 'inconnu';
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

function rowToEntry(row) {
  let message = null;
  try {
    message = row.message ? JSON.parse(row.message) : null;
  } catch (e) {
    message = null;
  }
  const entry = {
    id: row.msg_id,
    from: row.from_jid,
    canonicalJid: row.canonical_jid,
    text: row.text,
    message,
    timestamp: row.timestamp,
  };
  if (row.transcription) entry.transcription = row.transcription;
  return entry;
}

// Ajoute un message reçu à la conversation du contact correspondant.
// La conversation est plafonnée à MAX_MESSAGES_PER_CONTACT : au-delà, les messages
// les plus anciens sont écartés (fenêtre glissante des derniers messages).
// canonicalJid : adresse complète résolue par sessionManager (avec @s.whatsapp.net
// ou @lid) — mémorisée pour que l'envoi sache quelle adresse utiliser plus tard.
function saveIncomingMessage(userId, contact, msg, canonicalJid) {
  const db = getDb();
  const c = normalizeContact(contact);
  const entry = {
    id: msg.key.id,
    from: msg.key.remoteJid,
    canonicalJid: canonicalJid || msg.key.remoteJid,
    text: extractText(msg.message),
    message: msg.message,
    timestamp: toNum(msg.messageTimestamp),
  };

  db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (user_id, contact, msg_id, from_jid, canonical_jid, text, message, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, c, entry.id, entry.from, entry.canonicalJid, entry.text, JSON.stringify(entry.message), entry.timestamp);

    db.prepare(
      `DELETE FROM messages
       WHERE user_id = ? AND contact = ?
         AND id NOT IN (
           SELECT id FROM messages WHERE user_id = ? AND contact = ? ORDER BY id DESC LIMIT ?
         )`
    ).run(userId, c, userId, c, MAX_MESSAGES_PER_CONTACT);
  })();

  return entry;
}

// Enregistre la transcription d'un message vocal : elle devient aussi le "text"
// du message, pour que l'historique renvoyé au site soit directement lisible.
function setTranscription(userId, contact, msgId, transcription) {
  getDb()
    .prepare(
      `UPDATE messages SET transcription = ?, text = ?
       WHERE user_id = ? AND contact = ? AND msg_id = ?`
    )
    .run(transcription, transcription, userId, normalizeContact(contact), msgId);
}

// Adresse complète (@s.whatsapp.net ou @lid) la plus récente connue pour ce contact,
// d'après son historique. Permet à messageService.toJid de renvoyer un message au
// bon format sans que l'appelant (site/dashboard) ait besoin de connaître le type
// d'adresse actuellement valide pour ce contact.
function getLastCanonicalJid(userId, contact) {
  const row = getDb()
    .prepare(
      `SELECT canonical_jid FROM messages
       WHERE user_id = ? AND contact = ? AND canonical_jid IS NOT NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, normalizeContact(contact));
  return row ? row.canonical_jid : null;
}

function listContacts(userId) {
  return getDb()
    .prepare('SELECT DISTINCT contact FROM messages WHERE user_id = ? ORDER BY contact')
    .all(userId)
    .map((r) => r.contact);
}

function getMessages(userId, contact) {
  return getDb()
    .prepare('SELECT * FROM messages WHERE user_id = ? AND contact = ? ORDER BY id')
    .all(userId, normalizeContact(contact))
    .map(rowToEntry);
}

function getAllMessages(userId) {
  const result = {};
  const rows = getDb().prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY contact, id').all(userId);
  for (const row of rows) {
    (result[row.contact] ||= []).push(rowToEntry(row));
  }
  return result;
}

// Supprime, pour tous les utilisateurs, les messages plus vieux que maxAgeDays.
// Les messages sans timestamp exploitable sont conservés par prudence.
function purgeOldMessages(maxAgeDays = 7) {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 24 * 60 * 60; // timestamps WhatsApp en secondes
  const countContacts = () => db.prepare('SELECT COUNT(*) AS n FROM (SELECT DISTINCT user_id, contact FROM messages)').get().n;

  const contactsBefore = countContacts();
  const messagesDeleted = db
    .prepare('DELETE FROM messages WHERE timestamp IS NOT NULL AND timestamp > 0 AND timestamp < ?')
    .run(cutoff).changes;
  const usersProcessed = db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM messages').get().n;

  return {
    usersProcessed,
    filesDeleted: contactsBefore - countContacts(), // conversations devenues vides
    messagesDeleted,
  };
}

// Supprime tout l'historique de messages d'un utilisateur
function deleteUserMessages(userId) {
  getDb().prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
}

module.exports = {
  saveIncomingMessage,
  setTranscription,
  getLastCanonicalJid,
  listContacts,
  getMessages,
  getAllMessages,
  purgeOldMessages,
  deleteUserMessages,
  MAX_MESSAGES_PER_CONTACT,
};
