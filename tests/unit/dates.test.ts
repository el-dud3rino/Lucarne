import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toDateStr,
  parseLocalDate,
  addDays,
  startOfWeek,
  startOfMonthGrid,
  isSameDay,
  eventOccursOnDay,
} from '../../src/client/lib/dates.js';

test('toDateStr formats Dates into YYYY-MM-DD cleanly', () => {
  const d1 = new Date(2026, 0, 5); // Jan 5, 2026
  assert.equal(toDateStr(d1), '2026-01-05');

  const d2 = new Date(2026, 9, 31); // Oct 31, 2026
  assert.equal(toDateStr(d2), '2026-10-31');

  const d3 = new Date(2026, 11, 25); // Dec 25, 2026
  assert.equal(toDateStr(d3), '2026-12-25');
});

test('parseLocalDate creates local noon Date to prevent timezone drift', () => {
  const d = parseLocalDate('2026-07-04');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 6); // 0-indexed July
  assert.equal(d.getDate(), 4);
  assert.equal(d.getHours(), 12);
});

test('addDays correctly handles addition, subtraction, month boundaries and leap year', () => {
  const base = new Date(2026, 0, 15); // Jan 15, 2026
  const plus5 = addDays(base, 5);
  assert.equal(toDateStr(plus5), '2026-01-20');

  const minus10 = addDays(base, -10);
  assert.equal(toDateStr(minus10), '2026-01-05');

  // Month boundary (Jan 31 -> Feb 2)
  const jan31 = new Date(2026, 0, 31);
  const feb2 = addDays(jan31, 2);
  assert.equal(toDateStr(feb2), '2026-02-02');

  // Leap year boundary (Feb 28, 2028 -> Feb 29, 2028)
  const feb28_2028 = new Date(2028, 1, 28);
  const leapDay = addDays(feb28_2028, 1);
  assert.equal(toDateStr(leapDay), '2028-02-29');
});

test('startOfWeek returns Sunday or specified week start day', () => {
  // Wednesday, Oct 28, 2026
  const wed = new Date(2026, 9, 28);
  const sunStart = startOfWeek(wed, 0); // Sunday start
  assert.equal(toDateStr(sunStart), '2026-10-25'); // Oct 25 is Sunday
  assert.equal(sunStart.getDay(), 0);

  const monStart = startOfWeek(wed, 1); // Monday start
  assert.equal(toDateStr(monStart), '2026-10-26'); // Oct 26 is Monday
  assert.equal(monStart.getDay(), 1);
});

test('startOfMonthGrid anchors the first visible calendar tile to start of week', () => {
  // November 2026: Nov 1 is Sunday
  const nov = new Date(2026, 10, 15);
  const gridNov = startOfMonthGrid(nov);
  assert.equal(toDateStr(gridNov), '2026-11-01');

  // December 2026: Dec 1 is Tuesday -> Sunday start is Nov 29, 2026
  const dec = new Date(2026, 11, 10);
  const gridDec = startOfMonthGrid(dec);
  assert.equal(toDateStr(gridDec), '2026-11-29');
  assert.equal(gridDec.getDay(), 0);
});

test('isSameDay accurately compares dates regardless of hours/minutes', () => {
  const d1 = new Date(2026, 4, 10, 8, 30, 0);
  const d2 = new Date(2026, 4, 10, 22, 15, 0);
  const d3 = new Date(2026, 4, 11, 8, 30, 0);

  assert.equal(isSameDay(d1, d2), true);
  assert.equal(isSameDay(d1, d3), false);
});

test('eventOccursOnDay accurately evaluates single-day, multi-day, all-day and timed events', () => {
  const targetDay = new Date(2026, 9, 30); // Oct 30, 2026

  // 1. All-day event on same day
  assert.equal(
    eventOccursOnDay('2026-10-30T00:00:00.000Z', '2026-10-30T23:59:59.000Z', true, targetDay),
    true
  );

  // 2. All-day event spanning multiple days (Oct 28 to Nov 2)
  assert.equal(
    eventOccursOnDay('2026-10-28T00:00:00.000Z', '2026-11-02T23:59:59.000Z', true, targetDay),
    true
  );

  // 3. All-day event outside window
  assert.equal(
    eventOccursOnDay('2026-10-20T00:00:00.000Z', '2026-10-25T23:59:59.000Z', true, targetDay),
    false
  );

  // 4. Timed event during the day
  const noonStart = new Date(2026, 9, 30, 14, 0, 0).toISOString();
  const noonEnd = new Date(2026, 9, 30, 15, 30, 0).toISOString();
  assert.equal(eventOccursOnDay(noonStart, noonEnd, false, targetDay), true);

  // 5. Timed event spanning midnight (Oct 29 22:00 to Oct 30 02:00)
  const nightStart = new Date(2026, 9, 29, 22, 0, 0).toISOString();
  const nightEnd = new Date(2026, 9, 30, 2, 0, 0).toISOString();
  assert.equal(eventOccursOnDay(nightStart, nightEnd, false, targetDay), true);

  // 6. Timed event strictly before or after target day
  const yesterdayStart = new Date(2026, 9, 29, 10, 0, 0).toISOString();
  const yesterdayEnd = new Date(2026, 9, 29, 11, 0, 0).toISOString();
  assert.equal(eventOccursOnDay(yesterdayStart, yesterdayEnd, false, targetDay), false);
});
