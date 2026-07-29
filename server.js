require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');

const adminRoutes = require('./src/routes/adminRoutes');
const sessionRoutes = require('./src/routes/sessionRoutes');
const messageRoutes = require('./src/routes/messageRoutes');
const { purgeOldMessages } = require('./src/services/messageStoreService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.set('io', io);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Doc API statique
app.use('/doc-api', express.static(path.join(__dirname, 'public/doc-api')));

app.use('/admin', adminRoutes);
app.use('/session', sessionRoutes);
app.use('/message', messageRoutes);

app.get('/', (req, res) => {
  res.json({ success: true, service: 'whatsapp-gateway-atelier', doc: '/doc-api' });
});

// Un client (front My Atelier) rejoint la room de son userId pour recevoir
// ses events QR/connexion/etc en direct via websocket
io.on('connection', (socket) => {
  socket.on('join', (userId) => {
    if (userId) socket.join(userId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WhatsApp Gateway démarré sur le port ${PORT}`);
  console.log(`Documentation API : http://localhost:${PORT}/doc-api`);
});

// Purge des messages de plus de 7 jours : au démarrage, puis chaque jour
function runMessagePurge() {
  const stats = purgeOldMessages(7);
  console.log(
    `[purge] utilisateurs traités: ${stats.usersProcessed}, fichiers supprimés: ${stats.filesDeleted}, messages supprimés: ${stats.messagesDeleted}`
  );
}
runMessagePurge();
setInterval(runMessagePurge, 24 * 60 * 60 * 1000);
