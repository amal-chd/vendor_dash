/** Date formatting shared by the changelog console, editor and public page. */

const LOCALE = "en-IN";

export function formatDate(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(LOCALE, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3 min ago", "in 2 hours", "12 Sep 2026" once it's more than a week out. */
export function formatRelative(ms: number, now = Date.now()): string {
  if (!ms) return "—";
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs > 7 * 86_400_000) return formatDate(ms);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  if (abs < 60_000) return diff >= 0 ? "in under a minute" : "just now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function monthLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
}

export function dayLabel(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const tomorrow = new Date(now + 86_400_000);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "short" });
}

/** Value for <input type="datetime-local"> in the viewer's own timezone. */
export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
