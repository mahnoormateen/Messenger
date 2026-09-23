<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import type { ChatUser } from "~/composables/useChat";
import {
  invites,
  sentInvites,
  sendInvite,
  acceptInvite,
  dismissInvite,
  signOut // 1. Added sign-out composable method
} from "~/composables/useChat";

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;

const query = ref("");
const searchInput = ref<HTMLInputElement | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const searching = ref(false);
const lastRequestedQuery = ref("");

const profileOpen = ref(false);

/** State for Sign Out confirmation modal */
const showSignOutModal = ref(false);

// 2. Updated confirmSignOut function to trigger the logout flow
async function confirmSignOut() {
  showSignOutModal.value = false;
  try {
    await signOut();
  } catch (e) {
    console.error("Failed to sign out:", e);
  }
}

function cancelSignOut() {
  showSignOutModal.value = false;
}

const connected = computed(() => connectionStatus.value === "connected");
const hasQuery = computed(() => query.value.trim().length > 0);
const searchTerm = computed(() => query.value.trim().replace(/^@+/, "").toLowerCase());

const candidateUsername = computed(() => {
  const t = searchTerm.value;
  if (!hasQuery.value || searching.value) return null;
  if (searchResults.value.length > 0) return null;
  if (me.value?.username && me.value.username.toLowerCase() === t) return null;
  return t;
});

const usernameValid = computed(() => (candidateUsername.value ? USERNAME_RE.test(candidateUsername.value) : false));
const inviteSent = computed(() => (candidateUsername.value ? sentInvites.has(candidateUsername.value) : false));

const inviteMessage = ref("");
const sendingInvite = ref(false);
const inviteError = ref("");

watch(candidateUsername, () => (inviteError.value = ""));
watch(searchResults, () => {
  searching.value = false;
  if (searchResults.value.length > 0 && lastRequestedQuery.value && lastRequestedQuery.value !== query.value.trim()) {
    searchResults.value = [];
  }
});

async function sendInviteNow() {
  const uname = candidateUsername.value;
  if (!uname || !usernameValid.value || sendingInvite.value) return;
  sendingInvite.value = true;
  inviteError.value = "";
  try {
    await sendInvite(uname, inviteMessage.value.trim() || undefined);
    inviteMessage.value = "";
  } catch (e) {
    inviteError.value = (e as Error)?.message || "Could not send the invite.";
  } finally {
    sendingInvite.value = false;
  }
}

