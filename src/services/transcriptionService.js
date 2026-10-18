/**
 * Transcription automatique des messages vocaux (Groq Whisper).
 *
 * Activée dès que GROQ_API_KEY est définie (désactivable avec TRANSCRIPTION_ENABLED=false).
 * Variables d'environnement :
 *   GROQ_API_KEY            clé API Groq
 *   TRANSCRIPTION_MODEL     modèle (défaut : whisper-large-v3-turbo)
 *   TRANSCRIPTION_LANGUAGE  code langue ISO-639-1 pour guider la reconnaissance (ex. "fr") ;
 *                           vide = détection automatique
 *   TRANSCRIPTION_MAX_SECONDS  durée max d'un audio à transcrire (défaut : 300)
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MAX_FILE_BYTES = 24 * 1024 * 1024; // limite Groq : 25 Mo
const REQUEST_TIMEOUT_MS = 30000;
const MAX_CONCURRENT = 3;

function isTranscriptionEnabled() {
  if (!process.env.GROQ_API_KEY) return false;
  return String(process.env.TRANSCRIPTION_ENABLED || 'true').toLowerCase() !== 'false';
}

function maxSeconds() {
  return Number(process.env.TRANSCRIPTION_MAX_SECONDS) || 300;
}

/** Renvoie le sous-message audio (vocal ou fichier audio), ou null. */
function getAudioMessage(message) {
  return message?.audioMessage || null;
}

/** Vérifie que l'audio vaut la peine d'être transcrit (durée / taille raisonnables). */
function shouldTranscribe(audio) {
  if (!audio || !isTranscriptionEnabled()) return false;
  if (Number(audio.seconds) > maxSeconds()) return false;
  if (Number(audio.fileLength) > MAX_FILE_BYTES) return false;
  return true;
}

// Petit sémaphore pour ne pas envoyer trop de requêtes simultanées à Groq
let active = 0;
const waiting = [];
async function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); // le créneau est transmis directement au suivant
  else active -= 1;
}

/**
 * Transcrit un buffer audio. Renvoie le texte (chaîne vide si rien de reconnu).
 * Lève une erreur en cas d'échec réseau/API — à l'appelant de la rattraper.
 */
async function transcribeBuffer(buffer, { mimetype = 'audio/ogg' } = {}) {
  if (!buffer || !buffer.length) throw new Error('Audio vide');
  if (buffer.length > MAX_FILE_BYTES) throw new Error('Audio trop volumineux pour la transcription');

  const ext = mimetype.includes('mpeg') || mimetype.includes('mp3') ? 'mp3'
    : mimetype.includes('mp4') || mimetype.includes('m4a') || mimetype.includes('aac') ? 'm4a'
    : mimetype.includes('wav') ? 'wav'
    : mimetype.includes('webm') ? 'webm'
    : 'ogg';

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype.split(';')[0] }), `voice.${ext}`);
  form.append('model', process.env.TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (process.env.TRANSCRIPTION_LANGUAGE) form.append('language', process.env.TRANSCRIPTION_LANGUAGE);

  await acquire();
  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Groq HTTP ${res.status} ${detail}`);
    }
    const json = await res.json();
    return String(json.text || '').trim();
  } finally {
    release();
  }
}

module.exports = {
  isTranscriptionEnabled,
  getAudioMessage,
  shouldTranscribe,
  transcribeBuffer,
};
