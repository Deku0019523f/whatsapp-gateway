const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const messageController = require('../controllers/messageController');

const upload = multer({ dest: path.join(__dirname, '../../uploads') });

router.use(apiKeyAuth);
router.post('/send', upload.single('media'), messageController.send);

module.exports = router;
