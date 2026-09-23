<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";

const emit = defineEmits<{ (e: "back"): void }>();

const activeUser = computed(() => getUserById(activeChatId.value));
const messages = computed(() => (activeChatId.value ? getMessagesFor(activeChatId.value) : []));
const isTypingNow = computed(() => (activeChatId.value ? getTypingFor(activeChatId.value) : false));

const draft = ref("");
const emojiOpen = ref(false);
const profileOpen = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const scroller = ref<HTMLDivElement | null>(null);

// ---- message actions (WhatsApp-style delete menu) ----
const menuMsgId = ref<string | null>(null);
function toggleMenu(id: string) {
  menuMsgId.value = menuMsgId.value === id ? null : id;
}
function doDelete(m: { id: string }, mode: "me" | "everyone") {
  menuMsgId.value = null;
  deleteMessage(m.id, mode);
}

// ---- header menu (view profile / delete chat) ----
const headMenuOpen = ref(false);
const confirmDelete = ref(false);
function doClearChat() {
  const id = activeChatId.value;
  if (id) {
    clearChat(id); // closes the chat on success (activeChatId -> null)
    confirmDelete.value = false;
    headMenuOpen.value = false;
  }
}

// ---- header status ----
const statusText = computed(() => {
  const u = activeUser.value;
  if (!u) return "";
  if (isTypingNow.value) return `${u.name.split(" ")[0]} is typing…`;
  if (u.online) return "online";
  if (u.lastSeen) return `last seen ${formatTime(u.lastSeen)}`;
  return "offline";
});
const statusClass = computed(() => (isTypingNow.value ? "typing" : activeUser.value?.online ? "online" : ""));

// ---- message rows with date separators & grouping ----
interface Row {
  key: string;
  kind: "date" | "msg";
  text?: string;
  msg?: any;
  first?: boolean;
}

const rows = computed<Row[]>(() => {
  const list = messages.value;
  const out: Row[] = [];
  let prevDate = "";
  let prev: any = null;
  let msgIndex = 0;
  for (const m of list) {
    const d = new Date(m.timestamp);
    const day = d.toDateString();
    if (day !== prevDate) {
      out.push({ key: `d-${day}`, kind: "date", text: dayLabel(m.timestamp) });
      prevDate = day;
    }
    const sameSender = prev && prev.senderId === m.senderId;
    const withinGap = prev && m.timestamp - prev.timestamp < 5 * 60_000;
    out.push({
      key: `m-${msgIndex++}`,
      kind: "msg",
      msg: m,
      first: !(sameSender && withinGap),
    });
    prev = m;
  }
  return out;
});

// ---- auto-scroll ----
const stick = ref(true);
function onScroll() {
  const el = scroller.value;
  if (!el) return;
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
}
const showJump = ref(false);
watch(stick, (v) => (showJump.value = !v));

function scrollNow() {
  const el = scroller.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

watch(
  () => [rows.value.length, isTypingNow.value],
  async () => {
    await nextTick();
    const el = scroller.value;
    if (el && stick.value) el.scrollTop = el.scrollHeight;
  },
  { flush: "post" }
);

// fresh mount of chat -> scroll to bottom
watch(activeChatId, async () => {
  await nextTick();
  const el = scroller.value;
  if (el) {
    el.scrollTop = el.scrollHeight;
    stick.value = true;
  }
});

// ---- composer ----
const canSend = computed(() => draft.value.trim().length > 0);

function handleSend() {
  if (!activeChatId.value) return;
  if (sendMessage(draft.value)) {
    draft.value = "";
    sendTyping(activeChatId.value, false);
  }
}

function onCompose() {
  if (activeChatId.value) sendTyping(activeChatId.value, true);
}

function insertEmoji(e: string) {
  draft.value += e;
}

// ---- attachments ----
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function handleFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !activeChatId.value) return;
  if (file.size > 3_000_000) {
    alert("Image is too large for the demo (max 3 MB).");
    return;
  }
  const dataUrl = await readFileAsDataURL(file);
  sendMessage(dataUrl, "image");
}

