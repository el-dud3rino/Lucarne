import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-extras-'));
process.env.DATA_DIR = tempDir;

const { initSchema } = await import('../../src/server/db/schema.js');
const { seedIfNeeded } = await import('../../src/server/db/seed.js');
const { db, performBackup, restoreBackup, listBackups } = await import('../../src/server/db/connection.js');
const { countdownsRouter } = await import('../../src/server/routes/countdowns.js');
const { rewardsRouter } = await import('../../src/server/routes/rewards.js');
const { routinesRouter } = await import('../../src/server/routes/routines.js');
const { choresRouter } = await import('../../src/server/routes/chores.js');
const { eventsRouter } = await import('../../src/server/routes/events.js');
const { listsRouter } = await import('../../src/server/routes/lists.js');
const { todayRouter } = await import('../../src/server/routes/today.js');
const { syncIcsFeed } = await import('../../src/server/services/icsFeeds.js');
const { localDateStr } = await import('../../src/shared/chores.js');

initSchema();
seedIfNeeded();

const app = new Hono();
app.route('/api/countdowns', countdownsRouter);
app.route('/api/rewards', rewardsRouter);
app.route('/api/routines', routinesRouter);
app.route('/api/chores', choresRouter);
app.route('/api/events', eventsRouter);
app.route('/api/lists', listsRouter);
app.route('/api/today', todayRouter);

const json = (method: string, body?: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const today = localDateStr();
const shift = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateStr(d);
};
const kid = (db.prepare("SELECT id FROM family_members WHERE role = 'child' ORDER BY sort_order LIMIT 1").get() as { id: string }).id;

test('countdowns: create, list upcoming with days left, hide past ones, validate', async () => {
  const res = await app.request('/api/countdowns', json('POST', { title: 'Beach trip', emoji: '🏖️', dateStr: shift(12) }));
  assert.equal(res.status, 201);
  await app.request('/api/countdowns', json('POST', { title: 'Old party', dateStr: shift(-3) }));
  assert.equal((await app.request('/api/countdowns', json('POST', { title: 'x', dateStr: 'soon' }))).status, 400);

  const list = (await (await app.request('/api/countdowns')).json()) as Array<{ title: string; daysLeft: number }>;
  assert.deepEqual(
    list.map((c) => [c.title, c.daysLeft]),
    [['Beach trip', 12]]
  );
});

test('rewards: balance = chore stars + routine bonus - spent; refuses overspending; undo refunds', async () => {
  // Earn stars by completing two of the kid's chores today.
  // Fresh chore for the kid (seeded chores may be pre-completed or not due today).
  const created = [];
  for (const title of ['Feed the cat', 'Make bed']) {
    created.push(
      (await (await app.request('/api/chores', json('POST', { title, assignedMemberId: kid, frequency: 'daily', stars: 2 }))).json()) as {
        id: string;
        stars: number;
      }
    );
  }
  const mine = created;
  for (const c of mine) await app.request(`/api/chores/${c.id}/toggle`, json('POST', { dateStr: today }));
  const choreStars = mine.reduce((s, c) => s + c.stars, 0);

  const reward = (await (await app.request('/api/rewards', json('POST', { title: 'Pick the movie', emoji: '🎬', cost: choreStars + 5 }))).json()) as { id: string };
  let state = (await (await app.request('/api/rewards')).json()) as { balances: Array<{ memberId: string; balance: number }> };
  const before = state.balances.find((b) => b.memberId === kid)!.balance;
  assert.ok(before >= choreStars);

  const tooPoor = await app.request(`/api/rewards/${reward.id}/redeem`, json('POST', { memberId: kid }));
  if (before < choreStars + 5) {
    assert.equal(tooPoor.status, 400);
    assert.match(((await tooPoor.json()) as { error: string }).error, /Not enough stars/);
  }

  // A routine with a 5-star bonus, fully completed today, tops the balance up.
  const routine = (await (
    await app.request(
      '/api/routines',
      json('POST', { title: 'Bedtime', emoji: '🌙', memberId: kid, timeOfDay: 'evening', stars: 5, steps: [{ title: 'Brush teeth', emoji: '🪥' }, { title: 'Pajamas' }] })
    )
  ).json()) as { id: string; steps: Array<{ id: string }> };
  assert.equal(routine.steps.length, 2);
  await app.request(`/api/routines/steps/${routine.steps[0].id}/toggle`, json('POST', { dateStr: today }));
  state = (await (await app.request('/api/rewards')).json()) as typeof state;
  assert.equal(state.balances.find((b) => b.memberId === kid)!.balance, before, 'half a routine earns no bonus');
  await app.request(`/api/routines/steps/${routine.steps[1].id}/toggle`, json('POST', { dateStr: today }));
  state = (await (await app.request('/api/rewards')).json()) as typeof state;
  assert.equal(state.balances.find((b) => b.memberId === kid)!.balance, before + 5);

  const ok = await app.request(`/api/rewards/${reward.id}/redeem`, json('POST', { memberId: kid }));
  assert.equal(ok.status, 201, await ok.clone().text());
  const redemption = (await ok.json()) as { id: string; cost: number };
  state = (await (await app.request('/api/rewards')).json()) as typeof state & { history: unknown[] };
  assert.equal(state.balances.find((b) => b.memberId === kid)!.balance, before + 5 - redemption.cost);

  await app.request(`/api/rewards/redemptions/${redemption.id}`, json('DELETE'));
  state = (await (await app.request('/api/rewards')).json()) as typeof state;
  assert.equal(state.balances.find((b) => b.memberId === kid)!.balance, before + 5, 'undo refunds the stars');

  // Editing steps keeps existing step ids (and their checks)
  const edited = (await (
    await app.request(`/api/routines/${routine.id}`, json('PUT', { steps: [{ id: routine.steps[0].id, title: 'Brush teeth' }, { title: 'Story time' }] }))
  ).json()) as { steps: Array<{ id: string; title: string }> };
  assert.equal(edited.steps[0].id, routine.steps[0].id);
  assert.deepEqual(edited.steps.map((s) => s.title), ['Brush teeth', 'Story time']);
});

