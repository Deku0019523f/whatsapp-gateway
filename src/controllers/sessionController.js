const sessionManager = require('../sessions/sessionManager');

// POST /session/start  { mode: 'qr'|'pairing', phoneNumber? }
async function start(req, res) {
  const { mode, phoneNumber } = req.body;
  if (mode === 'pairing' && !phoneNumber) {
    return res.status(400).json({ success: false, error: 'phoneNumber requis pour le mode pairing' });
  }
  try {
    const io = req.app.get('io');
    const result = await sessionManager.startSession(req.user.userId, io, { mode, phoneNumber });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
}

// GET /session/status
function status(req, res) {
  const result = sessionManager.getStatus(req.user.userId);
  res.json({ success: true, ...result });
}

// POST /session/logout
async function logout(req, res) {
  const result = await sessionManager.logoutSession(req.user.userId);
  res.json({ success: true, ...result });
}

module.exports = { start, status, logout };