const recentlyAdded = computed(() => {
  const selfId = me.value?.id;
  return liveUsers.value
      .filter((u) => u.id !== selfId && hasConversation(u.id))
      .sort((a, b) => {
        const la = getLastMessageFor(a.id)?.timestamp ?? 0;
        const lb = getLastMessageFor(b.id)?.timestamp ?? 0;
        if (la !== lb) return lb - la;
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
});

const unreadCount = (id: string) => getUnreadFor(id);
const typing = (id: string) => getTypingFor(id);
const last = (id: string) => getLastMessageFor(id);

function preview(m?: ReturnType<typeof getLastMessageFor>) {
  if (!m) return "";
  if (m.deletedForAll) return "This message was deleted";
  if (m.type === "image") return "📷 Photo";
  return m.text;
}

function lastSeenLabel(u: ChatUser) {
  if (u.online) return "online";
  if (u.lastSeen) return sidebarTime(u.lastSeen);
  return "offline";
}

function onQueryInput() {
  clearTimeout(searchTimer);
  const q = query.value.trim();
  if (!q) {
    clearSearch();
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = setTimeout(() => {
    lastRequestedQuery.value = q;
    searchUsers(q);
  }, 250);
}

function clearSearchInput() {
  clearTimeout(searchTimer);
  query.value = "";
  clearSearch();
  searching.value = false;
}

function focusSearch() {
  clearTimeout(searchTimer);
  query.value = "";
  clearSearch();
  requestAnimationFrame(() => searchInput.value?.focus());
}

onBeforeUnmount(() => clearTimeout(searchTimer));

function select(id: string) {
  openChat(id);
  clearSearchInput();
}
</script>

<template>
  <aside class="sidebar">
    <!-- Header -->
    <header class="side-header">
      <div class="me" title="Edit your profile" @click="profileOpen = true">
        <div class="avatar-wrap">
          <div v-if="me" class="avatar md" :style="avatarStyle(me)">
            <img v-if="me.avatarImage" :src="me.avatarImage" alt="" class="avatar-img" />
            <template v-else>{{ initials(me.name) }}</template>
          </div>
        </div>
        <div class="me-meta">
          <strong>{{ me?.name }}</strong>
          <span class="me-status"><i class="dot" :class="{ on: connected }"></i>{{ connected ? "online" : "offline" }}</span>
        </div>
      </div>
      <div class="side-actions">
        <span class="pill" :class="connectionStatus" :title="connectionStatus">{{ connected ? "live" : connectionStatus }}</span>
        <button class="icon-btn" title="Edit profile" @click="profileOpen = true">
          <UIcon name="i-lucide-user" size="22" />
        </button>
        <button class="icon-btn" title="Sign out" @click="showSignOutModal = true">
          <UIcon name="i-lucide-log-out" size="22" />
        </button>
      </div>
    </header>

    <!-- Search -->
    <div class="search-box">
      <UIcon name="i-lucide-search" size="18" class="search-icon" />
      <input
          ref="searchInput"
          v-model="query"
          type="search"
          placeholder="Search signed-up people…"
          @input="onQueryInput"
      />
      <button v-if="hasQuery" class="clear-btn" title="Clear search" @click="clearSearchInput">✕</button>
    </div>

    <!-- Contacts -->
    <nav class="contacts">
      <!-- Invites: people who invited me before I signed up -->
      <template v-if="invites.length">
        <p class="section-label">Invites</p>
        <div v-for="inv in invites" :key="inv.id" class="invite-card">
          <div class="avatar-wrap">
            <div class="avatar sm" :style="avatarStyle(inv.from)">
              <img v-if="inv.from.avatarImage" :src="inv.from.avatarImage" alt="" class="avatar-img" />
              <template v-else>{{ initials(inv.from.name) }}</template>
            </div>
          </div>
          <div class="invite-card-body">
            <div class="invite-card-top">
              <strong>{{ inv.from.name }}</strong>
              <span class="invite-time">{{ sidebarTime(inv.createdAt) }}</span>
            </div>
            <p class="invite-card-msg">
              invited you to chat{{ inv.message ? ` — “${inv.message}”` : "" }}
            </p>
            <div class="invite-actions">
              <button class="invite-action ghost" @click="dismissInvite(inv.id)">Dismiss</button>
              <button class="invite-action solid" @click="acceptInvite(inv.id)">Accept & chat</button>
            </div>
          </div>
        </div>
      </template>

      <p class="section-label">{{ hasQuery ? "Search results" : "Recently Added" }}</p>

      <!-- Search results: every match is someone who signed up -->
      <template v-if="hasQuery">
        <div v-if="searching" class="no-results">
          <span>🔎</span>
          <strong>Searching…</strong>
        </div>

        <!-- No signed-up match → offer to invite that username -->
        <div v-else-if="searchResults.length === 0 && candidateUsername" class="invite-box" :class="{ sent: inviteSent }">
          <template v-if="inviteSent">
            <span class="invite-emoji">🎉</span>
            <strong>Invite sent to @{{ candidateUsername }}</strong>
            <small>They'll see it right here the moment they create an account.</small>
          </template>
          <template v-else>
            <span class="invite-emoji">📨</span>
            <strong>@{{ candidateUsername }} isn't signed up yet</strong>
            <small>Send an invite — it appears in their sidebar as soon as they join.</small>
            <input
                v-model="inviteMessage"
                class="invite-note"
                type="text"
                maxlength="140"
                placeholder="Add a note (optional)"
            />
            <p v-if="inviteError" class="invite-error">⚠ {{ inviteError }}</p>
            <small v-if="!usernameValid" class="invite-hint">
              Usernames are 2–32 characters using letters, numbers, dots, dashes or underscores.
            </small>
            <button class="invite-btn" :disabled="!usernameValid || sendingInvite" @click="sendInviteNow">
              {{ sendingInvite ? "Sending…" : "Send invite" }}
            </button>
          </template>
        </div>

        <div v-else-if="searchResults.length === 0" class="no-results">
          <span>🔎</span>
          <strong>No users found</strong>
          <small>Only people who signed up can be found here.</small>
        </div>

        <button
            v-for="u in searchResults"
            :key="u.id"
            class="contact"
            :class="{ active: activeChatId === u.id }"
            @click="select(u.id)"
        >
          <div class="avatar-wrap">
            <div class="avatar md" :style="avatarStyle(u)">
              <img v-if="u.avatarImage" :src="u.avatarImage" alt="" class="avatar-img" />
              <template v-else>{{ initials(u.name) }}</template>
            </div>
            <i class="online-dot" :class="{ on: u.online }"></i>
          </div>

          <div class="contact-body">
            <div class="contact-top">
              <span class="name">{{ u.name }}</span>
              <span class="time">{{ lastSeenLabel(u) }}</span>
            </div>

            <div class="contact-bottom">
              <span v-if="hasConversation(u.id)" class="preview dim">@{{ u.username }} · chat history exists</span>
              <span v-else class="preview dim">@{{ u.username }} — say hi 👋</span>
            </div>
          </div>
        </button>
      </template>

      <!-- Recently Added: people you've already exchanged messages with -->
      <template v-else>
        <div v-if="recentlyAdded.length === 0" class="no-results">
          <span>💬</span>
          <strong>No conversations yet</strong>
          <small>Search for someone who's signed up to start chatting.</small>
          <button class="ghost-btn" @click="focusSearch">Search people</button>
        </div>

        <button
            v-for="u in recentlyAdded"
            :key="u.id"
            class="contact"
            :class="{ active: activeChatId === u.id }"
            @click="openChat(u.id)"
        >
          <div class="avatar-wrap">
            <div class="avatar md" :style="avatarStyle(u)">
              <img v-if="u.avatarImage" :src="u.avatarImage" alt="" class="avatar-img" />
              <template v-else>{{ initials(u.name) }}</template>
            </div>
            <i class="online-dot" :class="{ on: u.online }"></i>
          </div>

          <div class="contact-body">
            <div class="contact-top">
              <span class="name">{{ u.name }}</span>
              <span class="time">{{ last(u.id) ? sidebarTime(last(u.id)!.timestamp) : "" }}</span>
            </div>

            <div class="contact-bottom">
              <span v-if="typing(u.id)" class="typing-preview">typing…</span>
              <span v-else class="preview">
                <template v-if="last(u.id)">
                  <template v-if="last(u.id)!.senderId === me?.id">You: </template>
                  {{ preview(last(u.id)) }}
                </template>
                <template v-else>Say hi 👋</template>
              </span>

              <span v-if="unreadCount(u.id)" class="badge">{{ unreadCount(u.id) > 99 ? "99+" : unreadCount(u.id) }}</span>
            </div>
          </div>
        </button>
      </template>
    </nav>

    <EditProfileModal v-if="profileOpen" @close="profileOpen = false" />

    <!-- Sign Out Confirmation Modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showSignOutModal" class="modal-overlay" @click.self="cancelSignOut">
          <div class="modal-card">
            <div class="modal-header">
              <div class="modal-icon warning">
                <UIcon name="i-lucide-log-out" size="24" />
              </div>
              <h3>Sign Out</h3>
            </div>
            <p class="modal-body">Are you sure you want to sign out of your account?</p>
            <div class="modal-actions">
              <button class="modal-btn secondary" @click="cancelSignOut">Cancel</button>
              <button class="modal-btn danger" @click="confirmSignOut">Sign Out</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--line);
  overflow: hidden;
}

/* ---- header ---- */
.side-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.me {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  cursor: pointer;
  padding: 4px 8px;
  margin: -4px -8px;
  border-radius: 10px;
  transition: background 0.12s ease;
}
.me:hover {
  background: #f5f6f8;
}
.me-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.me-meta strong {
  font-size: 15.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.me-status {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--ink-3);
}
.me-status .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-3);
}
.me-status .dot.on {
  background: var(--green);
}