test('habits: log counts, streaks and the 7-day strip', async () => {
  const habit = (await (await app.request('/api/routines/habits', json('POST', { title: 'Water', emoji: '💧', memberId: kid, targetPerDay: 2, unit: 'glasses' }))).json()) as { id: string };
  for (const [date, n] of [
    [shift(-2), 2],
    [shift(-1), 3],
    [today, 1],
  ] as const) {
    for (let i = 0; i < n; i++) await app.request(`/api/routines/habits/${habit.id}/log`, json('POST', { dateStr: date, delta: 1 }));
  }
  let h = ((await (await app.request(`/api/routines/habits?date=${today}`)).json()) as Array<{ id: string; today: number; streak: number; week: number[] }>).find(
    (x) => x.id === habit.id
  )!;
  assert.equal(h.today, 1);
  assert.equal(h.streak, 2, 'today not met yet -> streak through yesterday');
  assert.deepEqual(h.week.slice(-3), [2, 3, 1]);
  await app.request(`/api/routines/habits/${habit.id}/log`, json('POST', { dateStr: today, delta: 1 }));
  await app.request(`/api/routines/habits/${habit.id}/log`, json('POST', { dateStr: shift(-5), delta: -1 })); // never below zero
  h = ((await (await app.request(`/api/routines/habits?date=${today}`)).json()) as Array<typeof h>).find((x) => x.id === habit.id)!;
  assert.equal(h.streak, 3);
  assert.equal(h.week[1], 0);
});

