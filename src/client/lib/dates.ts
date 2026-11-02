export function toDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function startOfWeek(d: Date, weekStartsOn = 0): Date {
  const copy = new Date(d);
  const day = copy.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfWeek(first, 0);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function eventOccursOnDay(
  startIso: string,
  endIso: string,
  allDay: boolean,
  day: Date
): boolean {
  const dayStr = toDateStr(day);
  if (allDay) {
    const s = startIso.slice(0, 10);
    const e = endIso.slice(0, 10);
    return dayStr >= s && dayStr <= e;
  }
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0).getTime();
  const dayEnd = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    23,
    59,
    59,
    999
  ).getTime();
  const evStart = new Date(startIso).getTime();
  const evEnd = new Date(endIso).getTime();
  return evStart <= dayEnd && evEnd >= dayStart;
}
