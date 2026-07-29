module.exports = function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ success: false, error: 'Clé admin invalide ou manquante (x-admin-key)' });
  }
  next();
};
