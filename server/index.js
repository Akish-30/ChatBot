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
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 25 * 1024 * 1024, // 25 MB for attachments
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOADS_DIR));

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
    about: 'Always online! Message or call me to test features 💬',
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

// File & Image Upload Endpoint
app.post('/api/upload', (req, res) => {
  try {
    const { fileName, fileType, fileSize, dataUrl } = req.body;
    if (!dataUrl || !fileName) {
      return res.status(400).json({ error: 'Invalid file upload payload' });
    }

    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Malformed base64 data URL' });
    }

    const buffer = Buffer.from(matches[2], 'base64');
    const safeExt = path.extname(fileName).replace(/[^a-zA-Z0-9.]/g, '') || '';
    const baseName = path
      .basename(fileName, path.extname(fileName))
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const storedFileName = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}-${baseName}${safeExt}`;
    const filePath = path.join(UPLOADS_DIR, storedFileName);

    fs.writeFileSync(filePath, buffer);

    const isImage = Boolean(fileType && fileType.startsWith('image/'));
    return res.json({
      attachment: {
        url: `/uploads/${storedFileName}`,
        name: fileName,
        type: fileType || 'application/octet-stream',
        size: fileSize || buffer.length,
        isImage
      }
    });
  } catch (err) {
    console.error('File upload failed:', err);
    return res.status(500).json({ error: 'Failed to save uploaded file' });
  }
});

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

    const bot = db.users.find((u) => u.isBot);
    if (bot) {
      db.messages.push({
        id: `msg-${crypto.randomUUID()}`,
        senderId: bot.id,
        receiverId: user.id,
        text: `Hey ${user.username}! 👋 Welcome to ChatBox. You can send messages, share images/files (📎), or start a live Voice/Video call (📞 / 📹) with any online user!`,
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
  "You can also attach images & files with the paperclip button (📎) or test Voice & Video calls using the top-right buttons!",
  "I'm doing great! How is your day going?",
  "Got your message loud and clear! 🚀",
  "Everything here happens in real time over WebSockets & WebRTC!"
];

function triggerBotReply(botUser, humanUserId, incomingMsg) {
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

    emitToUser(humanUserId, 'typing:update', {
      senderId: botUser.id,
      isTyping: true
    });

    setTimeout(() => {
      emitToUser(humanUserId, 'typing:update', {
        senderId: botUser.id,
        isTyping: false
      });

      let replyText = BOT_REPLIES[Math.floor(Math.random() * BOT_REPLIES.length)];
      if (incomingMsg.attachment) {
        replyText = incomingMsg.attachment.isImage
          ? `Nice picture ("${incomingMsg.attachment.name}")! 📸 Image uploads work great!`
          : `Received your file "${incomingMsg.attachment.name}"! 📁`;
      } else if (incomingMsg.text) {
        const lower = incomingMsg.text.toLowerCase();
        if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
          replyText = `Hey there! 👋 Try sending me an image/file or starting a Voice/Video call!`;
        } else if (lower.includes('how are you')) {
          replyText = `I'm running at 100% uptime and feeling great! ⚡ How about you?`;
        }
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
    }, 1400);
  }, 450);
}

// Socket.io Real-time Messaging & WebRTC Call Signaling
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

  socket.on(
    'message:send',
    ({ tempId, senderId, receiverId, text, attachment, replyTo, isCallLog }, callback) => {
      if (!senderId || !receiverId) return;
      const cleanText = (text || '').trim();
      if (!cleanText && !attachment) return;

      const receiverOnline = isUserOnline(receiverId);
      const newMessage = {
        id: `msg-${crypto.randomUUID()}`,
        senderId,
        receiverId,
        text: cleanText,
        attachment: attachment || null,
        replyTo: replyTo || null,
        isCallLog: Boolean(isCallLog),
        timestamp: new Date().toISOString(),
        status: receiverOnline ? 'delivered' : 'sent'
      };

      db.messages.push(newMessage);
      saveDb(db);

      if (typeof callback === 'function') {
        callback({ tempId, message: newMessage });
      }
      emitToUser(senderId, 'message:sent_sync', { tempId, message: newMessage });
      emitToUser(receiverId, 'message:receive', newMessage);

      const receiverUser = db.users.find((u) => u.id === receiverId);
      if (receiverUser?.isBot && !isCallLog) {
        triggerBotReply(receiverUser, senderId, newMessage);
      }
    }
  );

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
      emitToUser(senderId, 'messages:status_update', {
        partnerId: readerId,
        messageIds: updatedIds,
        status: 'read'
      });
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

  // ---------------------------------------------------------------------------
  // WEBRTC VOICE & VIDEO CALL SIGNALING
  // ---------------------------------------------------------------------------
  socket.on('call:initiate', ({ callerId, callerName, callerAvatar, receiverId, callType, offer }) => {
    if (!callerId || !receiverId) return;

    const receiverUser = db.users.find((u) => u.id === receiverId);
    // If calling Maya (the demo bot), simulate answering after 1.5s so single-tab users can test calls
    if (receiverUser?.isBot) {
      setTimeout(() => {
        emitToUser(callerId, 'call:bot_accepted', {
          receiverId,
          callType
        });
      }, 1500);
      return;
    }

    if (!isUserOnline(receiverId)) {
      emitToUser(callerId, 'call:unavailable', {
        receiverId,
        reason: 'User is currently offline'
      });
      return;
    }

    emitToUser(receiverId, 'call:incoming', {
      callerId,
      callerName,
      callerAvatar,
      callType,
      offer
    });
  });

  socket.on('call:answer', ({ callerId, receiverId, answer }) => {
    if (!callerId) return;
    emitToUser(callerId, 'call:answered', {
      receiverId,
      answer
    });
  });

  socket.on('call:ice-candidate', ({ targetId, candidate }) => {
    if (!targetId || !candidate) return;
    emitToUser(targetId, 'call:ice-candidate', {
      candidate
    });
  });

  socket.on('call:reject', ({ callerId, receiverId }) => {
    if (!callerId) return;
    emitToUser(callerId, 'call:rejected', {
      receiverId
    });
  });

  socket.on('call:end', ({ targetId }) => {
    if (!targetId) return;
    emitToUser(targetId, 'call:ended', {});
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
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/socket.io') ||
      req.path.startsWith('/uploads')
    ) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`ChatBox Server running on http://localhost:${PORT}`);
});
