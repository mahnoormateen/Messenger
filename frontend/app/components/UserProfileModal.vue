<script setup lang="ts">
import type { ChatUser } from "~/composables/useChat";

const props = defineProps<{ user: ChatUser }>();
const emit = defineEmits<{ (e: "close"): void }>();

const statusLine = computed(() => {
  if (props.user.online) return { text: "Online now", cls: "online" };
  if (props.user.lastSeen) return { text: `Last seen ${formatTime(props.user.lastSeen)}`, cls: "offline" };
  return { text: "Offline", cls: "offline" };
});

function message() {
  openChat(props.user.id);
  emit("close");
}
</script>

<template>
  <teleport to="body">
    <transition name="fade">
      <div class="overlay" @click.self="emit('close')">
        <div class="card" :style="{ '--accent': user.avatarColor }">
          <button class="icon-btn close" @click="emit('close')">
            <UIcon name="i-lucide-x" size="22" />
          </button>

          <div class="avatar-wrap">
            <div class="avatar lg" :style="avatarStyle(user)">
              <img v-if="user.avatarImage" :src="user.avatarImage" alt="" class="avatar-img" />
              <template v-else>{{ initials(user.name) }}</template>
            </div>
            <i class="online-dot on" :class="{ on: user.online }"></i>
          </div>

          <h2>{{ user.name }}</h2>
          <span class="status" :class="statusLine.cls">{{ statusLine.text }}</span>

          <div class="divider"></div>

          <div class="bio">
            <p class="label">About</p>
            <p class="text">{{ user.bio }}</p>
          </div>

          <div class="actions">
            <button class="primary" @click="message">
              <UIcon name="i-lucide-message-circle" size="18" />
              Message {{ user.name.split(" ")[0] }}
            </button>
          </div>
        </div>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(17, 27, 33, 0.5);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.card {
  position: relative;
  width: min(100%, 380px);
  background: #fff;
  border-radius: 18px;
  padding: 34px 26px 26px;
  text-align: center;
  box-shadow: var(--shadow);
  animation: popIn 0.24s ease;
}
.close {
  position: absolute;
  top: 10px;
  right: 10px;
}
.avatar-wrap {
  display: inline-block;
  margin-bottom: 14px;
}
.card h2 {
  margin: 0;
  font-size: 21px;
}
.status {
  display: inline-block;
  margin-top: 5px;
  font-size: 13px;
  font-weight: 600;
}
.status.online {
  color: var(--brand-dark);
}
.status.offline {
  color: var(--ink-3);
}
.divider {
  height: 1px;
  background: var(--line);
  margin: 20px 0 16px;
}
.bio .label {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--ink-3);
}
.bio .text {
  margin: 0;
  font-size: 14px;
  color: var(--ink-2);
  line-height: 1.5;
}
.actions {
  margin-top: 22px;
}
.primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: var(--brand);
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  padding: 11px 18px;
  border-radius: 24px;
  transition: background 0.15s ease, transform 0.1s ease;
  box-shadow: 0 6px 16px rgba(0, 168, 132, 0.35);
}
.primary svg {
  width: 18px;
  height: 18px;
}
.primary:hover {
  background: var(--brand-dark);
}
.primary:active {
  transform: scale(0.96);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>