const previewSrc = ref("");
const previewOpen = ref(false);

function previewImage(src: string) {
  previewSrc.value = src;
  previewOpen.value = true;
}
function closePreview() {
  previewOpen.value = false;
}
function onPreviewKey(e: KeyboardEvent) {
  if (e.key === "Escape") closePreview();
}

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰","😘","😋","😛","😜","🤪",
  "🤗","🤭","🤫","🤔","🤐","😴","😮","😢","😭","😤","😠","😡","🤬","😱","😨","😥","🥺","😳","🤯","😬","🤠",
  "😎","🥳","😞","😔","😕","🙁","😫","🥱","😐","🫡","🥸","🤓",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💯",
  "👍","👎","👌","🤞","✌️","🤟","🤘","👊","✊","🤛","🤜","👏","🙌","🤝","🙏","💪","🫶","👋","🖐️","✋",
  "🎉","🎊","🎈","🎁","⭐","🌟","✨","🚀","💫","🔥","⚡","☀️","🌙","🌈","💧","🌊","🌸","🌹","🌻","🍀",
  "🎂","🍰","☕","🍕","🍔","🍟","🌮","🍣","🍜","🍩","🍦","🍿","⚽","🏀","🎮","🎵","🎧","📸","🚗","✈️",
  "🏠","💡","📚","🕶️","💼","🔒","✅","❌","👀","🗨️","💬","📱","💻",
];

function tickIcon(status: string) {
  return status === "sent" ? "i-lucide-check" : "i-lucide-check-check";
}
</script>

