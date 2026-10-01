import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
  MessageStatusTicks,
  SearchIcon,
  SendIcon,
  EmojiIcon,
  PaperclipIcon,
  FileIcon,
  DownloadIcon,
  PhoneIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
  MicIcon,
  MicOffIcon,
  InfoIcon,
  TrashIcon,
  LogoutIcon,
  SunIcon,
  MoonIcon,
  CloseIcon,
  LockIcon,
  ChatBubbleLogo
} from './components/Icons.jsx';

const SOCKET_URL = window.location.origin;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const AVATAR_PRESETS = [
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Felix&backgroundColor=b6e3f4',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Aneka&backgroundColor=ffdfbf',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Liam&backgroundColor=c0aede',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Sophia&backgroundColor=d1d4f9',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Zoe&backgroundColor=ffd5dc',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Noah&backgroundColor=b6f4d1',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Aria&backgroundColor=f4e8b6',
  'https://api.dicebear.com/9.x/avataaars/svg?seed=Leo&backgroundColor=f4c6b6'
];

const QUICK_EMOJIS = [
  '😀', '😂', '🥹', '😍', '🤩', '😎', '🤝', '👍',
  '🙏', '🔥', '❤️', '✨', '🎉', '🚀', '💯', '☕',
  '🤔', '🙌', '🥳', '👋', '💬', '⚡', '🌟', '✅'
];

// Gentle Web Audio API chime for live notifications & OTP arrival
function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.14); // A5
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);
  } catch {
    // Ignore audio context restrictions if user hasn't interacted yet
  }
}

function triggerDesktopNotification(title, body, icon) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon });
    }
  } catch {
    // Ignore unsupported environments
  }
}

