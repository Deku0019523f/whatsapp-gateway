const crypto = require('crypto');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../utils/db');
const { getUserById } = require('../utils/store');

/**
 * Webhooks sortants fiables :
 *  - chaque événement est d'abord écrit dans une file SQLite (table webhook_queue),
 *    donc rien n'est perdu si le site est down ou si le gateway redémarre ;
 *  - un worker réessaie avec un backoff exponentiel (5 s, 30 s, 2 min, 10 min, 1 h, 6 h...) ;
 *  - chaque requête est signée en HMAC-SHA256 (clé = webhookKey de l'utilisateur) ;
 *  - l'ancien header x-webhook-key reste envoyé par défaut (compatibilité), désactivable
 *    avec WEBHOOK_LEGACY_KEY_HEADER=false.
 *
 * Livraison "au moins une fois" : le site peut recevoir deux fois le même événement
 * (ex. crash après traitement, avant l'accusé). Il doit dédoublonner sur le header
 * x-webhook-id (ou le champ "id" du payload).
 */

const MAX_ATTEMPTS = Number(process.env.WEBHOOK_MAX_ATTEMPTS) || 8;
const REQUEST_TIMEOUT_MS = Number(process.env.WEBHOOK_TIMEOUT_MS) || 8000;
const MAX_CONCURRENT = 5;
const TICK_MS = 2000;
const SEND_LEGACY_KEY = String(process.env.WEBHOOK_LEGACY_KEY_HEADER || 'true').toLowerCase() !== 'false';

// Délais entre tentatives, en secondes (la dernière valeur est réutilisée ensuite).
// Modifiable via WEBHOOK_BACKOFF_SECONDS="5,30,120,600,3600,21600".
const BACKOFF_SECONDS = (process.env.WEBHOOK_BACKOFF_SECONDS || '5,30,120,600,3600,21600')
  .split(',')
  .map(Number)
  .filter((n) => Number.isFinite(n) && n >= 0);

// Événements périmés en quelques secondes (QR qui tourne, code de pairing) :
// inutile de les rejouer plus tard, une seule tentative.
const EPHEMERAL_EVENTS = new Set(['qr', 'pairing_code']);

// Un 4xx est une erreur définitive côté site (mauvaise URL, clé refusée...) : pas de retry,
// sauf 408 (timeout) et 429 (trop de requêtes).
function isRetryableStatus(status) {
  if (status >= 500) return true;
  return status === 408 || status === 429;
}

function sign(webhookKey, timestamp, body) {
  return crypto.createHmac('sha256', webhookKey).update(`${timestamp}.${body}`).digest('hex');
}

function backoffMs(attempts, retryAfterHeader) {
  const base = BACKOFF_SECONDS[Math.min(attempts - 1, BACKOFF_SECONDS.length - 1)] * 1000;
  const jitter = base * (0.9 + Math.random() * 0.2); // ±10 % pour éviter les rafales synchronisées
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(jitter, Math.min(retryAfter, 3600) * 1000);
  }
  return jitter;
}

