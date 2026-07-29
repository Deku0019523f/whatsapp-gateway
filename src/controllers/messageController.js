const { sendMessage } = require('../services/messageService');

// POST /message/send
// body (texte/lien): { to, type: 'text'|'link', text }
// form-data (fichier/image): { to, type: 'file'|'image', caption? } + fichier "media"
async function send(req, res) {
  try {
    const { to, type, text, caption } = req.body;
    if (!to || !type) {
      return res.status(400).json({ success: false, error: '"to" et "type" sont requis' });
    }

    let filePath, fileName, mimeType;
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
  }
}

module.exports = { send };
