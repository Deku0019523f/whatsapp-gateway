const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const messageController = require('../controllers/messageController');

const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument', 'text/plain', 'application/zip', 'video/', 'audio/'];

const upload = multer({
  dest: path.join(__dirname, '../../uploads'),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 Mo max
  fileFilter: (req, file, cb) => {
    const ok = ALLOWED_MIME_PREFIXES.some((p) => file.mimetype.startsWith(p));
    if (!ok) return cb(new Error(`Type de fichier non autorisé : ${file.mimetype}`));
    cb(null, true);
  },
});

router.use(apiKeyAuth);
router.post('/send', (req, res, next) => {
  upload.single('media')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    next();
  });
}, messageController.send);

router.get('/contacts', messageController.contacts);
router.get('/history', messageController.historyAll);
router.get('/history/:contact', messageController.historyByContact);

module.exports = router;
