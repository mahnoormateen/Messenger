import { io, type Socket } from "socket.io-client";
import { reactive, ref, computed } from "vue";
import {
  getStoredToken,
  setStoredToken,
  clearStoredToken,
  loginAPI,
  signupAPI,
  logoutAPI,
  inviteAPI,
  updateProfileAPI,
  type AuthUser,
  type Invite,
} from "~/utils/api";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export interface ChatUser {
  id: string;
  name: string;
  email?: string;
  username?: string | null;
  avatarColor: string;
  avatarImage?: string | null;
  bio: string;
  online: boolean;
  lastSeen: number | null;
}

export type MessageType = "text" | "image";
export type MessageStatus = "sent" | "delivered" | "read";

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  type: MessageType;
  timestamp: number;
  status: MessageStatus;
  /** True once someone deleted the message "for everyone" — render a tombstone, content is gone. */
  deletedForAll?: boolean;
  /** userIds that removed this message from their own view ("delete for me"). */
  deletedFor?: string[];
}

const WS_URL = "http://localhost:3001";

let socket: Socket | null = null;
let listenersBound = false;
const typingLastSent = new Map<string, number>();
const typingReset = new Map<string, ReturnType<typeof setTimeout>>();

// -----------------------------------------------------------------------------
// Reactive state (singleton, shared across the whole app)
// -----------------------------------------------------------------------------
export const connectionStatus = ref<"connecting" | "connected" | "disconnected">("connecting");
export const me = ref<ChatUser | null>(null);
export const users = ref<Record<string, ChatUser>>({});
export const activeChatId = ref<string | null>(null);
/** Set when a stored session is rejected by the server (expired/invalid token). */
export const authError = ref<string | null>(null);
/** Results of the last server-side user search (only signed-up users). */
export const searchResults = ref<ChatUser[]>([]);
/** Pending invites sent to my username by people who invited me before I signed up. */
export const invites = ref<Invite[]>([]);
/** Usernames I've already invited (username -> invite), so re-searching shows "Invite sent". */
export const sentInvites = reactive(new Map<string, Invite>());
/** Transient toast message (e.g. "your invite was accepted"). */
export const notice = ref<string | null>(null);

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const messagesByUser = reactive(new Map<string, ChatMessage[]>());
const lastMessageByUser = reactive(new Map<string, ChatMessage>());
const unreadByUser = reactive(new Map<string, number>());
const typingByUser = reactive(new Map<string, boolean>());

// -----------------------------------------------------------------------------
// Selectors
// -----------------------------------------------------------------------------
export const liveUsers = computed<ChatUser[]>(() => Object.values(users.value));

export function getUserById(id: string | null | undefined): ChatUser | null {
  return id ? (users.value[id] ?? null) : null;
}
export function getMessagesFor(userId: string): ChatMessage[] {
  return messagesByUser.get(userId) ?? [];
}
export function getUnreadFor(userId: string): number {
  return unreadByUser.get(userId) ?? 0;
}
export function getTypingFor(userId: string): boolean {
  return typingByUser.get(userId) ?? false;
}
export function getLastMessageFor(userId: string): ChatMessage | null {
  return lastMessageByUser.get(userId) ?? null;
}

/** Whether there is any conversation history with this user (a "Recently Added" contact). */
export function hasConversation(userId: string): boolean {
  return lastMessageByUser.has(userId) || (messagesByUser.get(userId)?.length ?? 0) > 0;
}

// -----------------------------------------------------------------------------
// Socket setup (lazy, client-only)
// -----------------------------------------------------------------------------
function applyUsers(list: ChatUser[]) {
  const next: Record<string, ChatUser> = {};
  for (const u of list) next[u.id] = u;
  users.value = next;
}

/** Merge invite lists by id without duplicates (server may send them in `init` and again on signup). */
function mergeInvites(list: Invite[]) {
  const byId = new Map(invites.value.map((i) => [i.id, i] as const));
  for (const inv of list) byId.set(inv.id, inv);
  invites.value = [...byId.values()];
}

function showNotice(text: string) {
  notice.value = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.value = null), 6000);
}

function onIncoming(m: ChatMessage) {
  const list = messagesByUser.get(m.senderId) ?? [];
  list.push(m);
  messagesByUser.set(m.senderId, list);
  lastMessageByUser.set(m.senderId, m);

  if (activeChatId.value === m.senderId) {
    // Chat is open — instantly considered read.
    unreadByUser.set(m.senderId, 0);
    socket?.emit("read", { from: m.senderId });
  } else {
    unreadByUser.set(m.senderId, (unreadByUser.get(m.senderId) ?? 0) + 1);
  }
}

