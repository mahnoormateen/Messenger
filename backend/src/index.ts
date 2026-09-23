import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server, type Socket } from "socket.io";
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PORT = 3001;
const CORS_ORIGIN = "http://localhost:3000";

const httpServer = createServer((req, res) => {
  void handleApi(req, res);
});

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  },
});

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
interface ChatUser {
  id: string;
  name: string;
  avatarColor: string;
  bio: string;
  /** Optional profile photo as a base64 data URL (client-side downscaled). */
  avatarImage?: string;
}

interface Account {
  userId: string;
  username: string;
  passwordHash: string;
}

type MessageType = "text" | "image";

interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  type: MessageType;
  timestamp: number;
  status: "sent" | "delivered" | "read";
  /** True once someone deleted the message "for everyone" — content is wiped and every participant sees a tombstone. */
  deletedForAll?: boolean;
  /** userIds who removed this message from their own view via "delete for me". */
  deletedFor?: string[];
}

/** An invite sent to a username that hasn't signed up yet. */
interface Invite {
  id: string;
  username: string;
  fromUserId: string;
  fromName: string;
  fromAvatarColor: string;
  fromAvatarImage?: string;
  message?: string;
  createdAt: number;
}

// -----------------------------------------------------------------------------
// Registered users (created through POST /api/signup — the only users visible
// in search / presence / Recently Added lists)
// -----------------------------------------------------------------------------
const users = new Map<string, ChatUser>();

// -----------------------------------------------------------------------------
// Accounts & passwords (in-memory — good enough for a demo)
// -----------------------------------------------------------------------------
const accountsByUsername = new Map<string, Account>();
const accountsByUserId = new Map<string, Account>();

/** scrypt hash stored as `salt:hash` — no plaintext passwords ever kept. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// -----------------------------------------------------------------------------
// Sessions (token -> userId)
// -----------------------------------------------------------------------------
const sessions = new Map<string, string>();

function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, userId);
  return token;
}

// -----------------------------------------------------------------------------
// Runtime state (in-memory — fine for a demo)
// -----------------------------------------------------------------------------
/** userId -> set of connected socket ids */
const online = new Map<string, Set<string>>();
/** userId -> last disconnect timestamp */
const lastSeen = new Map<string, number>();

/** "u1|u2" -> shared timeline between the two users */
const messagesByPair = new Map<string, ChatMessage[]>();

/** receiverId -> Map<senderId, unread count> */
const unreadByReceiver = new Map<string, Map<string, number>>();

/** usernames that haven't signed up yet -> pending invites sent to them */
const invitesByUsername = new Map<string, Invite[]>();

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

const isOnline = (userId: string) => (online.get(userId)?.size ?? 0) > 0;

function getTimeline(a: string, b: string): ChatMessage[] {
  const key = pairKey(a, b);
  let list = messagesByPair.get(key);
  if (!list) {
    list = [];
    messagesByPair.set(key, list);
  }
  return list;
}

function bumpUnread(receiverId: string, senderId: string) {
  let map = unreadByReceiver.get(receiverId) ?? new Map<string, number>();
  unreadByReceiver.set(receiverId, map);
  map.set(senderId, (map.get(senderId) ?? 0) + 1);
}

/** Recompute both directions of a pair's unread counts from the shared timeline
 *  (messages the receiver deleted "for me" no longer count). */
function recountUnread(a: string, b: string) {
  const timeline = getTimeline(a, b);
  for (const me of [a, b]) {
    const them = me === a ? b : a;
    let n = 0;
    for (const m of timeline) {
      if (m.receiverId === me && m.status !== "read" && !m.deletedForAll && !(m.deletedFor ?? []).includes(me)) n++;
    }
    let map = unreadByReceiver.get(me) ?? new Map<string, number>();
    map.set(them, n);
    unreadByReceiver.set(me, map);
  }
}

function clientUser(id: string) {
  const u = users.get(id);
  if (!u) return null;
  const account = accountsByUserId.get(id);
  if (!account) return null; // only signed-up users are discoverable
  return {
    ...u,
    username: account.username,
    online: isOnline(id),
    lastSeen: isOnline(id) ? null : (lastSeen.get(id) ?? null),
  };
}

function clientUsers() {
  return [...users.keys()].map((id) => clientUser(id)).filter(Boolean);
}

function toClientInvite(inv: Invite) {
  return {
    id: inv.id,
    username: inv.username,
    message: inv.message ?? null,
    createdAt: inv.createdAt,
    from: {
      id: inv.fromUserId,
      name: inv.fromName,
      avatarColor: inv.fromAvatarColor,
      ...(inv.fromAvatarImage ? { avatarImage: inv.fromAvatarImage } : {}),
    },
  };
}

