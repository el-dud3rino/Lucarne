/**
 * Local bookkeeping for Gemini API rate limits, so Lucarne stays inside the free tier instead of
 * sending requests that are certain to be rejected.
 *
 * Free-tier limits (Google AI Studio, Nov 2026): full Flash models 5 requests/minute and 20/day;
 * Flash-Lite models 15/minute and 500/day. Daily quotas reset at midnight Pacific time.
 * Set GEMINI_PAID_TIER=1 to turn the local limits off (paid keys have much higher limits).
 */

export type GeminiTier = 'flash' | 'lite';

export const FREE_TIER_LIMITS: Record<GeminiTier, { rpm: number; rpd: number }> = {
  flash: { rpm: 5, rpd: 20 },
  lite: { rpm: 15, rpd: 500 },
};

export function tierOf(model: string): GeminiTier {
  return /flash-lite/i.test(model) ? 'lite' : 'flash';
}

const PACIFIC_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "2026-11-02" in Pacific time (Google's quota day). */
export function pacificDayKey(ms: number): string {
  return PACIFIC_DAY.format(new Date(ms));
}

/** Timestamp of the next midnight Pacific (DST-safe), when daily quotas reset. */
export function nextPacificMidnight(now: number): number {
  const today = pacificDayKey(now);
  let lo = now;
  let hi = now + 26 * 3600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (pacificDayKey(mid) === today) lo = mid;
    else hi = mid;
  }
  // Midnight falls on a whole second; hi is within 1 s after it.
  return Math.floor(hi / 1000) * 1000;
}

/** 'day' / 'minute' for Google quota (429) errors, null for anything else. */
export function classifyQuotaError(err: unknown): 'day' | 'minute' | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/RESOURCE_EXHAUSTED|"code":\s*429|exceeded your current quota|Quota exceeded/i.test(msg)) return null;
  if (/per ?day|PerDay|requests per day|daily/i.test(msg)) return 'day';
  return 'minute';
}

export interface UsageSnapshot {
  day: string;
  counts: Record<string, number>;
}

export class GeminiUsage {
  private minute = new Map<string, number[]>();
  private day: UsageSnapshot;

  constructor(
    private readonly opts: {
      limits?: Record<GeminiTier, { rpm: number; rpd: number }>;
      enabled?: boolean;
      load?: () => UsageSnapshot | null;
      save?: (snap: UsageSnapshot) => void;
    } = {}
  ) {
    this.day = opts.load?.() ?? { day: '', counts: {} };
  }

  private get limits() {
    return this.opts.limits ?? FREE_TIER_LIMITS;
  }

  private get enabled() {
    return this.opts.enabled ?? process.env.GEMINI_PAID_TIER !== '1';
  }

  private rollDay(now: number) {
    const key = pacificDayKey(now);
    if (this.day.day !== key) this.day = { day: key, counts: {} };
  }

  record(model: string, now = Date.now()): void {
    const list = (this.minute.get(model) ?? []).filter((t) => now - t < 60_000);
    list.push(now);
    this.minute.set(model, list);
    this.rollDay(now);
    this.day.counts[model] = (this.day.counts[model] ?? 0) + 1;
    this.opts.save?.(this.day);
  }

  /** Mark a model as out of daily quota (Google said so), even if our own count disagrees. */
  markDayExhausted(model: string, now = Date.now()): void {
    this.rollDay(now);
    this.day.counts[model] = Math.max(this.day.counts[model] ?? 0, this.limits[tierOf(model)].rpd);
    this.opts.save?.(this.day);
  }

  usedToday(model: string, now = Date.now()): number {
    this.rollDay(now);
    return this.day.counts[model] ?? 0;
  }

  /** 0 if the model can be used now; otherwise the time it becomes available again. */
  blockedUntil(model: string, now = Date.now()): number {
    if (!this.enabled) return 0;
    const lim = this.limits[tierOf(model)];
    if (this.usedToday(model, now) >= lim.rpd) return nextPacificMidnight(now);
    const recent = (this.minute.get(model) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= lim.rpm) return recent[0] + 60_000;
    return 0;
  }
}
