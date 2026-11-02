/** "just now", "5 min ago", "3 h ago", "2 d ago", or "never". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** 45 -> "45 min", 60 -> "1 h", 75 -> "1 h 15 min", 480 -> "8 h". */
export function formatMinutes(total: number | null | undefined): string {
  if (total == null || !Number.isFinite(total) || total <= 0) return '—';
  const h = Math.floor(total / 60);
  const m = Math.round(total % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
