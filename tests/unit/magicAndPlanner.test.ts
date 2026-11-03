import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-magic-'));

const { normalizeMagicDrafts } = await import('../../src/server/services/magicImport.js');
const { validatePlan, rotationPlan } = await import('../../src/server/services/mealPlanner.js');

const members = [
  { id: 'm-leo', name: 'Leo' },
  { id: 'm-maya', name: 'Maya' },
];

test('Magic Import: keeps valid events, fixes times, maps names, drops junk and duplicates', () => {
  const drafts = normalizeMagicDrafts(
    {
      events: [
        { title: 'Picture Day', date: '2026-11-12', allDay: true, people: ['leo'] },
        { title: 'Soccer vs. Eagles', date: '2026-11-08', startTime: '9:00', endTime: '', allDay: false, people: ['Maya', 'Coach Bob'] },
        { title: 'Soccer vs. Eagles', date: '2026-11-08', startTime: '09:00', allDay: false }, // duplicate
        { title: 'Book fair', date: '2026-11-16', endDate: '2026-11-14', allDay: true }, // end before start -> one day
        { title: 'Recital', date: '2026-12-01', startTime: '18:30', endTime: '18:00', allDay: false }, // end before start -> +1h
        { title: 'No date here', date: 'next Tuesday', allDay: true },
        { title: '', date: '2026-11-20', allDay: true },
        { title: 'Bad time becomes all-day', date: '2026-11-21', startTime: '25:99', allDay: false },
        'garbage',
      ],
    },
    members
  );
  assert.deepEqual(
    drafts.map((d) => d.title),
    ['Soccer vs. Eagles', 'Picture Day', 'Book fair', 'Bad time becomes all-day', 'Recital']
  );
  const soccer = drafts[0];
  assert.equal(soccer.startTime, '09:00');
  assert.equal(soccer.endTime, '10:00');
  assert.deepEqual(soccer.memberIds, ['m-maya']);
  assert.deepEqual(drafts[1].memberIds, ['m-leo']);
  assert.equal(drafts[2].endDate, '2026-11-16');
  assert.equal(drafts[3].allDay, true);
  assert.equal(drafts[4].endTime, '19:30');
});

test('Magic Import: tolerates a bare array or an empty answer', () => {
  assert.equal(normalizeMagicDrafts([{ title: 'A', date: '2026-01-02', allDay: true }], members).length, 1);
  assert.deepEqual(normalizeMagicDrafts({}, members), []);
  assert.deepEqual(normalizeMagicDrafts(null, members), []);
});

test('Meal planner: only saved recipes, only requested nights, no repeats', () => {
  const recipes = [
    { id: 'r1', title: 'Tacos' },
    { id: 'r2', title: 'Pasta' },
  ];
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04'];
  const plan = validatePlan(
    {
      dinners: [
        { date: '2026-11-03', recipeId: 'r2', reason: 'Quick' },
        { date: '2026-11-02', recipeId: 'r1' },
        { date: '2026-11-04', recipeId: 'r1' }, // repeat
        { date: '2026-11-04', recipeId: 'invented-123' }, // not a saved recipe
        { date: '2026-12-25', recipeId: 'r2' }, // not requested
      ],
    },
    dates,
    recipes
  );
  assert.deepEqual(
    plan.map((p) => `${p.dateStr}:${p.title}`),
    ['2026-11-02:Tacos', '2026-11-03:Pasta']
  );
});

test('Meal planner rotation: least recently planned first, never more picks than recipes', () => {
  const plan = rotationPlan(
    ['2026-11-02', '2026-11-03', '2026-11-04'],
    [
      { id: 'a', title: 'Chili', tags: [], favorite: false, totalMinutes: 60, lastPlanned: '2026-10-30' },
      { id: 'b', title: 'Curry', tags: [], favorite: true, totalMinutes: 40, lastPlanned: null },
    ]
  );
  assert.deepEqual(
    plan.map((p) => p.title),
    ['Curry', 'Chili']
  );
});