function replaceTemp(tempId: string, serverMsg: ChatMessage) {
  for (const [key, list] of messagesByUser) {
    const i = list.findIndex((m) => m.id === tempId);
    if (i >= 0) {
      // Keep the local entry (content + status) but adopt the server's id/timestamp
      // so later read/delivery status events match.
      list[i] = { ...list[i], id: serverMsg.id, timestamp: serverMsg.timestamp };
      const lm = lastMessageByUser.get(key);
      if (lm && lm.id === tempId) lastMessageByUser.set(key, { ...lm, id: serverMsg.id, timestamp: serverMsg.timestamp });
      break;
    }
  }
}

function updateStatus(id: string, status: MessageStatus) {
  for (const list of messagesByUser.values()) {
    const m = list.find((x) => x.id === id);
    if (m && (m.status === "sent" || m.status === "delivered")) m.status = status;
  }
}

// -----------------------------------------------------------------------------
// Message deletion (WhatsApp-style: "delete for me" / "delete for everyone")
// -----------------------------------------------------------------------------

function findMessageById(id: string): ChatMessage | null {
  for (const list of messagesByUser.values()) {
    const m = list.find((x) => x.id === id);
    if (m) return m;
  }
  return null;
}

/** Replace a message with the server's updated copy (used for delete-for-everyone tombstones). */
function applyDeletedMessage(serverMsg: ChatMessage) {
  for (const [key, list] of messagesByUser) {
    const i = list.findIndex((m) => m.id === serverMsg.id);
    if (i >= 0) {
      list[i] = serverMsg;
      const lm = lastMessageByUser.get(key);
      if (lm && lm.id === serverMsg.id) lastMessageByUser.set(key, serverMsg);
      return;
    }
  }
}

/** Remove a message from my view entirely ("delete for me"). */
function removeMessageForMe(msgId: string) {
  for (const [key, list] of messagesByUser) {
    const i = list.findIndex((m) => m.id === msgId);
    if (i >= 0) {
      list.splice(i, 1);
      const lm = lastMessageByUser.get(key);
      if (lm && lm.id === msgId) {
        const prev = list[list.length - 1];
        if (prev) lastMessageByUser.set(key, prev);
        else lastMessageByUser.delete(key);
      }
      if (list.length === 0) messagesByUser.delete(key);
      return;
    }
  }
}

/**
 * WhatsApp-style deletion.
 * - "me":       drops the message from MY view; the peer keeps it (no notification to them).
 * - "everyone": replaces the message with a "This message was deleted" tombstone on both
 *               sides (only possible for messages I sent — the server enforces this).
 */
export function deleteMessage(messageId: string, mode: "me" | "everyone") {
  const s = socket;
  if (!s?.connected) {
    showNotice("You're offline — could not delete the message.");
    return;
  }
  if (mode === "everyone") {
    const original = findMessageById(messageId);
    if (!original) return;
    // Optimistic tombstone while the server confirms, so the action feels instant.
    applyDeletedMessage({ ...original, deletedForAll: true, text: "" });
    s.emit("message:delete", { messageId, mode }, (resp?: { ok?: boolean; message?: ChatMessage; error?: string }) => {
      if (resp?.ok && resp.message) {
        applyDeletedMessage(resp.message); // adopt the server's canonical tombstone
      } else {
        showNotice(resp?.error ?? "Could not delete the message.");
        if (original) applyDeletedMessage(original); // server refused — restore
      }
    });
  } else {
    const target = findMessageById(messageId);
    if (!target) return;
    removeMessageForMe(messageId);
    s.emit("message:delete", { messageId, mode }, (resp?: { ok?: boolean; error?: string; unread?: number }) => {
      if (resp?.ok) {
        if (typeof resp.unread === "number" && activeChatId.value) unreadByUser.set(activeChatId.value, resp.unread);
      } else {
        showNotice(resp?.error ?? "Could not delete the message.");
      }
    });
  }
}

/**
 * WhatsApp-style "delete chat": removes the whole conversation with a user
 * from MY view (messages, sidebar preview, unread, typing). The peer keeps
 * their copy, and the pair drops out of "Recently Added" for me. If that chat
 * is currently open it closes.
 */
export function clearChat(userId: string) {
  const s = socket;
  if (!s?.connected) {
    showNotice("You're offline — could not delete the chat.");
    return;
  }
  messagesByUser.delete(userId);
  lastMessageByUser.delete(userId);
  unreadByUser.delete(userId);
  typingByUser.delete(userId);
  if (activeChatId.value === userId) activeChatId.value = null;
  s.emit("chat:clear", { with: userId }, (resp?: { ok?: boolean; error?: string }) => {
    if (!resp?.ok) showNotice(resp?.error ?? "Could not delete the chat.");
  });
}

