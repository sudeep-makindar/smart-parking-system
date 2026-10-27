/** 3725 -> "01:02:05" */
export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

/** 3725 -> "1h 2m", 75 -> "1m 15s", 9 -> "9s" */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatAgo(seconds: number): string {
  if (seconds < 0) return "—";
  if (seconds < 5) return "just now";
  return `${formatDuration(seconds)} ago`;
}

/** "Go to Slot A2" -> "A2" */
export function guidanceSlot(guidance: string): string | null {
  const match = /slot\s+([A-Z]\d+)/i.exec(guidance);
  return match ? match[1].toUpperCase() : null;
}