<template>
  <div class="chat">
    <!-- Header -->
    <header class="chat-header">
      <button class="icon-btn back-btn" title="Back to chats" @click="emit('back')">
        <UIcon name="i-lucide-chevron-left" size="22" />
      </button>

      <div v-if="activeUser" class="partner" @click="profileOpen = true">
        <div class="avatar-wrap">
          <div class="avatar md" :style="avatarStyle(activeUser)">
            <img v-if="activeUser.avatarImage" :src="activeUser.avatarImage" alt="" class="avatar-img" />
            <template v-else>{{ initials(activeUser.name) }}</template>
          </div>
          <i class="online-dot" :class="{ on: activeUser.online }"></i>
        </div>
        <div class="partner-meta">
          <strong>{{ activeUser.name }}</strong>
          <span class="sub" :class="statusClass">{{ statusText }}</span>
        </div>
      </div>

      <div class="head-actions">
        <button class="icon-btn" title="Profile" @click="profileOpen = true">
          <UIcon name="i-lucide-info" size="22" />
        </button>

        <div class="head-menu">
          <button class="icon-btn" title="More" @click="headMenuOpen = !headMenuOpen">
            <UIcon name="i-lucide-ellipsis-vertical" size="22" />
          </button>

          <div v-if="headMenuOpen" class="head-menu-panel">
            <button class="head-menu-item" @click="profileOpen = true; headMenuOpen = false">
              <UIcon name="i-lucide-user" size="16" />
              View profile
            </button>
            <button class="head-menu-item danger" @click="confirmDelete = !confirmDelete">
              <UIcon name="i-lucide-trash-2" size="16" />
              Delete chat
            </button>

            <div v-if="confirmDelete" class="head-menu-confirm">
              <span>
                Delete your whole chat with <strong>{{ activeUser?.name }}</strong>?
                This clears it on your side only — {{ activeUser?.name }} keeps their copy.
              </span>
              <div class="head-menu-confirm-actions">
                <button class="ghost" @click="confirmDelete = false">Cancel</button>
                <button class="danger" @click="doClearChat">Delete</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Click-away layer for the header menu -->
      <div v-if="headMenuOpen" class="head-menu-layer" @click="headMenuOpen = false; confirmDelete = false"></div>
    </header>

    <!-- Messages -->
    <div ref="scroller" class="messages" @scroll="onScroll">
      <template v-for="r in rows" :key="r.key">
        <div v-if="r.kind === 'date'" class="date-chip">{{ r.text }}</div>

        <div
          v-else
          class="msg-line"
          :class="[r.msg!.senderId === me?.id ? 'mine' : 'in', r.first ? 'first' : 'folded']"
        >
          <div
            v-if="r.msg!.senderId !== me?.id && r.first"
            class="mini-avatar avatar xs"
            :style="avatarStyle(activeUser)"
          >
            <img v-if="activeUser?.avatarImage" :src="activeUser.avatarImage" alt="" class="avatar-img" />
            <template v-else>{{ initials(activeUser?.name ?? "?") }}</template>
          </div>

          <div class="bubble-shell">
            <div v-if="r.msg!.deletedForAll" class="bubble tombstone-bubble">
              <span>This message was deleted</span>
            </div>

            <div v-else-if="r.msg!.type === 'image'" class="bubble img-bubble">
              <img :src="r.msg!.text" alt="Attachment" @click="previewImage(r.msg!.text)" />
              <span class="meta">
                <span class="time">{{ formatTime(r.msg!.timestamp) }}</span>
                <span v-if="r.msg!.senderId === me?.id" class="ticks" :class="r.msg!.status">
                  <UIcon :name="tickIcon(r.msg!.status)" size="14" />
                </span>
              </span>
            </div>

            <div v-else class="bubble text-bubble">
              <span class="bubble-text">{{ r.msg!.text }}</span>
              <span class="meta">
                <span class="time">{{ formatTime(r.msg!.timestamp) }}</span>
                <span v-if="r.msg!.senderId === me?.id" class="ticks" :class="r.msg!.status">
                  <UIcon :name="tickIcon(r.msg!.status)" size="14" />
                </span>
              </span>
              <button
                v-if="!r.msg!.deletedForAll"
                class="del-toggle"
                :class="{ open: menuMsgId === r.msg!.id }"
                title="Message actions"
                @click.stop="toggleMenu(r.msg!.id)"
              >
                <UIcon name="i-lucide-chevron-down" size="15" />
              </button>
            </div>

            <button
              v-if="r.msg!.type === 'image' && !r.msg!.deletedForAll"
              class="del-toggle"
              :class="{ open: menuMsgId === r.msg!.id }"
              title="Message actions"
              @click.stop="toggleMenu(r.msg!.id)"
            >
              <UIcon name="i-lucide-chevron-down" size="14" />
            </button>

            <div v-if="menuMsgId === r.msg!.id" class="msg-menu">
              <button class="msg-menu-item" @click="doDelete(r.msg!, 'me')">Delete for me</button>
              <button v-if="r.msg!.senderId === me?.id" class="msg-menu-item" @click="doDelete(r.msg!, 'everyone')">
                Delete for everyone
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- Typing indicator -->
      <div v-if="isTypingNow && activeUser" class="msg-line in first folded-near-typing">
        <div class="mini-avatar avatar xs" :style="avatarStyle(activeUser)">
          <img v-if="activeUser.avatarImage" :src="activeUser.avatarImage" alt="" class="avatar-img" />
          <template v-else>{{ initials(activeUser.name) }}</template>
        </div>
        <div class="bubble typing-bubble">
          <span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="messages.length === 0" class="empty-chat">
        <span class="empty-svg">💬</span>
        <strong>{{ activeUser?.name }}</strong>
        <p>No messages yet. Say something nice! 👋</p>
      </div>

      <transition name="jump">
        <button v-if="showJump && messages.length" class="jump-btn" title="Scroll to latest" @click="scrollNow">
          <UIcon name="i-lucide-arrow-down" size="20" />
        </button>
      </transition>
    </div>

    <!-- Click-away layer for the message action menu -->
    <div v-if="menuMsgId" class="msg-menu-layer" @click="menuMsgId = null"></div>

    <!-- Emoji picker -->
    <div v-if="emojiOpen" class="emoji-layer" @click="emojiOpen = false"></div>
    <transition name="pop">
      <div v-if="emojiOpen" class="emoji-panel">
        <div class="emoji-grid">
          <button v-for="e in EMOJIS" :key="e" @click="insertEmoji(e)">{{ e }}</button>
        </div>
      </div>
    </transition>

    <!-- Composer -->
    <footer class="composer">
      <button class="icon-btn" :class="{ on: emojiOpen }" title="Emoji" @click="emojiOpen = !emojiOpen">
        <UIcon name="i-lucide-smile" size="22" />
      </button>

      <input
        v-model="draft"
        type="text"
        placeholder="Type a message"
        autocomplete="off"
        spellcheck="false"
        @keydown.enter.exact.prevent="handleSend"
        @input="onCompose"
        @focus="onCompose"
      />

      <button class="icon-btn" title="Attach image" @click="fileInput?.click()">
        <UIcon name="i-lucide-paperclip" size="22" />
      </button>
      <input ref="fileInput" type="file" accept="image/*" hidden @change="handleFile" />

      <button class="send-btn" :disabled="!canSend" title="Send" @click="handleSend">
        <UIcon name="i-lucide-send" size="20" />
      </button>
    </footer>

    <UserProfileModal v-if="profileOpen && activeUser" :user="activeUser" @close="profileOpen = false" />

    <!-- Image lightbox -->
    <teleport to="body">
      <transition name="fade">
        <div
          v-if="previewOpen"
          class="lightbox-overlay"
          tabindex="-1"
          @click.self="closePreview"
          @keydown.esc="onPreviewKey"
        >
          <div class="lightbox-stage">
            <img :src="previewSrc" alt="Image preview" />
            <button class="icon-btn lightbox-close" title="Close (Esc)" @click="closePreview">
              <UIcon name="i-lucide-x" size="22" />
            </button>
            <span class="lightbox-hint">Click anywhere or press Esc to close</span>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>

