const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../middlewares/apiKeyAuth');
const { createAuthFailureLimiter } = require('../middlewares/rateLimit');
const sessionController = require('../controllers/sessionController');

router.use(createAuthFailureLimiter(), apiKeyAuth);
router.post('/start', sessionController.start);
router.get('/status', sessionController.status);
router.post('/logout', sessionController.logout);

module.exports = router;
