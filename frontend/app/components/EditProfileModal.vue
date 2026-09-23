<script setup lang="ts">
import { ref, computed } from "vue";
import { me, updateProfile } from "~/composables/useChat";

/** Same palette the backend derives initial avatar colors from. */
const AVATAR_COLORS = ["#00a884", "#f97316", "#3b82f6", "#ef4444", "#8b5cf6", "#10b981", "#eab308", "#ec4899"];

const emit = defineEmits<{ (e: "close"): void }>();

const name = ref(me.value?.name ?? "");
const bio = ref(me.value?.bio ?? "");
const avatarColor = ref(me.value?.avatarColor ?? "#00a884");
const avatarImage = ref<string | null>(me.value?.avatarImage ?? null);
/** Only send the photo to the server when the user actually changed it. */
const imageChanged = ref(false);
const saving = ref(false);
const error = ref("");

const fileInput = ref<HTMLInputElement | null>(null);

const username = computed(() => me.value?.username ?? null);

/** Live avatar preview while editing. */
const previewUser = computed(() => ({
  name: name.value.trim() || "?",
  avatarColor: avatarColor.value,
  avatarImage: avatarImage.value,
}));

/** Downscale a picked photo to ≤256px and encode as JPEG so it stays small. */
function readAndResize(file: File, maxDim = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas unavailable"));
          return;
        }
        // White backdrop so transparent PNGs/GIFs don't turn black in JPEG.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

async function pickFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    error.value = "Please choose an image file (PNG, JPEG, GIF or WebP).";
    return;
  }
  try {
    avatarImage.value = await readAndResize(file);
    imageChanged.value = true;
    error.value = "";
  } catch {
    error.value = "Couldn't read that image — try another file.";
  }
}

function removeImage() {
  avatarImage.value = null;
  imageChanged.value = true;
  error.value = "";
}

async function save() {
  const trimmedName = name.value.trim();
  if (!trimmedName) {
    error.value = "Display name can't be empty.";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    await updateProfile({
      name: trimmedName,
      bio: bio.value.trim(),
      avatarColor: avatarColor.value,
      ...(imageChanged.value ? { avatarImage: avatarImage.value } : {}),
    });
    emit("close");
  } catch (e) {
    error.value = (e as Error)?.message || "Could not save your profile.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <teleport to="body">
    <transition name="fade">
      <div class="overlay" @click.self="emit('close')">
        <form class="card" @submit.prevent="save">
          <button type="button" class="icon-btn close" title="Cancel" @click="emit('close')">
            <UIcon name="i-lucide-x" size="22" />
          </button>

          <h2>Edit profile</h2>

          <!-- Live avatar preview -->
          <div class="avatar-wrap">
            <div class="avatar xl" :style="avatarStyle(previewUser)">
              <img v-if="avatarImage" :src="avatarImage" alt="Profile photo" class="avatar-img" />
              <template v-else>{{ initials(previewUser.name) }}</template>
            </div>
          </div>

          <!-- Profile photo -->
          <div class="photo-controls">
            <button type="button" class="photo-btn" @click="fileInput?.click()">
              {{ avatarImage ? "Change photo" : "Add photo" }}
            </button>
            <button v-if="avatarImage" type="button" class="photo-btn danger" @click="removeImage">Remove</button>
            <input ref="fileInput" type="file" accept="image/*" hidden @change="pickFile" />
          </div>
          <p class="photo-hint">Photos are resized to 256px on your device before saving.</p>

          <!-- Avatar color -->
          <div class="field">
            <span class="label">Avatar color</span>
            <div class="swatches">
              <button
                v-for="c in AVATAR_COLORS"
                :key="c"
                type="button"
                class="swatch"
                :class="{ on: avatarColor === c }"
                :style="{ background: c }"
                :title="c"
                @click="avatarColor = c"
              >
                <UIcon v-if="avatarColor === c" name="i-lucide-check" size="16" class="text-white" />
              </button>
            </div>
          </div>

          <label class="field">
            <span class="label">Display name</span>
            <input v-model="name" type="text" maxlength="40" placeholder="How others see you" />
          </label>

          <label class="field">
            <span class="label">About</span>
            <textarea v-model="bio" rows="3" maxlength="200" placeholder="A short bio (optional)"></textarea>
            <span class="count">{{ bio.length }}/200</span>
          </label>

          <p class="readonly">
            Username <strong>@{{ username }}</strong> can't be changed — it's your sign-in handle.
          </p>

          <p v-if="error" class="form-error">⚠ {{ error }}</p>

          <div class="actions">
            <button type="button" class="ghost" @click="emit('close')">Cancel</button>
            <button type="submit" class="primary" :disabled="saving">
              {{ saving ? "Saving…" : "Save changes" }}
            </button>
          </div>
        </form>
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
  width: min(100%, 400px);
  max-height: calc(100vh - 60px);
  overflow-y: auto;
  background: #fff;
  border-radius: 18px;
  padding: 30px 26px 24px;
  text-align: center;
  box-shadow: var(--shadow);
  animation: popIn 0.24s ease;
}
.card h2 {
  margin: 0 0 14px;
  font-size: 20px;
}
.close {
  position: absolute;
  top: 10px;
  right: 10px;
}
/* avatar */
.avatar-wrap {
  display: inline-block;
  margin-bottom: 6px;
}

/* profile photo controls */
.photo-controls {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 6px;
}
.photo-btn {
  border: 1px solid var(--brand);
  background: #fff;
  color: var(--brand-dark);
  font-size: 12.5px;
  font-weight: 600;
  padding: 7px 14px;
  border-radius: 18px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.photo-btn:hover {
  background: var(--brand);
  color: #fff;
}
.photo-btn:active {
  transform: scale(0.96);
}
.photo-btn.danger {
  border-color: #ef4444;
  color: #b91c1c;
}
.photo-btn.danger:hover {
  background: #ef4444;
  color: #fff;
}
.photo-hint {
  margin: 0 0 14px;
  font-size: 11.5px;
  color: var(--ink-3);
}

/* fields */
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
  text-align: left;
}
.field .label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--ink-3);
}
.field input,
.field textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  color: var(--ink);
  background: #fff;
  resize: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.field input:focus,
.field textarea:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(0, 168, 132, 0.15);
}
.field input::placeholder,
.field textarea::placeholder {
  color: var(--ink-3);
}
.field .count {
  font-size: 11px;
  color: var(--ink-3);
  text-align: right;
}

/* swatches */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.swatch {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s ease, box-shadow 0.12s ease;
}
.swatch svg {
  width: 16px;
  height: 16px;
}
.swatch:hover:not(.on) {
  transform: scale(1.1);
}
.swatch.on {
  box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--ink-2);
}

.readonly {
  margin: 4px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f5f6f8;
  font-size: 12.5px;
  color: var(--ink-2);
  text-align: left;
}
.readonly strong {
  color: var(--ink);
}

.form-error {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 13px;
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.08);
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 20px;
}
.actions button {
  flex: 1;
  height: 44px;
  border-radius: 22px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease, opacity 0.15s ease;
}
.actions button:active {
  transform: scale(0.97);
}
.actions .ghost {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--ink-2);
}
.actions .ghost:hover {
  background: #f5f6f8;
}
.actions .primary {
  border: none;
  background: linear-gradient(160deg, var(--brand), var(--brand-dark));
  color: #fff;
  box-shadow: 0 6px 16px rgba(0, 168, 132, 0.35);
}
.actions .primary:hover:not(:disabled) {
  filter: brightness(1.04);
}
.actions .primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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