<style scoped>
.chat {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  overflow: hidden;
  position: relative;
}

/* ---- header ---- */
.chat-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 62px;
  min-height: 62px;
  padding: 0 8px 0 6px;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.back-btn {
  display: none;
}

.partner {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 10px;
}

.partner:hover {
  background: #f5f6f8;
}

.partner-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.partner-meta strong {
  font-size: 15.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.partner-meta .sub {
  font-size: 12px;
  color: var(--ink-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.partner-meta .sub.online {
  color: var(--brand-dark);
}

.partner-meta .sub.typing {
  color: var(--brand-dark);
  font-style: italic;
  font-weight: 600;
}

.head-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  position: relative;
}

/* ---- header menu ---- */
.head-menu {
  position: relative;
}

.head-menu-layer {
  position: absolute;
  inset: 0;
  z-index: 30;
}

.head-menu-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: 250px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.2);
  padding: 6px;
  animation: popIn 0.14s ease;
}

.head-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13.5px;
  color: var(--ink);
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
}

.head-menu-item:hover {
  background: #f1f2f4;
}

.head-menu-item.danger {
  color: #dc2626;
}

.head-menu-item.danger:hover {
  background: #fef2f2;
}

/* Centered confirmation modal when deleting a chat */
.head-menu-confirm {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(10, 14, 18, 0.8);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.head-menu-confirm strong {
  color: var(--ink);
}
.head-menu-confirm .text {
  text-align: center;
  max-width: 400px;
  color: var(--ink-2);
  font-size: 14px;
}
.head-menu-confirm .text span {
  color: var(--ink);
}
.head-menu-confirm-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  justify-content: center;
}
.head-menu-confirm-actions button {
  border: none;
  border-radius: 8px;
  padding: 8px 24px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.head-menu-confirm-actions .ghost {
  background: #f1f2f4;
  color: var(--ink-2);
}
.head-menu-confirm-actions .ghost:hover {
  background: #e5e8ea;
}
.head-menu-confirm-actions .danger {
  background: #dc2626;
  color: #fff;
}
.head-menu-confirm-actions .danger:hover {
  background: #b91c1c;
}

.head-menu-confirm strong {
  color: var(--ink);
}

.head-menu-confirm-actions {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  justify-content: center;
}

.head-menu-confirm-actions button {
  border: none;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.head-menu-confirm-actions .ghost {
  background: #f1f2f4;
  color: var(--ink-2);
}

.head-menu-confirm-actions .ghost:hover {
  background: #e5e8ea;
}

.head-menu-confirm-actions .danger {
  background: #dc2626;
  color: #fff;
}

.head-menu-confirm-actions .danger:hover {
  background: #b91c1c;
}

/* ---- messages ---- */
.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: auto;
  padding: 14px 6% 10px;
  background-color: var(--bg-chat);
  background-image: radial-gradient(
      rgba(17, 27, 33, 0.045) 1px,
      transparent 1px
  );
  background-size: 20px 20px;
  position: relative;
}

.date-chip {
  display: table;
  margin: 6px auto 16px;
  padding: 5px 13px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ink-2);
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  user-select: none;
}

