import { Pool } from "pg";

// -----------------------------------------------------------------------------
// Connection — override with DATABASE_URL when your setup differs.
// Default matches the local demo instance (postgres@localhost:5433/chatter).
// -----------------------------------------------------------------------------
export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:1234@localhost:5433/chatter",
});

// -----------------------------------------------------------------------------
// Row types (snake_case columns -> camelCase properties)
// -----------------------------------------------------------------------------
export interface UserRow {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  avatarColor: string;
  bio: string;
  avatarImage: string | null;
  lastSeen: number | null;
}

export type MessageType = "text" | "image";
export type MessageStatus = "sent" | "delivered" | "read";

export interface MessageRow {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  type: MessageType;
  timestamp: number;
  status: MessageStatus;
  deletedForAll: boolean;
  deletedFor: string[];
}

export interface InviteRow {
  id: string;
  username: string;
  fromUserId: string;
  fromName: string;
  fromAvatarColor: string;
  fromAvatarImage: string | null;
  message: string | null;
  createdAt: number;
}

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  avatar_color  TEXT NOT NULL,
  bio           TEXT NOT NULL DEFAULT '',
  avatar_image  TEXT,
  last_seen     BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
  token   TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  sender_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text            TEXT NOT NULL DEFAULT '',
  type            TEXT NOT NULL DEFAULT 'text',
  timestamp       BIGINT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent',
  deleted_for_all BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_for     TEXT[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS invites (
  id                 TEXT PRIMARY KEY,
  username           TEXT NOT NULL,
  from_user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_name          TEXT NOT NULL,
  from_avatar_color  TEXT NOT NULL,
  from_avatar_image  TEXT,
  message            TEXT,
  created_at         BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_sender   ON messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages (receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_pair     ON messages (sender_id, receiver_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_del_for  ON messages USING GIN (deleted_for);
CREATE INDEX IF NOT EXISTS idx_invites_username  ON invites (username);
`;

export async function initDb(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

// -----------------------------------------------------------------------------
// Row mappers
// -----------------------------------------------------------------------------
function mapUser(r: Record<string, unknown>): UserRow {
  return {
    id: String(r.id),
    username: String(r.username),
    passwordHash: String(r.password_hash),
    name: String(r.name),
    avatarColor: String(r.avatar_color),
    bio: String(r.bio ?? ""),
    avatarImage: r.avatar_image == null ? null : String(r.avatar_image),
    lastSeen: r.last_seen == null ? null : Number(r.last_seen),
  };
}

function mapMessage(r: Record<string, unknown>): MessageRow {
  return {
    id: String(r.id),
    senderId: String(r.sender_id),
    receiverId: String(r.receiver_id),
    text: String(r.text ?? ""),
    type: (String(r.type) as MessageType) || "text",
    timestamp: Number(r.timestamp),
    status: (String(r.status) as MessageStatus) || "sent",
    deletedForAll: Boolean(r.deleted_for_all),
    deletedFor: Array.isArray(r.deleted_for) ? (r.deleted_for as string[]) : [],
  };
}

function mapInvite(r: Record<string, unknown>): InviteRow {
  return {
    id: String(r.id),
    username: String(r.username),
    fromUserId: String(r.from_user_id),
    fromName: String(r.from_name),
    fromAvatarColor: String(r.from_avatar_color),
    fromAvatarImage: r.from_avatar_image == null ? null : String(r.from_avatar_image),
    message: r.message == null ? null : String(r.message),
    createdAt: Number(r.created_at),
  };
}

// -----------------------------------------------------------------------------
// Users / accounts
// -----------------------------------------------------------------------------
export async function createUser(input: {
  id: string;
  username: string;
  passwordHash: string;
  name: string;
  avatarColor: string;
  bio: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, username, password_hash, name, avatar_color, bio)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.id, input.username, input.passwordHash, input.name, input.avatarColor, input.bio],
  );
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function getUserByUsername(username: string): Promise<UserRow | null> {
  const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function usernameExists(username: string): Promise<boolean> {
  const { rows } = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
  return rows.length > 0;
}

export async function updateUserProfile(
  id: string,
  patch: { name?: string; bio?: string; avatarColor?: string; avatarImage?: string | null },
): Promise<UserRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.name !== undefined) {
    sets.push(`name = $${i++}`);
    values.push(patch.name);
  }
  if (patch.bio !== undefined) {
    sets.push(`bio = $${i++}`);
    values.push(patch.bio);
  }
  if (patch.avatarColor !== undefined) {
    sets.push(`avatar_color = $${i++}`);
    values.push(patch.avatarColor);
  }
  if (patch.avatarImage !== undefined) {
    sets.push(`avatar_image = $${i++}`);
    values.push(patch.avatarImage);
  }
  if (!sets.length) return getUserById(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    [...values, id],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function setLastSeen(id: string, ts: number): Promise<void> {
  await pool.query("UPDATE users SET last_seen = $1 WHERE id = $2", [ts, id]);
}

// -----------------------------------------------------------------------------
// Sessions
// -----------------------------------------------------------------------------
export async function createSession(token: string, userId: string): Promise<void> {
  await pool.query("INSERT INTO sessions (token, user_id) VALUES ($1, $2)", [token, userId]);
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function getSessionUserId(token: string): Promise<string | null> {
  const { rows } = await pool.query("SELECT user_id FROM sessions WHERE token = $1", [token]);
  return rows[0] ? String(rows[0].user_id) : null;
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------
export async function insertMessage(msg: Omit<MessageRow, "deletedForAll" | "deletedFor">): Promise<void> {
  await pool.query(
    `INSERT INTO messages (id, sender_id, receiver_id, text, type, timestamp, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [msg.id, msg.senderId, msg.receiverId, msg.text, msg.type, msg.timestamp, msg.status],
  );
}

export async function getTimeline(a: string, b: string): Promise<MessageRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
     ORDER BY timestamp ASC`,
    [a, b],
  );
  return rows.map(mapMessage);
}

export async function getMessageById(id: string): Promise<MessageRow | null> {
  const { rows } = await pool.query("SELECT * FROM messages WHERE id = $1", [id]);
  return rows[0] ? mapMessage(rows[0]) : null;
}

/** Mark every message `from` -> `to` as delivered. Returns the changed messages. */
export async function markDeliveredFor(userId: string): Promise<MessageRow[]> {
  const { rows } = await pool.query(
    `UPDATE messages SET status = 'delivered'
     WHERE receiver_id = $1 AND status = 'sent'
     RETURNING *`,
    [userId],
  );
  return rows.map(mapMessage);
}

/** Mark all messages `from` -> `to` as read. Returns true when anything changed. */
export async function markRead(from: string, to: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE messages SET status = 'read'
     WHERE sender_id = $1 AND receiver_id = $2 AND status <> 'read'`,
    [from, to],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteForEveryone(id: string): Promise<MessageRow | null> {
  const { rows } = await pool.query(
    `UPDATE messages SET deleted_for_all = TRUE, text = '', deleted_for = '{}'
     WHERE id = $1 RETURNING *`,
    [id],
  );
  return rows[0] ? mapMessage(rows[0]) : null;
}

/** Add `userId` to deleted_for unless it's already there. */
export async function deleteForUser(id: string, userId: string): Promise<MessageRow | null> {
  const { rows } = await pool.query(
    `UPDATE messages SET deleted_for = (SELECT array_agg(DISTINCT x)
       FROM unnest(deleted_for || $2) AS x)
     WHERE id = $1 AND NOT (deleted_for @> $2)
     RETURNING *`,
    [id, [userId]],
  );
  return rows[0] ? mapMessage(rows[0]) : null;
}

/** Add `userId` to deleted_for on every message in the pair timeline. */
export async function clearChatFor(a: string, b: string, userId: string): Promise<void> {
  await pool.query(
    `UPDATE messages
     SET deleted_for = (SELECT array_agg(DISTINCT x)
       FROM unnest(deleted_for || $3) AS x)
     WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
       AND NOT (deleted_for @> $3)`,
    [a, b, [userId]],
  );
}

/** Unread count: messages from `other` -> `me`, not read, not deleted for me. */
export async function unreadFor(me: string, other: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM messages
     WHERE sender_id = $1 AND receiver_id = $2
       AND status <> 'read'
       AND deleted_for_all = FALSE
       AND NOT (deleted_for @> ARRAY[$2::text])`,
    [other, me],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * "Recently Added" — every user `me` has exchanged visible messages with,
 * including the last visible message and the current unread count.
 */
export async function contactsWithLastMessage(me: string): Promise<
  Array<{ user: UserRow; lastMessage: MessageRow; unread: number }>
> {
  const { rows } = await pool.query(
    `WITH pairs AS (
       SELECT DISTINCT other_id FROM (
         SELECT receiver_id AS other_id FROM messages WHERE sender_id = $1
         UNION
         SELECT sender_id AS other_id FROM messages WHERE receiver_id = $1
       ) t
     )
     SELECT u.*,
            m.id AS m_id, m.sender_id AS m_sender_id, m.receiver_id AS m_receiver_id,
            m.text AS m_text, m.type AS m_type, m.timestamp AS m_timestamp, m.status AS m_status,
            m.deleted_for_all AS m_deleted_for_all, m.deleted_for AS m_deleted_for,
            (SELECT count(*)::int FROM messages un
              WHERE un.sender_id = u.id AND un.receiver_id = $1
                AND un.status <> 'read' AND un.deleted_for_all = FALSE
                AND NOT (un.deleted_for @> ARRAY[$1::text])) AS unread
     FROM pairs p
     JOIN users u ON u.id = p.other_id
     JOIN LATERAL (
       SELECT * FROM messages m
       WHERE ((m.sender_id = $1 AND m.receiver_id = u.id)
           OR (m.sender_id = u.id AND m.receiver_id = $1))
         AND NOT (m.deleted_for @> ARRAY[$1::text])
       ORDER BY m.timestamp DESC
       LIMIT 1
     ) m ON TRUE`,
    [me],
  );
  return rows.map((r) => ({
    user: mapUser(r),
    lastMessage: mapMessage({
      id: r.m_id,
      sender_id: r.m_sender_id,
      receiver_id: r.m_receiver_id,
      text: r.m_text,
      type: r.m_type,
      timestamp: r.m_timestamp,
      status: r.m_status,
      deleted_for_all: r.m_deleted_for_all,
      deleted_for: r.m_deleted_for,
    }),
    unread: Number(r.unread ?? 0),
  }));
}

/** Search signed-up users by display name or username (case-insensitive). */
export async function searchUsers(q: string, excludeId: string): Promise<UserRow[]> {
  if (!q) {
    const { rows } = await pool.query("SELECT * FROM users WHERE id <> $1 ORDER BY name", [excludeId]);
    return rows.map(mapUser);
  }
  const needle = `%${q}%`;
  const { rows } = await pool.query(
    `SELECT * FROM users
     WHERE id <> $1 AND (name ILIKE $2 OR username ILIKE $2)
     ORDER BY name`,
    [excludeId, needle],
  );
  return rows.map(mapUser);
}

export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await pool.query("SELECT * FROM users ORDER BY name");
  return rows.map(mapUser);
}

// -----------------------------------------------------------------------------
// Invites
// -----------------------------------------------------------------------------
export async function insertInvite(inv: InviteRow): Promise<void> {
  await pool.query(
    `INSERT INTO invites (id, username, from_user_id, from_name, from_avatar_color, from_avatar_image, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      inv.id,
      inv.username,
      inv.fromUserId,
      inv.fromName,
      inv.fromAvatarColor,
      inv.fromAvatarImage,
      inv.message,
      inv.createdAt,
    ],
  );
}

export async function getInvitesByUsername(username: string): Promise<InviteRow[]> {
  const { rows } = await pool.query(
    "SELECT * FROM invites WHERE username = $1 ORDER BY created_at ASC",
    [username],
  );
  return rows.map(mapInvite);
}

export async function hasInviteFrom(username: string, fromUserId: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT 1 FROM invites WHERE username = $1 AND from_user_id = $2",
    [username, fromUserId],
  );
  return rows.length > 0;
}

/** Remove (claim) all invites addressed to `username` and return them. */
export async function claimInvites(username: string): Promise<InviteRow[]> {
  const { rows } = await pool.query(
    "DELETE FROM invites WHERE username = $1 RETURNING *",
    [username],
  );
  return rows.map(mapInvite);
}