/** Pending invites addressed to this user's username (empty for accounts with none). */
function clientInvites(userId: string) {
  const account = accountsByUserId.get(userId);
  if (!account) return [];
  return (invitesByUsername.get(account.username) ?? []).map(toClientInvite);
}

/**
 * "Recently Added" — every user the signed-in user has exchanged messages with,
 * sorted by most-recent message. Only signed-up users are included.
 */
function myContacts(userId: string) {
  const out: Array<{ user: NonNullable<ReturnType<typeof clientUser>>; lastMessage: ChatMessage; unread: number }> = [];
  for (const [key, list] of messagesByPair) {
    if (!list.length) continue;
    const [a, b] = key.split("|");
    if (a !== userId && b !== userId) continue;
    const other = a === userId ? b : a;
    const user = clientUser(other);
    if (!user) continue;
    // Messages this user deleted "for me" are invisible to them; if that's all
    // there is, this pair no longer counts as a recent conversation for them.
    const visible = list.filter((m) => !(m.deletedFor ?? []).includes(userId));
    if (!visible.length) continue;
    out.push({ user, lastMessage: visible[visible.length - 1], unread: unreadByReceiver.get(userId)?.get(other) ?? 0 });
  }
  return out.sort((x, y) => y.lastMessage.timestamp - x.lastMessage.timestamp);
}

function broadcastPresence() {
  io.emit("presence", { users: clientUsers() });
}

/** Mark previously-unsent messages as delivered now that the receiver is back online. */
function flushDeliveredFor(userId: string) {
  for (const list of messagesByPair.values()) {
    for (const m of list) {
      if (m.receiverId === userId && m.status === "sent") {
        m.status = "delivered";
        io.to(`user:${m.senderId}`).emit("message:status", { id: m.id, status: "delivered" });
      }
    }
  }
}

/** Bind a user to this socket: join their private room, track presence, send init. */
function registerConnection(socket: Socket, userId: string) {
  socket.join(`user:${userId}`);

  const set = online.get(userId) ?? new Set<string>();
  set.add(socket.id);
  online.set(userId, set);
  lastSeen.delete(userId);

  flushDeliveredFor(userId);

  socket.emit("init", { me: clientUser(userId), users: clientUsers(), contacts: myContacts(userId), invites: clientInvites(userId) });
  broadcastPresence();
}

// -----------------------------------------------------------------------------
// REST API (login / signup / logout / me)
// -----------------------------------------------------------------------------
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      raw += chunk;
      if (raw.length > limit) {
        settled = true;
        reject(new HttpError(400, "Request body too large"));
      }
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", () => reject(new HttpError(400, "Request aborted")));
  });
}

function parseBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

function avatarColorFor(seed: string): string {
  const palette = ["#00a884", "#f97316", "#3b82f6", "#ef4444", "#8b5cf6", "#10b981", "#eab308", "#ec4899"];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

async function apiSignup(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const nameRaw = typeof body.name === "string" ? body.name.trim() : "";
  const name = nameRaw ? nameRaw.slice(0, 40) : username;

  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, "Username must be 2-32 characters: letters, numbers, dots, dashes or underscores.");
  }
  if (password.length < 6) {
    throw new HttpError(400, "Password must be at least 6 characters.");
  }
  if (accountsByUsername.has(username)) {
    throw new HttpError(409, "That username is already taken.");
  }

  const userId = `user-${randomBytes(4).toString("hex")}`;
  const avatarColor = avatarColorFor(username);
  users.set(userId, { id: userId, name, avatarColor, bio: "New here 👋" });
  const account: Account = { userId, username, passwordHash: hashPassword(password) };
  accountsByUsername.set(username, account);
  accountsByUserId.set(userId, account);

  // Claim any invites that were waiting for this username and notify the inviters.
  const claimedInvites = (invitesByUsername.get(username) ?? []).map(toClientInvite);
  if (claimedInvites.length > 0) {
    invitesByUsername.delete(username);
    for (const inv of claimedInvites) {
      io.to(`user:${inv.from.id}`).emit("invite:accepted", {
        inviteId: inv.id,
        username,
        user: { id: userId, name, avatarColor },
      });
    }
  }

  const token = createSession(userId);
  sendJson(res, 201, { token, user: clientUser(userId), invites: claimedInvites });
}