/** Met un événement en file d'attente pour le webhook de l'utilisateur. */
function sendWebhook(userId, event, data) {
  try {
    const user = getUserById(userId);
    if (!user || !user.webhookUrl) return null;

    const id = uuidv4();
    const now = Date.now();
    const payload = JSON.stringify({ id, event, userId, data, timestamp: now });

    getDb()
      .prepare(
        `INSERT INTO webhook_queue (id, user_id, event, payload, status, attempts, max_attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
      )
      .run(id, userId, event, payload, EPHEMERAL_EVENTS.has(event) ? 1 : MAX_ATTEMPTS, now, now);

    setImmediate(tick); // envoi immédiat, sans attendre le prochain passage du worker
    return id;
  } catch (err) {
    // Ne jamais faire planter le traitement d'un message à cause d'un souci de file d'attente
    console.error(`[webhook] impossible de mettre ${event} en file pour ${userId} :`, err.message);
    return null;
  }
}

let inFlight = 0;
const busyRows = new Set();

async function deliver(row) {
  const db = getDb();
  const user = getUserById(row.user_id);
  const attempt = row.attempts + 1;

  const finish = (fields) => {
    db.prepare(
      `UPDATE webhook_queue SET status = @status, attempts = @attempts, next_attempt_at = @next,
         last_error = @error, last_status = @httpStatus, delivered_at = @deliveredAt
       WHERE id = @id`
    ).run({
      id: row.id,
      status: fields.status,
      attempts: attempt,
      next: fields.next ?? row.next_attempt_at,
      error: fields.error ?? null,
      httpStatus: fields.httpStatus ?? null,
      deliveredAt: fields.status === 'delivered' ? Date.now() : null,
    });
  };

  if (!user || !user.webhookUrl) {
    finish({ status: 'failed', error: 'Aucune URL de webhook configurée pour cet utilisateur' });
    return;
  }

  const timestamp = Date.now();
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'whatsapp-gateway-atelier/webhook',
    'x-webhook-id': row.id,
    'x-webhook-event': row.event,
    'x-webhook-attempt': String(attempt),
    'x-webhook-timestamp': String(timestamp),
    'x-webhook-signature': `sha256=${sign(user.webhookKey, timestamp, row.payload)}`,
  };
  if (SEND_LEGACY_KEY) headers['x-webhook-key'] = user.webhookKey;

  let httpStatus = null;
  let error = null;
  let retryAfter = null;

  try {
    const res = await axios.post(user.webhookUrl, row.payload, {
      headers,
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true, // on gère nous-mêmes les codes HTTP
      transformRequest: [(d) => d], // le corps est déjà la chaîne signée, ne pas le re-sérialiser
    });
    httpStatus = res.status;
    retryAfter = res.headers?.['retry-after'];
    if (res.status >= 200 && res.status < 300) {
      finish({ status: 'delivered', httpStatus });
      return;
    }
    error = `Réponse HTTP ${res.status}`;
  } catch (err) {
    error = err.code ? `${err.code}: ${err.message}` : err.message;
  }

  const retryable = httpStatus === null || isRetryableStatus(httpStatus);
  if (!retryable || attempt >= row.max_attempts) {
    console.error(`[webhook] abandon ${row.event} (${row.id}) pour ${row.user_id} après ${attempt} tentative(s) : ${error}`);
    finish({ status: 'failed', error, httpStatus });
    return;
  }
  finish({ status: 'pending', error, httpStatus, next: Date.now() + backoffMs(attempt, retryAfter) });
}

function tick() {
  if (inFlight >= MAX_CONCURRENT) return;
  let rows;
  try {
    rows = getDb()
      .prepare(
        `SELECT * FROM webhook_queue
         WHERE status = 'pending' AND next_attempt_at <= ?
         ORDER BY created_at, rowid LIMIT ?`
      )
      .all(Date.now(), MAX_CONCURRENT * 4);
  } catch (err) {
    return; // base fermée (arrêt en cours)
  }

  for (const row of rows) {
    if (inFlight >= MAX_CONCURRENT) break;
    if (busyRows.has(row.id)) continue;
    busyRows.add(row.id);
    inFlight += 1;
    deliver(row)
      .catch((err) => console.error('[webhook] erreur interne :', err.message))
      .finally(() => {
        busyRows.delete(row.id);
        inFlight -= 1;
      });
  }
}

// Ménage : on garde 3 jours les livraisons réussies, 14 jours les échecs (pour diagnostic)
function cleanupQueue() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const db = getDb();
  db.prepare("DELETE FROM webhook_queue WHERE status = 'delivered' AND delivered_at < ?").run(now - 3 * day);
  db.prepare("DELETE FROM webhook_queue WHERE status = 'failed' AND created_at < ?").run(now - 14 * day);
}

let timer = null;
let cleanupTimer = null;

function startWebhookWorker() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
  cleanupQueue();
  cleanupTimer = setInterval(cleanupQueue, 6 * 60 * 60 * 1000);
  cleanupTimer.unref();
  tick();
}

function stopWebhookWorker() {
  if (timer) clearInterval(timer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  timer = null;
  cleanupTimer = null;
}

/** Attend (max timeoutMs) la fin des envois en cours — utilisé à l'arrêt propre. */
async function drainWebhooks(timeoutMs = 5000) {
  const start = Date.now();
  while (inFlight > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

// --- Suivi côté admin -------------------------------------------------------

function listDeliveries({ status, userId, limit = 50 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (userId) {
    where.push('user_id = ?');
    params.push(userId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const deliveries = db
    .prepare(
      `SELECT id, user_id, event, status, attempts, max_attempts, next_attempt_at, last_error, last_status, created_at, delivered_at
       FROM webhook_queue ${clause} ORDER BY created_at DESC LIMIT ?`
    )
    .all(...params, Math.min(Math.max(Number(limit) || 50, 1), 200))
    .map((r) => ({
      id: r.id,
      userId: r.user_id,
      event: r.event,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      nextAttemptAt: r.status === 'pending' ? r.next_attempt_at : null,
      lastError: r.last_error,
      lastHttpStatus: r.last_status,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
    }));

  const counts = { pending: 0, delivered: 0, failed: 0 };
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM webhook_queue GROUP BY status').all()) {
    counts[r.status] = r.n;
  }
  return { counts, deliveries };
}

/** Remet une livraison échouée (ou en attente) en file pour un nouvel essai immédiat. */
function retryDelivery(id) {
  const info = getDb()
    .prepare(
      `UPDATE webhook_queue
       SET status = 'pending', attempts = 0, max_attempts = ?, next_attempt_at = ?, last_error = NULL
       WHERE id = ? AND status IN ('failed', 'pending')`
    )
    .run(MAX_ATTEMPTS, Date.now(), id);
  if (info.changes) setImmediate(tick);
  return info.changes > 0;
}

module.exports = {
  sendWebhook,
  startWebhookWorker,
  stopWebhookWorker,
  drainWebhooks,
  listDeliveries,
  retryDelivery,
  sign,
};
