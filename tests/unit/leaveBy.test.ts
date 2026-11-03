import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLeaveAlerts, leaveLabel, weatherHint } from '../../src/shared/leaveBy.js';
import type { CalendarEvent } from '../../src/shared/types.js';

const NOW = Date.parse('2026-11-02T17:00:00.000Z');
const ev = (id: string, startOffsetMin: number, travel: number | null, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  title: id,
  description: '',
  location: '',
  startIso: new Date(NOW + startOffsetMin * 60_000).toISOString(),
  endIso: new Date(NOW + (startOffsetMin + 60) * 60_000).toISOString(),
  allDay: false,
  memberIds: [],
  calendarSourceId: null,
  externalEventId: null,
  updatedAt: '',
  travelMinutes: travel,
  ...extra,
});

test('leave alerts: heads-up window, now, late, and ignored events', () => {
  const alerts = computeLeaveAlerts(
    [
      ev('soccer', 40, 20), // leave in 20 -> soon
      ev('far-off', 120, 15), // leave in 105 -> outside window
      ev('dentist', 15, 15), // leave now
      ev('late', 10, 15), // should have left 5 min ago
      ev('started', -5, 15), // already started
      ev('no-travel', 20, null),
      ev('allday', 20, 10, { allDay: true }),
    ],
    NOW
  );
  assert.deepEqual(
    alerts.map((a) => [a.event.id, a.status, a.minutesUntilLeave]),
    [
      ['late', 'late', -5],
      ['dentist', 'now', 0],
      ['soccer', 'soon', 20],
    ]
  );
  assert.equal(leaveLabel(alerts[0]), 'Should have left 5 min ago');
  assert.equal(leaveLabel(alerts[1]), 'Leave now');
  assert.equal(leaveLabel(alerts[2]), 'Leave in 20 min');
});

test('weather hint picks the most useful advice', () => {
  assert.match(weatherHint({ hi: 45, lo: 30, precipChance: 10, code: 1 }, 'F')!, /Cold/);
  assert.match(weatherHint({ hi: 60, lo: 50, precipChance: 80, code: 61 }, 'F')!, /Rain/);
  assert.match(weatherHint({ hi: 30, lo: 20, precipChance: 90, code: 73 }, 'F')!, /Snow/);
  assert.match(weatherHint({ hi: 70, lo: 52, precipChance: 0, code: 0 }, 'F')!, /jacket/);
  assert.equal(weatherHint({ hi: 75, lo: 62, precipChance: 0, code: 0 }, 'F'), null);
  assert.match(weatherHint({ hi: 33, lo: 22, precipChance: 0, code: 0 }, 'C')!, /Hot/);
  assert.equal(weatherHint(undefined, 'F'), null);
});