async function apiLogin(req: IncomingMessage, res: ServerResponse) {
  const body = await readBody(req);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    throw new HttpError(400, "Username and password are required.");
  }

  const account = accountsByUsername.get(username);
  const valid = account && verifyPassword(password, account.passwordHash);
  if (!account || !valid) {
    // Same error for a missing user or a wrong password — don't leak which.
    throw new HttpError(401, "Invalid username or password.");
  }

  const user = clientUser(account.userId);
  if (!user) throw new HttpError(401, "Invalid username or password.");

  sendJson(res, 200, { token: createSession(account.userId), user });
}

function apiLogout(req: IncomingMessage, res: ServerResponse) {
  const token = parseBearer(req);
  if (token) sessions.delete(token);
  res.writeHead(204, corsHeaders());
  res.end();
}

function apiMe(req: IncomingMessage, res: ServerResponse) {
  const token = parseBearer(req);
  const userId = token ? sessions.get(token) : undefined;
  if (!userId) throw new HttpError(401, "Missing or invalid token.");

  const user = clientUser(userId);
  if (!user) throw new HttpError(404, "User not found.");

  sendJson(res, 200, { user });
}

/** Update the signed-in user's public profile (display name, bio, avatar color, photo). */
async function apiUpdateProfile(req: IncomingMessage, res: ServerResponse) {
  const token = parseBearer(req);
  const userId = token ? sessions.get(token) : undefined;
  if (!userId) throw new HttpError(401, "Missing or invalid token.");

  const user = users.get(userId);
  if (!user) throw new HttpError(401, "Missing or invalid token.");

  // Profiles carry a resized avatar photo, so allow a larger body for this route.
  const body = await readBody(req, 2 * 1024 * 1024);

  let name = user.name;
  if (body.name !== undefined) {
    if (typeof body.name !== "string") throw new HttpError(400, "Display name must be a string.");
    name = body.name.trim().slice(0, 40);
    if (!name) throw new HttpError(400, "Display name can't be empty.");
  }

  let bio = user.bio;
  if (body.bio !== undefined) {
    if (typeof body.bio !== "string") throw new HttpError(400, "Bio must be a string.");
    bio = body.bio.trim().slice(0, 200);
  }

  let avatarColor = user.avatarColor;
  if (body.avatarColor !== undefined) {
    if (typeof body.avatarColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.avatarColor)) {
      throw new HttpError(400, "Avatar color must be a hex color like #00a884.");
    }
    avatarColor = body.avatarColor;
  }

  let avatarImage: string | undefined = user.avatarImage;
  let imageChanged = false;
  if (body.avatarImage !== undefined) {
    imageChanged = true;
    if (body.avatarImage === null) {
      avatarImage = undefined; // removing the photo
    } else if (
      typeof body.avatarImage === "string" &&
      body.avatarImage.length <= 2_000_000 &&
      /^data:image\/(?:png|jpe?g|webp|gif);base64,/.test(body.avatarImage)
    ) {
      avatarImage = body.avatarImage;
    } else {
      throw new HttpError(400, "Avatar image must be a valid base64 image data-URL (max ~1.5 MB).");
    }
  }

  if (name !== user.name || bio !== user.bio || avatarColor !== user.avatarColor || imageChanged) {
    users.set(userId, { id: userId, name, avatarColor, bio, ...(avatarImage ? { avatarImage } : {}) });
    // Everyone (including the editor's own other tabs) picks up the new details.
    broadcastPresence();
  }

  sendJson(res, 200, { user: clientUser(userId) });
}

/** Live uniqueness check for the signup form: available | taken | invalid. */
function apiCheckUsername(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const username = (url.searchParams.get("username") ?? "").trim().toLowerCase();

  let status: "available" | "taken" | "invalid";
  if (!USERNAME_RE.test(username)) {
    status = "invalid";
  } else {
    status = accountsByUsername.has(username) ? "taken" : "available";
  }
  sendJson(res, 200, { status });
}

/** Invite a username that hasn't signed up yet (requires a signed-in account). */
async function apiInvite(req: IncomingMessage, res: ServerResponse) {
  const token = parseBearer(req);
  const userId = token ? sessions.get(token) : undefined;
  if (!userId) throw new HttpError(401, "Missing or invalid token.");

  const from = users.get(userId);
  if (!from) throw new HttpError(401, "Missing or invalid token.");

  const body = await readBody(req);
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, "Username must be 2-32 characters: letters, numbers, dots, dashes or underscores.");
  }
  if (accountsByUsername.has(username)) {
    throw new HttpError(409, "That username already has an account — send them a message instead.");
  }

  const list = invitesByUsername.get(username) ?? [];
  if (list.some((i) => i.fromUserId === userId)) {
    throw new HttpError(409, "You already invited that username.");
  }

  const message = typeof body.message === "string" ? body.message.trim().slice(0, 140) : "";
  const invite: Invite = {
    id: `inv-${Date.now()}-${randomUUID().slice(0, 6)}`,
    username,
    fromUserId: userId,
    fromName: from.name,
    fromAvatarColor: from.avatarColor,
    ...(from.avatarImage ? { fromAvatarImage: from.avatarImage } : {}),
    ...(message ? { message } : {}),
    createdAt: Date.now(),
  };
  list.push(invite);
  invitesByUsername.set(username, list);

  sendJson(res, 201, { ok: true, invite: toClientInvite(invite) });
}

