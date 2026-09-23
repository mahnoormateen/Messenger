<script setup lang="ts">
import { onMounted, ref, computed, watch } from "vue";

const LEGACY_STORAGE_KEY = "chatter.user";

const mode = ref<"login" | "signup">("login");
const username = ref("");
const password = ref("");
const name = ref("");
const loading = ref(false);
const error = ref("");


// ---- live username uniqueness check (signup mode only) ----
const CHECK_URL = "http://localhost:3001/api/check-username";
const usernameStatus = ref<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let checkSeq = 0;

watch([username, mode], () => {
  clearTimeout(checkTimer);
  if (mode.value !== "signup" || username.value.trim().length < 2) {
    usernameStatus.value = "idle";
    return;
  }
  usernameStatus.value = "checking";
  const seq = ++checkSeq;
  checkTimer = setTimeout(async () => {
    try {
      const res = await fetch(`${CHECK_URL}?username=${encodeURIComponent(username.value.trim())}`);
      const data = await res.json().catch(() => ({}));
      if (seq !== checkSeq) return; // a newer keystroke superseded this request
      usernameStatus.value =
        data.status === "available"
          ? "available"
          : data.status === "taken"
            ? "taken"
            : data.status === "invalid"
              ? "invalid"
              : "idle";
    } catch {
      // Server unreachable — fall back to the server-side check on submit.
      if (seq === checkSeq) usernameStatus.value = "idle";
    }
  }, 400);
});

onMounted(() => {
  connectSocket();

  // Clear the pre-auth stored user object (kept by older versions of the app).
  if (typeof window !== "undefined") window.localStorage.removeItem(LEGACY_STORAGE_KEY);

  // If a session token is stored, connectSocket() signs us back in automatically
  // and the server emits `init`. A stale token surfaces here as an auth error.
  if (authError.value) error.value = authError.value;
});

// If the socket is rejected mid-session (server restart / expired token), show it.
watch(authError, (message) => {
  if (message) error.value = message;
});

