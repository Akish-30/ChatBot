import React, { useState, useEffect, useRef, useMemo } from 'react';
import { io } from 'socket.io-client';
import {
  MessageStatusTicks,
  SearchIcon,
  SendIcon,
  EmojiIcon,
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

export default function App() {
  // Theme state
  const [theme, setTheme] = useState(() => localStorage.getItem('chatbox_theme') || 'dark');

  // Active user in this browser tab (sessionStorage allows multiple tabs with different users)
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

  // App state
  const [users, setUsers] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [typingUsers, setTypingUsers] = useState({}); // { [userId]: true }
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState('all'); // 'all' | 'unread' | 'online'
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showInfoDrawer, setShowInfoDrawer] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileAboutDraft, setProfileAboutDraft] = useState('');

  const socketRef = useRef(null);
  const selectedContactIdRef = useRef(selectedContactId);
  const currentUserRef = useRef(currentUser);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const isTypingEmittedRef = useRef(false);
  const inputRef = useRef(null);

  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chatbox_theme', theme);
  }, [theme]);

  // Fetch initial users list even on login page so user can see existing accounts
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
      // Refresh users & summaries on reconnect
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
        // Immediately mark as read since the chat is open
        socket.emit('message:read', {
          readerId: myUser.id,
          senderId: incomingMsg.senderId
        });
      }

      // Update sidebar conversation summary
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

    return () => {
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

    fetch(`/api/messages/${encodeURIComponent(currentUser.id)}/${encodeURIComponent(selectedContactId)}`)
      .then((r) => r.json())
      .then((data) => {
        const loaded = data.messages || [];
        setMessages(loaded);

        // Mark unread incoming messages as read
        const hasUnread = loaded.some(
          (m) => m.senderId === selectedContactId && m.receiverId === currentUser.id && m.status !== 'read'
        );
        if (hasUnread && socketRef.current) {
          socketRef.current.emit('message:read', {
            readerId: currentUser.id,
            senderId: selectedContactId
          });
        }

        // Clear local unread badge immediately
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

  // Scroll to bottom when messages change or typing indicator appears
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers[selectedContactId]]);

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
    } catch (err) {
      setLoginError('Failed to connect to server. Is the backend running?');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
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

  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    const text = messageInput.trim();
    if (!text || !currentUser || !selectedContactId || !socketRef.current) return;

    emitStopTyping(selectedContactId);

    const tempId = `temp-${Date.now()}`;
    const optimisticMsg = {
      id: tempId,
      senderId: currentUser.id,
      receiverId: selectedContactId,
      text,
      replyTo: replyingTo
        ? {
            id: replyingTo.id,
            text: replyingTo.text,
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

    // Filter by search query
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

    // Sort by most recent message timestamp (or online status)
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

  // Filter messages inside open chat when chatSearchQuery is active
  const displayedMessages = useMemo(() => {
    const q = chatSearchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.text.toLowerCase().includes(q));
  }, [messages, chatSearchQuery]);

  // Group displayed messages with date headers
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
              <p>Real-time person-to-person messaging</p>
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
                💡 <strong>Tip:</strong> Open this URL in two browser tabs and sign in with two different usernames to chat person-to-person live!
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER: MAIN WHATSAPP-STYLE CHAT INTERFACE
  // ---------------------------------------------------------------------------
  const isContactTyping = selectedContact && typingUsers[selectedContact.id];

  return (
    <div className="whatsapp-app">
      <div className="whatsapp-container">
        {/* ================= LEFT SIDEBAR ================= */}
        <aside className="sidebar">
          {/* Sidebar Header */}
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

          {/* Edit Profile Popover */}
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

          {/* Search & Filters */}
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

          {/* Contacts List */}
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
                              <span className="preview-message-text">{lastMsg.text}</span>
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
            {/* Chat Header (No voice/video caller buttons — strictly chat!) */}
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
                      isContactTyping ? 'typing-highlight' : selectedContact.online ? 'online-highlight' : ''
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

            {/* In-Chat Search Bar */}
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

            {/* Messages Area */}
            <div className="messages-viewport">
              <div className="encryption-notice">
                <LockIcon size={12} />
                <span>
                  Messages are delivered in real time between {currentUser.username} and{' '}
                  {selectedContact.username}.
                </span>
              </div>

              {messagesWithDateHeaders.length === 0 ? (
                <div className="no-messages-placeholder">
                  <p>
                    Say hello to <strong>{selectedContact.username}</strong>! 👋
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
                        className="message-bubble"
                        onDoubleClick={() => setReplyingTo(msg)}
                        title="Double-click to reply"
                      >
                        {msg.replyTo && (
                          <div className="quoted-reply">
                            <span className="quoted-sender">{msg.replyTo.senderName}</span>
                            <p className="quoted-text">{msg.replyTo.text}</p>
                          </div>
                        )}

                        <div className="message-content-wrap">
                          <span className="message-text">{msg.text}</span>
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

              {/* Live Typing Indicator Bubble */}
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

            {/* Reply Preview Banner */}
            {replyingTo && (
              <div className="reply-composer-banner">
                <div className="reply-banner-content">
                  <span className="reply-banner-author">
                    Replying to{' '}
                    {replyingTo.senderId === currentUser.id ? 'yourself' : selectedContact.username}
                  </span>
                  <p className="reply-banner-text">{replyingTo.text}</p>
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

            {/* Quick Emoji Picker */}
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
                ref={inputRef}
                type="text"
                className="composer-input"
                placeholder={`Message ${selectedContact.username}...`}
                value={messageInput}
                onChange={handleInputChange}
                autoFocus
              />

              <button
                type="submit"
                className="send-btn"
                disabled={!messageInput.trim()}
                title="Send message"
              >
                <SendIcon size={20} />
              </button>
            </form>
          </main>
        ) : (
          /* Empty Welcome State when no chat is selected */
          <main className="chat-empty-state">
            <div className="empty-state-card">
              <ChatBubbleLogo size={68} />
              <h2>ChatBox Web</h2>
              <p>
                Select any contact on the left to start chatting in real time with instant
                online status, typing indicators, and blue read receipts.
              </p>
              <div className="empty-feature-badges">
                <span className="feature-badge">🟢 Live Online Status</span>
                <span className="feature-badge">💬 Typing Indicators</span>
                <span className="feature-badge">✓✓ Blue Read Ticks</span>
              </div>
              <div className="empty-encryption-footer">
                <LockIcon size={13} />
                <span>Real-time WebSocket messaging</span>
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
              </div>

              <div className="info-section">
                <span className="info-label">About</span>
                <p className="info-value">{selectedContact.about || 'Hey there! I am using ChatBox.'}</p>
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
