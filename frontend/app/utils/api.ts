// -----------------------------------------------------------------------------
// REST client for the backend auth API
// -----------------------------------------------------------------------------

export const API_URL = "http://localhost:3001/api";
export const TOKEN_STORAGE_KEY = "chatter.token";

export interface AuthUser {
  id: string;
  name: string;
  username: string | null;
  avatarColor: string;
  avatarImage?: string | null;
  bio: string;
  online: boolean;
  lastSeen: number | null;
}

export interface InviteActor {
  id: string;
  name: string;
  avatarColor: string;
  avatarImage?: string | null;
}

export interface Invite {
  id: string;
  username: string;
  message: string | null;
  createdAt: number;
  from: InviteActor;
}

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data;
}

export function loginAPI(username: string, password: string) {
  return request<{ token: string; user: AuthUser }>("/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function signupAPI(payload: { username: string; password: string; name?: string }) {
  return request<{ token: string; user: AuthUser; invites?: Invite[] }>("/signup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function meAPI(token: string) {
  return request<{ user: AuthUser }>("/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Update the signed-in user's public profile (display name, bio, avatar color, photo). */
export function updateProfileAPI(
  token: string,
  patch: { name?: string; bio?: string; avatarColor?: string; avatarImage?: string | null },
) {
  return request<{ user: AuthUser }>("/me", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
}

export function logoutAPI(token: string) {
  return request<void>("/logout", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Send an invite to a username that hasn't signed up yet. */
export function inviteAPI(token: string, username: string, message?: string) {
  return request<{ ok: boolean; invite: Invite }>("/invite", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username, message }),
  });
}

/** Pending invites sent to the signed-in user's username. */
export function myInvitesAPI(token: string) {
  return request<{ invites: Invite[] }>("/invites", {
    headers: { Authorization: `Bearer ${token}` },
  });
}