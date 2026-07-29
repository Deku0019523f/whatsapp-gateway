const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const sessionController = require('../controllers/sessionController');

router.use(apiKeyAuth);
router.post('/start', sessionController.start);
router.get('/status', sessionController.status);
router.post('/logout', sessionController.logout);

module.exports = router;
