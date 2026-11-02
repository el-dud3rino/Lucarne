import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categoryForCalendar, categoryForEvent } from '../../src/shared/eventCategories.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-unit-cat-'));
const { dedupeBirthdays } = await import('../../src/server/routes/events.js');

test('holiday and birthday calendars are recognized by Google ID or name', () => {
  assert.equal(categoryForCalendar('en.usa#holiday@group.v.calendar.google.com', 'Holidays in United States'), 'holiday');
  assert.equal(categoryForCalendar('xyz@group.calendar.google.com', 'Holidays in Canada'), 'holiday');
  assert.equal(categoryForCalendar('addressbook#contacts@group.v.calendar.google.com', 'Contacts'), 'birthday');
  assert.equal(categoryForCalendar('abc@group.calendar.google.com', 'Birthdays (Sync-able)'), 'birthday');
  assert.equal(categoryForCalendar('family@group.calendar.google.com', 'Family'), null);
  assert.equal(categoryForCalendar('me@gmail.com', 'Holiday Party Planning Committee'), 'holiday');
});

test('event category: calendar wins, else Google birthday type or "…Birthday" title', () => {
  assert.equal(categoryForEvent('holiday', "Mom's Birthday"), 'holiday');
  assert.equal(categoryForEvent(null, "Jennifer Cullison's Birthday"), 'birthday');
  assert.equal(categoryForEvent(null, 'Leo bday party'), 'birthday');
  assert.equal(categoryForEvent(null, 'Dinner', 'birthday'), 'birthday');
  assert.equal(categoryForEvent(null, 'Soccer practice', 'default'), null);
  assert.equal(categoryForEvent(null, 'Birthdaycake shopping'), null, 'whole word only');
});

test('the same birthday from two calendars shows once; other events untouched', () => {
  const ev = (id: string, title: string, day: string, category: any = 'birthday') => ({
    id, title, description: '', location: '', startIso: `${day}T00:00:00.000Z`, endIso: `${day}T23:59:59.000Z`,
    allDay: true, memberIds: [], calendarSourceId: null, externalEventId: null, updatedAt: '', category,
  });
  const out = dedupeBirthdays([
    ev('a', "Hillary's Birthday", '2027-06-30'),
    ev('b', "hillary's birthday ", '2027-06-30'),
    ev('c', "Hillary's Birthday", '2028-06-30'),
    ev('d', 'Swim', '2027-06-30', null),
    ev('e', 'Swim', '2027-06-30', null),
  ] as any);
  assert.deepEqual(out.map((e: any) => e.id), ['a', 'c', 'd', 'e']);
});
