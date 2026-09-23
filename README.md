# Chatter — Realtime Private Messenger

A WhatsApp/Telegram-style 1:1 chat demo built with **Nuxt 4 (Vue 3)** + **Socket.IO** + **Node**.

## Features

- **Accounts** — sign up with a **username + password** (or log back in); sessions
  are token-based and remembered on the device, so the next visit auto-logs-in.
  Only **signed-up users** are visible in the app — there are no seeded personas.
- **Recently Added** — the sidebar lists only the people you've **already messaged**,
  sorted by recency, with last-message preview, timestamp, unread badge and live
  *"typing…"* indicator.
- **Search** — just signed in with an empty list? Search by name/username to find
  any **signed-up** user, then open a chat and send your first message. The new
  person then appears under Recently Added.
- **Invites** — searching a username that **hasn't signed up yet** offers an
  invite with an optional note. It sits in pending state until that username
  creates an account; then the invite is delivered to their sidebar (dismiss or
  "Accept & chat") and you get a toast that it was accepted.
- **Profile editing** — click your avatar or the person icon at the top of the
  sidebar to edit your display name, bio, avatar color and **profile photo**
  (picked from your device, downscaled to 256px before upload). Changes propagate
  to everyone in real time (header, profile modal, search, Recently Added).
- **Private chat** — every message is delivered only to the intended person via a
  per-user Socket.IO room (`user:<id>`). No "broadcast room" leaks.
- **Rich bubbles** — own messages right (green), received left (white), grouped
  with avatar tails, timestamps, date separators, smooth slide-in animations and
  delivery/read ticks: ✓ sent, ✓✓ delivered, ✓✓ blue read.
- **Delete messages** — hover any bubble and open the action menu for WhatsApp-style
  deletion: **Delete for me** removes the message from your view only (the other
  person keeps it, no notification), while **Delete for everyone** (your own
  messages only) wipes the content server-side and replaces it with a
  *"This message was deleted"* tombstone on both sides — in history, previews and
  live chat alike.
- **Realtime** — replies appear instantly, no refresh. Typing indicators, online
  presence, read receipts and unread counts are all live.
- **Composer** — emoji picker, image attachments (sent as data-URLs), auto-growing
  input, Enter-to-send.
- **History** — message timelines are kept server-side (in memory); opening a chat
  loads it back, along with unread counts.
- **Responsive** — two-pane layout on desktop, sliding sidebar↔chat on mobile
  (<860px) with a back button.

## Run it

```bash
# Terminal 1 — Socket.IO backend + REST API (port 3001)
cd backend
npm install
npm run dev

# Terminal 2 — Nuxt frontend (port 3000)
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**.

## Auth API

| Method | Path            | Body                                  | Response |
| ------ | --------------- | ------------------------------------- | -------- |
| POST   | `/api/signup`   | `{ "username", "password", "name"? }` | `201 { token, user }` |
| POST   | `/api/login`    | `{ "username", "password" }`          | `200 { token, user }` |
| POST   | `/api/logout`   | (Bearer token)                        | `204` |
| GET    | `/api/me`       | (Bearer token)                        | `200 { user }` |
| PATCH  | `/api/me`       | `{ "name"?, "bio"?, "avatarColor"?, "avatarImage"? }` (Bearer token) | `200 { user }` |
| GET    | `/api/check-username` | `?username=...`                 | `200 { status }` — `available` / `taken` / `invalid` |
| POST   | `/api/invite`   | `{ "username", "message"? }` (Bearer token) | `201 { ok, invite }` |
| GET    | `/api/invites`  | (Bearer token)                        | `200 { invites }` |
| GET    | `/api/health`   | —                                     | `200 { ok }` |

- `400` — invalid username (2–32 chars of letters/numbers/dots/dashes/underscores)
  or a password shorter than 6 chars.
- `409` — username already taken.
- `401` — bad credentials on login (same message for unknown user / wrong password),
  or a missing/invalid token.
- Passwords are hashed with **scrypt** (`salt:hash`); tokens are random 32-byte
  hex strings stored server-side in memory. All of it is in-memory (like chat
  history), so a backend restart resets accounts and sessions.
- Only accounts created via `/api/signup` are visible: the ownership is enforced
  server-side, so presence broadcasts, search results and "Recently Added" never
  list anything else.
- `/api/invite` rejects usernames that already have an account (`409`) and
  prevents duplicate invites from the same user. When the invited username signs
  up, pending invites are claimed, delivered to them, and each inviter gets an
  `invite:accepted` socket event.

## Try the private chat

1. Open the app in **two browser tabs**.
2. In each tab **sign up** with a different username (your session token is kept,
   so a later visit signs you in automatically).
3. You'll land on an empty **Recently Added** list — type the other person's name
   in the search box, pick them, and send your first message.
4. Now they appear under **Recently Added** with unread badges, presence dots,
   typing indicators and ✓✓ read ticks.
5. Open a **third tab** and sign up with a fourth username that a friend will
   later claim — then search for it, send an **invite**, and sign that username
   up in another tab to see it delivered ("Accept & chat"). Regardless of invites,
   you can only ever reach other signed-up accounts by search.

## Architecture

```
backend/src/index.ts        Socket.IO server + REST API
  - POST /api/signup   creates account (username + scrypt-hashed password) -> token (+ claimed invites)
  - POST /api/login    verifies credentials -> new session token
  - POST /api/logout   invalidates the session token
  - GET  /api/me       returns the signed-in user
  - PATCH /api/me      updates display name / bio / avatar color / photo -> broadcasts presence so everyone sees it
  - GET  /api/check-username  availability check for the signup form (available|taken|invalid)
  - POST /api/invite   invites a username that hasn't signed up yet (Bearer token)
  - GET  /api/invites   pending invites sent to the signed-in user's username
  - GET  /api/health   server health probe
  - init            me + roster + "Recently Added" contacts (user, lastMessage, unread) + invites
  - search:users    finds signed-up users by name/username (excludes yourself)
  - invite:accepted  emitted to an inviter when the invited username signs up
  - private:message stores & emits ONLY to the receiver's room (sender/receiver/text/type/timestamp/status)
  - history         returns the pair timeline + unread count
  - read            marks messages read, resets unread, notifies the sender
  - typing          relays typing state to the receiver's room only
  - presence        broadcasts online/offline to everyone (signed-up users only)

frontend/app/
  composables/useChat.ts    socket singleton + reactive store (messages, unread, typing, presence, search, invites)
  composables/useViewport.ts
  utils/api.ts              REST client for login/signup/logout/me/invites + token storage
  utils/format.ts           time/date/avatar helpers
  components/
    LoginScreen.vue          sign-up / log-in form with live username-availability check
    ChatSidebar.vue          Recently Added list + signed-up-user search + invite box + received invites
    ChatWindow.vue           bubbles, ticks, emoji, attachments, auto-scroll, typing bubble
    UserProfileModal.vue     profile view (avatar, bio, online status)
    EditProfileModal.vue     edit display name, bio and avatar color
    BrandWelcome.vue         empty state
  pages/index.vue            shell / responsive layout + notice toast
  assets/css/main.css        design tokens + shared styles
```

## Notes

- Message history, accounts and sessions live **in memory** on the server —
  restarting the backend resets them (fine for a demo).
- Images are attached as base64 data URLs (max ~3 MB) — no upload service needed.