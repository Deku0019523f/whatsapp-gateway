const express = require('express');
const router = express.Router();
const adminAuth = require('../middlewares/adminAuth');
const { createAuthFailureLimiter } = require('../middlewares/rateLimit');
const userController = require('../controllers/userController');

router.use(createAuthFailureLimiter(), adminAuth);
router.post('/users', userController.createUser);
router.get('/users', userController.listUsers);
router.post('/users/:userId/regenerate-key', userController.regenerateApiKey);
router.put('/users/:userId/webhook', userController.updateWebhook);
router.delete('/users/:userId', userController.removeUser);

// Suivi des webhooks sortants (file d'attente, échecs, relance manuelle)
router.get('/webhooks', userController.listWebhookDeliveries);
router.post('/webhooks/:id/retry', userController.retryWebhookDelivery);

module.exports = router;
