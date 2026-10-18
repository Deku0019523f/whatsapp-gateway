const rateLimit = require('express-rate-limit');

function jsonHandler(message) {
  return (req, res) => res.status(429).json({ success: false, error: message });
}

const common = { standardHeaders: 'draft-7', legacyHeaders: false };

// Plafond global par IP : filet de sécurité contre les abus, volontairement large
// pour ne pas gêner le site My Atelier (appels serveur-à-serveur depuis une seule IP).
const globalLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_MIN) || 600,
  handler: jsonHandler('Trop de requêtes, réessayez dans quelques instants'),
});

// Anti brute-force des clés : seules les requêtes refusées (401) comptent.
// Au-delà de 20 échecs en 15 min, l'IP est bloquée temporairement.
// Chaque groupe de routes (admin, session, message) a son propre compteur : des clés API
// erronées ne doivent pas bloquer l'accès admin depuis la même IP, et inversement.
function createAuthFailureLimiter() {
  return rateLimit({
    ...common,
    windowMs: 15 * 60 * 1000,
    limit: Number(process.env.AUTH_FAILURES_PER_15MIN) || 20,
    skipSuccessfulRequests: true,
    handler: jsonHandler('Trop de tentatives d\'authentification échouées, réessayez plus tard'),
  });
}

// Limite d'envoi de messages par utilisateur (à placer après apiKeyAuth) :
// protège aussi le numéro WhatsApp d'un envoi en rafale qui risquerait un bannissement.
const sendLimiter = rateLimit({
  ...common,
  windowMs: 60 * 1000,
  limit: Number(process.env.SEND_LIMIT_PER_MIN) || 60,
  keyGenerator: (req) => `user:${req.user.userId}`,
  handler: jsonHandler('Limite d\'envoi atteinte pour cet utilisateur, réessayez dans une minute'),
});

module.exports = { globalLimiter, createAuthFailureLimiter, sendLimiter };