/** Pending invites sent to the signed-in user's username. */
function apiInvites(req: IncomingMessage, res: ServerResponse) {
  const token = parseBearer(req);
  const userId = token ? sessions.get(token) : undefined;
  if (!userId) throw new HttpError(401, "Missing or invalid token.");
  sendJson(res, 200, { invites: clientInvites(userId) });
}

async function handleApi(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? "GET";
  const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  try {
    switch (`${method} ${path}`) {
      case "POST /api/signup": return await apiSignup(req, res);
      case "GET /api/check-username": return apiCheckUsername(req, res);
      case "POST /api/login": return await apiLogin(req, res);
      case "POST /api/logout": return apiLogout(req, res);
      case "GET /api/me": return apiMe(req, res);
      case "PATCH /api/me": return await apiUpdateProfile(req, res);
      case "POST /api/invite": return await apiInvite(req, res);
      case "GET /api/invites": return apiInvites(req, res);
      case "GET /api/health": return sendJson(res, 200, { ok: true });
      default:
        throw new HttpError(404, "Not found");
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal server error";
    if (status >= 500) console.error("[api] error:", err);
    sendJson(res, status, { error: message });
  }
}

// -----------------------------------------------------------------------------
// Socket events
// -----------------------------------------------------------------------------
/** Socket.IO auth: if a session token is provided it must be valid. */
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || !token) return next(); // anonymous status-only connection
  const userId = sessions.get(token);
  if (!userId) return next(new Error("unauthorized"));
  socket.data.userId = userId;
  next();
});