/** Drop all chat/session state and disconnect (used on logout / session expiry). */
function resetSessionState() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  me.value = null;
  activeChatId.value = null;
  messagesByUser.clear();
  lastMessageByUser.clear();
  unreadByUser.clear();
  typingByUser.clear();
  searchResults.value = [];
  invites.value = [];
  sentInvites.clear();
  notice.value = null;
  if (noticeTimer) clearTimeout(noticeTimer);
  users.value = {};
  connectionStatus.value = "disconnected";
}

export function connectSocket(): Socket | null {
  if (typeof window === "undefined") return null;
  if (socket) return socket;

  // If a session token is stored, the server signs this socket in automatically.
  const token = getStoredToken();
  socket = io(WS_URL, {
    transports: ["websocket", "polling"],
    auth: token ? { token } : undefined,
  });

  socket.on("connect", () => (connectionStatus.value = "connected"));
  socket.on("disconnect", () => (connectionStatus.value = "disconnected"));
  socket.on("connect_error", (err: Error) => {
    connectionStatus.value = "disconnected";
    if (err.message === "unauthorized") {
      // The stored session no longer exists on the server — clear it.
      clearStoredToken();
      authError.value = "Session expired — please sign in again.";
      resetSessionState();
    }
  });

  socket.on("init", (p: { me?: ChatUser; users?: ChatUser[]; contacts?: Array<{ user: ChatUser; lastMessage: ChatMessage; unread: number }>; invites?: Invite[] }) => {
    if (p.me) me.value = p.me;
    if (p.users) applyUsers(p.users);
    // Seed the "Recently Added" list from the server without loading full histories.
    for (const c of p.contacts ?? []) {
      lastMessageByUser.set(c.user.id, c.lastMessage);
      unreadByUser.set(c.user.id, c.unread);
    }
    if (p.invites?.length) mergeInvites(p.invites);
  });
  socket.on("presence", (p: { users?: ChatUser[] }) => {
    if (p.users) applyUsers(p.users);
  });

  socket.on("search:results", (p: { q?: string; users?: ChatUser[] }) => {
    searchResults.value = p.users ?? [];
  });

  socket.on("history", (p: { with: string; messages: ChatMessage[]; unread: number }) => {
    messagesByUser.set(p.with, p.messages ?? []);
    unreadByUser.set(p.with, 0);
    if (activeChatId.value === p.with) socket?.emit("read", { from: p.with });
  });

  socket.on("private:message", (m: ChatMessage) => onIncoming(m));
  socket.on("message:status", (p: { id: string; status: MessageStatus }) => updateStatus(p.id, p.status));

  // The peer (or my own other tab) chose "delete for everyone" — swap in the tombstone.
  socket.on("message:deleted", (p: { message: ChatMessage }) => {
    if (p?.message) applyDeletedMessage(p.message);
  });

  // One of my other tabs deleted a whole chat — mirror it here.
  socket.on("chat:cleared", (p: { with: string }) => {
    if (!p?.with) return;
    messagesByUser.delete(p.with);
    lastMessageByUser.delete(p.with);
    unreadByUser.delete(p.with);
    typingByUser.delete(p.with);
    if (activeChatId.value === p.with) activeChatId.value = null;
  });

  socket.on("messages:read", (p: { by: string }) => {
    const myId = me.value?.id;
    if (myId) {
      for (const list of messagesByUser.values()) {
        for (const m of list) {
          if (m.senderId === myId && m.receiverId === p.by && m.status !== "read") m.status = "read";
        }
      }
    }
    unreadByUser.set(p.by, 0);
  });

  socket.on("typing", (p: { from: string; isTyping: boolean }) => {
    const timer = typingReset.get(p.from);
    if (timer) clearTimeout(timer);
    if (p.isTyping) {
      typingByUser.set(p.from, true);
      typingReset.set(p.from, setTimeout(() => typingByUser.set(p.from, false), 4000));
    } else {
      typingByUser.set(p.from, false);
    }
  });

  socket.on("invite:accepted", (p: { inviteId: string; username: string; user: { id: string; name: string } }) => {
    sentInvites.delete(p.username);
    showNotice(`✨ ${p.user.name} (@${p.username}) joined Chatter — your invite was accepted.`);
    // The new user reaches everyone via the presence broadcast; also open a chat shortcut is overkill.
  });

  return socket;
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------
/** Reconnect the socket carrying a session token and wait until it's live. */
function connectWithToken(token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = connectSocket();
    if (!s) return reject(new Error("Chat socket unavailable"));
    if (s.connected) return resolve();

    const timer = setTimeout(() => {
      s.off("connect", onOk);
      s.off("connect_error", onErr);
      reject(new Error("Timed out connecting to the chat server."));
    }, 6000);

    function onOk() {
      clearTimeout(timer);
      s.off("connect", onOk);
      s.off("connect_error", onErr);
      resolve();
    }
    function onErr(err: Error) {
      clearTimeout(timer);
      s.off("connect", onOk);
      s.off("connect_error", onErr);
      reject(
        new Error(
          err.message === "unauthorized"
            ? "Session expired — please sign in again."
            : "Could not connect to the chat server.",
        ),
      );
    }

    s.once("connect", onOk);
    s.once("connect_error", onErr);
  });
}

