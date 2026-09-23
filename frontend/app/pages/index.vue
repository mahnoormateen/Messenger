<script setup lang="ts">
import { onMounted } from "vue";
import { notice } from "~/composables/useChat";

onMounted(() => {
  startViewport();
  connectSocket();
});
</script>

<template>
  <!-- Login / identity picker -->
  <LoginScreen v-if="!me" />

  <!-- Main shell -->
  <div v-else class="app-shell" :class="{ 'is-mobile': isMobile }">
    <ChatSidebar v-show="!isMobile || !activeChatId" class="sidebar-col" />

    <section class="chat-col" v-show="!isMobile || !!activeChatId">
      <ChatWindow v-if="activeChatId" :key="activeChatId" @back="closeChat" />
      <BrandWelcome v-else />
    </section>

    <!-- Transient toast (e.g. "your invite was accepted") -->
    <Transition name="toast-fade">
      <div v-if="notice" class="toast" role="status">{{ notice }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  background: var(--bg-app);
  overflow: hidden;
}

.sidebar-col {
  width: 360px;
  min-width: 260px;
  max-width: 40vw;
  height: 100%;
}

.chat-col {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

@media (max-width: 860px) {
  .app-shell {
    position: relative;
  }
  .sidebar-col {
    width: 100%;
    max-width: none;
  }
}

.toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 60;
  max-width: min(90vw, 480px);
  background: var(--ink);
  color: #fff;
  padding: 10px 18px;
  border-radius: 24px;
  font-size: 13.5px;
  line-height: 1.4;
  text-align: center;
  box-shadow: var(--shadow);
}
.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-8px);
}
</style>