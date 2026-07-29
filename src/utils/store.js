const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/users.json');

function ensureDb() {
  if (!fs.existsSync(path.dirname(DB_PATH))) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ users: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function getUsers() {
  return readDb().users;
}

function getUserById(userId) {
  return readDb().users.find((u) => u.userId === userId);
}

function getUserByApiKey(apiKey) {
  return readDb().users.find((u) => u.apiKey === apiKey);
}

function addUser(user) {
  const db = readDb();
  db.users.push(user);
  writeDb(db);
  return user;
}

function updateUser(userId, updates) {
  const db = readDb();
  const idx = db.users.findIndex((u) => u.userId === userId);
  if (idx === -1) return null;
  db.users[idx] = { ...db.users[idx], ...updates };
  writeDb(db);
  return db.users[idx];
}

function deleteUser(userId) {
  const db = readDb();
  db.users = db.users.filter((u) => u.userId !== userId);
  writeDb(db);
}

module.exports = {
  getUsers,
  getUserById,
  getUserByApiKey,
  addUser,
  updateUser,
  deleteUser,
};
