import type { CalendarEvent } from './types.js';

export interface LeaveAlert {
  event: CalendarEvent;
  /** Epoch ms when they need to walk out the door */
  leaveAt: number;
  /** Whole minutes until leaveAt (negative = should have left already) */
  minutesUntilLeave: number;
  /** soon: within the heads-up window · now: leave within 2 min · late: past leave time, event not started */
  status: 'soon' | 'now' | 'late';
}

/** Show the banner this many minutes before leave time. */
export const LEAVE_HEADS_UP_MIN = 30;

/**
 * Timed events with a travel time whose leave time is coming up (or just passed, until the event
 * starts). Soonest first.
 */
export function computeLeaveAlerts(events: CalendarEvent[], now: number = Date.now(), headsUpMin = LEAVE_HEADS_UP_MIN): LeaveAlert[] {
  const out: LeaveAlert[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.allDay || !ev.travelMinutes || ev.travelMinutes <= 0) continue;
    const start = Date.parse(ev.startIso);
    if (!Number.isFinite(start) || now >= start) continue;
    const leaveAt = start - ev.travelMinutes * 60_000;
    if (now < leaveAt - headsUpMin * 60_000) continue;
    const key = ev.originalEventId ? `${ev.originalEventId}|${ev.startIso}` : ev.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const minutesUntilLeave = Math.ceil((leaveAt - now) / 60_000);
    out.push({ event: ev, leaveAt, minutesUntilLeave, status: minutesUntilLeave < 0 ? 'late' : minutesUntilLeave <= 2 ? 'now' : 'soon' });
  }
  return out.sort((a, b) => a.leaveAt - b.leaveAt);
}

/** "Leave in 12 min", "Leave now", "Leave 5 min ago" style label. */
export function leaveLabel(a: Pick<LeaveAlert, 'minutesUntilLeave' | 'status'>): string {
  if (a.status === 'now') return 'Leave now';
  if (a.status === 'late') return `Should have left ${-a.minutesUntilLeave} min ago`;
  return `Leave in ${a.minutesUntilLeave} min`;
}

/** Clothing hint for the morning brief from the day's forecast. */
export function weatherHint(f: { hi: number; lo: number; precipChance: number | null; code: number } | undefined, unit: 'F' | 'C'): string | null {
  if (!f) return null;
  const cold = unit === 'F' ? 40 : 5;
  const cool = unit === 'F' ? 58 : 14;
  const snow = (f.code >= 71 && f.code <= 77) || f.code === 85 || f.code === 86;
  const rain = (f.precipChance ?? 0) >= 50 || (f.code >= 51 && f.code <= 82 && !snow) || f.code >= 95;
  if (snow) return '❄️ Snow today: boots and warm coats';
  if (f.lo <= cold) return rain ? '🧥☔ Cold and wet: warm coat and umbrella' : '🧥 Cold: warm coats, hats and gloves';
  if (rain) return '☔ Rain likely: grab rain jackets';
  if (f.lo <= cool) return '🧥 Chilly morning: bring a jacket';
  if (f.hi >= (unit === 'F' ? 88 : 31)) return '🧴 Hot: water bottles and sunscreen';
  return null;
}
