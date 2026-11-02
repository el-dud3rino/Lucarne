import type { Chore } from './types.js';

/** YYYY-MM-DD in the device's local time zone (never UTC; avoids evening date flips). */
export function localDateStr(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Whether a chore is due on the given local date. Shared by the Chores view and Keep sync. */
export function choreAppliesToDate(
  chore: Pick<Chore, 'frequency' | 'daysOfWeek' | 'specificDate'>,
  d: Date,
  dateStr: string
): boolean {
  const dow = d.getDay();
  if (chore.frequency === 'daily') return true;
  if (chore.frequency === 'weekdays') return dow >= 1 && dow <= 5;
  if (chore.frequency === 'weekends') return dow === 0 || dow === 6;
  if (chore.frequency === 'weekly') {
    return chore.daysOfWeek.length === 0 || chore.daysOfWeek.includes(dow);
  }
  if (chore.frequency === 'once') {
    return !chore.specificDate || chore.specificDate === dateStr;
  }
  return true;
}
