import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Google Keep per-person chore lists (fake Keep)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-keep-chores-'));
  process.env.DATA_DIR = tempDir;
  process.env.KEEP_BRIDGE_CMD = JSON.stringify([process.execPath, path.resolve('tests/mocks/fakeKeepBridge.mjs')]);
  const keepFile = path.join(tempDir, 'keep', 'fake-keep.json');
  fs.mkdirSync(path.dirname(keepFile), { recursive: true });
  fs.writeFileSync(keepFile, JSON.stringify({ notes: {} }));
  const readKeep = () => JSON.parse(fs.readFileSync(keepFile, 'utf8'));
  const writeKeep = (s: any) => fs.writeFileSync(keepFile, JSON.stringify(s, null, 2));

  const { initSchema } = await import('../../src/server/db/schema.js');
  const { seedIfNeeded } = await import('../../src/server/db/seed.js');
  const { db } = await import('../../src/server/db/connection.js');
  const { choresRouter } = await import('../../src/server/routes/chores.js');
  const { keepRouter } = await import('../../src/server/routes/keep.js');
  const { localDateStr, choreAppliesToDate } = await import('../../src/shared/chores.js');
  initSchema();
  seedIfNeeded();

  const app = new Hono();
  app.route('/api/chores', choresRouter);
  app.route('/api/keep', keepRouter);
  const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Known setup: one person with two daily chores and one Saturday-only chore, nothing done yet.
  const member = (db.prepare("SELECT id, name FROM family_members WHERE role = 'child' ORDER BY sort_order LIMIT 1").get() as any);
  db.prepare('DELETE FROM chore_completions').run();
  db.prepare('UPDATE chores SET assigned_member_id = NULL WHERE assigned_member_id = ?').run(member.id);
  const addChore = async (title: string, frequency: string, daysOfWeek: number[] = []) =>
    ((await (await app.request('/api/chores', json('POST', { title, assignedMemberId: member.id, frequency, daysOfWeek, stars: 2 }))).json()) as any).id;
  const bedId = await addChore('Make Bed', 'daily');
  const teethId = await addChore('Brush Teeth', 'daily');
  const today = new Date();
  const notTodayDow = (today.getDay() + 3) % 7;
  await addChore('Water Plants', 'weekly', [notTodayDow]);

  // 1. Create a "<Name>'s Chores" Keep list and link it; today's chores appear unchecked
  const linkRes = (await (await app.request(`/api/keep/chore-links/${member.id}`, json('PUT', { createTitle: `${member.name}'s Chores` }))).json()) as any;
  assert.equal(linkRes.state, 'ok', linkRes.message);
  const noteId = linkRes.choreLinks[0].keepNoteId;
  const note = () => readKeep().notes[noteId];
  assert.equal(note().title, `${member.name}'s Chores`);
  assert.deepEqual(note().items.map((i: any) => i.text).sort(), ['Brush Teeth', 'Make Bed'], 'only chores due today');
  assert.ok(note().items.every((i: any) => !i.checked));

  // 2. Checking off in Keep records a completion + stars for that person
  let s = readKeep();
  s.notes[noteId].items.find((i: any) => i.text === 'Make Bed').checked = true;
  writeKeep(s);
  await app.request('/api/keep/sync', json('POST'));
  const completion = db.prepare('SELECT * FROM chore_completions WHERE chore_id = ? AND date_str = ?').get(bedId, localDateStr()) as any;
  assert.ok(completion, 'completion recorded');
  assert.equal(completion.completed_by_member_id, member.id);
  assert.equal(completion.stars_earned, 2);

  // 3. Checking off on the wall reaches Keep
  await app.request(`/api/chores/${teethId}/toggle`, json('POST', { dateStr: localDateStr() }));
  await app.request('/api/keep/sync', json('POST'));
  assert.equal(note().items.find((i: any) => i.text === 'Brush Teeth').checked, true);

  // 4. Adding in Keep creates a one-off chore for today
  s = readKeep();
  s.notes[noteId].items.push({ id: 'k-room', text: 'Clean Room', checked: false });
  writeKeep(s);
  await app.request('/api/keep/sync', json('POST'));
  const room = db.prepare("SELECT * FROM chores WHERE title = 'Clean Room'").get() as any;
  assert.ok(room, 'one-off chore created');
  assert.equal(room.frequency, 'once');
  assert.equal(room.specific_date, localDateStr());
  assert.equal(room.assigned_member_id, member.id);

  // 5. Steady state: no Keep writes
  const applyBefore = readKeep().applyCount || 0;
  await app.request('/api/keep/sync', json('POST'));
  assert.equal(readKeep().applyCount || 0, applyBefore);

  // 6. Deleting a recurring chore in Keep keeps the routine and brings it back
  s = readKeep();
  s.notes[noteId].items = s.notes[noteId].items.filter((i: any) => i.text !== 'Make Bed');
  writeKeep(s);
  await app.request('/api/keep/sync', json('POST'));
  assert.ok(db.prepare('SELECT 1 FROM chores WHERE id = ?').get(bedId), 'routine not deleted');
  await app.request('/api/keep/sync', json('POST'));
  assert.ok(note().items.some((i: any) => i.text === 'Make Bed'), 'routine re-added to Keep');

  // 7. Midnight rollover: next day all checks clear, yesterday's one-off disappears
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 9, 0, 0);
  mock.timers.enable({ apis: ['Date'], now: tomorrow });
  try {
    await app.request('/api/keep/sync', json('POST'));
    const items = note().items;
    const expected = ['Brush Teeth', 'Make Bed'];
    if (choreAppliesToDate({ frequency: 'weekly', daysOfWeek: [notTodayDow], specificDate: null }, tomorrow, localDateStr(tomorrow))) {
      expected.push('Water Plants');
    }
    assert.deepEqual(items.map((i: any) => i.text).sort(), expected.sort(), 'new day list');
    assert.ok(items.every((i: any) => !i.checked), 'checks reset for the new day');
  } finally {
    mock.timers.reset();
  }

  // 8. Unlink
  const unlinked = (await (await app.request(`/api/keep/chore-links/${member.id}`, json('DELETE'))).json()) as any;
  assert.equal(unlinked.choreLinks.length, 0);
});
