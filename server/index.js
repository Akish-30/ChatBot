import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_USERS = [
  {
    id: 'user-alex',
    username: 'Alex Rivera',
    avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Alex&backgroundColor=b6e3f4',
    about: 'Building cool things on the web 🚀',
    lastSeen: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  },
  {
    id: 'user-priya',
    username: 'Priya Sharma',
    avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Priya&backgroundColor=ffdfbf',
    about: 'Coffee first, messages second ☕',
    lastSeen: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString()
  },
  {
    id: 'user-bot',
    username: 'Maya (Instant Reply)',
    avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Maya&backgroundColor=c0aede',
    about: 'Always online! Message me to test blue ticks & typing indicators 💬',
    lastSeen: new Date().toISOString(),
    isBot: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString()
  }
];

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        users: Array.isArray(parsed.users) ? parsed.users : DEFAULT_USERS,
        messages: Array.isArray(parsed.messages) ? parsed.messages : []
      };
    }
  } catch (err) {
    console.error('Error loading DB, initializing fresh:', err);
  }
  const initial = { users: DEFAULT_USERS, messages: [] };
  saveDb(initial);
  return initial;
}

function saveDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving DB:', err);
  }
}

const db = loadDb();

// Map of userId -> Set of socketIds
const onlineUserSockets = new Map();

