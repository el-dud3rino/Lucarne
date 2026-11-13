import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eventDayRange,
  isMultiDay,
  itemsThatFit,
  lanesPerColumn,
  layoutSpanBars,
  splitForMore,
} from '../../src/shared/calendarLayout.js';
import { awayMembersForEvent, awayOnDate, effectiveChores, isHomeLocation, looksLikeTrip } from '../../src/shared/away.js';

const allDay = (id: string, start: string, end: string) => ({
  id,
  startIso: `${start}T00:00:00.000Z`,
  endIso: `${end}T00:00:00.000Z`,
  allDay: true,
});

test('eventDayRange: all-day uses the dates as written; timed ending at midnight stays on one day', () => {
  assert.deepEqual(eventDayRange(allDay('a', '2026-11-12', '2026-11-15')), { start: '2026-11-12', end: '2026-11-15' });
  const timed = { id: 't', allDay: false, startIso: new Date(2026, 10, 13, 18).toISOString(), endIso: new Date(2026, 10, 14, 0).toISOString() };
  assert.deepEqual(eventDayRange(timed), { start: '2026-11-13', end: '2026-11-13' });
  assert.equal(isMultiDay(timed), false);
  const overnight = { ...timed, endIso: new Date(2026, 10, 14, 2).toISOString() };
  assert.equal(isMultiDay(overnight), true);
});

test('layoutSpanBars: clips to the range, packs lanes, marks continuations', () => {
  const evs = [
    allDay('vacation', '2026-11-12', '2026-11-29'),
    allDay('con', '2026-11-13', '2026-11-15'),
    allDay('single', '2026-11-14', '2026-11-14'),
    allDay('later', '2026-11-16', '2026-11-17'),
  ];
  const bars = layoutSpanBars(evs, '2026-11-13', 5); // Nov 13–17
  const byId = Object.fromEntries(bars.map((b) => [b.ev.id, b]));
  assert.equal(byId.single, undefined, 'single-day events stay in the day cell');
  assert.deepEqual(
    { col: byId.vacation.col, span: byId.vacation.span, lane: byId.vacation.lane, before: byId.vacation.continuesBefore, after: byId.vacation.continuesAfter },
    { col: 0, span: 5, lane: 0, before: true, after: true }
  );
  assert.equal(byId.con.lane, 1);
  assert.equal(byId.later.lane, 1, 'reuses the lane the con freed up');
  assert.deepEqual(lanesPerColumn(bars, 5), [2, 2, 2, 2, 2]);
});

test('itemsThatFit and splitForMore never cut an item in half', () => {
  assert.equal(itemsThatFit(39), 0);
  assert.equal(itemsThatFit(40), 1);
  assert.equal(itemsThatFit(83), 1);
  assert.equal(itemsThatFit(84), 2);
  assert.deepEqual(splitForMore([1, 2, 3, 4], 2), { shown: [1, 2], more: 2 });
  assert.deepEqual(splitForMore([1, 2], 2), { shown: [1, 2], more: 0 });
});

const members = [
  { id: 'fam', role: 'family' as const },
  { id: 'dad', role: 'parent' as const },
  { id: 'kid', role: 'child' as const },
];
const base = { description: '', location: '', category: null, ...allDay('e', '2026-11-20', '2026-11-22') };

test('looksLikeTrip: needs trip words, a full day, specific people and a non-home location', () => {
  assert.equal(looksLikeTrip({ ...base, title: 'Beach vacation', memberIds: ['dad'] }, members, '12 Oak St, Augusta GA'), true);
  assert.equal(looksLikeTrip({ ...base, title: 'Beach vacation', memberIds: ['fam'] }, members), false, 'Family events never auto-skip everyone');
  assert.equal(looksLikeTrip({ ...base, title: 'Dentist', memberIds: ['dad'] }, members), false);
  assert.equal(looksLikeTrip({ ...base, title: 'Staycation trip', location: '12 Oak St', memberIds: ['dad'] }, members, '12 Oak St, Augusta GA'), false);
  const short = { ...base, allDay: false, startIso: new Date(2026, 10, 20, 9).toISOString(), endIso: new Date(2026, 10, 20, 11).toISOString() };
  assert.equal(looksLikeTrip({ ...short, title: 'Trip to the store', memberIds: ['dad'] }, members), false);
  assert.equal(isHomeLocation('Home', 'anything'), true);
});

test('awayMembersForEvent: the override wins; "away" on a Family event means everyone', () => {
  assert.deepEqual(awayMembersForEvent({ ...base, title: 'MagicCon', memberIds: ['dad'], awayMode: 'away' }, members), ['dad']);
  assert.deepEqual(awayMembersForEvent({ ...base, title: 'Vacation', memberIds: ['fam'], awayMode: 'away' }, members), ['dad', 'kid']);
  assert.deepEqual(awayMembersForEvent({ ...base, title: 'Vacation', memberIds: ['dad'], awayMode: 'home' }, members), []);
});

test('awayOnDate + effectiveChores: away people\'s chores go up for grabs; skips are flagged', () => {
  const evs = [{ ...base, title: 'Ski trip', memberIds: ['kid'] }];
  const away = awayOnDate(evs, '2026-11-21', members);
  assert.deepEqual(away.map((a) => a.memberId), ['kid']);
  assert.deepEqual(awayOnDate(evs, '2026-11-23', members), []);
  const result = effectiveChores(
    [
      { id: 'c1', assignedMemberId: 'kid' },
      { id: 'c2', assignedMemberId: 'dad' },
      { id: 'c3', assignedMemberId: null },
    ],
    away,
    ['c2']
  );
  assert.deepEqual(
    result.map((r) => [r.chore.id, r.ownerId, r.reassignedFrom, r.skipped]),
    [
      ['c1', null, 'kid', false],
      ['c2', 'dad', null, true],
      ['c3', null, null, false],
    ]
  );
});