/* ---- message row ---- */
.msg-line {
  display: flex;
  align-items: flex-end;
  gap: 7px;
  margin-bottom: 2px;
  animation: msgIn 0.24s ease;
  min-width: 0;
}

.msg-line.first {
  margin-top: 12px;
}

.msg-line.mine {
  flex-direction: row-reverse;
}

.mini-avatar {
  margin-bottom: 5px;
  flex-shrink: 0;
}

/* ---- bubble shell ---- */
/*
  IMPORTANT:
  Maximum width is always 50% of the available message area.
*/
.bubble-shell {
  position: relative;
  display: flex;
  min-width: 0;
  max-width: 50%;
}

/* ---- general bubble ---- */
.bubble {
  position: relative;
  width: fit-content;
  max-width: 100%;
  min-width: 0;

  padding: 7px 9px 6px;

  border-radius: 10px;

  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);

  background: var(--bubble-other);
  color: var(--ink);

  /*
    Long words / URLs will also break instead of
    making the bubble wider than 50%.
  */
  overflow-wrap: anywhere;
  word-break: break-word;
}

.in.first .bubble {
  border-bottom-left-radius: 3px;
}

.in.first .bubble::before {
  content: "";
  position: absolute;
  left: -8px;
  bottom: 0;

  border-bottom: 9px solid var(--bubble-other);
  border-left: 9px solid transparent;
}

.mine.first .bubble {
  border-bottom-right-radius: 3px;
}

.mine.first .bubble::after {
  content: "";
  position: absolute;
  right: -8px;
  bottom: 0;

  border-bottom: 9px solid var(--bubble-own);
  border-right: 9px solid transparent;
}

.mine .bubble {
  background: var(--bubble-own);
}

/* ---- text bubbles ---- */
.text-bubble {
  display: block;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
}

/*
  Text is allowed to wrap.
  It will wrap when the bubble reaches 50%.
*/
.bubble-text {
  display: inline;
  min-width: 0;

  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;

  font-size: 14.2px;
  line-height: 1.42;
}

/* ---- message time / ticks ---- */
.meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  float: right;

  margin: 8px 0 -8px 8px;

  font-size: 11px;
  color: var(--ink-3);

  user-select: none;
}

.mine .meta {
  color: rgba(17, 27, 33, 0.5);
}

.text-bubble .meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;

  float: right;

  margin: 8px 0 -8px 8px;
}

.ticks {
  font-size: 13px;
  line-height: 1;
  color: rgba(17, 27, 33, 0.55);
}

.ticks.read {
  color: #53bdeb;
}

/* ---- message actions ---- */
.del-toggle {
  position: absolute;
  top: 2px;
  right: 4px;

  z-index: 2;

  display: flex;
  align-items: center;
  justify-content: center;

  width: 24px;
  height: 24px;

  border: none;
  border-radius: 50%;

  background: rgba(255, 255, 255, 0.85);
  color: var(--ink-2);

  cursor: pointer;

  opacity: 0;

  transition:
      opacity 0.12s ease,
      background 0.12s ease;
}

