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

  // Login form state
  const [usernameInput, setUsernameInput] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_PRESETS[0]);
  const [aboutInput, setAboutInput] = useState('Hey there! I am using ChatBox.');
  const [loginError, setLoginError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Chat state
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

  // File & Image Upload state
  const [pendingFile, setPendingFile] = useState(null); // { file, name, size, type, dataUrl, isImage }
  const [isUploading, setIsUploading] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);

  // Voice & Video Call state
  // callState: null | { status: 'incoming'|'calling'|'connected', callType: 'voice'|'video', partnerId, partnerName, partnerAvatar, offer }
  const [callState, setCallState] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callToast, setCallToast] = useState('');

  const socketRef = useRef(null);
  const selectedContactIdRef = useRef(selectedContactId);
  const currentUserRef = useRef(currentUser);
  const callStateRef = useRef(callState);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingEmittedRef = useRef(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);

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
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chatbox_theme', theme);
  }, [theme]);

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

  // Fetch initial users list
  useEffect(() => {
    fetch('/api/users')
      .then((r) => r.json())
      .then((data) => {
        if (data.users) setUsers(data.users);
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

    // -------------------------------------------------------------------------
    // WEBRTC CALL SIGNALING LISTENERS
    // -------------------------------------------------------------------------
    socket.on('call:incoming', ({ callerId, callerName, callerAvatar, callType, offer }) => {
      if (callStateRef.current) {
        socket.emit('call:reject', { callerId, receiverId: currentUser.id });
        return;
      }
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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: callType === 'video' ? { width: 1280, height: 720 } : false
      });
      return stream;
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

    // Log call in chat if it was connected
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
  // FILE & IMAGE UPLOAD HANDLERS
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
  // AUTH & MESSAGING HANDLERS
  // ---------------------------------------------------------------------------
  const handleLogin = async (e, presetName = null, presetAvatar = null, presetAbout = null) => {
    if (e) e.preventDefault();
    const nameToUse = (presetName ?? usernameInput).trim();
    if (!nameToUse) {
      setLoginError('Please enter a username to start chatting.');
      return;
    }

    setIsLoggingIn(true);
    setLoginError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: nameToUse,
          avatar: presetAvatar || selectedAvatar,
          about: presetAbout || aboutInput
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || 'Could not sign in');
        setIsLoggingIn(false);
        return;
      }

      sessionStorage.setItem('chatbox_active_user', JSON.stringify(data.user));
      setCurrentUser(data.user);
      setProfileAboutDraft(data.user.about || '');
      if (data.users) setUsers(data.users);
      if (data.summaries) setSummaries(data.summaries);
    } catch {
      setLoginError('Failed to connect to server. Is the backend running?');
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
      const matchesQuery =
        !query ||
        u.username.toLowerCase().includes(query) ||
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
  // RENDER: QUICK LOGIN SCREEN
  // ---------------------------------------------------------------------------
  if (!currentUser) {
    return (
      <div className="login-page">
        <div className="login-top-banner" />
        <div className="login-card">
          <div className="login-brand">
            <ChatBubbleLogo size={46} />
            <div>
              <h1>ChatBox Web</h1>
              <p>Real-time messaging, voice/video calls & file sharing</p>
            </div>
            <button
              type="button"
              className="icon-btn login-theme-toggle"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              title="Toggle theme"
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>

          <form onSubmit={handleLogin} className="login-form">
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
              <label htmlFor="username-input">Your Display Name / Username</label>
              <input
                id="username-input"
                type="text"
                placeholder="e.g., Akish, Rahul, Sarah..."
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                autoFocus
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
              {isLoggingIn ? 'Signing in...' : 'Start Chatting →'}
            </button>
          </form>

          {users.length > 0 && (
            <div className="quick-accounts">
              <div className="quick-accounts-title">
                <span>Or one-click sign in with an existing profile</span>
              </div>
              <div className="quick-account-list">
                {users
                  .filter((u) => !u.isBot)
                  .slice(0, 6)
                  .map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className="quick-account-chip"
                      onClick={(e) => handleLogin(e, u.username, u.avatar, u.about)}
                    >
                      <div className="chip-avatar-wrap">
                        <img src={u.avatar} alt={u.username} />
                        {u.online && <span className="online-dot" />}
                      </div>
                      <span>{u.username}</span>
                    </button>
                  ))}
              </div>
              <p className="multi-tab-tip">
                💡 <strong>Tip:</strong> Open this URL in two browser tabs and sign in with two different usernames to chat, share files, and call live!
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isContactTyping = selectedContact && typingUsers[selectedContact.id];

  return (
    <div className="whatsapp-app">
      {/* Toast Notification */}
      {callToast && <div className="call-toast">{callToast}</div>}

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

            {/* Call Controls Bar */}
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
                <span className="current-user-status">Online</span>
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
                placeholder="Search or start new chat"
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
                  ? lastMsg.text ||
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
                              {isLastFromMe && <MessageStatusTicks status={lastMsg.status} />}
                              <span className="preview-message-text">{previewText}</span>
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

                  return (
                    <div
                      key={msg.id}
                      className={`message-row ${isOutgoing ? 'outgoing' : 'incoming'}`}
                    >
                      <div
                        className={`message-bubble ${msg.isCallLog ? 'call-log-bubble' : ''}`}
                        onDoubleClick={() => setReplyingTo(msg)}
                        title="Double-click to reply"
                      >
                        {msg.replyTo && (
                          <div className="quoted-reply">
                            <span className="quoted-sender">{msg.replyTo.senderName}</span>
                            <p className="quoted-text">{msg.replyTo.text}</p>
                          </div>
                        )}

                        {/* Attachment Rendering (Image or File Card) */}
                        {msg.attachment && (
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
                          {msg.text && <span className="message-text">{msg.text}</span>}
                          <span className="message-meta">
                            <span className="message-time">{formatTime(msg.timestamp)}</span>
                            {isOutgoing && <MessageStatusTicks status={msg.status} />}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="bubble-reply-btn"
                          onClick={() => {
                            setReplyingTo(msg);
                            inputRef.current?.focus();
                          }}
                          title="Reply"
                        >
                          ↩
                        </button>
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

            {/* Pending File / Image Attachment Preview Banner */}
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

            {/* Reply Preview Banner */}
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

            {/* Message Input Composer */}
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
                Select any contact on the left to chat in real time, share images & files, or
                launch a live peer-to-peer Voice or Video call.
              </p>
              <div className="empty-feature-badges">
                <span className="feature-badge">📞 Voice & Video Calls</span>
                <span className="feature-badge">📎 Image & File Sharing</span>
                <span className="feature-badge">✓✓ Blue Read Ticks</span>
              </div>
              <div className="empty-encryption-footer">
                <LockIcon size={13} />
                <span>Real-time WebSocket & WebRTC messaging</span>
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