io.on("connection", (socket: Socket) => {
  // Token-authenticated sockets are auto-registered (login via REST API).
  const authedId = socket.data.userId as string | undefined;
  if (authedId) registerConnection(socket, authedId);

  socket.on("history", ({ with: otherId }: { with: string }) => {
    const me = socket.data.userId as string | undefined;
    if (!me || !otherId) return;
    socket.emit("history", {
      with: otherId,
      messages: getTimeline(me, otherId).filter((m) => !(m.deletedFor ?? []).includes(me)),
      unread: unreadByReceiver.get(me)?.get(otherId) ?? 0,
    });
  });

  /** Find signed-up users to start a new chat with (excludes yourself). */
  socket.on("search:users", ({ q }: { q?: string }) => {
    const me = socket.data.userId as string | undefined;
    if (!me) return;
    const needle = String(q ?? "").trim().toLowerCase();
    const list = [...users.keys()]
      .map((id) => clientUser(id))
      .filter((u): u is NonNullable<typeof u> => u !== null && u.id !== me)
      .filter((u) => !needle || u.name.toLowerCase().includes(needle) || (u.username ?? "").toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
    socket.emit("search:results", { q: needle, users: list });
  });

  socket.on("private:message", (payload, ack?: (r: unknown) => void) => {
    const me = socket.data.userId as string | undefined;
    const to = payload?.to as string | undefined;
    const type: MessageType = payload?.type === "image" ? "image" : "text";
    const content = String(payload?.text ?? "").trim();

    if (!me || !to || !users.has(to) || !content) return;

    const message: ChatMessage = {
      id: `m-${Date.now()}-${randomUUID().slice(0, 6)}`,
      senderId: me,
      receiverId: to,
      text: content,
      type,
      timestamp: Date.now(),
      status: "sent",
    };

    getTimeline(me, to).push(message);
    bumpUnread(to, me);

    // Confirm to the sender (so optimistic UI can swap temp id -> server id)
    ack?.({ ok: true, tempId: payload.tempId, message });

    const delivered = isOnline(to);
    if (delivered) {
      message.status = "delivered";
      socket.emit("message:status", { id: message.id, status: "delivered" });
    }

    // Private delivery: only the receiver's room gets this message.
    io.to(`user:${to}`).emit("private:message", message);
  });

  /**
   * WhatsApp-style message deletion.
   * - mode "me":       removes the message from THIS user's view only (no broadcast —
   *                    the peer's copy is untouched).
   * - mode "everyone": only allowed on your own messages; wipes the content server-side
   *                    and tells both participants to render a "This message was deleted"
   *                    tombstone in place of the bubble.
   */
  socket.on("message:delete", (payload: { messageId?: string; mode?: string }, ack?: (r?: unknown) => void) => {
    const me = socket.data.userId as string | undefined;
    const messageId = payload?.messageId;
    const mode = payload?.mode === "everyone" ? "everyone" : "me";
    if (!me || typeof messageId !== "string" || !messageId) {
      ack?.({ ok: false, error: "Invalid request." });
      return;
    }

    let found: ChatMessage | null = null;
    let key = "";
    for (const [pair, list] of messagesByPair) {
      const m = list.find((x) => x.id === messageId);
      if (m) { found = m; key = pair; break; }
    }
    if (!found) {
      ack?.({ ok: false, error: "Message not found." });
      return;
    }
    const [a, b] = key.split("|");
    if (a !== me && b !== me) {
      ack?.({ ok: false, error: "You are not part of this conversation." });
      return;
    }

    if (mode === "everyone") {
      if (found.senderId !== me) {
        ack?.({ ok: false, error: "You can only delete your own messages for everyone." });
        return;
      }
      found.deletedForAll = true;
      found.text = ""; // the content is truly gone — both sides only keep a tombstone
      delete found.deletedFor;
      io.to(`user:${found.senderId}`).emit("message:deleted", { message: found });
      io.to(`user:${found.receiverId}`).emit("message:deleted", { message: found });
      recountUnread(a, b);
      ack?.({ ok: true, message: found });
    } else {
      // Delete for me — the peer keeps seeing the message exactly as before.
      const hidden = found.deletedFor ?? [];
      if (!hidden.includes(me)) hidden.push(me);
      found.deletedFor = hidden;
      recountUnread(a, b);
      ack?.({ ok: true, message: found, unread: unreadByReceiver.get(me)?.get(a === me ? b : a) ?? 0 });
    }
  });

  /**
   * WhatsApp-style "delete chat": clears the ENTIRE conversation with another
   * user from THIS user's view only — the peer keeps their copy untouched.
   * Unread resets and the pair drops out of "Recently Added" for this user
   * (history then returns an empty timeline). The user's own other tabs are
   * told to clear it too via their private room, so every tab stays in sync.
   */
  socket.on("chat:clear", ({ with: otherId }: { with: string }, ack?: (r?: unknown) => void) => {
    const me = socket.data.userId as string | undefined;
    if (!me || typeof otherId !== "string" || !otherId) {
      ack?.({ ok: false, error: "Invalid request." });
      return;
    }
    for (const m of getTimeline(me, otherId)) {
      const hidden = m.deletedFor ?? [];
      if (!hidden.includes(me)) hidden.push(me);
      m.deletedFor = hidden;
    }
    recountUnread(me, otherId);
    ack?.({ ok: true, unread: unreadByReceiver.get(me)?.get(otherId) ?? 0 });
    // My other browser tabs share this account — mirror the clear there.
    io.to(`user:${me}`).emit("chat:cleared", { with: otherId });
  });

  socket.on("read", ({ from }: { from: string }) => {
    const me = socket.data.userId as string | undefined;
    if (!me || !from) return;

    let changed = false;
    for (const m of getTimeline(me, from)) {
      if (m.senderId === from && m.receiverId === me && m.status !== "read") {
        m.status = "read";
        changed = true;
      }
    }
    unreadByReceiver.get(me)?.set(from, 0);
    if (changed) {
      io.to(`user:${from}`).emit("messages:read", { by: me });
    }
  });

  socket.on("typing", ({ to, isTyping }: { to: string; isTyping: boolean }) => {
    const me = socket.data.userId as string | undefined;
    if (!me || !to) return;
    io.to(`user:${to}`).emit("typing", { from: me, isTyping: Boolean(isTyping) });
  });

  socket.on("get:presence", () => {
    const me = socket.data.userId as string | undefined;
    if (me) socket.emit("presence", { users: clientUsers() });
  });

  socket.on("disconnect", () => {
    const userId = socket.data.userId as string | undefined;
    if (!userId) return;

    const set = online.get(userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        online.delete(userId);
        lastSeen.set(userId, Date.now());
      }
    }
    broadcastPresence();
  });
});

httpServer.listen(PORT, () => {
  console.log(`⚡ Chatter backend running on http://localhost:${PORT}`);
  console.log("   REST API: POST /api/login · POST /api/signup · POST /api/logout · GET/PATCH /api/me");
});