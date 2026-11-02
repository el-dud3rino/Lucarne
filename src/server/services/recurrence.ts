import type { CalendarEvent } from '../../shared/types.js';

const DAY_MS = 86_400_000;
const MAX_INSTANCES_PER_EVENT = 500;

/**
 * Expands a recurring CalendarEvent into virtual instances within the specified ISO date window.
 * Supports 'daily', 'weekly', 'biweekly', and 'monthly' recurrence cadences.
 *
 * Each virtual instance receives:
 * - id: `${event.id}_${instanceDateStr}` (where instanceDateStr is YYYY-MM-DD)
 * - originalEventId: event.id
 * - isRecurringInstance: true
 * - recurrenceRule: event.recurrenceRule
 * - startIso & endIso projected to the occurrence date while preserving time-of-day and duration.
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

  const baseHours = baseStart.getUTCHours();
  const baseMinutes = baseStart.getUTCMinutes();
  const baseSeconds = baseStart.getUTCSeconds();
  const baseMs = baseStart.getUTCMilliseconds();

  const rule = event.recurrenceRule;

  if (rule === 'daily' || rule === 'weekly' || rule === 'biweekly') {
    const stepDays = rule === 'daily' ? 1 : rule === 'weekly' ? 7 : 14;
    const stepMs = stepDays * DAY_MS;

    let curStartMs = baseStart.getTime();

    // Fast-forward past occurrences if baseStart is far before windowStart
    if (curStartMs + durationMs < winStart) {
      const skip = Math.floor((winStart - (curStartMs + durationMs)) / stepMs);
      if (skip > 0) {
        curStartMs += skip * stepMs;
      }
    }

    let iterations = 0;
    while (curStartMs <= winEnd && iterations < MAX_INSTANCES_PER_EVENT) {
      iterations++;
      const curEndMs = curStartMs + durationMs;

      if (curEndMs >= winStart && curStartMs <= winEnd) {
        const instStart = new Date(curStartMs);
        const instEnd = new Date(curEndMs);
        const dateStr = instStart.toISOString().slice(0, 10);

        if (!exceptionSet.has(dateStr)) {
          instances.push({
            ...event,
            id: `${event.id}_${dateStr}`,
            originalEventId: event.id,
            isRecurringInstance: true,
            recurrenceRule: event.recurrenceRule,
            startIso: instStart.toISOString(),
            endIso: instEnd.toISOString(),
          });
        }
      }

      curStartMs += stepMs;
    }
  } else if (rule === 'monthly') {
    const targetDay = baseStart.getUTCDate();
    let curYear = baseStart.getUTCFullYear();
    let curMonth = baseStart.getUTCMonth();

    // Fast-forward months if baseStart is far in the past
    const winStartDate = new Date(winStart);
    const monthDiff =
      (winStartDate.getUTCFullYear() - curYear) * 12 +
      (winStartDate.getUTCMonth() - curMonth);
    if (monthDiff > 1) {
      const advance = monthDiff - 1;
      curYear += Math.floor(advance / 12);
      curMonth += advance % 12;
      if (curMonth > 11) {
        curYear += Math.floor(curMonth / 12);
        curMonth = curMonth % 12;
      }
    }

    let iterations = 0;
    while (iterations < MAX_INSTANCES_PER_EVENT) {
      iterations++;

      // Month-end clamping: e.g. Jan 31 in Feb -> Feb 28 or Feb 29 (leap year safe)
      const daysInMonth = new Date(Date.UTC(curYear, curMonth + 1, 0)).getUTCDate();
      const actualDay = Math.min(targetDay, daysInMonth);

      const instStart = new Date(
        Date.UTC(curYear, curMonth, actualDay, baseHours, baseMinutes, baseSeconds, baseMs)
      );
      const curStartMs = instStart.getTime();

      if (curStartMs > winEnd) {
        break;
      }

      const curEndMs = curStartMs + durationMs;
      if (curEndMs >= winStart && curStartMs <= winEnd) {
        const dateStr = instStart.toISOString().slice(0, 10);

        if (!exceptionSet.has(dateStr)) {
          instances.push({
            ...event,
            id: `${event.id}_${dateStr}`,
            originalEventId: event.id,
            isRecurringInstance: true,
            recurrenceRule: event.recurrenceRule,
            startIso: instStart.toISOString(),
            endIso: new Date(curEndMs).toISOString(),
          });
        }
      }

      curMonth++;
      if (curMonth > 11) {
        curMonth = 0;
        curYear++;
      }
    }
  }

  return instances;
}