/** Store the session, then reconnect the socket authenticated with its token. */
async function establishSession(token: string, user: AuthUser) {
  setStoredToken(token);
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  me.value = user; // optimistic — the server confirms via `init` on connect
  try {
    await connectWithToken(token);
  } catch (err) {
    resetSessionState();
    throw err;
  }
}

export async function loginUser(username: string, password: string): Promise<void> {
  authError.value = null;
  const { token, user } = await loginAPI(username, password);
  await establishSession(token, user);
}

export async function signupUser(payload: { username: string; password: string; name?: string }): Promise<void> {
  authError.value = null;
  const { token, user, invites: claimed = [] } = await signupAPI(payload);
  // Invites that were waiting for this username become visible right after signup.
  if (claimed.length) mergeInvites(claimed);
  await establishSession(token, user);
}

export async function logoutUser(): Promise<void> {
  const token = getStoredToken();
  if (token) {
    try {
      await logoutAPI(token);
    } catch {
      // token may already be dead server-side — ignore
    }
  }
  clearStoredToken();
  if (typeof window !== "undefined") window.localStorage.removeItem("chatter.user"); // legacy key
  resetSessionState();
  connectionStatus.value = "connecting";
  connectSocket(); // anonymous status-only socket for the login screen
}

export function openChat(userId: string) {
  const s = connectSocket();
  if (!s) return;
  activeChatId.value = userId;
  unreadByUser.set(userId, 0);
  s.emit("history", { with: userId });
  s.emit("read", { from: userId });
}

/** Ask the server for signed-up users whose name/username matches the query. */
export function searchUsers(q: string) {
  const s = connectSocket();
  if (!s) return;
  s.emit("search:users", { q });
}

export function clearSearch() {
  searchResults.value = [];
}

/** Send an invite to a username that hasn't signed up yet. */
export async function sendInvite(username: string, message?: string): Promise<Invite> {
  const token = getStoredToken();
  if (!token) throw new Error("You must be signed in to invite someone.");
  const res = await inviteAPI(token, username, message);
  sentInvites.set(res.invite.username, res.invite);
  return res.invite;
}

/** Remove an invite without acting on it. */
export function dismissInvite(id: string) {
  invites.value = invites.value.filter((i) => i.id !== id);
}

/** Accept an invite: open a private chat with the person who invited you. */
export function acceptInvite(id: string) {
  const inv = invites.value.find((i) => i.id === id);
  invites.value = invites.value.filter((i) => i.id !== id);
  if (inv) {
    openChat(inv.from.id);
    showNotice(`💬 You're now chatting with ${inv.from.name}.`);
  }
}

/** Update my public profile (display name, bio, avatar color, photo).
 *  The server broadcasts the new details to everyone via the presence event. */
export async function updateProfile(patch: {
  name?: string;
  bio?: string;
  avatarColor?: string;
  avatarImage?: string | null;
}): Promise<ChatUser> {
  const token = getStoredToken();
  if (!token) throw new Error("You must be signed in to edit your profile.");
  const { user } = await updateProfileAPI(token, patch);
  me.value = user;
  showNotice("✨ Profile updated.");
  return user;
}

export function closeChat() {
  activeChatId.value = null;
}

export function sendMessage(text: string, type: MessageType = "text"): boolean {
  const to = activeChatId.value;
  const self = me.value;
  const content = type === "image" ? text : text.trim();
  if (!socket || !to || !self || !content) return false;

  const msg: ChatMessage = {
    id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    senderId: self.id,
    receiverId: to,
    text: content,
    type,
    timestamp: Date.now(),
    status: "sent",
  };

  const list = messagesByUser.get(to) ?? [];
  list.push(msg);
  messagesByUser.set(to, list);
  lastMessageByUser.set(to, msg);

  socket.emit("private:message", { tempId: msg.id, to, text: content, type }, (resp?: { ok?: boolean; tempId?: string; message?: ChatMessage }) => {
    if (resp?.message) replaceTemp(resp.tempId ?? msg.id, resp.message);
  });
  return true;
}

export function sendTyping(to: string, isTyping: boolean) {
  if (!socket) return;
  const now = Date.now();
  if (isTyping) {
    const last = typingLastSent.get(to) ?? 0;
    if (now - last < 350) return; // throttle
    typingLastSent.set(to, now);
  } else {
    typingLastSent.delete(to);
  }
  socket.emit("typing", { to, isTyping });
}

export function signOut() {
  void logoutUser();
}