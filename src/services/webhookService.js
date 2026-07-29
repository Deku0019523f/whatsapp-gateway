const axios = require('axios');
const { getUserById } = require('../utils/store');

/**
 * Envoie un événement au webhook du site de l'utilisateur.
 * Chaque requête est authentifiée avec le header x-webhook-key,
 * pour que My Atelier vérifie que l'appel vient bien du gateway.
 */
async function sendWebhook(userId, event, data) {
  const user = getUserById(userId);
  if (!user || !user.webhookUrl) return;

  const payload = {
    event,
    userId,
    data,
    timestamp: Date.now(),
  };

  try {
    await axios.post(user.webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-key': user.webhookKey,
      },
      timeout: 8000,
    });
  } catch (err) {
    console.error(`[webhook] Échec envoi vers ${user.webhookUrl} pour ${userId}:`, err.message);
  }
}

module.exports = { sendWebhook };