test('events: travel time and driver are stored; feed events are read-only', async () => {
  const start = new Date();
  start.setHours(start.getHours() + 2, 0, 0, 0);
  const res = await app.request(
    '/api/events',
    json('POST', { title: 'Soccer', startIso: start.toISOString(), endIso: new Date(start.getTime() + 3600_000).toISOString(), memberIds: [kid], travelMinutes: 20, driverMemberId: 'mem-dad' })
  );
  const ev = (await res.json()) as { id: string; travelMinutes: number; driverMemberId: string };
  assert.equal(ev.travelMinutes, 20);
  assert.equal(ev.driverMemberId, 'mem-dad');
  const upd = (await (await app.request(`/api/events/${ev.id}`, json('PUT', { travelMinutes: '' }))).json()) as { travelMinutes: number | null; driverMemberId: string };
  assert.equal(upd.travelMinutes, null);
  assert.equal(upd.driverMemberId, 'mem-dad', 'untouched fields are kept');

  // Subscribe to a feed (fetch stubbed) and check its events.
  const feedId = 'feed-test';
  db.prepare("INSERT INTO ics_feeds (id, url, name, member_ids_json, enabled, created_at) VALUES (?, 'https://example.test/s.ics', 'School', ?, 1, ?)").run(
    feedId,
    JSON.stringify([kid]),
    new Date().toISOString()
  );
  const d = today.replace(/-/g, '');
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:s1\r\nDTSTART;VALUE=DATE:${d}\r\nSUMMARY:Early Release\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  const feed = await syncIcsFeed(feedId, async () => ics);
  assert.equal(feed.eventCount, 1);
  assert.equal(feed.syncError, null);
  const feedEvent = db.prepare('SELECT id, member_ids_json FROM events WHERE ics_feed_id = ?').get(feedId) as { id: string; member_ids_json: string };
  assert.deepEqual(JSON.parse(feedEvent.member_ids_json), [kid]);
  assert.equal((await app.request(`/api/events/${feedEvent.id}`, json('PUT', { title: 'Hacked' }))).status, 403);
  assert.equal((await app.request(`/api/events/${feedEvent.id}`, json('DELETE'))).status, 403);

  // A broken download keeps the last good copy.
  const failed = await syncIcsFeed(feedId, async () => {
    throw new Error('HTTP 500');
  });
  assert.equal(failed.syncError, 'HTTP 500');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM events WHERE ics_feed_id = ?').get(feedId) as { n: number }).n, 1);

  // Today summary includes the feed event, filtered by person for kid mode.
  const summary = (await (await app.request(`/api/today?date=${today}&memberId=${kid}`)).json()) as {
    events: Array<{ title: string }>;
    chores: unknown[];
    routines: unknown[];
    countdowns: Array<{ title: string }>;
  };
  assert.ok(summary.events.some((e) => e.title === 'Early Release'));
  assert.ok(summary.chores.some((c) => (c as { title: string }).title === 'Feed the cat'));
  assert.ok(summary.routines.length >= 1);
  assert.equal(summary.countdowns[0]?.title, 'Beach trip');
});

test('grocery quick items: learned from manual adds, hidden from tiles when already on the list', async () => {
  const listId = 'list-groceries';
  for (const t of ['Milk', 'milk', 'Bananas', 'Milk']) {
    await app.request(`/api/lists/${listId}/items`, json('POST', { text: t }));
    // check everything off so the next add counts as a fresh add
    db.prepare('UPDATE list_items SET checked = 1 WHERE list_id = ?').run(listId);
  }
  await app.request(`/api/lists/${listId}/items`, json('POST', { text: 'Chicken thighs', recipeSourceTitle: 'Curry' })); // from a recipe: not a staple
  let quick = (await (await app.request(`/api/lists/${listId}/quick-items`)).json()) as Array<{ nameKey: string; text: string; addCount: number }>;
  assert.equal(quick[0].text.toLowerCase(), 'milk');
  assert.equal(quick[0].addCount, 3);
  assert.ok(!quick.some((q) => /chicken/i.test(q.text)));

  await app.request(`/api/lists/${listId}/items`, json('POST', { text: 'Bananas' })); // now waiting on the list
  quick = (await (await app.request(`/api/lists/${listId}/quick-items`)).json()) as typeof quick;
  assert.ok(!quick.some((q) => q.text === 'Bananas'));

  await app.request('/api/lists/quick-items/hide', json('POST', { nameKey: quick[0].nameKey }));
  quick = (await (await app.request(`/api/lists/${listId}/quick-items`)).json()) as typeof quick;
  assert.ok(!quick.some((q) => q.text.toLowerCase() === 'milk'));
});

test('backups: restore replaces data in place and keeps a safety copy', async () => {
  const backupFile = performBackup();
  db.prepare("UPDATE family_members SET name = 'Changed' WHERE id = ?").run(kid);
  db.prepare('DELETE FROM countdowns').run();

  const result = restoreBackup(path.basename(backupFile));
  assert.equal((db.prepare('SELECT name FROM family_members WHERE id = ?').get(kid) as { name: string }).name !== 'Changed', true);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM countdowns').get() as { n: number }).n, 2);
  assert.ok(listBackups().some((b) => b.name === result.safetyBackup && b.preRestore));
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
  assert.throws(() => restoreBackup('../lucarne.db'), /Unknown backup/);
});
