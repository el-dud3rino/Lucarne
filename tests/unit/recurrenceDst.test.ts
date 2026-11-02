import test from 'node:test';
import assert from 'node:assert/strict';

// Run in a US time zone with a DST change (Nov 1, 2026 and Mar 8, 2026 for America/New_York).
process.env.TZ = 'America/New_York';
const { expandRecurringEvent } = await import('../../src/server/services/recurrence.js');

const base = (startLocal: Date, minutes: number, rule: any) => ({
  id: 'e1', title: 'Piano', description: '', location: '', allDay: false, memberIds: [],
  calendarSourceId: null, externalEventId: null, updatedAt: '',
  startIso: startLocal.toISOString(), endIso: new Date(startLocal.getTime() + minutes * 60_000).toISOString(),
  recurrenceRule: rule, exceptionDates: [] as string[],
});
const localHM = (iso: string) => {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

test('weekly event keeps its local time across the fall-back DST change', () => {
  const ev = base(new Date(2026, 9, 27, 16, 0), 45, 'weekly'); // Tue Oct 27, 4:00 PM EDT
  const out = expandRecurringEvent(ev, new Date(2026, 9, 26).toISOString(), new Date(2026, 10, 20).toISOString());
  assert.deepEqual(out.map((e) => e.id.split('_')[1]), ['2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17']);
  assert.ok(out.every((e) => localHM(e.startIso) === '16:00'), out.map((e) => localHM(e.startIso)).join(','));
  assert.ok(out.every((e) => (new Date(e.endIso).getTime() - new Date(e.startIso).getTime()) === 45 * 60_000));
});

test('daily event keeps its local time across the spring-forward DST change', () => {
  const ev = base(new Date(2026, 2, 6, 7, 30), 30, 'daily'); // Mar 6, 7:30 AM EST
  const out = expandRecurringEvent(ev, new Date(2026, 2, 6).toISOString(), new Date(2026, 2, 10, 23).toISOString());
  assert.equal(out.length, 5);
  assert.ok(out.every((e) => localHM(e.startIso) === '7:30'), out.map((e) => localHM(e.startIso)).join(','));
});

test('monthly event keeps local time and clamps to month end; fast-forward works far in the future', () => {
  const ev = base(new Date(2026, 0, 31, 18, 0), 60, 'monthly'); // Jan 31, 6:00 PM EST
  const out = expandRecurringEvent(ev, new Date(2026, 1, 1).toISOString(), new Date(2026, 3, 30, 23).toISOString());
  assert.deepEqual(out.map((e) => e.id.split('_')[1]), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.ok(out.every((e) => localHM(e.startIso) === '18:00'));
  const later = expandRecurringEvent(base(new Date(2026, 9, 27, 16, 0), 45, 'weekly'), new Date(2028, 6, 1).toISOString(), new Date(2028, 6, 15).toISOString());
  assert.equal(later.length, 2);
  assert.ok(later.every((e) => localHM(e.startIso) === '16:00' && new Date(e.startIso).getDay() === 2));
});

test('exception dates skip a single occurrence (local date)', () => {
  const ev = { ...base(new Date(2026, 9, 27, 21, 30), 30, 'weekly'), exceptionDates: ['2026-11-03'] }; // 9:30 PM: UTC date is the next day
  const out = expandRecurringEvent(ev, new Date(2026, 9, 26).toISOString(), new Date(2026, 10, 12).toISOString());
  assert.deepEqual(out.map((e) => e.id.split('_')[1]), ['2026-10-27', '2026-11-10']);
});
