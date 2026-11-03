import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs, wallTimeToUtc } from '../../src/server/services/ics.js';

const WIN_START = Date.UTC(2026, 0, 1);
const WIN_END = Date.UTC(2027, 11, 31);

const wrap = (body: string) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Lincoln Elementary', body.trim(), 'END:VCALENDAR'].join('\r\n');

test('ICS: all-day, timed UTC, TZID, folded lines and escaped text', () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:a1
DTSTART;VALUE=DATE:20261126
DTEND;VALUE=DATE:20261128
SUMMARY:Thanksgiving Break - No School
END:VEVENT
BEGIN:VEVENT
UID:a2
DTSTART:20261110T150000Z
DTEND:20261110T160000Z
SUMMARY:Picture Day
LOCATION:Gym\\, Building B
DESCRIPTION:Wear your best smile.\\nRetakes in Dec
 ember.
END:VEVENT
BEGIN:VEVENT
UID:a3
DTSTART;TZID=America/Denver:20260715T180000
DTEND;TZID=America/Denver:20260715T193000
SUMMARY:Soccer Practice
BEGIN:VALARM
TRIGGER:-PT30M
SUMMARY:Alarm should be ignored
END:VALARM
END:VEVENT`);
  const { calendarName, events } = parseIcs(ics, WIN_START, WIN_END);
  assert.equal(calendarName, 'Lincoln Elementary');
  assert.equal(events.length, 3);

  const brk = events.find((e) => e.uid === 'a1')!;
  assert.equal(brk.allDay, true);
  assert.equal(brk.startIso, '2026-11-26T00:00:00.000Z');
  assert.equal(brk.endIso, '2026-11-27T23:59:59.000Z', 'DTEND is exclusive -> last day is the 27th');

  const pic = events.find((e) => e.uid === 'a2')!;
  assert.equal(pic.startIso, '2026-11-10T15:00:00.000Z');
  assert.equal(pic.location, 'Gym, Building B');
  assert.equal(pic.description, 'Wear your best smile.\nRetakes in December.');

  const soccer = events.find((e) => e.uid === 'a3')!;
  assert.equal(soccer.title, 'Soccer Practice');
  // Denver is UTC-6 in July (MDT)
  assert.equal(soccer.startIso, '2026-07-16T00:00:00.000Z');
  assert.equal(soccer.endIso, '2026-07-16T01:30:00.000Z');
});

test('ICS: Windows time zone names from Outlook are understood', () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:w1
DTSTART;TZID="Eastern Standard Time":20261201T090000
DTEND;TZID="Eastern Standard Time":20261201T100000
SUMMARY:Dentist
END:VEVENT`);
  const [ev] = parseIcs(ics, WIN_START, WIN_END).events;
  assert.equal(ev.startIso, '2026-12-01T14:00:00.000Z'); // EST = UTC-5
});

test('ICS: weekly RRULE keeps wall-clock time across DST, honours COUNT, BYDAY, EXDATE and overrides', () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:r1
DTSTART;TZID=America/New_York:20261026T163000
DTEND;TZID=America/New_York:20261026T173000
RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6
EXDATE;TZID=America/New_York:20261104T163000
SUMMARY:Swim
END:VEVENT
BEGIN:VEVENT
UID:r1
RECURRENCE-ID;TZID=America/New_York:20261102T163000
DTSTART;TZID=America/New_York:20261102T180000
DTEND;TZID=America/New_York:20261102T190000
SUMMARY:Swim (late start)
END:VEVENT`);
  const events = parseIcs(ics, WIN_START, WIN_END).events;
  const titles = events.map((e) => `${e.title}@${e.startIso}`);
  // Occurrences: Oct 26 (Mo), 28 (We), Nov 2 (Mo -> overridden), 4 (We -> EXDATE), 9 (Mo), 11 (We)
  assert.deepEqual(titles, [
    'Swim@2026-10-26T20:30:00.000Z', // EDT (UTC-4)
    'Swim@2026-10-28T20:30:00.000Z',
    'Swim (late start)@2026-11-02T23:00:00.000Z',
    'Swim@2026-11-09T21:30:00.000Z', // EST (UTC-5): same 4:30 PM local
    'Swim@2026-11-11T21:30:00.000Z',
  ]);
});

test('ICS: monthly/yearly/until rules, cancelled events and window filtering', () => {
  const ics = wrap(`
BEGIN:VEVENT
UID:m1
DTSTART;VALUE=DATE:20260131
RRULE:FREQ=MONTHLY;UNTIL=20260601
SUMMARY:Month-end report
END:VEVENT
BEGIN:VEVENT
UID:y1
DTSTART;VALUE=DATE:20100704
RRULE:FREQ=YEARLY
SUMMARY:Independence Day
END:VEVENT
BEGIN:VEVENT
UID:c1
DTSTART:20261201T120000Z
STATUS:CANCELLED
SUMMARY:Cancelled game
END:VEVENT
BEGIN:VEVENT
UID:old
DTSTART:20200101T120000Z
SUMMARY:Way in the past
END:VEVENT`);
  const events = parseIcs(ics, WIN_START, WIN_END).events;
  const month = events.filter((e) => e.uid.startsWith('m1')).map((e) => e.startIso.slice(0, 10));
  // Months without a 31st are skipped (RFC 5545); stops after UNTIL (June 1)
  assert.deepEqual(month, ['2026-01-31', '2026-03-31', '2026-05-31']);
  const july4 = events.filter((e) => e.uid.startsWith('y1')).map((e) => e.startIso.slice(0, 10));
  assert.deepEqual(july4, ['2026-07-04', '2027-07-04'], 'a series from 2010 still reaches the window');
  assert.ok(!events.some((e) => e.title === 'Cancelled game'));
  assert.ok(!events.some((e) => e.title === 'Way in the past'));
});

test('ICS: non-calendar responses are rejected', () => {
  assert.throws(() => parseIcs('<html>Sign in</html>', WIN_START, WIN_END), /did not return a calendar/);
});

test('wallTimeToUtc handles both sides of a DST change', () => {
  assert.equal(new Date(wallTimeToUtc(2026, 3, 7, 12, 0, 0, 'America/Chicago')).toISOString(), '2026-03-07T18:00:00.000Z');
  assert.equal(new Date(wallTimeToUtc(2026, 3, 9, 12, 0, 0, 'America/Chicago')).toISOString(), '2026-03-09T17:00:00.000Z');
});
