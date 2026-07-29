const fs = require('fs');
const { sendMessage } = require('../services/messageService');
const { listContacts, getMessages, getAllMessages } = require('../services/messageStoreService');

// POST /message/send
// body (texte/lien): { to, type: 'text'|'link', text }
// form-data (fichier/image): { to, type: 'file'|'image', caption? } + fichier "media"
async function send(req, res) {
  let filePath, fileName, mimeType;
  try {
    const { to, type, text, caption } = req.body;
    if (!to || !type) {
      return res.status(400).json({ success: false, error: '"to" et "type" sont requis' });
    }

    if (req.file) {
      filePath = req.file.path;
      fileName = req.file.originalname;
      mimeType = req.file.mimetype;
    }

    if ((type === 'file' || type === 'image') && !filePath) {
      return res.status(400).json({ success: false, error: 'Fichier manquant (champ "media")' });
    }
    if ((type === 'text' || type === 'link') && !text) {
      return res.status(400).json({ success: false, error: '"text" est requis pour ce type' });
    }

    const result = await sendMessage(req.user.userId, {
      to,
      type,
      text,
      caption,
      filePath,
      fileName,
      mimeType,
    });

    res.json({ success: true, messageId: result?.key?.id || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    // Toujours nettoyer le fichier temporaire uploadé (succès ou échec)
    if (filePath) {
      fs.unlink(filePath, () => {});
    }
  }
}

// GET /message/contacts -> liste des numéros ayant déjà écrit
function contacts(req, res) {
  res.json({ success: true, contacts: listContacts(req.user.userId) });
}

// GET /message/history/:contact -> tous les messages reçus d'un contact précis
function historyByContact(req, res) {
  const { contact } = req.params;
  res.json({ success: true, contact, messages: getMessages(req.user.userId, contact) });
}

// GET /message/history -> toutes les conversations regroupées par contact
function historyAll(req, res) {
  res.json({ success: true, conversations: getAllMessages(req.user.userId) });
}

module.exports = { send, contacts, historyByContact, historyAll };
