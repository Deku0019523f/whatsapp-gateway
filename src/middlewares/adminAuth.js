const crypto = require('crypto');

// Comparaison en temps constant (on compare les empreintes SHA-256, qui ont toujours
// la même longueur) pour ne pas laisser fuiter la clé admin par mesure de temps.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  const expected = process.env.ADMIN_KEY;
  if (!expected || !key || !safeEqual(key, expected)) {
    return res.status(401).json({ success: false, error: 'Clé admin invalide ou manquante (x-admin-key)' });
  }
  next();
};