function isUserOnline(userId) {
  const user = db.users.find((u) => u.id === userId);
  if (user?.isBot) return true;
  const sockets = onlineUserSockets.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

function getEnrichedUsers() {
  return db.users.map((u) => ({
    ...u,
    online: isUserOnline(u.id)
  }));
}

function emitToUser(userId, event, payload) {
  const sockets = onlineUserSockets.get(userId);
  if (sockets) {
    for (const socketId of sockets) {
      io.to(socketId).emit(event, payload);
    }
  }
}

function getConversationSummaries(userId) {
  const summaries = {};
  for (const otherUser of db.users) {
    if (otherUser.id === userId) continue;
    const convoMessages = db.messages.filter(
      (m) =>
        (m.senderId === userId && m.receiverId === otherUser.id) ||
        (m.senderId === otherUser.id && m.receiverId === userId)
    );
    const lastMessage = convoMessages.length > 0 ? convoMessages[convoMessages.length - 1] : null;
    const unreadCount = convoMessages.filter(
      (m) => m.senderId === otherUser.id && m.receiverId === userId && m.status !== 'read'
    ).length;

    summaries[otherUser.id] = {
      lastMessage,
      unreadCount
    };
  }
  return summaries;
}

// REST Endpoints

// Login or register by username
app.post('/api/login', (req, res) => {
  const { username, avatar, about } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const cleanName = username.trim();
  let user = db.users.find(
    (u) => u.username.toLowerCase() === cleanName.toLowerCase()
  );

  if (!user) {
    user = {
      id: `user-${crypto.randomUUID().slice(0, 8)}`,
      username: cleanName,
      avatar:
        avatar ||
        `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(cleanName)}&backgroundColor=b6e3f4`,
      about: about?.trim() || 'Hey there! I am using ChatBox.',
      lastSeen: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    db.users.push(user);

    // Seed a friendly welcome message from Maya so new users immediately see how chats look
    const bot = db.users.find((u) => u.isBot);
    if (bot) {
      db.messages.push({
        id: `msg-${crypto.randomUUID()}`,
        senderId: bot.id,
        receiverId: user.id,
        text: `Hey ${user.username}! 👋 Welcome to ChatBox. You can chat with me here to test typing indicators and blue read ticks, or open another browser tab and sign in with a second username to chat person-to-person in real time!`,
        timestamp: new Date().toISOString(),
        status: 'delivered'
      });
    }

    saveDb(db);
    io.emit('users:update', getEnrichedUsers());
  } else {
    if (avatar) user.avatar = avatar;
    if (about && about.trim()) user.about = about.trim();
    user.lastSeen = new Date().toISOString();
    saveDb(db);
    io.emit('users:update', getEnrichedUsers());
  }

  return res.json({
    user: { ...user, online: true },
    users: getEnrichedUsers(),
    summaries: getConversationSummaries(user.id)
  });
});

// Update user profile (about / avatar)
app.post('/api/profile', (req, res) => {
  const { userId, about, avatar } = req.body;
  const user = db.users.find((u) => u.id === userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (typeof about === 'string') user.about = about.trim() || user.about;
  if (typeof avatar === 'string' && avatar.trim()) user.avatar = avatar.trim();
  saveDb(db);

  const enriched = getEnrichedUsers();
  io.emit('users:update', enriched);
  res.json({ user: enriched.find((u) => u.id === userId) });
});

// Get all users and conversation summaries for a user
app.get('/api/users', (req, res) => {
  const { userId } = req.query;
  res.json({
    users: getEnrichedUsers(),
    summaries: userId ? getConversationSummaries(String(userId)) : {}
  });
});

// Get messages between two users
app.get('/api/messages/:userA/:userB', (req, res) => {
  const { userA, userB } = req.params;
  const history = db.messages.filter(
    (m) =>
      (m.senderId === userA && m.receiverId === userB) ||
      (m.senderId === userB && m.receiverId === userA)
  );
  res.json({ messages: history });
});

// Clear conversation between two users
app.delete('/api/messages/:userA/:userB', (req, res) => {
  const { userA, userB } = req.params;
  db.messages = db.messages.filter(
    (m) =>
      !(
        (m.senderId === userA && m.receiverId === userB) ||
        (m.senderId === userB && m.receiverId === userA)
      )
  );
  saveDb(db);
  emitToUser(userA, 'conversation:cleared', { partnerId: userB });
  emitToUser(userB, 'conversation:cleared', { partnerId: userA });
  res.json({ success: true });
});

// Smart auto-replies for Maya (the optional test bot)
const BOT_REPLIES = [
  "That's awesome! Notice how my message ticks turned blue when you opened this chat? ✓✓",
  "Everything here happens in real time over WebSockets (Socket.io)! Try opening a second browser tab with another username to chat person-to-person.",
  "I'm doing great! How is your day going?",
  "Got your message loud and clear! 🚀",
  "WhatsApp-style chatting without any bloat — fast, clean, and instant!"
];

function triggerBotReply(botUser, humanUserId, incomingText) {
  // 1. After 600ms, mark user's message as read (blue ticks)
  setTimeout(() => {
    const updatedIds = [];
    for (const msg of db.messages) {
      if (msg.senderId === humanUserId && msg.receiverId === botUser.id && msg.status !== 'read') {
        msg.status = 'read';
        updatedIds.push(msg.id);
      }
    }
    if (updatedIds.length > 0) {
      saveDb(db);
      emitToUser(humanUserId, 'messages:status_update', {
        partnerId: botUser.id,
        messageIds: updatedIds,
        status: 'read'
      });
    }

    // 2. Start typing indicator
    emitToUser(humanUserId, 'typing:update', {
      senderId: botUser.id,
      isTyping: true
    });

    // 3. Send reply after 1.5s of typing
    setTimeout(() => {
      emitToUser(humanUserId, 'typing:update', {
        senderId: botUser.id,
        isTyping: false
      });

      const lower = incomingText.toLowerCase();
      let replyText = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
      if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
        replyText = `Hey there! 👋 Great to chat with you. How can I help you test ChatBox today?`;
      } else if (lower.includes('how are you')) {
        replyText = `I'm running at 100% uptime and feeling great! ⚡ How about you?`;
      }

      const recipientOnline = isUserOnline(humanUserId);
      const botMsg = {
        id: `msg-${crypto.randomUUID()}`,
        senderId: botUser.id,
        receiverId: humanUserId,
        text: replyText,
        timestamp: new Date().toISOString(),
        status: recipientOnline ? 'delivered' : 'sent'
      };

      db.messages.push(botMsg);
      saveDb(db);

      emitToUser(humanUserId, 'message:receive', botMsg);
    }, 1500);
  }, 500);
}

// Socket.io Real-time Handling
io.on('connection', (socket) => {
  let currentUserId = null;

  socket.on('user:online', ({ userId }) => {
    if (!userId) return;
    currentUserId = userId;

    if (!onlineUserSockets.has(userId)) {
      onlineUserSockets.set(userId, new Set());
    }
    onlineUserSockets.get(userId).add(socket.id);

    const user = db.users.find((u) => u.id === userId);
    if (user) {
      user.lastSeen = new Date().toISOString();
    }

    // Upgrade any 'sent' messages addressed to this user to 'delivered'
    const senderBuckets = new Map();
    for (const msg of db.messages) {
      if (msg.receiverId === userId && msg.status === 'sent') {
        msg.status = 'delivered';
        if (!senderBuckets.has(msg.senderId)) {
          senderBuckets.set(msg.senderId, []);
        }
        senderBuckets.get(msg.senderId).push(msg.id);
      }
    }

    if (senderBuckets.size > 0) {
      saveDb(db);
      for (const [senderId, messageIds] of senderBuckets.entries()) {
        emitToUser(senderId, 'messages:status_update', {
          partnerId: userId,
          messageIds,
          status: 'delivered'
        });
      }
    }

    io.emit('users:update', getEnrichedUsers());
  });

  socket.on('message:send', ({ tempId, senderId, receiverId, text, replyTo }, callback) => {
    if (!senderId || !receiverId || !text || !text.trim()) return;

    const receiverOnline = isUserOnline(receiverId);
    const newMessage = {
      id: `msg-${crypto.randomUUID()}`,
      senderId,
      receiverId,
      text: text.trim(),
      replyTo: replyTo || null,
      timestamp: new Date().toISOString(),
      status: receiverOnline ? 'delivered' : 'sent'
    };

    db.messages.push(newMessage);
    saveDb(db);

    // Acknowledge to sender
    if (typeof callback === 'function') {
      callback({ tempId, message: newMessage });
    }
    // Also broadcast to any other open tabs of the sender
    emitToUser(senderId, 'message:sent_sync', { tempId, message: newMessage });

    // Deliver to receiver in real time
    emitToUser(receiverId, 'message:receive', newMessage);

    // Check if receiver is the instant-reply bot
    const receiverUser = db.users.find((u) => u.id === receiverId);
    if (receiverUser?.isBot) {
      triggerBotReply(receiverUser, senderId, newMessage.text);
    }
  });

  socket.on('message:read', ({ readerId, senderId }) => {
    if (!readerId || !senderId) return;

    const updatedIds = [];
    for (const msg of db.messages) {
      if (msg.senderId === senderId && msg.receiverId === readerId && msg.status !== 'read') {
        msg.status = 'read';
        updatedIds.push(msg.id);
      }
    }

    if (updatedIds.length > 0) {
      saveDb(db);
      // Notify the sender so their ticks turn blue immediately
      emitToUser(senderId, 'messages:status_update', {
        partnerId: readerId,
        messageIds: updatedIds,
        status: 'read'
      });
      // Sync read state across reader's own tabs
      emitToUser(readerId, 'messages:read_sync', {
        partnerId: senderId,
        messageIds: updatedIds
      });
    }
  });

  socket.on('typing:start', ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;
    emitToUser(receiverId, 'typing:update', {
      senderId,
      isTyping: true
    });
  });

  socket.on('typing:stop', ({ senderId, receiverId }) => {
    if (!senderId || !receiverId) return;
    emitToUser(receiverId, 'typing:update', {
      senderId,
      isTyping: false
    });
  });

  socket.on('disconnect', () => {
    if (currentUserId && onlineUserSockets.has(currentUserId)) {
      const userSet = onlineUserSockets.get(currentUserId);
      userSet.delete(socket.id);
      if (userSet.size === 0) {
        onlineUserSockets.delete(currentUserId);
        const user = db.users.find((u) => u.id === currentUserId);
        if (user) {
          user.lastSeen = new Date().toISOString();
          saveDb(db);
        }
        io.emit('users:update', getEnrichedUsers());
      }
    }
  });
});

// Serve built React frontend in production / single-port mode
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ChatBox Server running on http://localhost:${PORT}`);
});

