const express = require('express');
const router = express.Router();
const adminAuth = require('../middlewares/adminAuth');
const userController = require('../controllers/userController');

router.use(adminAuth);
router.post('/users', userController.createUser);
router.get('/users', userController.listUsers);
router.post('/users/:userId/regenerate-key', userController.regenerateApiKey);
router.put('/users/:userId/webhook', userController.updateWebhook);
router.delete('/users/:userId', userController.removeUser);

module.exports = router;
