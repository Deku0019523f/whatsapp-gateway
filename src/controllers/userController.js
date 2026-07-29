const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { addUser, getUsers, getUserById, updateUser, deleteUser } = require('../utils/store');

function genKey(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

// POST /admin/users  { webhookUrl }
function createUser(req, res) {
  const { webhookUrl } = req.body;
  const userId = uuidv4();
  const user = {
    userId,
    apiKey: genKey('key'),
    webhookUrl: webhookUrl || null,
    webhookKey: genKey('whk'),
    createdAt: new Date().toISOString(),
  };
  addUser(user);
  res.json({ success: true, user });
}

// GET /admin/users
function listUsers(req, res) {
  res.json({ success: true, users: getUsers() });
}

// POST /admin/users/:userId/regenerate-key
function regenerateApiKey(req, res) {
  const user = getUserById(req.params.userId);
  if (!user) return res.status(404).json({ success: false, error: 'Utilisateur introuvable' });
  const updated = updateUser(user.userId, { apiKey: genKey('key') });
  res.json({ success: true, user: updated });
}

// PUT /admin/users/:userId/webhook  { webhookUrl }
function updateWebhook(req, res) {
  const user = getUserById(req.params.userId);
  if (!user) return res.status(404).json({ success: false, error: 'Utilisateur introuvable' });
  const updated = updateUser(user.userId, { webhookUrl: req.body.webhookUrl });
  res.json({ success: true, user: updated });
}

// DELETE /admin/users/:userId
function removeUser(req, res) {
  deleteUser(req.params.userId);
  res.json({ success: true });
}

module.exports = { createUser, listUsers, regenerateApiKey, updateWebhook, removeUser };
