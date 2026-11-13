import type { CalendarEvent } from './types.js';

/** Local YYYY-MM-DD for a Date. */
function dayStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(s: string, days: number): string {
  const [y, m, d] = s.split('-').map(Number);
  return dayStr(new Date(y, m - 1, d + days, 12));
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

type Ev = Pick<CalendarEvent, 'id' | 'startIso' | 'endIso' | 'allDay'>;

/** First and last local day an event touches (inclusive). */
export function eventDayRange(ev: Ev): { start: string; end: string } {
  if (ev.allDay) {
    const start = ev.startIso.slice(0, 10);
    return { start, end: ev.endIso.slice(0, 10) < start ? start : ev.endIso.slice(0, 10) };
  }
  const s = new Date(ev.startIso);
  const e = new Date(ev.endIso);
  // Ending exactly at midnight doesn't touch the next day.
  if (e > s && e.getHours() === 0 && e.getMinutes() === 0 && e.getSeconds() === 0) e.setMilliseconds(-1);
  const start = dayStr(s);
  const end = dayStr(e < s ? s : e);
  return { start, end };
}

export function isMultiDay(ev: Ev): boolean {
  const r = eventDayRange(ev);
  return r.end > r.start;
}

export interface SpanBar<E extends Ev> {
  ev: E;
  /** Column in the visible range, 0-based */
  col: number;
  span: number;
  lane: number;
  /** Starts before / ends after the visible range (draw a continuation edge) */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Lays multi-day events out as bars across `numDays` columns starting at `firstDay`, packing them
 * into as few lanes as possible (earliest and longest first, like a paper calendar).
 */
export function layoutSpanBars<E extends Ev>(events: E[], firstDay: string, numDays: number): SpanBar<E>[] {
  const lastDay = shiftDay(firstDay, numDays - 1);
  const items = events
    .filter(isMultiDay)
    .map((ev) => ({ ev, ...eventDayRange(ev) }))
    .filter((r) => r.end >= firstDay && r.start <= lastDay)
    .sort((a, b) => (a.start === b.start ? daysBetween(b.start, b.end) - daysBetween(a.start, a.end) : a.start < b.start ? -1 : 1));

  const laneEnds: number[] = [];
  const bars: SpanBar<E>[] = [];
  for (const it of items) {
    const col = Math.max(0, daysBetween(firstDay, it.start));
    const endCol = Math.min(numDays - 1, daysBetween(firstDay, it.end));
    let lane = laneEnds.findIndex((end) => end < col);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endCol);
    } else {
      laneEnds[lane] = endCol;
    }
    bars.push({
      ev: it.ev,
      col,
      span: endCol - col + 1,
      lane,
      continuesBefore: it.start < firstDay,
      continuesAfter: it.end > lastDay,
    });
  }
  return bars;
}

/** How many lanes the bars use in each column (0..numDays-1). */
export function lanesPerColumn(bars: Array<Pick<SpanBar<Ev>, 'col' | 'span' | 'lane'>>, numDays: number): number[] {
  const out = new Array<number>(numDays).fill(0);
  for (const b of bars) {
    for (let c = b.col; c < b.col + b.span && c < numDays; c++) out[c] = Math.max(out[c], b.lane + 1);
  }
  return out;
}

/**
 * How many 40px-tall items fit in a space without cutting one in half.
 * `gap` is the space between items.
 */
export function itemsThatFit(availablePx: number, itemPx = 40, gap = 4): number {
  if (availablePx < itemPx) return 0;
  return Math.floor((availablePx + gap) / (itemPx + gap));
}

/** Splits a day's items into the ones shown and how many hide behind a "+N more" chip. */
export function splitForMore<T>(items: T[], capacity: number): { shown: T[]; more: number } {
  if (items.length <= capacity) return { shown: items, more: 0 };
  return { shown: items.slice(0, Math.max(0, capacity)), more: items.length - Math.max(0, capacity) };
}
