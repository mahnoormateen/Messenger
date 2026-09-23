<script setup lang="ts">
const statusText = computed(() => {
  const map = { connecting: "Connecting to server…", connected: "Connected to Socket.IO server", disconnected: "Disconnected" };
  return map[connectionStatus.value];
});
</script>

<template>
  <div class="welcome">
    <div class="welcome-inner">
      <div class="welcome-mark">
        <UIcon name="i-lucide-message-circle" size="44" />
      </div>
      <h2>Chatter</h2>
      <p>Pick a conversation from Recently Added, or search for a signed-up person to start chatting.</p>
      <span class="conn" :class="connectionStatus">{{ statusText }}</span>
      <div class="features">
        <span>🔒 Private 1:1 rooms</span>
        <span>✓ Read receipts</span>
        <span>✍️ Typing indicators</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 50% 30%, rgba(255, 255, 255, 0.9) 0%, transparent 60%),
    var(--bg-app);
  overflow: hidden;
}

.welcome-inner {
  text-align: center;
  padding: 30px;
  max-width: 420px;
  animation: popIn 0.4s ease;
}

.welcome-mark {
  width: 92px;
  height: 92px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 28px;
  background: linear-gradient(160deg, var(--brand), var(--brand-dark));
  color: #fff;
  box-shadow: 0 14px 34px rgba(0, 168, 132, 0.35);
}
.welcome-mark svg {
  width: 44px;
  height: 44px;
}

.welcome h2 {
  margin: 0;
  font-size: 24px;
  letter-spacing: -0.4px;
}
.welcome p {
  margin: 8px 0 16px;
  color: var(--ink-3);
  font-size: 14px;
  line-height: 1.55;
}

.conn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  padding: 6px 12px;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.conn::before {
  content: "";
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #bdbdbd;
}
.conn.connected::before {
  background: var(--green);
}
.conn.disconnected::before {
  background: #ef4444;
}

.features {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 22px;
}
.features span {
  font-size: 12px;
  color: var(--ink-2);
  background: #fff;
  padding: 6px 11px;
  border-radius: 20px;
  border: 1px solid var(--line);
}
</style>