function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatSidebarDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatDateDivider(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'TODAY';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return date
    .toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

function formatLastSeen(isoString) {
  if (!isoString) return 'offline';
  const date = new Date(isoString);
  const now = new Date();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) {
    return `last seen today at ${timeStr}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `last seen yesterday at ${timeStr}`;
  }
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `last seen ${dateStr} at ${timeStr}`;
}

function formatFileSize(bytes) {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function formatCallDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('chatbox_theme') || 'dark');

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('chatbox_active_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Login & OTP Verification State
  const [loginStep, setLoginStep] = useState('credentials'); // 'credentials' | 'otp'
  const [identifierInput, setIdentifierInput] = useState(''); // Email or Mobile number
  const [usernameInput, setUsernameInput] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_PRESETS[0]);
  const [aboutInput, setAboutInput] = useState('Hey there! I am using ChatBox.');
  const [otpInput, setOtpInput] = useState('');
  const [otpNotification, setOtpNotification] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Real Email (Gmail SMTP) & SMS (Fast2SMS / Twilio) Gateway Modal State
  const [showGatewayModal, setShowGatewayModal] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState({ emailConfigured: false, smsConfigured: false });
  const [emailUserDraft, setEmailUserDraft] = useState('');
  const [emailPassDraft, setEmailPassDraft] = useState('');
  const [fast2smsKeyDraft, setFast2smsKeyDraft] = useState('');
  const [gatewaySaveMsg, setGatewaySaveMsg] = useState('');

  // Chat State
  const [users, setUsers] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [typingUsers, setTypingUsers] = useState({});
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState('all');
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileAboutDraft, setProfileAboutDraft] = useState('');

  // Live Incoming Message Notification Popup
  const [liveNotification, setLiveNotification] = useState(null); // { id, senderId, senderName, senderAvatar, text }

  // Delete Message Modal State ("Delete for me" vs "Delete for everyone")
  const [deleteModalMsg, setDeleteModalMsg] = useState(null);

  // File & Image Upload State
  const [pendingFile, setPendingFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);

  // Voice & Video Call State
  const [callState, setCallState] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callToast, setCallToast] = useState('');

  const socketRef = useRef(null);
  const selectedContactIdRef = useRef(selectedContactId);
  const currentUserRef = useRef(currentUser);
  const usersRef = useRef(users);
  const callStateRef = useRef(callState);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingEmittedRef = useRef(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const liveNotifTimeoutRef = useRef(null);

  // WebRTC Refs
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pendingCandidatesRef = useRef([]);

  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chatbox_theme', theme);
  }, [theme]);

  // Request Browser Desktop Notification permission on login
  useEffect(() => {
    if (currentUser && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [currentUser]);

  // Call duration timer
  useEffect(() => {
    if (callState?.status !== 'connected') {
      setCallDuration(0);
      return;
    }
    const interval = setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [callState?.status]);

  // Attach streams to video/audio elements whenever call overlay renders
  useEffect(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }
  }, [callState]);

  const showToast = (msg) => {
    setCallToast(msg);
    setTimeout(() => setCallToast(''), 3500);
  };

  const showLiveMessageBanner = (incomingMsg) => {
    const sender = usersRef.current.find((u) => u.id === incomingMsg.senderId);
    const senderName = sender?.username || 'New Message';
    const senderAvatar =
      sender?.avatar ||
      `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(senderName)}`;
    const preview =
      incomingMsg.text ||
      (incomingMsg.attachment
        ? incomingMsg.attachment.isImage
          ? `📷 Sent a photo (${incomingMsg.attachment.name})`
          : `📎 Sent a file (${incomingMsg.attachment.name})`
        : 'New message');

    playNotificationChime();
    triggerDesktopNotification(senderName, preview, senderAvatar);

    if (liveNotifTimeoutRef.current) clearTimeout(liveNotifTimeoutRef.current);
    setLiveNotification({
      id: incomingMsg.id,
      senderId: incomingMsg.senderId,
      senderName,
      senderAvatar,
      text: preview
    });
    liveNotifTimeoutRef.current = setTimeout(() => {
      setLiveNotification(null);
    }, 5000);
  };

  const cleanupCallMedia = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    pendingCandidatesRef.current = [];
    setIsMuted(false);
    setIsCameraOff(false);
    setCallState(null);
  };

  // Fetch initial users list & gateway status
  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => {
        if (data.users) setUsers(data.users);
      })
      .catch(() => {});

    fetch('/api/auth/gateway-status')
      .then((r) => r.json())
      .then((status) => {
        setGatewayStatus(status);
        if (status.emailUser) setEmailUserDraft(status.emailUser);
      })
      .catch(() => {});
  }, []);

  // Connect Socket.io when logged in
  useEffect(() => {
    if (!currentUser) return;

    const socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('user:online', { userId: currentUser.id });
      fetch(`/api/users?userId=${encodeURIComponent(currentUser.id)}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.users) setUsers(data.users);
          if (data.summaries) setSummaries(data.summaries);
        })
        .catch(() => {});
    });

    socket.on('users:update', (updatedUsers) => {
      setUsers(updatedUsers);
      const updatedSelf = updatedUsers.find((u) => u.id === currentUser.id);
      if (updatedSelf) {
        setCurrentUser(updatedSelf);
        sessionStorage.setItem('chatbox_active_user', JSON.stringify(updatedSelf));
      }
    });

    socket.on('message:receive', (incomingMsg) => {
      const activePartnerId = selectedContactIdRef.current;
      const myUser = currentUserRef.current;
      const isFromActiveChat = activePartnerId === incomingMsg.senderId;

      // Always show live notification banner & play chime on incoming messages!
      showLiveMessageBanner(incomingMsg);

      if (isFromActiveChat) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === incomingMsg.id)) return prev;
          return [...prev, { ...incomingMsg, status: 'read' }];
        });
        socket.emit('message:read', {
          readerId: myUser.id,
          senderId: incomingMsg.senderId
        });
      }

      setSummaries((prev) => {
        const existing = prev[incomingMsg.senderId] || { unreadCount: 0 };
        return {
          ...prev,
          [incomingMsg.senderId]: {
            lastMessage: isFromActiveChat ? { ...incomingMsg, status: 'read' } : incomingMsg,
            unreadCount: isFromActiveChat ? 0 : (existing.unreadCount || 0) + 1
          }
        };
      });
    });

    socket.on('message:sent_sync', ({ tempId, message }) => {
      const activePartnerId = selectedContactIdRef.current;
      if (activePartnerId === message.receiverId) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === message.id || (tempId && m.id === tempId));
          if (exists) {
            return prev.map((m) => (m.id === tempId || m.id === message.id ? message : m));
          }
          return [...prev, message];
        });
      }
      setSummaries((prev) => ({
        ...prev,
        [message.receiverId]: {
          ...(prev[message.receiverId] || { unreadCount: 0 }),
          lastMessage: message
        }
      }));
    });

    // Real-time Delete for Everyone update
    socket.on('message:deleted_everyone', ({ messageId, partnerId, updatedMessage }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? updatedMessage : m))
      );
      setSummaries((prev) => {
        const current = prev[partnerId];
        if (!current?.lastMessage || current.lastMessage.id !== messageId) return prev;
        return {
          ...prev,
          [partnerId]: {
            ...current,
            lastMessage: updatedMessage
          }
        };
      });
    });

    // Real-time Delete for Me update
    socket.on('message:deleted_me', ({ messageId, partnerId, newLastMessage }) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setSummaries((prev) => ({
        ...prev,
        [partnerId]: {
          ...(prev[partnerId] || { unreadCount: 0 }),
          lastMessage: newLastMessage
        }
      }));
    });

    socket.on('messages:status_update', ({ partnerId, messageIds, status }) => {
      const idSet = new Set(messageIds);
      setMessages((prev) =>
        prev.map((m) => (idSet.has(m.id) ? { ...m, status } : m))
      );

      setSummaries((prev) => {
        const partnerSummary = prev[partnerId];
        if (!partnerSummary?.lastMessage) return prev;
        if (idSet.has(partnerSummary.lastMessage.id)) {
          return {
            ...prev,
            [partnerId]: {
              ...partnerSummary,
              lastMessage: { ...partnerSummary.lastMessage, status }
            }
          };
        }
        return prev;
      });
    });

    socket.on('messages:read_sync', ({ partnerId }) => {
      setSummaries((prev) => ({
        ...prev,
        [partnerId]: {
          ...(prev[partnerId] || {}),
          unreadCount: 0
        }
      }));
    });

    socket.on('typing:update', ({ senderId, isTyping }) => {
      setTypingUsers((prev) => ({
        ...prev,
        [senderId]: isTyping
      }));
    });

    socket.on('conversation:cleared', ({ partnerId }) => {
      if (selectedContactIdRef.current === partnerId) {
        setMessages([]);
      }
      setSummaries((prev) => ({
        ...prev,
        [partnerId]: { lastMessage: null, unreadCount: 0 }
      }));
    });

    // WEBRTC CALL SIGNALING LISTENERS
    socket.on('call:incoming', ({ callerId, callerName, callerAvatar, callType, offer }) => {
      if (callStateRef.current) {
        socket.emit('call:reject', { callerId, receiverId: currentUser.id });
        return;
      }
      playNotificationChime();
      triggerDesktopNotification(
        `Incoming ${callType === 'video' ? 'Video' : 'Voice'} Call`,
        `${callerName} is calling you...`,
        callerAvatar
      );
      setCallState({
        status: 'incoming',
        callType: callType || 'voice',
        partnerId: callerId,
        partnerName: callerName,
        partnerAvatar: callerAvatar,
        offer
      });
    });

    socket.on('call:answered', async ({ answer }) => {
      try {
        const pc = peerConnectionRef.current;
        if (pc && answer) {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          for (const cand of pendingCandidatesRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingCandidatesRef.current = [];
        }
        setCallState((prev) => (prev ? { ...prev, status: 'connected' } : null));
      } catch (err) {
        console.error('Error setting remote answer:', err);
      }
    });

    socket.on('call:bot_accepted', () => {
      setCallState((prev) => (prev ? { ...prev, status: 'connected' } : null));
    });

    socket.on('call:ice-candidate', async ({ candidate }) => {
      if (!candidate) return;
      const pc = peerConnectionRef.current;
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });

    socket.on('call:rejected', () => {
      showToast('Call was declined');
      cleanupCallMedia();
    });

    socket.on('call:unavailable', ({ reason }) => {
      showToast(reason || 'User is unavailable');
      cleanupCallMedia();
    });

    socket.on('call:ended', () => {
      showToast('Call ended');
      cleanupCallMedia();
    });

    return () => {
      cleanupCallMedia();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [currentUser?.id]);

  // Load conversation messages when a contact is selected
  useEffect(() => {
    if (!currentUser || !selectedContactId) return;

    setChatSearchOpen(false);
    setChatSearchQuery('');
    setReplyingTo(null);
    setShowEmojiPicker(false);
    setPendingFile(null);

    fetch(`/api/messages/${encodeURIComponent(currentUser.id)}/${encodeURIComponent(selectedContactId)}`)
      .then((r) => r.json())
      .then((data) => {
        const loaded = data.messages || [];
        setMessages(loaded);

        const hasUnread = loaded.some(
          (m) => m.senderId === selectedContactId && m.receiverId === currentUser.id && m.status !== 'read'
        );
        if (hasUnread && socketRef.current) {
          socketRef.current.emit('message:read', {
            readerId: currentUser.id,
            senderId: selectedContactId
          });
        }

        setSummaries((prev) => ({
          ...prev,
          [selectedContactId]: {
            ...(prev[selectedContactId] || {}),
            unreadCount: 0
          }
        }));
      })
      .catch((err) => console.error('Failed to load messages:', err));
  }, [currentUser?.id, selectedContactId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers[selectedContactId]]);

  // ---------------------------------------------------------------------------
  // WEBRTC VOICE & VIDEO CALL FUNCTIONS
  // ---------------------------------------------------------------------------
  const getMediaStreamWithFallback = async (callType) => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video' ? { width: 1280, height: 720 } : false
      });
    } catch {
      if (callType === 'video') {
        try {
          return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch {
          return null;
        }
      }
      return null;
    }
  };

  const createPeerConnection = (partnerId, localStream) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    const remoteStream = new MediaStream();
    remoteStreamRef.current = remoteStream;

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    pc.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => {
        remoteStream.addTrack(track);
      });
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('call:ice-candidate', {
          targetId: partnerId,
          candidate: event.candidate
        });
      }
    };

    return pc;
  };

  const handleStartCall = async (callType) => {
    if (!currentUser || !selectedContact || !socketRef.current) return;
    if (callState) return;

    const stream = await getMediaStreamWithFallback(callType);
    localStreamRef.current = stream;

    setCallState({
      status: 'calling',
      callType,
      partnerId: selectedContact.id,
      partnerName: selectedContact.username,
      partnerAvatar: selectedContact.avatar
    });

    try {
      const pc = createPeerConnection(selectedContact.id, stream);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video'
      });
      await pc.setLocalDescription(offer);

      socketRef.current.emit('call:initiate', {
        callerId: currentUser.id,
        callerName: currentUser.username,
        callerAvatar: currentUser.avatar,
        receiverId: selectedContact.id,
        callType,
        offer
      });
    } catch (err) {
      console.error('Failed to initiate call:', err);
      showToast('Could not start call');
      cleanupCallMedia();
    }
  };

  const handleAcceptCall = async () => {
    if (!callState || !socketRef.current || !currentUser) return;
    const { partnerId, callType, offer } = callState;

    const stream = await getMediaStreamWithFallback(callType);
    localStreamRef.current = stream;

    try {
      const pc = createPeerConnection(partnerId, stream);
      if (offer) {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        for (const cand of pendingCandidatesRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        pendingCandidatesRef.current = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current.emit('call:answer', {
        callerId: partnerId,
        receiverId: currentUser.id,
        answer
      });

      setCallState((prev) => (prev ? { ...prev, status: 'connected' } : null));
    } catch (err) {
      console.error('Error accepting call:', err);
      cleanupCallMedia();
    }
  };

  const handleDeclineCall = () => {
    if (!callState || !socketRef.current || !currentUser) return;
    socketRef.current.emit('call:reject', {
      callerId: callState.partnerId,
      receiverId: currentUser.id
    });
    cleanupCallMedia();
  };

  const handleEndCall = () => {
    if (!callState || !socketRef.current || !currentUser) return;
    const { partnerId, callType, status } = callState;

    socketRef.current.emit('call:end', {
      targetId: partnerId
    });

    if (status === 'connected') {
      const icon = callType === 'video' ? '📹' : '📞';
      const label = callType === 'video' ? 'Video call' : 'Voice call';
      const logText = `${icon} ${label} (${formatCallDuration(callDuration)})`;
      socketRef.current.emit('message:send', {
        tempId: `temp-${Date.now()}`,
        senderId: currentUser.id,
        receiverId: partnerId,
        text: logText,
        isCallLog: true
      });
    }

    cleanupCallMedia();
  };

  const handleToggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = isMuted;
      });
    }
    setIsMuted(!isMuted);
  };

  const handleToggleCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = isCameraOff;
      });
    }
    setIsCameraOff(!isCameraOff);
  };

  // ---------------------------------------------------------------------------
  // FILE & IMAGE UPLOAD HANDLER
  // ---------------------------------------------------------------------------
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      showToast('File size must be under 20 MB');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setPendingFile({
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        dataUrl: reader.result,
        isImage: Boolean(file.type && file.type.startsWith('image/'))
      });
      inputRef.current?.focus();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ---------------------------------------------------------------------------
  // MOBILE / EMAIL OTP AUTH HANDLERS
  // ---------------------------------------------------------------------------
  const handleRequestOtp = async (
    e,
    presetIdentifier = null,
    presetName = null,
    presetAvatar = null,
    presetAbout = null
  ) => {
    if (e) e.preventDefault();
    const idToUse = (presetIdentifier ?? identifierInput).trim();
    const nameToUse = (presetName ?? usernameInput).trim();

    if (!idToUse) {
      setLoginError('Please enter your Mobile Number or Email Address.');
      return;
    }
    if (!nameToUse) {
      setLoginError('Please enter your Display Name.');
      return;
    }

    if (presetIdentifier) setIdentifierInput(presetIdentifier);
    if (presetName) setUsernameInput(presetName);
    if (presetAvatar) setSelectedAvatar(presetAvatar);
    if (presetAbout) setAboutInput(presetAbout);

    setIsLoggingIn(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: idToUse })
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Could not send OTP');
        setIsLoggingIn(false);
        return;
      }

      if (data.existingProfile && !presetName) {
        setUsernameInput(data.existingProfile.username || nameToUse);
        setSelectedAvatar(data.existingProfile.avatar || selectedAvatar);
        setAboutInput(data.existingProfile.about || aboutInput);
      }

      setOtpInput('');
      setLoginStep('otp');
      setOtpNotification({
        channel: data.channel,
        target: data.target,
        otpCode: data.otpCode,
        deliveredLive: data.deliveredLive,
        provider: data.provider,
        previewUrl: data.previewUrl,
        gatewayError: data.gatewayError
      });

      playNotificationChime();
      triggerDesktopNotification(
        `ChatBox ${data.channel === 'email' ? 'Email' : 'SMS'} OTP`,
        data.deliveredLive
          ? `Verification code sent to ${data.target} via ${data.provider}`
          : `Your verification code for ${data.target} is ${data.otpCode}`,
        selectedAvatar
      );
    } catch {
      setLoginError('Failed to connect to server. Is the backend running?');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSaveGatewayConfig = async (e) => {
    e.preventDefault();
    setGatewaySaveMsg('Saving...');
    try {
      const res = await fetch('/api/auth/gateway-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailUser: emailUserDraft,
          emailPass: emailPassDraft,
          fast2smsKey: fast2smsKeyDraft
        })
      });
      const data = await res.json();
      if (data.success) {
        setGatewayStatus({
          emailConfigured: data.emailConfigured,
          smsConfigured: data.smsConfigured
        });
        setEmailPassDraft('');
        setFast2smsKeyDraft('');
        setGatewaySaveMsg('Saved! Real OTP delivery is now active.');
        setTimeout(() => {
          setGatewaySaveMsg('');
          setShowGatewayModal(false);
        }, 1200);
      }
    } catch {
      setGatewaySaveMsg('Failed to save gateway settings.');
    }
  };

  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    if (!otpInput.trim() || otpInput.trim().length !== 6) {
      setLoginError('Please enter the 6-digit OTP code.');
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifierInput.trim(),
          otp: otpInput.trim(),
          username: usernameInput.trim(),
          avatar: selectedAvatar,
          about: aboutInput
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'OTP verification failed');
        setIsLoggingIn(false);
        return;
      }

      setOtpNotification(null);
      setLoginStep('credentials');
      sessionStorage.setItem('chatbox_active_user', JSON.stringify(data.user));
      setCurrentUser(data.user);
      setProfileAboutDraft(data.user.about || '');
      if (data.users) setUsers(data.users);
      if (data.summaries) setSummaries(data.summaries);
    } catch {
      setLoginError('Failed to verify OTP.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    cleanupCallMedia();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    sessionStorage.removeItem('chatbox_active_user');
    setCurrentUser(null);
    setSelectedContactId(null);
    setMessages([]);
    setLoginStep('credentials');
    setOtpInput('');
    setOtpNotification(null);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          about: profileAboutDraft
        })
      });
      const data = await res.json();
      if (data.user) {
        setCurrentUser(data.user);
        sessionStorage.setItem('chatbox_active_user', JSON.stringify(data.user));
      }
      setEditingProfile(false);
    } catch {
      setEditingProfile(false);
    }
  };

  const emitStopTyping = (partnerId) => {
    if (isTypingEmittedRef.current && socketRef.current && currentUser && partnerId) {
      socketRef.current.emit('typing:stop', {
        senderId: currentUser.id,
        receiverId: partnerId
      });
      isTypingEmittedRef.current = false;
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setMessageInput(val);

    if (!socketRef.current || !currentUser || !selectedContactId) return;

    if (val.trim().length > 0) {
      if (!isTypingEmittedRef.current) {
        socketRef.current.emit('typing:start', {
          senderId: currentUser.id,
          receiverId: selectedContactId
        });
        isTypingEmittedRef.current = true;
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        emitStopTyping(selectedContactId);
      }, 1800);
    } else {
      emitStopTyping(selectedContactId);
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const text = messageInput.trim();
    if ((!text && !pendingFile) || !currentUser || !selectedContactId || !socketRef.current || isUploading) {
      return;
    }

    emitStopTyping(selectedContactId);

    let uploadedAttachment = null;
    if (pendingFile) {
      setIsUploading(true);
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: pendingFile.name,
            fileType: pendingFile.type,
            fileSize: pendingFile.size,
            dataUrl: pendingFile.dataUrl
          })
        });
        const data = await res.json();
        if (!res.ok || !data.attachment) {
          showToast(data.error || 'Failed to upload file');
          setIsUploading(false);
          return;
        }
        uploadedAttachment = data.attachment;
      } catch {
        showToast('Error uploading file');
        setIsUploading(false);
        return;
      } finally {
        setIsUploading(false);
      }
    }

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      senderId: currentUser.id,
      receiverId: selectedContactId,
      text,
      attachment: uploadedAttachment,
      replyTo: replyingTo
        ? {
            id: replyingTo.id,
            text: replyingTo.text || (replyingTo.attachment ? `📎 ${replyingTo.attachment.name}` : ''),
            senderName:
              replyingTo.senderId === currentUser.id
                ? 'You'
                : selectedContact?.username || 'Contact'
          }
        : null,
      timestamp: new Date().toISOString(),
      status: 'sent'
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setMessageInput('');
    setPendingFile(null);
    setReplyingTo(null);
    setShowEmojiPicker(false);

    setSummaries((prev) => ({
      ...prev,
      [selectedContactId]: {
        ...(prev[selectedContactId] || { unreadCount: 0 }),
        lastMessage: optimisticMsg
      }
    }));

    socketRef.current.emit(
      'message:send',
      {
        tempId,
        senderId: currentUser.id,
        receiverId: selectedContactId,
        text,
        attachment: uploadedAttachment,
        replyTo: optimisticMsg.replyTo
      },
      (ack) => {
        if (ack?.message) {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? ack.message : m))
          );
          setSummaries((prev) => ({
            ...prev,
            [selectedContactId]: {
              ...(prev[selectedContactId] || { unreadCount: 0 }),
              lastMessage: ack.message
            }
          }));
        }
      }
    );
  };

  const handleConfirmDeleteMessage = (mode) => {
    if (!deleteModalMsg || !currentUser || !selectedContactId || !socketRef.current) return;
    socketRef.current.emit('message:delete', {
      messageId: deleteModalMsg.id,
      userId: currentUser.id,
      partnerId: selectedContactId,
      mode // 'me' | 'everyone'
    });
    setDeleteModalMsg(null);
  };

  const handleClearChat = async () => {
    if (!currentUser || !selectedContactId) return;
    await fetch(
      `/api/messages/${encodeURIComponent(currentUser.id)}/${encodeURIComponent(selectedContactId)}`,
      { method: 'DELETE' }
    );
  };

  const contacts = useMemo(() => {
    if (!currentUser) return [];
    const list = users.filter((u) => u.id !== currentUser.id);

    const query = sidebarSearch.trim().toLowerCase();
    const filtered = list.filter((u) => {
      const lastMsg = summaries[u.id]?.lastMessage?.text || '';
      const idStr = u.identifier || '';
      const matchesQuery =
        !query ||
        u.username.toLowerCase().includes(query) ||
        idStr.toLowerCase().includes(query) ||
        lastMsg.toLowerCase().includes(query);

      if (!matchesQuery) return false;
      if (sidebarFilter === 'unread') {
        return (summaries[u.id]?.unreadCount || 0) > 0;
      }
      if (sidebarFilter === 'online') {
        return Boolean(u.online);
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const timeA = summaries[a.id]?.lastMessage?.timestamp
        ? new Date(summaries[a.id].lastMessage.timestamp).getTime()
        : 0;
      const timeB = summaries[b.id]?.lastMessage?.timestamp
        ? new Date(summaries[b.id].lastMessage.timestamp).getTime()
        : 0;
      if (timeB !== timeA) return timeB - timeA;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.username.localeCompare(b.username);
    });
  }, [users, currentUser, summaries, sidebarSearch, sidebarFilter]);

  const selectedContact = useMemo(
    () => users.find((u) => u.id === selectedContactId) || null,
    [users, selectedContactId]
  );

  const displayedMessages = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        (m.text && m.text.toLowerCase().includes(q)) ||
        (m.attachment?.name && m.attachment.name.toLowerCase().includes(q))
    );
  }, [messages, chatSearchQuery]);

  const messagesWithDateHeaders = useMemo(() => {
    const items = [];
    let lastDateLabel = null;
    for (const msg of displayedMessages) {
      const dateLabel = formatDateDivider(msg.timestamp);
      if (dateLabel !== lastDateLabel) {
        items.push({ type: 'divider', id: `div-${dateLabel}-${msg.id}`, label: dateLabel });
        lastDateLabel = dateLabel;
      }
      items.push({ type: 'message', data: msg });
    }
    return items;
  }, [displayedMessages]);

  // ---------------------------------------------------------------------------
  // RENDER: MOBILE / EMAIL + OTP LOGIN SCREEN
  // ---------------------------------------------------------------------------
  if (!currentUser) {
    return (
      <div className="login-page">
        {/* Live OTP Push Notification Banner at Top of Screen */}
        {otpNotification && (
          <div className="live-otp-banner">
            <div className="live-otp-icon">
              {otpNotification.channel === 'email' ? '📧' : '💬'}
            </div>
            <div className="live-otp-body">
              <div className="live-otp-header">
                <strong>
                  {otpNotification.deliveredLive
                    ? `Real ${otpNotification.provider} Dispatched`
                    : otpNotification.channel === 'email'
                    ? 'Email Verification OTP'
                    : 'SMS Verification OTP'}
                </strong>
                <span>to {otpNotification.target}</span>
              </div>
              {otpNotification.deliveredLive ? (
                <p>
                  ✅ A dynamic 6-digit OTP has been sent directly to{' '}
                  <strong>{otpNotification.target}</strong>! Please check your{' '}
                  {otpNotification.channel === 'email' ? 'email inbox' : 'mobile messages'}.
                </p>
              ) : (
                <p>
                  Dynamic 6-digit OTP for <strong>{otpNotification.target}</strong>:{' '}
                  <span className="otp-code-highlight">{otpNotification.otpCode}</span>
                </p>
              )}
            </div>
            <div className="live-otp-actions">
              {otpNotification.previewUrl && (
                <a
                  href={otpNotification.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="autofill-otp-btn webmail-link"
                >
                  📬 Open Email
                </a>
              )}
              {otpNotification.otpCode && (
                <button
                  type="button"
                  className="autofill-otp-btn"
                  onClick={() => setOtpInput(otpNotification.otpCode)}
                >
                  Auto-Fill OTP
                </button>
              )}
            </div>
          </div>
        )}

        {/* Gateway Configuration Modal (Gmail App Password & Fast2SMS API Key) */}
        {showGatewayModal && (
          <div className="modal-backdrop" onClick={() => setShowGatewayModal(false)}>
            <div className="delete-modal-card gateway-modal" onClick={(e) => e.stopPropagation()}>
              <div className="gateway-modal-header">
                <h3>⚙️ Configure Real Email & SMS OTP</h3>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowGatewayModal(false)}
                >
                  <CloseIcon size={18} />
                </button>
              </div>
              <p className="gateway-modal-desc">
                Enter your Gmail App Password or Fast2SMS key below to send real OTPs directly to any mobile phone or email inbox.
              </p>

              <form onSubmit={handleSaveGatewayConfig} className="login-form">
                <div className="form-group">
                  <label>Sender Gmail Address (for Real Email OTPs)</label>
                  <input
                    type="email"
                    placeholder="yourname@gmail.com"
                    value={emailUserDraft}
                    onChange={(e) => setEmailUserDraft(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>
                    Gmail 16-Digit App Password (
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#38bdf8' }}
                    >
                      Get App Password ↗
                    </a>
                    )
                  </label>
                  <input
                    type="password"
                    placeholder={
                      gatewayStatus.emailConfigured
                        ? '•••••••••••••••• (Already saved — enter new to update)'
                        : 'xxxx xxxx xxxx xxxx'
                    }
                    value={emailPassDraft}
                    onChange={(e) => setEmailPassDraft(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>
                    Fast2SMS API Key (for Real Indian +91 Mobile SMS —{' '}
                    <a
                      href="https://www.fast2sms.com/"
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#38bdf8' }}
                    >
                      fast2sms.com ↗
                    </a>
                    )
                  </label>
                  <input
                    type="password"
                    placeholder={
                      gatewayStatus.smsConfigured
                        ? '•••••••••••••••• (Already saved — enter new to update)'
                        : 'Paste Fast2SMS API Authorization Key'
                    }
                    value={fast2smsKeyDraft}
                    onChange={(e) => setFast2smsKeyDraft(e.target.value)}
                  />
                </div>

                {gatewaySaveMsg && <div className="gateway-save-msg">{gatewaySaveMsg}</div>}

                <button type="submit" className="login-submit-btn">
                  Save Real OTP Gateway Settings ✓
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="login-card">
          <div className="login-brand">
            <ChatBubbleLogo size={46} />
            <div>
              <h1>ChatBox Web</h1>
              <p>Dynamic Mobile / Email OTP Sign-In</p>
            </div>
            <div className="login-theme-toggle" style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowGatewayModal(true)}
                title="Configure Real Email / SMS OTP Gateway"
              >
                ⚙️
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title="Toggle theme"
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
            </div>
          </div>

          <div className="gateway-status-strip" onClick={() => setShowGatewayModal(true)}>
            <span>
              {gatewayStatus.emailConfigured ? '🟢 Real Gmail SMTP Active' : '📧 Email OTP Ready'}
            </span>
            <span>•</span>
            <span>
              {gatewayStatus.smsConfigured ? '🟢 Real SMS Gateway Active' : '📱 Mobile OTP Ready'}
            </span>
            <span className="gateway-config-link">⚙️ Configure</span>
          </div>

          {loginStep === 'credentials' ? (
            <form onSubmit={handleRequestOtp} className="login-form">
              <div className="form-group">
                <label>Choose Your Avatar</label>
                <div className="avatar-grid">
                  {AVATAR_PRESETS.map((url, idx) => (
                    <button
                      key={url}
                      type="button"
                      className={`avatar-option ${selectedAvatar === url ? 'selected' : ''}`}
                      onClick={() => setSelectedAvatar(url)}
                      title={`Avatar ${idx + 1}`}
                    >
                      <img src={url} alt={`Avatar ${idx + 1}`} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="identifier-input">Mobile Number or Email Address *</label>
                <input
                  id="identifier-input"
                  type="text"
                  placeholder="e.g. +91 9876543210 or akish@gmail.com"
                  value={identifierInput}
                  onChange={(e) => setIdentifierInput(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="username-input">Your Display Name *</label>
                <input
                  id="username-input"
                  type="text"
                  placeholder="e.g. Akish, Rahul, Sarah..."
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  maxLength={32}
                />
              </div>

              <div className="form-group">
                <label htmlFor="about-input">About Status</label>
                <input
                  id="about-input"
                  type="text"
                  placeholder="Hey there! I am using ChatBox."
                  value={aboutInput}
                  onChange={(e) => setAboutInput(e.target.value)}
                  maxLength={80}
                />
              </div>

              {loginError && <div className="login-error">{loginError}</div>}

              <button type="submit" className="login-submit-btn" disabled={isLoggingIn}>
                {isLoggingIn ? 'Sending Dynamic OTP...' : 'Send Dynamic OTP Code →'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="login-form">
              <div className="otp-step-info">
                <span className="otp-badge">
                  {otpNotification?.deliveredLive
                    ? `✅ Sent via ${otpNotification.provider}`
                    : otpNotification?.channel === 'email'
                    ? '📧 Dynamic Email OTP Sent'
                    : '📱 Dynamic Mobile OTP Sent'}
                </span>
                <p>
                  We sent a dynamic 6-digit verification code to{' '}
                  <strong>{otpNotification?.target || identifierInput}</strong>
                </p>
                {otpNotification?.gatewayError && (
                  <p style={{ color: '#f87171', fontSize: '0.78rem' }}>
                    Gateway note: {otpNotification.gatewayError} (Fallback active above)
                  </p>
                )}
              </div>

              <div className="form-group">
                <label htmlFor="otp-input">Enter 6-Digit OTP Code</label>
                <input
                  id="otp-input"
                  type="text"
                  className="otp-code-input"
                  placeholder="• • • • • •"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  maxLength={6}
                  autoFocus
                />
              </div>

              {loginError && <div className="login-error">{loginError}</div>}

              <button type="submit" className="login-submit-btn" disabled={isLoggingIn}>
                {isLoggingIn ? 'Verifying OTP...' : 'Verify OTP & Start Chatting ✓'}
              </button>

              <div className="otp-footer-actions">
                <button
                  type="button"
                  className="text-link-btn"
                  onClick={() => {
                    setLoginStep('credentials');
                    setLoginError('');
                  }}
                >
                  ← Change Mobile / Email
                </button>
                <button
                  type="button"
                  className="text-link-btn"
                  onClick={(e) => handleRequestOtp(e)}
                >
                  Resend New OTP
                </button>
              </div>
            </form>
          )}

          {users.length > 0 && loginStep === 'credentials' && (
            <div className="quick-accounts">
              <div className="quick-accounts-title">
                <span>Or test OTP login with an existing account</span>
              </div>
              <div className="quick-account-list">
                {users
                  .filter((u) => !u.isBot)
                  .slice(0, 5)
                  .map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="quick-account-chip"
                      onClick={(e) =>
                        handleRequestOtp(
                          e,
                          u.identifier || `${u.username.toLowerCase().replace(/\s+/g, '')}@chatbox.app`,
                          u.username,
                          u.avatar,
                          u.about
                        )
                      }
                    >
                      <div className="chip-avatar-wrap">
                        <img src={u.avatar} alt={u.username} />
                        {u.online && <span className="online-dot" />}
                      </div>
                      <span>{u.username}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isContactTyping = selectedContact && typingUsers[selectedContact.id];

  return (
    <div className="whatsapp-app">
      {/* Live Incoming Message Floating Notification Banner */}
      {liveNotification && (
        <div
          className="live-msg-notification"
          onClick={() => {
            setSelectedContactId(liveNotification.senderId);
            setLiveNotification(null);
          }}
          title="Click to open conversation"
        >
          <img
            src={liveNotification.senderAvatar}
            alt={liveNotification.senderName}
            className="live-notif-avatar"
          />
          <div className="live-notif-content">
            <div className="live-notif-top">
              <span className="live-notif-name">{liveNotification.senderName}</span>
              <span className="live-notif-tag">LIVE MESSAGE</span>
            </div>
            <p className="live-notif-text">{liveNotification.text}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation();
              setLiveNotification(null);
            }}
          >
            <CloseIcon size={15} />
          </button>
        </div>
      )}

      {/* Call / Action Toast Notification */}
      {callToast && <div className="call-toast">{callToast}</div>}

      {/* Delete Message Modal ("Delete for me" or "Delete for everyone") */}
      {deleteModalMsg && (
        <div className="modal-backdrop" onClick={() => setDeleteModalMsg(null)}>
          <div className="delete-modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Delete message?</h3>
            <p className="delete-modal-preview">
              {deleteModalMsg.text
                ? `"${deleteModalMsg.text.slice(0, 70)}${deleteModalMsg.text.length > 70 ? '...' : ''}"`
                : deleteModalMsg.attachment
                ? `Attachment: ${deleteModalMsg.attachment.name}`
                : 'Selected message'}
            </p>

            <div className="delete-modal-actions">
              {deleteModalMsg.senderId === currentUser.id && !deleteModalMsg.deletedForEveryone && (
                <button
                  type="button"
                  className="delete-choice-btn everyone"
                  onClick={() => handleConfirmDeleteMessage('everyone')}
                >
                  Delete for everyone
                </button>
              )}
              <button
                type="button"
                className="delete-choice-btn me"
                onClick={() => handleConfirmDeleteMessage('me')}
              >
                Delete for me
              </button>
              <button
                type="button"
                className="delete-choice-btn cancel"
                onClick={() => setDeleteModalMsg(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image Lightbox Modal */}
      {lightboxImage && (
        <div className="lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage.url} alt={lightboxImage.name} />
            <div className="lightbox-actions">
              <span>{lightboxImage.name}</span>
              <div className="lightbox-btn-group">
                <a
                  href={lightboxImage.url}
                  download={lightboxImage.name}
                  className="lightbox-btn"
                >
                  <DownloadIcon size={16} />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  className="lightbox-btn close"
                  onClick={() => setLightboxImage(null)}
                >
                  <CloseIcon size={16} />
                  <span>Close</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Incoming Call Modal */}
      {callState?.status === 'incoming' && (
        <div className="call-modal-overlay">
          <div className="incoming-call-card">
            <div className="call-avatar-pulse">
              <img src={callState.partnerAvatar} alt={callState.partnerName} />
            </div>
            <h3>{callState.partnerName}</h3>
            <p className="incoming-call-subtitle">
              Incoming {callState.callType === 'video' ? 'Video' : 'Voice'} Call...
            </p>
            <div className="incoming-call-actions">
              <button
                type="button"
                className="call-action-btn decline"
                onClick={handleDeclineCall}
                title="Decline Call"
              >
                <PhoneOffIcon size={22} />
                <span>Decline</span>
              </button>
              <button
                type="button"
                className="call-action-btn accept"
                onClick={handleAcceptCall}
                title="Accept Call"
              >
                {callState.callType === 'video' ? <VideoIcon size={22} /> : <PhoneIcon size={22} />}
                <span>Accept</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active / Outgoing Call Overlay */}
      {(callState?.status === 'calling' || callState?.status === 'connected') && (
        <div className="call-modal-overlay">
          <div className="active-call-stage">
            <audio ref={remoteAudioRef} autoPlay playsInline />

            {callState.callType === 'video' ? (
              <div className="video-stage">
                <video
                  ref={remoteVideoRef}
                  className="remote-video"
                  autoPlay
                  playsInline
                />
                <div className="video-partner-Fallback">
                  <div className="call-avatar-pulse">
                    <img src={callState.partnerAvatar} alt={callState.partnerName} />
                  </div>
                  <h3>{callState.partnerName}</h3>
                  <p>
                    {callState.status === 'calling'
                      ? 'Ringing...'
                      : formatCallDuration(callDuration)}
                  </p>
                </div>

                <div className="local-video-pip">
                  <video
                    ref={localVideoRef}
                    className={`local-video ${isCameraOff ? 'hidden-video' : ''}`}
                    autoPlay
                    playsInline
                    muted
                  />
                  {isCameraOff && <div className="camera-off-badge">Camera Off</div>}
                </div>
              </div>
            ) : (
              <div className="voice-stage">
                <div className="call-avatar-pulse large">
                  <img src={callState.partnerAvatar} alt={callState.partnerName} />
                </div>
                <h2>{callState.partnerName}</h2>
                <span className="call-timer-badge">
                  {callState.status === 'calling'
                    ? 'Ringing...'
                    : formatCallDuration(callDuration)}
                </span>
              </div>
            )}

            <div className="call-controls-bar">
              <button
                type="button"
                className={`call-ctrl-btn ${isMuted ? 'toggled-off' : ''}`}
                onClick={handleToggleMute}
                title={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
              >
                {isMuted ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
              </button>

              {callState.callType === 'video' && (
                <button
                  type="button"
                  className={`call-ctrl-btn ${isCameraOff ? 'toggled-off' : ''}`}
                  onClick={handleToggleCamera}
                  title={isCameraOff ? 'Turn Camera On' : 'Turn Camera Off'}
                >
                  {isCameraOff ? <VideoOffIcon size={20} /> : <VideoIcon size={20} />}
                </button>
              )}

              <button
                type="button"
                className="call-ctrl-btn end-call"
                onClick={handleEndCall}
                title="End Call"
              >
                <PhoneOffIcon size={22} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="whatsapp-container">
        {/* ================= LEFT SIDEBAR ================= */}
        <aside className="sidebar">
          <header className="sidebar-header">
            <div
              className="current-user-pill"
              onClick={() => {
                setProfileAboutDraft(currentUser.about || '');
                setEditingProfile(!editingProfile);
              }}
              title="Click to edit your About status"
            >
              <div className="avatar-wrapper">
                <img src={currentUser.avatar} alt={currentUser.username} className="avatar-img" />
                <span className="online-dot" title="You are online" />
              </div>
              <div className="current-user-meta">
                <span className="current-user-name">{currentUser.username}</span>
                <span className="current-user-status">
                  {currentUser.identifier || 'Verified Online'}
                </span>
              </div>
            </div>

            <div className="header-actions">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              >
                {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              </button>
              <button
                type="button"
                className="icon-btn logout-btn"
                onClick={handleLogout}
                title="Switch User / Logout"
              >
                <LogoutIcon />
              </button>
            </div>
          </header>

          {editingProfile && (
            <form className="profile-editor" onSubmit={handleSaveProfile}>
              <div className="profile-editor-header">
                <span>Your About Status</span>
                <button type="button" className="icon-btn" onClick={() => setEditingProfile(false)}>
                  <CloseIcon size={16} />
                </button>
              </div>
              <div className="profile-editor-row">
                <input
                  type="text"
                  value={profileAboutDraft}
                  onChange={(e) => setProfileAboutDraft(e.target.value)}
                  placeholder="Available"
                  maxLength={80}
                />
                <button type="submit" className="save-mini-btn">Save</button>
              </div>
            </form>
          )}

          <div className="sidebar-search-bar">
            <div className="search-input-wrap">
              <SearchIcon size={16} />
              <input
                type="text"
                placeholder="Search by name, mobile, email or message"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
              />
              {sidebarSearch && (
                <button
                  type="button"
                  className="clear-search-btn"
                  onClick={() => setSidebarSearch('')}
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>

            <div className="filter-pills">
              <button
                type="button"
                className={`filter-pill ${sidebarFilter === 'all' ? 'active' : ''}`}
                onClick={() => setSidebarFilter('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`filter-pill ${sidebarFilter === 'unread' ? 'active' : ''}`}
                onClick={() => setSidebarFilter('unread')}
              >
                Unread
              </button>
              <button
                type="button"
                className={`filter-pill ${sidebarFilter === 'online' ? 'active' : ''}`}
                onClick={() => setSidebarFilter('online')}
              >
                Online
              </button>
            </div>
          </div>

          <div className="contact-list">
            {contacts.length === 0 ? (
              <div className="empty-contacts">
                <p>No contacts match your filter.</p>
              </div>
            ) : (
              contacts.map((contact) => {
                const summary = summaries[contact.id] || {};
                const lastMsg = summary.lastMessage;
                const unreadCount = summary.unreadCount || 0;
                const isSelected = contact.id === selectedContactId;
                const isTyping = Boolean(typingUsers[contact.id]);
                const isLastFromMe = lastMsg?.senderId === currentUser.id;
                const previewText = lastMsg
                  ? lastMsg.deletedForEveryone
                    ? '🚫 This message was deleted'
                    : lastMsg.text ||
                      (lastMsg.attachment
                        ? `${lastMsg.attachment.isImage ? '📷 Photo' : '📎 ' + lastMsg.attachment.name}`
                        : '')
                  : '';

                return (
                  <div
                    key={contact.id}
                    className={`contact-item ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedContactId(contact.id)}
                  >
                    <div className="avatar-wrapper">
                      <img src={contact.avatar} alt={contact.username} className="avatar-img" />
                      {contact.online && <span className="online-dot" title="Online" />}
                    </div>

                    <div className="contact-body">
                      <div className="contact-top-row">
                        <span className="contact-name">{contact.username}</span>
                        <span className={`contact-time ${unreadCount > 0 ? 'unread-time' : ''}`}>
                          {lastMsg ? formatSidebarDate(lastMsg.timestamp) : ''}
                        </span>
                      </div>

                      <div className="contact-bottom-row">
                        <div className="contact-preview">
                          {isTyping ? (
                            <span className="typing-text">typing...</span>
                          ) : lastMsg ? (
                            <>
                              {isLastFromMe && !lastMsg.deletedForEveryone && (
                                <MessageStatusTicks status={lastMsg.status} />
                              )}
                              <span
                                className={`preview-message-text ${
                                  lastMsg.deletedForEveryone ? 'deleted-preview' : ''
                                }`}
                              >
                                {previewText}
                              </span>
                            </>
                          ) : (
                            <span className="preview-about-text">{contact.about}</span>
                          )}
                        </div>

                        {unreadCount > 0 && (
                          <span className="unread-badge">{unreadCount}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ================= MAIN CHAT PANEL ================= */}
        {selectedContact ? (
          <main className="chat-panel">
            <header className="chat-header">
              <div
                className="chat-header-contact"
                onClick={() => setShowInfoDrawer(!showInfoDrawer)}
                title="Click for contact info"
              >
                <div className="avatar-wrapper">
                  <img
                    src={selectedContact.avatar}
                    alt={selectedContact.username}
                    className="avatar-img"
                  />
                  {selectedContact.online && <span className="online-dot" />}
                </div>
                <div className="chat-header-meta">
                  <span className="chat-header-name">{selectedContact.username}</span>
                  <span
                    className={`chat-header-status ${
                      isContactTyping
                        ? 'typing-highlight'
                        : selectedContact.online
                        ? 'online-highlight'
                        : ''
                    }`}
                  >
                    {isContactTyping
                      ? 'typing...'
                      : selectedContact.online
                      ? 'online'
                      : formatLastSeen(selectedContact.lastSeen)}
                  </span>
                </div>
              </div>

              <div className="header-actions">
                <button
                  type="button"
                  className="icon-btn call-btn"
                  onClick={() => handleStartCall('voice')}
                  title={`Voice call ${selectedContact.username}`}
                >
                  <PhoneIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn call-btn"
                  onClick={() => handleStartCall('video')}
                  title={`Video call ${selectedContact.username}`}
                >
                  <VideoIcon />
                </button>
                <div className="header-divider" />
                <button
                  type="button"
                  className={`icon-btn ${chatSearchOpen ? 'active' : ''}`}
                  onClick={() => {
                    setChatSearchOpen(!chatSearchOpen);
                    setChatSearchQuery('');
                  }}
                  title="Search messages in chat"
                >
                  <SearchIcon />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={handleClearChat}
                  title="Clear chat history"
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  className={`icon-btn ${showInfoDrawer ? 'active' : ''}`}
                  onClick={() => setShowInfoDrawer(!showInfoDrawer)}
                  title="Contact info"
                >
                  <InfoIcon />
                </button>
              </div>
            </header>

            {chatSearchOpen && (
              <div className="in-chat-search">
                <SearchIcon size={16} />
                <input
                  type="text"
                  placeholder={`Search messages with ${selectedContact.username}...`}
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => {
                    setChatSearchOpen(false);
                    setChatSearchQuery('');
                  }}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            )}

            <div className="messages-viewport">
              <div className="encryption-notice">
                <LockIcon size={12} />
                <span>
                  Real-time messages, voice/video calls & file sharing between{' '}
                  {currentUser.username} and {selectedContact.username}.
                </span>
              </div>

              {messagesWithDateHeaders.length === 0 ? (
                <div className="no-messages-placeholder">
                  <p>
                    Say hello, share a file, or start a call with{' '}
                    <strong>{selectedContact.username}</strong>! 👋
                  </p>
                </div>
              ) : (
                messagesWithDateHeaders.map((item) => {
                  if (item.type === 'divider') {
                    return (
                      <div key={item.id} className="date-divider">
                        <span>{item.label}</span>
                      </div>
                    );
                  }

                  const msg = item.data;
                  const isOutgoing = msg.senderId === currentUser.id;
                  const isDeletedEveryone = Boolean(msg.deletedForEveryone);

                  return (
                    <div
                      key={msg.id}
                      className={`message-row ${isOutgoing ? 'outgoing' : 'incoming'}`}
                    >
                      <div
                        className={`message-bubble ${msg.isCallLog ? 'call-log-bubble' : ''} ${
                          isDeletedEveryone ? 'deleted-bubble' : ''
                        }`}
                        onDoubleClick={() => !isDeletedEveryone && setReplyingTo(msg)}
                        title={isDeletedEveryone ? 'Deleted message' : 'Double-click to reply'}
                      >
                        {!isDeletedEveryone && msg.replyTo && (
                          <div className="quoted-reply">
                            <span className="quoted-sender">{msg.replyTo.senderName}</span>
                            <p className="quoted-text">{msg.replyTo.text}</p>
                          </div>
                        )}

                        {!isDeletedEveryone && msg.attachment && (
                          <div className="message-attachment">
                            {msg.attachment.isImage ? (
                              <div
                                className="image-attachment-wrap"
                                onClick={() => setLightboxImage(msg.attachment)}
                              >
                                <img
                                  src={msg.attachment.url}
                                  alt={msg.attachment.name}
                                  loading="lazy"
                                />
                              </div>
                            ) : (
                              <a
                                href={msg.attachment.url}
                                download={msg.attachment.name}
                                className="file-attachment-card"
                              >
                                <div className="file-card-icon">
                                  <FileIcon size={22} />
                                </div>
                                <div className="file-card-meta">
                                  <span className="file-card-name">{msg.attachment.name}</span>
                                  <span className="file-card-size">
                                    {formatFileSize(msg.attachment.size)}
                                  </span>
                                </div>
                                <div className="file-card-download">
                                  <DownloadIcon size={18} />
                                </div>
                              </a>
                            )}
                          </div>
                        )}

                        <div className="message-content-wrap">
                          {isDeletedEveryone ? (
                            <span className="message-text deleted-msg-italic">
                              🚫 This message was deleted
                            </span>
                          ) : (
                            msg.text && <span className="message-text">{msg.text}</span>
                          )}
                          <span className="message-meta">
                            <span className="message-time">{formatTime(msg.timestamp)}</span>
                            {isOutgoing && !isDeletedEveryone && (
                              <MessageStatusTicks status={msg.status} />
                            )}
                          </span>
                        </div>

                        {/* Hover Action Pill: Reply & Delete ("Delete for me" / "Delete for everyone") */}
                        <div className="bubble-actions-pill">
                          {!isDeletedEveryone && (
                            <button
                              type="button"
                              className="bubble-action-btn"
                              onClick={() => {
                                setReplyingTo(msg);
                                inputRef.current?.focus();
                              }}
                              title="Reply"
                            >
                              ↩
                            </button>
                          )}
                          <button
                            type="button"
                            className="bubble-action-btn delete"
                            onClick={() => setDeleteModalMsg(msg)}
                            title="Delete message"
                          >
                            <TrashIcon size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {isContactTyping && (
                <div className="message-row incoming">
                  <div className="message-bubble typing-bubble">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {pendingFile && (
              <div className="attachment-preview-banner">
                <div className="attachment-preview-left">
                  {pendingFile.isImage ? (
                    <img
                      src={pendingFile.dataUrl}
                      alt={pendingFile.name}
                      className="attachment-thumb"
                    />
                  ) : (
                    <div className="attachment-file-badge">
                      <FileIcon size={20} />
                    </div>
                  )}
                  <div className="attachment-preview-info">
                    <span className="attachment-preview-name">{pendingFile.name}</span>
                    <span className="attachment-preview-size">
                      {formatFileSize(pendingFile.size)} — Ready to send
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setPendingFile(null)}
                  title="Remove attachment"
                >
                  <CloseIcon size={18} />
                </button>
              </div>
            )}

            {replyingTo && (
              <div className="reply-composer-banner">
                <div className="reply-banner-content">
                  <span className="reply-banner-author">
                    Replying to{' '}
                    {replyingTo.senderId === currentUser.id ? 'yourself' : selectedContact.username}
                  </span>
                  <p className="reply-banner-text">
                    {replyingTo.text ||
                      (replyingTo.attachment ? `📎 ${replyingTo.attachment.name}` : '')}
                  </p>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setReplyingTo(null)}
                >
                  <CloseIcon size={18} />
                </button>
              </div>
            )}

            {showEmojiPicker && (
              <div className="emoji-picker-bar">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="emoji-btn"
                    onClick={() => {
                      setMessageInput((prev) => prev + emoji);
                      inputRef.current?.focus();
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            <form className="chat-composer" onSubmit={handleSendMessage}>
              <button
                type="button"
                className={`icon-btn ${showEmojiPicker ? 'active' : ''}`}
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                title="Insert emoji"
              >
                <EmojiIcon />
              </button>

              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <button
                type="button"
                className={`icon-btn ${pendingFile ? 'active' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                title="Attach image or file"
              >
                <PaperclipIcon />
              </button>

              <input
                ref={inputRef}
                type="text"
                className="composer-input"
                placeholder={
                  pendingFile
                    ? `Add a caption for ${pendingFile.name}...`
                    : `Message ${selectedContact.username}...`
                }
                value={messageInput}
                onChange={handleInputChange}
                autoFocus
              />

              <button
                type="submit"
                className="send-btn"
                disabled={(!messageInput.trim() && !pendingFile) || isUploading}
                title="Send message"
              >
                <SendIcon size={20} />
              </button>
            </form>
          </main>
        ) : (
          <main className="chat-empty-state">
            <div className="empty-state-card">
              <ChatBubbleLogo size={68} />
              <h2>ChatBox Web</h2>
              <p>
                Select any contact on the left to chat in real time with live notifications,
                share images & files, delete messages for everyone, or start a Voice/Video call.
              </p>
              <div className="empty-feature-badges">
                <span className="feature-badge">🔐 Mobile / Email OTP</span>
                <span className="feature-badge">🔔 Live Notifications</span>
                <span className="feature-badge">🗑️ Delete for Everyone</span>
                <span className="feature-badge">📞 Voice & Video Calls</span>
              </div>
              <div className="empty-encryption-footer">
                <LockIcon size={13} />
                <span>Verified account: {currentUser.identifier || currentUser.username}</span>
              </div>
            </div>
          </main>
        )}

        {/* ================= RIGHT CONTACT INFO DRAWER ================= */}
        {selectedContact && showInfoDrawer && (
          <aside className="info-drawer">
            <header className="info-drawer-header">
              <button
                type="button"
                className="icon-btn"
                onClick={() => setShowInfoDrawer(false)}
              >
                <CloseIcon />
              </button>
              <span>Contact info</span>
            </header>

            <div className="info-drawer-body">
              <div className="info-profile-card">
                <div className="info-avatar-large">
                  <img src={selectedContact.avatar} alt={selectedContact.username} />
                  {selectedContact.online && <span className="online-dot-large" />}
                </div>
                <h3>{selectedContact.username}</h3>
                {selectedContact.identifier && (
                  <span className="info-identifier-pill">{selectedContact.identifier}</span>
                )}
                <p className="info-status-text">
                  {isContactTyping
                    ? 'typing...'
                    : selectedContact.online
                    ? 'Online now'
                    : formatLastSeen(selectedContact.lastSeen)}
                </p>
                <div className="info-quick-call-row">
                  <button
                    type="button"
                    className="info-call-pill"
                    onClick={() => handleStartCall('voice')}
                  >
                    <PhoneIcon size={16} />
                    <span>Voice Call</span>
                  </button>
                  <button
                    type="button"
                    className="info-call-pill"
                    onClick={() => handleStartCall('video')}
                  >
                    <VideoIcon size={16} />
                    <span>Video Call</span>
                  </button>
                </div>
              </div>

              <div className="info-section">
                <span className="info-label">About</span>
                <p className="info-value">
                  {selectedContact.about || 'Hey there! I am using ChatBox.'}
                </p>
              </div>

              <div className="info-section">
                <span className="info-label">Chat Statistics</span>
                <p className="info-value">{messages.length} messages in this conversation</p>
              </div>

              <div className="info-section">
                <button
                  type="button"
                  className="danger-outline-btn"
                  onClick={handleClearChat}
                >
                  <TrashIcon size={16} />
                  <span>Clear Chat Messages</span>
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
