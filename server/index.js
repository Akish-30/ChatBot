import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 25 * 1024 * 1024,
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

app.use('/uploads', express.static(UPLOADS_DIR));

const DEFAULT_USERS = [
  {
    id: 'user-alex',
    username: 'Alex Rivera',
    identifier: 'alex@chatbox.app',
    contactType: 'email',
    avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Alex&backgroundColor=b6e3f4',
    about: 'Building cool things on the web 🚀',
    lastSeen: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString()
  },
  {
    id: 'user-priya',
    username: 'Priya Sharma',
    identifier: '+91 9876543210',
    contactType: 'phone',
    avatar: 'https://api.dicebear.com/9.x/avataaars/svg?seed=Priya&backgroundColor=ffdfbf',
    about: 'Coffee first, messages second ☕',
    lastSeen: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString()
  },
  {
    id: 'user-bot',
    username: 'Maya (Instant Reply)',
    identifier: 'maya@chatbox.app',
    contactType: 'email',
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

// In-memory OTP store: normalizedIdentifier -> { otp, expiresAt }
const otpStore = new Map();

// Optional real SMTP transporter if EMAIL_USER & EMAIL_PASS are set in environment
const mailTransporter =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      })
    : null;

function normalizeIdentifier(raw) {
  if (!raw) return { valid: false };
  const trimmed = String(raw).trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (emailRegex.test(trimmed)) {
    return {
      valid: true,
      type: 'email',
      normalized: trimmed.toLowerCase(),
      display: trimmed.toLowerCase()
    };
  }
  // Phone validation: allow +, spaces, dashes, 8 to 15 digits
  const digitsOnly = trimmed.replace(/[\s\-()]/g, '');
  const phoneRegex = /^\+?[0-9]{8,15}$/;
  if (phoneRegex.test(digitsOnly)) {
    return {
      valid: true,
      type: 'phone',
      normalized: digitsOnly,
      display: trimmed
    };
  }
  return { valid: false };
}

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

function isDeletedForUser(msg, userId) {
  return Array.isArray(msg.deletedFor) && msg.deletedFor.includes(userId);
}

function getVisibleMessagesBetween(userA, userB, viewerId) {
  return db.messages.filter(
    (m) =>
      ((m.senderId === userA && m.receiverId === userB) ||
        (m.senderId === userB && m.receiverId === userA)) &&
      !isDeletedForUser(m, viewerId)
  );
}

