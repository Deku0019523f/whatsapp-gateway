const { getDb } = require('./db');

// Stockage des utilisateurs dans SQLite (table "users").
// L'API publique est identique à l'ancienne version JSON : getUsers, getUserById,
// getUserByApiKey, addUser, updateUser, deleteUser.

function rowToUser(row) {
  if (!row) return undefined;
  return {
    userId: row.user_id,
    apiKey: row.api_key,
    webhookUrl: row.webhook_url,
    webhookKey: row.webhook_key,
    createdAt: row.created_at,
  };
}

function getUsers() {
  return getDb().prepare('SELECT * FROM users ORDER BY created_at').all().map(rowToUser);
}

function getUserById(userId) {
  return rowToUser(getDb().prepare('SELECT * FROM users WHERE user_id = ?').get(userId));
}

function getUserByApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return undefined;
  return rowToUser(getDb().prepare('SELECT * FROM users WHERE api_key = ?').get(apiKey));
}

function addUser(user) {
  getDb()
    .prepare(
      `INSERT INTO users (user_id, api_key, webhook_url, webhook_key, created_at)
       VALUES (@userId, @apiKey, @webhookUrl, @webhookKey, @createdAt)`
    )
    .run({
      userId: user.userId,
      apiKey: user.apiKey,
      webhookUrl: user.webhookUrl || null,
      webhookKey: user.webhookKey,
      createdAt: user.createdAt || new Date().toISOString(),
    });
  return user;
}

const UPDATABLE = { apiKey: 'api_key', webhookUrl: 'webhook_url', webhookKey: 'webhook_key' };

function updateUser(userId, updates) {
  const current = getUserById(userId);
  if (!current) return null;

  const sets = [];
  const params = { userId };
  for (const [field, column] of Object.entries(UPDATABLE)) {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      sets.push(`${column} = @${field}`);
      params[field] = updates[field] === undefined ? null : updates[field];
    }
  }
  if (sets.length) {
    getDb().prepare(`UPDATE users SET ${sets.join(', ')} WHERE user_id = @userId`).run(params);
  }
  return getUserById(userId);
}

function deleteUser(userId) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM users WHERE user_id = ?').run(userId);
    db.prepare("DELETE FROM webhook_queue WHERE user_id = ? AND status = 'pending'").run(userId);
  })();
}

module.exports = {
  getUsers,
  getUserById,
  getUserByApiKey,
  addUser,
  updateUser,
  deleteUser,
};
