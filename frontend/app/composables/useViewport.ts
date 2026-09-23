import { ref } from "vue";

/** Shared, responsive "am I on a phone-sized viewport?" flag. */
export const isMobile = ref(false);

let started = false;

export function startViewport() {
  if (started || typeof window === "undefined") return;
  started = true;
  const mq = window.matchMedia("(max-width: 860px)");
  const apply = () => (isMobile.value = mq.matches);
  apply();
  mq.addEventListener("change", apply);
}