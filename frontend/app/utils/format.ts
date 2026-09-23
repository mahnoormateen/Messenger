// Small shared formatting helpers (auto-imported by Nuxt)

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

/** "2:05 PM" (12-hour clock) */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** Group header: Today / Yesterday / "Friday, 18 Sep" */
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (sameDay(d, yest)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

/** Sidebar timestamp: "2:05 PM" today, "Yesterday", weekday, or DD/MM */
export function sidebarTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (sameDay(d, now)) return formatTime(ts);
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (sameDay(d, yest)) return "Yesterday";
  if (now.getTime() - d.getTime() < 6 * 86400000) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

/** "Alice Johnson" -> "AJ" */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/** Darken a hex color for gradient avatars */
export function shade(hex: string, amount = 0.28): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  const r = Math.round(((num >> 16) & 255) * (1 - amount));
  const g = Math.round(((num >> 8) & 255) * (1 - amount));
  const b = Math.round((num & 255) * (1 - amount));
  return `rgb(${r}, ${g}, ${b})`;
}

export function avatarStyle(u: { avatarColor?: string } | null) {
  if (!u?.avatarColor) return {};
  return {
    background: `linear-gradient(160deg, ${u.avatarColor} 0%, ${shade(u.avatarColor)} 100%)`,
    color: "#ffffff",
  };
}