import test from 'node:test';
import assert from 'node:assert/strict';
import { eventLook, eventPeople, memberSwatch } from '../../src/client/lib/eventColors.js';
import type { FamilyMember } from '../../src/shared/types.js';

const mk = (id: string, role: string, bg: string, accent: string): FamilyMember =>
  ({ id, name: id, initial: id[0], emoji: '', role, colorBg: bg, colorText: '#000', colorAccent: accent } as unknown as FamilyMember);
const family = mk('fam', 'family', '#eee', '#999');
const mom = mk('mom', 'parent', '#fde', '#f00');
const leo = mk('leo', 'child', '#def', '#00f');
const maya = mk('maya', 'child', '#efd', '#0f0');
const members = [family, mom, leo, maya];

test('single person is a solid color', () => {
  const look = eventLook({ memberIds: ['leo'], category: null }, members);
  assert.equal(look.striped, false);
  assert.equal(look.background, '#def');
  assert.equal(look.bar, '#00f');
});

test('several people get diagonal stripes in their colors', () => {
  const look = eventLook({ memberIds: ['mom', 'leo'], category: null }, members);
  assert.equal(look.striped, true);
  assert.equal(look.background, 'linear-gradient(135deg, #fde 0.00% 50.00%, #def 50.00% 100.00%)', 'each color once, as diagonal bands');
  assert.match(look.bar, /#f00 0\.00% 50\.00%, #00f 50\.00% 100\.00%/);
});

test('Family (or nobody) means everyone, in household order', () => {
  assert.deepEqual(eventPeople({ memberIds: ['fam'] }, members).map((m) => m.id), ['mom', 'leo', 'maya']);
  assert.deepEqual(eventPeople({ memberIds: [] }, members).map((m) => m.id), ['mom', 'leo', 'maya']);
  assert.equal(eventLook({ memberIds: ['fam'], category: null }, members).striped, true);
  assert.match(memberSwatch(family, members), /^linear-gradient\(135deg/);
  assert.equal(memberSwatch(leo, members), '#00f');
});

test('birthday/holiday categories keep their own color', () => {
  const look = eventLook({ memberIds: ['mom', 'leo'], category: 'birthday' }, members);
  assert.equal(look.striped, false);
});

test('unknown member ids are ignored', () => {
  const look = eventLook({ memberIds: ['ghost', 'maya'], category: null }, members);
  assert.equal(look.striped, false);
  assert.equal(look.background, '#efd');
});
