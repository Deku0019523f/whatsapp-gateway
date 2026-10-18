const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '../../data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'gateway.db');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  user_id     TEXT PRIMARY KEY,
  api_key     TEXT NOT NULL UNIQUE,
  webhook_url TEXT,
  webhook_key TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  contact       TEXT NOT NULL,
  msg_id        TEXT,
  from_jid      TEXT,
  canonical_jid TEXT,
  text          TEXT,
  transcription TEXT,
  message       TEXT,
  timestamp     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages (user_id, contact, id);
CREATE INDEX IF NOT EXISTS idx_messages_msgid   ON messages (user_id, contact, msg_id);
CREATE INDEX IF NOT EXISTS idx_messages_ts      ON messages (timestamp);

CREATE TABLE IF NOT EXISTS webhook_queue (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  event           TEXT NOT NULL,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',   -- pending | delivered | failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  last_status     INTEGER,
  created_at      INTEGER NOT NULL,
  delivered_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_queue_due  ON webhook_queue (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_queue_user ON webhook_queue (user_id, status);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

function toNum(ts) {
  if (ts == null) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toNumber === 'function') return ts.toNumber(); // protobuf Long
  const n = Number(ts);
  return Number.isFinite(n) ? n : null;
}

// Import unique (au premier démarrage) de l'ancien stockage JSON :
//   data/users.json                      -> table users
//   data/messages/<userId>/<contact>.json -> table messages
// Les anciens fichiers ne sont pas supprimés, seulement renommés en *.migrated
// (ils restent donc récupérables en cas de souci).
function migrateLegacyJson(database) {
  const done = database.prepare("SELECT value FROM meta WHERE key = 'legacy_json_migrated'").get();
  if (done) return;

  const usersFile = path.join(DATA_DIR, 'users.json');
  const messagesDir = path.join(DATA_DIR, 'messages');
  const stats = { users: 0, messages: 0 };

  const insertUser = database.prepare(
    `INSERT OR IGNORE INTO users (user_id, api_key, webhook_url, webhook_key, created_at)
     VALUES (@userId, @apiKey, @webhookUrl, @webhookKey, @createdAt)`
  );
  const insertMessage = database.prepare(
    `INSERT INTO messages (user_id, contact, msg_id, from_jid, canonical_jid, text, transcription, message, timestamp)
     VALUES (@userId, @contact, @msgId, @from, @canonicalJid, @text, @transcription, @message, @timestamp)`
  );

  const run = database.transaction(() => {
    if (fs.existsSync(usersFile)) {
      try {
        const raw = fs.readFileSync(usersFile, 'utf-8');
        const parsed = raw.trim() ? JSON.parse(raw) : { users: [] };
        for (const u of parsed.users || []) {
          if (!u.userId || !u.apiKey || !u.webhookKey) continue;
          insertUser.run({
            userId: u.userId,
            apiKey: u.apiKey,
            webhookUrl: u.webhookUrl || null,
            webhookKey: u.webhookKey,
            createdAt: u.createdAt || new Date().toISOString(),
          });
          stats.users += 1;
        }
      } catch (err) {
        console.error('[migration] users.json illisible, ignoré :', err.message);
      }
    }

    if (fs.existsSync(messagesDir)) {
      for (const userId of fs.readdirSync(messagesDir)) {
        const userDir = path.join(messagesDir, userId);
        if (!fs.statSync(userDir).isDirectory()) continue;
        for (const file of fs.readdirSync(userDir)) {
          if (!file.endsWith('.json')) continue;
          const contact = file.replace(/\.json$/, '');
          let list;
          try {
            const raw = fs.readFileSync(path.join(userDir, file), 'utf-8');
            list = raw.trim() ? JSON.parse(raw) : [];
          } catch (err) {
            console.error(`[migration] ${userId}/${file} illisible, ignoré :`, err.message);
            continue;
          }
          for (const m of list) {
            insertMessage.run({
              userId,
              contact,
              msgId: m.id || null,
              from: m.from || null,
              canonicalJid: m.canonicalJid || null,
              text: m.text || null,
              transcription: m.transcription || null,
              message: JSON.stringify(m.message ?? null),
              timestamp: toNum(m.timestamp),
            });
            stats.messages += 1;
          }
        }
      }
    }

    database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('legacy_json_migrated', ?)").run(
      new Date().toISOString()
    );
  });
  run();

  // Renommage après le commit seulement : si la transaction échoue, rien n'est touché.
  if (fs.existsSync(usersFile)) fs.renameSync(usersFile, `${usersFile}.migrated`);
  if (fs.existsSync(messagesDir)) fs.renameSync(messagesDir, `${messagesDir}.migrated`);

  if (stats.users || stats.messages) {
    console.log(`[migration] JSON -> SQLite : ${stats.users} utilisateur(s), ${stats.messages} message(s) importés`);
  }
}

function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  migrateLegacyJson(db);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, toNum, DB_PATH };
