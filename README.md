# ChatBox Web — Real-Time Person-to-Person Chat

A WhatsApp Web-inspired real-time messaging application built with **React (Vite)** and **Node.js + Express + Socket.io**.

## Features
- **Quick Login with Username & Avatar**: Jump straight into chatting without complex sign-up forms.
- **Multi-Tab Person-to-Person Testing**: Uses per-tab session state so you can open two browser tabs (`http://localhost:5173`), log in as two different users, and chat with each other live in real time.
- **Live Online / Offline & Last Seen Status**: Green online badges and automatic "last seen today at..." timestamps.
- **Live Typing Indicators**: Shows `typing...` in the chat header, sidebar preview, and animated typing bubble as the other person types.
- **Read Receipts (Blue Ticks)**:
  - `✓` Single gray tick: Sent
  - `✓✓` Double gray ticks: Delivered (recipient is online)
  - `✓✓` Double blue ticks: Read (recipient opened the conversation)
- **Message Replies, Emoji Bar, Search & Dark/Light Mode**: Double-click any message to quote-reply, filter contacts by `All` / `Unread` / `Online`, search inside conversations, and switch between WhatsApp Dark & Light themes.
- **Focused purely on Chat**: No voice/video call clutter.

## Getting Started

1. **Start the Backend Server** (port `3001`):
   ```bash
   npm run dev:server
   ```
2. **Start the React Frontend** (port `5173`):
   ```bash
   npm run dev:client
   ```
3. Open **http://localhost:5173** in two browser tabs, sign in with two usernames, and start chatting!
