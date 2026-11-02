import type { CalendarEvent } from '../../shared/types.js';

const DAY_MS = 86_400_000;
const MAX_INSTANCES_PER_EVENT = 500;

/** YYYY-MM-DD in local time (the household's time zone). */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Expands a recurring CalendarEvent into virtual instances within the specified ISO date window.
 * Supports 'daily', 'weekly', 'biweekly', and 'monthly' recurrence cadences.
 *
 * Occurrences keep the same LOCAL clock time (e.g. "every Tuesday at 4:00 PM"), so they don't shift
 * by an hour when daylight saving time starts or ends. Date math is done in the device's local time
 * zone (set TZ for the server process if the device's system time zone is wrong).
 *
 * Each virtual instance receives:
 * - id: `${event.id}_${instanceDateStr}` (instanceDateStr = local YYYY-MM-DD of the occurrence)
 * - originalEventId: event.id
 * - isRecurringInstance: true
 * - recurrenceRule: event.recurrenceRule
 * - startIso & endIso projected to the occurrence date while preserving local time-of-day and duration.
 */
export function expandRecurringEvent(
  event: CalendarEvent,
  windowStartIso: string,
  windowEndIso: string
): CalendarEvent[] {
  if (!event.recurrenceRule) return [];

  const baseStart = new Date(event.startIso);
  const baseEnd = new Date(event.endIso);
  const durationMs = Math.max(0, baseEnd.getTime() - baseStart.getTime());

  const winStart = new Date(windowStartIso).getTime();
  const winEnd = new Date(windowEndIso).getTime();

  if (Number.isNaN(winStart) || Number.isNaN(winEnd) || winStart > winEnd) {
    return [];
  }

  // If the series starts strictly after the requested window, no instances can occur.
  if (baseStart.getTime() > winEnd) {
    return [];
  }

  const exceptionSet = new Set(event.exceptionDates || []);
  const instances: CalendarEvent[] = [];

  const push = (instStart: Date) => {
    const startMs = instStart.getTime();
    const endMs = startMs + durationMs;
    if (endMs < winStart || startMs > winEnd) return;
    const dateStr = localDateStr(instStart);
    if (exceptionSet.has(dateStr)) return;
    instances.push({
      ...event,
      id: `${event.id}_${dateStr}`,
      originalEventId: event.id,
      isRecurringInstance: true,
      recurrenceRule: event.recurrenceRule,
      startIso: instStart.toISOString(),
      endIso: new Date(endMs).toISOString(),
    });
  };

  const rule = event.recurrenceRule;

  if (rule === 'daily' || rule === 'weekly' || rule === 'biweekly') {
    const stepDays = rule === 'daily' ? 1 : rule === 'weekly' ? 7 : 14;
    // Calendar-day steps in local time keep the clock time fixed across DST changes.
    const occurrence = (n: number) => {
      const d = new Date(baseStart);
      d.setDate(d.getDate() + n * stepDays);
      return d;
    };

    // Fast-forward close to the window (one step early to be safe around DST).
    let n = 0;
    if (baseStart.getTime() + durationMs < winStart) {
      n = Math.max(0, Math.floor((winStart - (baseStart.getTime() + durationMs)) / (stepDays * DAY_MS)) - 1);
    }

    for (let iterations = 0; iterations < MAX_INSTANCES_PER_EVENT; iterations++, n++) {
      const instStart = occurrence(n);
      if (instStart.getTime() > winEnd) break;
      push(instStart);
    }
  } else if (rule === 'monthly') {
    const targetDay = baseStart.getDate();
    const h = baseStart.getHours();
    const m = baseStart.getMinutes();
    const s = baseStart.getSeconds();
    const ms = baseStart.getMilliseconds();
    let curYear = baseStart.getFullYear();
    let curMonth = baseStart.getMonth();

    // Fast-forward months if baseStart is far in the past
    const winStartDate = new Date(winStart);
    const monthDiff = (winStartDate.getFullYear() - curYear) * 12 + (winStartDate.getMonth() - curMonth);
    if (monthDiff > 1) {
      const target = curMonth + monthDiff - 1;
      curYear += Math.floor(target / 12);
      curMonth = target % 12;
    }

    for (let iterations = 0; iterations < MAX_INSTANCES_PER_EVENT; iterations++) {
      // Month-end clamping: e.g. Jan 31 in Feb -> Feb 28 or Feb 29 (leap year safe)
      const daysInMonth = new Date(curYear, curMonth + 1, 0).getDate();
      const instStart = new Date(curYear, curMonth, Math.min(targetDay, daysInMonth), h, m, s, ms);
      if (instStart.getTime() > winEnd) break;
      push(instStart);

      curMonth++;
      if (curMonth > 11) {
        curMonth = 0;
        curYear++;
      }
    }
  }

  return instances;
}