.bubble-shell:hover .del-toggle,
.del-toggle.open {
  opacity: 1;
}

@media (hover: none) {
  .del-toggle {
    opacity: 0.45;
  }
}

/* Text bubble delete button */
.text-bubble .del-toggle {
  position: absolute;

  top: 5px;
  right: 3px;

  width: 18px;
  height: 18px;

  background: transparent;
  color: var(--ink-3);
}

.mine .text-bubble .del-toggle {
  color: rgba(17, 27, 33, 0.5);
}

.text-bubble .del-toggle:hover,
.text-bubble .del-toggle.open {
  background: rgba(0, 0, 0, 0.06);
}

.mine .text-bubble .del-toggle:hover,
.mine .text-bubble .del-toggle.open {
  background: rgba(0, 0, 0, 0.08);
}

/* ---- message menu ---- */
.msg-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;

  z-index: 40;

  min-width: 190px;

  background: #fff;
  border-radius: 10px;

  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);

  padding: 5px;

  animation: msgIn 0.12s ease;
}

.msg-menu-item {
  display: flex;
  align-items: center;

  width: 100%;

  border: none;
  background: transparent;

  text-align: left;

  font-size: 13.5px;
  color: var(--ink);

  padding: 8px 12px;

  border-radius: 7px;

  cursor: pointer;
}

.msg-menu-item:hover {
  background: #f1f2f4;
}

.msg-menu-layer {
  position: absolute;
  inset: 0;

  z-index: 30;
}

/* ---- deleted message ---- */
.tombstone-bubble {
  display: flex;
  align-items: center;

  font-style: italic;
  font-size: 13.5px;

  color: var(--ink-2);
  background: #f1f3f5;

  user-select: none;
}

/* ---- image bubble ---- */
.img-bubble {
  padding: 4px;
  overflow: hidden;
}

.img-bubble img {
  display: block;

  max-width: 100%;
  max-height: 320px;

  border-radius: 6px;

  cursor: zoom-in;

  background: #000;
}

/* ---- image lightbox ---- */
.lightbox-overlay {
  position: fixed;
  inset: 0;

  z-index: 200;

  background: rgba(10, 14, 18, 0.82);

  backdrop-filter: blur(4px);

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 24px;
}

:focus-visible:focus {
  outline: none;
}

.lightbox-stage {
  position: relative;

  display: flex;
  align-items: center;
  justify-content: center;

  max-width: min(92vw, 1200px);
  max-height: 90vh;

  animation: popIn 0.22s ease;
}

.lightbox-stage img {
  display: block;

  max-width: 100%;
  max-height: 88vh;

  border-radius: 10px;

  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);

  object-fit: contain;
}

.lightbox-close {
  position: absolute;

  top: -44px;
  right: -44px;

  z-index: 2;

  color: #fff;

  background: rgba(255, 255, 255, 0.14);

  border: 1px solid rgba(255, 255, 255, 0.25);

  backdrop-filter: blur(4px);
}

.lightbox-close:hover {
  background: rgba(255, 255, 255, 0.26);
  color: #fff;
}

.lightbox-hint {
  position: absolute;

  bottom: -34px;

  left: 0;
  right: 0;

  text-align: center;

  font-size: 12.5px;

  color: rgba(255, 255, 255, 0.65);

  user-select: none;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ---- typing bubble ---- */
.typing-bubble {
  display: inline-flex;

  gap: 4px;

  padding: 12px 14px 11px;
}

.tdot {
  width: 7px;
  height: 7px;

  border-radius: 50%;

  background: var(--ink-3);

  animation: tdotBlink 1.2s infinite;
}

.tdot:nth-child(2) {
  animation-delay: 0.15s;
}

.tdot:nth-child(3) {
  animation-delay: 0.3s;
}

/* ---- empty chat ---- */
.empty-chat {
  text-align: center;

  padding: 70px 20px;

  color: var(--ink-2);
}

.empty-chat .empty-svg {
  font-size: 44px;
}

.empty-chat strong {
  display: block;

  margin-top: 10px;

  font-size: 16px;

  color: var(--ink);
}

.empty-chat p {
  margin: 6px 0 0;

  font-size: 13px;
}

/* ---- jump button ---- */
.jump-btn {
  position: sticky;

  bottom: 16px;
  left: 100%;

  transform: translateX(-50%);

  width: 42px;
  height: 42px;

  border-radius: 50%;

  border: none;

  background: #fff;
  color: var(--ink-2);

  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);

  display: flex;
  align-items: center;
  justify-content: center;

  margin-left: auto;
  margin-right: 14px;
}