.side-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.pill {
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 4px 8px;
  border-radius: 20px;
  color: var(--ink-2);
  background: #f1f2f4;
}
.pill.connected {
  color: var(--brand-dark);
  background: rgba(0, 168, 132, 0.12);
}
.pill.disconnected {
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.1);
}

/* ---- search ---- */
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 14px 8px;
  padding: 0 10px;
  height: 40px;
  border-radius: 22px;
  background: #f0f2f5;
  transition: background 0.15s ease;
}
.search-box:focus-within {
  background: #e8eaed;
}
.search-icon {
  width: 18px;
  height: 18px;
  color: var(--ink-3);
  flex-shrink: 0;
}
.search-box input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 14px;
  color: var(--ink);
}
.search-box input::placeholder {
  color: var(--ink-3);
}
.clear-btn {
  border: none;
  background: #d7dbe0;
  color: #fff;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 10px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}
.clear-btn:hover {
  background: #c0c6cc;
}

/* ---- contacts ---- */
.contacts {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 8px 12px;
}
.section-label {
  margin: 8px 10px 4px;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--ink-3);
}

.contact {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 10px;
  border: none;
  background: transparent;
  border-radius: 12px;
  text-align: left;
  transition: background 0.12s ease;
}
.contact:hover {
  background: #f5f6f8;
}
.contact.active {
  background: rgba(0, 168, 132, 0.1);
}

.contact-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-bottom: 1px solid rgba(233, 237, 239, 0.7);
  padding-bottom: 9px;
}
.contact:last-child .contact-body {
  border-bottom: none;
}