async function submit() {
  error.value = "";
  authError.value = null;

  const u = username.value.trim();
  const p = password.value;
  if (!u) {
    error.value = "Please enter your username.";
    return;
  }

  if (mode.value === "signup") {
    if (usernameStatus.value === "taken") {
      error.value = "That username is already taken.";
      return;
    }
    if (usernameStatus.value === "invalid") {
      error.value = "Username must be 2–32 characters and use only letters, numbers, dots, dashes or underscores.";
      return;
    }
  }

  loading.value = true;
  try {
    if (mode.value === "signup") {
      if (p.length < 6) {
        error.value = "Password must be at least 6 characters.";
        return;
      }
      await signupUser({ username: u, password: p, name: name.value.trim() || undefined });
    } else {
      if (!p) {
        error.value = "Please enter your password.";
        return;
      }
      await loginUser(u, p);
    }
  } catch (e) {
    error.value = (e as Error)?.message || "Something went wrong. Please try again.";
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login">
    <div class="login-card">
      <div class="brand">
        <div class="brand-mark">💬</div>
        <h1>Messenger</h1>
        <p>Realtime private messaging</p>
      </div>


      <!-- Mode tabs -->
      <div class="tabs">
        <button :class="{ on: mode === 'login' }" @click="mode = 'login'">Log in</button>
        <button :class="{ on: mode === 'signup' }" @click="mode = 'signup'">Sign up</button>
      </div>

      <!-- Auth form -->
      <form class="signup-form" @submit.prevent="submit">
        <label class="field">
          <span>Username</span>
          <input v-model="username" type="text" placeholder="e.g. jane.doe" minlength="2" maxlength="32" autocomplete="username" />
          <span v-if="mode === 'signup' && usernameStatus === 'checking'" class="field-hint">Checking availability…</span>
          <span v-else-if="mode === 'signup' && usernameStatus === 'taken'" class="field-hint bad">⛔ That username is already taken.</span>
          <span v-else-if="mode === 'signup' && usernameStatus === 'invalid'" class="field-hint bad">Use 2–32 characters: letters, numbers, dots, dashes or underscores.</span>
          <span v-else-if="mode === 'signup' && usernameStatus === 'available'" class="field-hint ok">✓ Username is available</span>
        </label>

        <label class="field">
          <span>Password</span>
          <input v-model="password" type="password" placeholder="••••••••" autocomplete="current-password" />
        </label>

        <label v-if="mode === 'signup'" class="field">
          <span>Display name (optional)</span>
          <input v-model="name" type="text" placeholder="e.g. Jane Doe" maxlength="40" autocomplete="name" />
        </label>

        <p v-if="error" class="form-error">⚠ {{ error }}</p>

        <button class="submit-btn" type="submit" :disabled="loading">
          {{ loading ? "Signing in…" : mode === "login" ? "Log in & chat" : "Create account & join" }}
        </button>

        <p class="hint">
          <template v-if="mode === 'login'">
            New here? <a href="#" @click.prevent="mode = 'signup'">Create an account</a> — it's free.
          </template>
          <template v-else>
            Your session is remembered on this device, so next time you'll be signed in automatically.
          </template>
        </p>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background:
    radial-gradient(at 12% 8%, rgba(0, 168, 132, 0.12) 0px, transparent 50%),
    radial-gradient(at 88% 92%, rgba(59, 130, 246, 0.1) 0px, transparent 50%),
    var(--bg-app);
}

.login-card {
  width: min(100%, 480px);
  background: #fff;
  border-radius: 20px;
  box-shadow: var(--shadow);
  padding: 32px;
  animation: popIn 0.4s ease;
}

.brand {
  text-align: center;
}
.brand-mark {
  width: 64px;
  height: 64px;
  margin: 0 auto 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 30px;
  border-radius: 18px;
  background: linear-gradient(160deg, var(--brand), var(--brand-dark));
  box-shadow: 0 10px 24px rgba(0, 168, 132, 0.35);
}
.brand h1 {
  margin: 0;
  font-size: 26px;
  letter-spacing: -0.3px;
}
.brand p {
  margin: 4px 0 0;
  color: var(--ink-3);
  font-size: 13px;
}

.conn-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 18px auto 0;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  background: #f1f2f4;
  color: var(--ink-2);
}
.conn-pill .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #bdbdbd;
}
.conn-pill.connected .dot {
  background: var(--green);
  animation: blink 2s infinite;
}
.conn-pill.disconnected .dot {
  background: #ef4444;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ---- tabs ---- */
.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin: 22px 0 18px;
  padding: 4px;
  background: #f0f2f5;
  border-radius: 12px;
}
.tabs button {
  border: none;
  background: transparent;
  padding: 9px 0;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink-2);
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}
.tabs button.on {
  background: #fff;
  color: var(--ink);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* ---- form ---- */
.signup-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field span {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--ink-3);
}
.field input {
  height: 46px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  font-size: 14.5px;
  outline: none;
  color: var(--ink);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.field input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(0, 168, 132, 0.15);
}
.field input::placeholder {
  color: var(--ink-3);
}

.field-hint {
  font-size: 12px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink-3);
}
.field-hint.ok {
  color: var(--brand-dark);
}
.field-hint.bad {
  color: #dc2626;
}

.form-error {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.08);
}

.submit-btn {
  height: 48px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(160deg, var(--brand), var(--brand-dark));
  color: #fff;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.2px;
  box-shadow: 0 8px 20px rgba(0, 168, 132, 0.35);
  transition: transform 0.1s ease, opacity 0.15s ease, box-shadow 0.15s ease;
}
.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(0, 168, 132, 0.4);
}
.submit-btn:active:not(:disabled) {
  transform: scale(0.98);
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.hint {
  margin: 18px 0 0;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--ink-3);
  text-align: center;
}
.hint a {
  color: var(--brand-dark);
  font-weight: 600;
  text-decoration: none;
}

@media (max-width: 480px) {
  .login-card {
    padding: 22px 16px;
  }
}
</style>