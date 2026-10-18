const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { addUser, getUsers, getUserById, updateUser, deleteUser } = require('../utils/store');
const sessionManager = require('../sessions/sessionManager');
const { deleteUserMessages } = require('../services/messageStoreService');
const { listDeliveries, retryDelivery } = require('../services/webhookService');

function genKey(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

// Un webhook doit être une URL http(s) valide. Renvoie { ok, value } ; value = null si vide.
function parseWebhookUrl(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  try {
    const u = new URL(String(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false };
    return { ok: true, value: u.toString() };
  } catch (e) {
    return { ok: false };
  }
}

const INVALID_WEBHOOK = { success: false, error: 'webhookUrl invalide : une URL http(s) est requise' };

// POST /admin/users  { webhookUrl }
function createUser(req, res) {
  const parsed = parseWebhookUrl(req.body.webhookUrl);
  if (!parsed.ok) return res.status(400).json(INVALID_WEBHOOK);
  const userId = uuidv4();
  const user = {
    userId,
    apiKey: genKey('key'),
    webhookUrl: parsed.value,
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
  const parsed = parseWebhookUrl(req.body.webhookUrl);
  if (!parsed.ok) return res.status(400).json(INVALID_WEBHOOK);
  const updated = updateUser(user.userId, { webhookUrl: parsed.value });
  res.json({ success: true, user: updated });
}

// DELETE /admin/users/:userId
async function removeUser(req, res) {
  const { userId } = req.params;
  try {
    // Best-effort : pas grave si aucune session n'était active pour cet utilisateur
    await sessionManager.logoutSession(userId).catch(() => {});
    deleteUserMessages(userId);
    deleteUser(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /admin/webhooks?status=failed|pending|delivered&userId=...&limit=50
function listWebhookDeliveries(req, res) {
  const { status, userId, limit } = req.query;
  if (status && !['pending', 'delivered', 'failed'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status doit valoir pending, delivered ou failed' });
  }
  res.json({ success: true, ...listDeliveries({ status, userId, limit }) });
}

// POST /admin/webhooks/:id/retry -> remet une livraison échouée en file d'attente
function retryWebhookDelivery(req, res) {
  if (!retryDelivery(req.params.id)) {
    return res.status(404).json({ success: false, error: 'Livraison introuvable ou déjà livrée' });
  }
  res.json({ success: true });
}

module.exports = {
  createUser,
  listUsers,
  regenerateApiKey,
  updateWebhook,
  removeUser,
  listWebhookDeliveries,
  retryWebhookDelivery,
};