.contact-top,
.contact-bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}
.contact-top {
  justify-content: space-between;
}

.name {
  font-size: 15px;
  font-weight: 500;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.contact.active .name {
  font-weight: 600;
}

.time {
  color: var(--ink-3);
  font-size: 11.5px;
  flex-shrink: 0;
}
.contact.active .time {
  color: var(--brand-dark);
}

.preview {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview.dim {
  font-style: italic;
}
.typing-preview {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--brand-dark);
  font-style: italic;
  font-weight: 600;
  animation: msgIn 0.2s ease;
}

.badge {
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  background: var(--green);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  animation: popIn 0.25s ease;
}

.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 46px 20px;
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
}
.no-results span {
  font-size: 30px;
  margin-bottom: 8px;
}
.no-results strong {
  color: var(--ink-2);
  font-size: 14px;
}
.no-results small {
  font-size: 12px;
}

.ghost-btn {
  margin-top: 14px;
  border: 1px solid var(--brand);
  background: #fff;
  color: var(--brand-dark);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 18px;
  border-radius: 20px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.ghost-btn:hover {
  background: var(--brand);
  color: #fff;
}
.ghost-btn:active {
  transform: scale(0.97);
}

/* ---- invites (received) ---- */
.invite-card {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin: 4px 10px 8px;
  padding: 12px;
  background: #f7faf9;
  border: 1px solid rgba(0, 168, 132, 0.25);
  border-radius: 14px;
  animation: popIn 0.3s ease;
}
.invite-card-body {
  flex: 1;
  min-width: 0;
}
.invite-card-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.invite-card-top strong {
  font-size: 14px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.invite-time {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--ink-3);
}
.invite-card-msg {
  margin: 3px 0 10px;
  font-size: 12.5px;
  color: var(--ink-2);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.invite-actions {
  display: flex;
  gap: 8px;
}
.invite-action {
  border: none;
  border-radius: 18px;
  padding: 6px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.invite-action:active {
  transform: scale(0.96);
}
.invite-action.ghost {
  background: transparent;
  color: var(--ink-2);
}
.invite-action.ghost:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--ink);
}
.invite-action.solid {
  background: var(--brand);
  color: #fff;
}
.invite-action.solid:hover {
  background: var(--brand-dark);
}

/* ---- invite box (search hit nothing) ---- */
.invite-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 6px 10px;
  padding: 20px 16px;
  border-radius: 14px;
  background: linear-gradient(180deg, #fbfdfc, #f3f8f6);
  border: 1px dashed rgba(0, 168, 132, 0.5);
  color: var(--ink-3);
  font-size: 13px;
  text-align: center;
  animation: popIn 0.25s ease;
}
.invite-box.sent {
  border-style: solid;
  background: rgba(0, 168, 132, 0.08);
}
.invite-emoji {
  font-size: 30px;
  margin-bottom: 4px;
}
.invite-box strong {
  color: var(--ink-2);
  font-size: 14px;
}
.invite-box small {
  font-size: 12px;
  line-height: 1.45;
}
.invite-note {
  width: 100%;
  margin-top: 8px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 13px;
  outline: none;
  color: var(--ink);
  background: #fff;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.invite-note:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(0, 168, 132, 0.15);
}
.invite-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #b91c1c;
}
.invite-hint {
  margin-top: 4px;
}
.invite-btn {
  margin-top: 8px;
  border: none;
  border-radius: 20px;
  padding: 9px 22px;
  background: linear-gradient(160deg, var(--brand), var(--brand-dark));
  color: #fff;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(0, 168, 132, 0.3);
  transition: transform 0.1s ease, opacity 0.15s ease;
}
.invite-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}
.invite-btn:active:not(:disabled) {
  transform: scale(0.97);
}
.invite-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* ---- modal (sign out) ---- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.modal-card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  gap: 16px;
  transform: scale(1);
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.modal-icon.warning {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #fef2f2;
  color: #ef4444;
  flex-shrink: 0;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--ink);
}

.modal-body {
  margin: 0;
  font-size: 14.5px;
  color: var(--ink-2, #555);
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.modal-btn {
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
}

.modal-btn:active {
  transform: scale(0.97);
}

.modal-btn.secondary {
  background: #f1f2f4;
  color: var(--ink, #333);
}

.modal-btn.secondary:hover {
  background: #e4e6e9;
}

.modal-btn.danger {
  background: #ef4444;
  color: #fff;
}

.modal-btn.danger:hover {
  background: #dc2626;
}

/* Modal Vue Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .modal-card {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-fade-enter-from .modal-card {
  transform: scale(0.92);
}
</style>