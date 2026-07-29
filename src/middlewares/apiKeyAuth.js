const { getUserByApiKey } = require('../utils/store');

module.exports = function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({ success: false, error: 'Clé API manquante (header x-api-key)' });
  }
  const user = getUserByApiKey(key);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Clé API invalide' });
  }
  req.user = user;
  next();
};
