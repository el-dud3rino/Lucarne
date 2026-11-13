import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Chores away + skip: a trip moves chores up for grabs; skipping toggles and clears a completion', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-away-'));
  process.env.DATA_DIR = tempDir;

  const { initSchema } = await import('../../src/server/db/schema.js');
  const { seedIfNeeded } = await import('../../src/server/db/seed.js');
  const { choresRouter } = await import('../../src/server/routes/chores.js');
  const { eventsRouter } = await import('../../src/server/routes/events.js');
  const { buildTodaySummary } = await import('../../src/server/routes/today.js');
  initSchema();
  seedIfNeeded();

  const app = new Hono();
  app.route('/api/chores', choresRouter);
  app.route('/api/events', eventsRouter);

  const dateStr = '2031-06-11';
  const kidId = 'mem-kid1';

  // Not away yet
  let data = (await (await app.request(`/api/chores?date=${dateStr}`)).json()) as {
    chores: Array<{ id: string; assignedMemberId: string | null }>;
    away: Array<{ memberId: string }>;
    skippedChoreIds: string[];
  };
  assert.deepEqual(data.away, []);
  assert.deepEqual(data.skippedChoreIds, []);
  const kidChore = data.chores.find((c) => c.assignedMemberId === kidId);
  assert.ok(kidChore, 'seed has a chore for the kid');

  // A trip for the kid (automatic: trip words, all-day, a specific person)
  const created = await app.request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Grandma trip',
      allDay: true,
      startIso: '2031-06-10T00:00:00.000Z',
      endIso: '2031-06-12T23:59:59.000Z',
      memberIds: [kidId],
    }),
  });
  assert.equal(created.status, 201);
  const ev = (await created.json()) as { id: string; awayMode: string | null };
  assert.equal(ev.awayMode, null, 'automatic by default');

  data = (await (await app.request(`/api/chores?date=${dateStr}`)).json()) as typeof data;
  assert.deepEqual(data.away.map((a) => a.memberId), [kidId]);
  const summary = buildTodaySummary(dateStr);
  assert.equal(summary.choresLeft.find((c) => c.memberId === kidId)?.total, 0, "away kid's chores don't count against them");

  // Override: not away
  await app.request(`/api/events/${ev.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ awayMode: 'home' }),
  });
  data = (await (await app.request(`/api/chores?date=${dateStr}`)).json()) as typeof data;
  assert.deepEqual(data.away, [], '"Not away" override wins');

  // Skip: completes are cleared, toggling again un-skips
  await app.request(`/api/chores/${kidChore!.id}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr }),
  });
  const skip1 = (await (await app.request(`/api/chores/${kidChore!.id}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr }),
  })).json()) as { skipped: boolean };
  assert.equal(skip1.skipped, true);
  const afterSkip = (await (await app.request(`/api/chores?date=${dateStr}`)).json()) as typeof data & {
    completions: Array<{ choreId: string }>;
  };
  assert.deepEqual(afterSkip.skippedChoreIds, [kidChore!.id]);
  assert.equal(afterSkip.completions.some((c) => c.choreId === kidChore!.id), false, 'skipping clears the completion');

  const skip2 = (await (await app.request(`/api/chores/${kidChore!.id}/skip`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dateStr }),
  })).json()) as { skipped: boolean };
  assert.equal(skip2.skipped, false);
});