function getConversationSummaries(userId) {
  const summaries = {};
  for (const otherUser of db.users) {
    if (otherUser.id === userId) continue;
    const convoMessages = getVisibleMessagesBetween(userId, otherUser.id, userId);
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

// ---------------------------------------------------------------------------
// AUTH & OTP ENDPOINTS
// ---------------------------------------------------------------------------
app.post('/api/auth/send-otp', async (req, res) => {
  const { identifier } = req.body;
  const parsed = normalizeIdentifier(identifier);
  if (!parsed.valid) {
    return res.status(400).json({
      error: 'Please enter a valid Mobile Number (e.g. +91 9876543210) or Email Address (e.g. name@example.com).'
    });
  }

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  otpStore.set(parsed.normalized, {
    otp,
    expiresAt: Date.now() + 5 * 60 * 1000
  });

  const existingUser = db.users.find(
    (u) =>
      u.identifier &&
      normalizeIdentifier(u.identifier).normalized === parsed.normalized
  );

  let emailSentLive = false;
  if (parsed.type === 'email' && mailTransporter) {
    try {
      await mailTransporter.sendMail({
        from: `"ChatBox Security" <${process.env.EMAIL_USER}>`,
        to: parsed.display,
        subject: `Your ChatBox Verification Code: ${otp}`,
        html: `
          <div style="font-family: sans-serif; max-width: 460px; margin: 0 auto; padding: 24px; border-radius: 16px; background: #0f172a; color: #f8fafc;">
            <h2 style="color: #818cf8; margin-top: 0;">ChatBox Web Verification</h2>
            <p>Use the 6-digit OTP code below to sign in to your ChatBox account:</p>
            <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; padding: 16px; background: #1e293b; border-radius: 12px; text-align: center; color: #38bdf8; margin: 20px 0;">
              ${otp}
            </div>
            <p style="font-size: 13px; color: #94a3b8;">This code expires in 5 minutes.</p>
          </div>
        `
      });
      emailSentLive = true;
    } catch (err) {
      console.warn('SMTP email send failed, falling back to live notification OTP:', err.message);
    }
  }

  console.log(`[ChatBox OTP] Sent to ${parsed.display} (${parsed.type}): ${otp}`);

  return res.json({
    success: true,
    channel: parsed.type,
    target: parsed.display,
    emailSentLive,
    // Included so the live on-screen SMS/Email notification popup can display the real OTP immediately
    otpCode: otp,
    existingProfile: existingUser
      ? {
          username: existingUser.username,
          avatar: existingUser.avatar,
          about: existingUser.about
        }
      : null
  });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const { identifier, otp, username, avatar, about } = req.body;
  const parsed = normalizeIdentifier(identifier);
  if (!parsed.valid) {
    return res.status(400).json({ error: 'Invalid mobile number or email.' });
  }

  const record = otpStore.get(parsed.normalized);
  if (!record) {
    return res.status(400).json({ error: 'No OTP found. Please request a new OTP.' });
  }
  if (Date.now() > record.expiresAt) {
    otpStore.delete(parsed.normalized);
    return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
  }
  if (String(otp).trim() !== record.otp) {
    return res.status(400).json({ error: 'Invalid 6-digit OTP code. Please check and try again.' });
  }

  // OTP verified! Clear it from store
  otpStore.delete(parsed.normalized);

  let user = db.users.find(
    (u) =>
      u.identifier &&
      normalizeIdentifier(u.identifier).normalized === parsed.normalized
  );

  const cleanName = (username || '').trim();

  if (!user) {
    if (!cleanName) {
      return res.status(400).json({ error: 'Please provide a display name for your account.' });
    }
    user = {
      id: `user-${crypto.randomUUID().slice(0, 8)}`,
      username: cleanName,
      identifier: parsed.display,
      contactType: parsed.type,
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
        text: `Hey ${user.username}! 👋 Your ${parsed.type === 'email' ? 'email' : 'mobile number'} (${parsed.display}) is verified. You can chat, share files, make voice/video calls, or delete messages ("Delete for me" / "Delete for everyone")!`,
        timestamp: new Date().toISOString(),
        status: 'delivered'
      });
    }
  } else {
    if (cleanName) user.username = cleanName;
    if (avatar) user.avatar = avatar;
    if (about && about.trim()) user.about = about.trim();
    user.lastSeen = new Date().toISOString();
  }

  saveDb(db);
  io.emit('users:update', getEnrichedUsers());

  return res.json({
    user: { ...user, online: true },
    users: getEnrichedUsers(),
    summaries: getConversationSummaries(user.id)
  });
});

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

// Get visible messages between two users for userA
app.get('/api/messages/:userA/:userB', (req, res) => {
  const { userA, userB } = req.params;
  const history = getVisibleMessagesBetween(userA, userB, userA);
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
  "Try hovering over any message and clicking the trash icon (🗑️) to test 'Delete for me' vs 'Delete for everyone'!",
  "I'm doing great! How is your day going?",
  "Got your message loud and clear! 🚀",
  "Everything here happens in real time with live notifications!"
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
          replyText = `Hey there! 👋 Try sending me a message and deleting it with "Delete for everyone", or switch to another chat to see my live notification banner!`;
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

// Socket.io Real-time Messaging, Delete & WebRTC Call Signaling
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
        deletedFor: [],
        deletedForEveryone: false,
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

  // ---------------------------------------------------------------------------
  // MESSAGE DELETE: "DELETE FOR ME" OR "DELETE FOR EVERYONE"
  // ---------------------------------------------------------------------------
  socket.on('message:delete', ({ messageId, userId, partnerId, mode }) => {
    if (!messageId || !userId || !partnerId) return;
    const msg = db.messages.find((m) => m.id === messageId);
    if (!msg) return;

    if (mode === 'everyone') {
      msg.deletedForEveryone = true;
      msg.deletedBy = userId;
      msg.text = 'This message was deleted';
      msg.attachment = null;
      msg.replyTo = null;
      saveDb(db);

      emitToUser(userId, 'message:deleted_everyone', {
        messageId,
        partnerId,
        updatedMessage: msg
      });
      emitToUser(partnerId, 'message:deleted_everyone', {
        messageId,
        partnerId: userId,
        updatedMessage: msg
      });
    } else {
      // mode === 'me'
      if (!Array.isArray(msg.deletedFor)) {
        msg.deletedFor = [];
      }
      if (!msg.deletedFor.includes(userId)) {
        msg.deletedFor.push(userId);
      }
      saveDb(db);

      const remaining = getVisibleMessagesBetween(userId, partnerId, userId);
      const newLastMessage = remaining.length > 0 ? remaining[remaining.length - 1] : null;

      emitToUser(userId, 'message:deleted_me', {
        messageId,
        partnerId,
        newLastMessage
      });
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