.jump-btn svg {
  width: 20px;
  height: 20px;
}

.jump-enter-active {
  animation: popIn 0.22s ease;
}

.jump-leave-active {
  transition:
      opacity 0.15s ease,
      transform 0.15s ease;
}

.jump-leave-to {
  opacity: 0;

  transform: translateX(-50%) scale(0.8);
}

/* ---- emoji picker ---- */
.emoji-layer {
  position: absolute;
  inset: 0;

  z-index: 5;
}

.emoji-panel {
  position: absolute;

  left: 14px;
  right: 14px;

  bottom: 76px;

  z-index: 6;

  background: #fff;

  border-radius: 14px;

  box-shadow: var(--shadow);

  padding: 10px;

  max-height: 260px;

  overflow-y: auto;
}

.emoji-grid {
  display: grid;

  grid-template-columns: repeat(
    auto-fill,
    minmax(38px, 1fr)
  );

  gap: 2px;
}

.emoji-grid button {
  width: 38px;
  height: 38px;

  border: none;

  background: transparent;

  border-radius: 8px;

  font-size: 22px;
  line-height: 1;

  transition:
      background 0.1s ease,
      transform 0.08s ease;
}

.emoji-grid button:hover {
  background: #f1f2f4;

  transform: scale(1.12);
}

.pop-enter-active,
.pop-leave-active {
  transition:
      opacity 0.16s ease,
      transform 0.16s ease;
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;

  transform: translateY(8px) scale(0.96);
}

/* ---- composer ---- */
.composer {
  display: flex;
  align-items: flex-end;

  gap: 4px;

  padding: 10px 12px;

  background: #fff;

  border-top: 1px solid var(--line);
}

.composer input {
  flex: 1;

  min-width: 0;

  border: none;
  outline: none;

  background: #f0f2f5;

  border-radius: 22px;

  padding: 11px 16px;

  font-size: 14.5px;
  line-height: 1.4;

  color: var(--ink);
}

.composer input::placeholder {
  color: var(--ink-3);
}

.send-btn {
  width: 44px;
  height: 44px;

  flex-shrink: 0;

  border: none;

  border-radius: 50%;

  background: var(--brand);

  color: #fff;

  display: flex;
  align-items: center;
  justify-content: center;

  transition:
      background 0.15s ease,
      transform 0.1s ease,
      opacity 0.15s ease;

  box-shadow: 0 4px 12px rgba(0, 168, 132, 0.35);
}

.send-btn svg {
  width: 20px;
  height: 20px;

  margin-left: -2px;
}

.send-btn:hover:not(:disabled) {
  background: var(--brand-dark);
}

.send-btn:active:not(:disabled) {
  transform: scale(0.92);
}

.send-btn:disabled {
  background: #c8d6d2;

  box-shadow: none;

  cursor: not-allowed;

  opacity: 0.7;
}

/* ---- responsive ---- */
@media (max-width: 860px) {
  .back-btn {
    display: inline-flex;
  }

  .messages {
    padding: 12px 9px 8px;
  }

  /*
    IMPORTANT:
    Still 50% on mobile.
    Do NOT change this to 80%.
  */
  .bubble-shell {
    max-width: 50%;
  }

  .bubble {
    max-width: 100%;
  }
}

/* ---- animations ---- */
@keyframes popIn {
  from {
    opacity: 0;
    transform: scale(0.96);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes msgIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes tdotBlink {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
</style>
