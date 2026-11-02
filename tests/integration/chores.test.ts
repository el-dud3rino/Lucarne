import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Chores Integration: routines, assigned & shared claiming, completion toggling, and star ledger calculation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-chores-'));
  process.env.DATA_DIR = tempDir;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { db } = await import('../../src/server/db/connection.js');
    const { choresRouter } = await import('../../src/server/routes/chores.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/chores', choresRouter);

    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. Fetch chores for today
    const res1 = await app.request(`/api/chores?date=${todayStr}`);
    assert.equal(res1.status, 200);
    const data1 = (await res1.json()) as { chores: any[]; completions: any[]; stats: any[] };

    assert.ok(data1.chores.length >= 10, 'Must have seeded chores');
    assert.ok(Array.isArray(data1.stats), 'Stats array must be present');

    // Verify chores cover routines: morning, afternoon, evening, anytime
    const times = new Set(data1.chores.map((c) => c.timeOfDay));
    assert.ok(times.has('morning'), 'Must have morning chores');
    assert.ok(times.has('evening'), 'Must have evening chores');

    // 2. Test Assigned Chore completion (Kid 1 - Leo)
    const kidChore = data1.chores.find((c) => c.assignedMemberId === 'mem-kid1' && c.id === 'chore-2');
    assert.ok(kidChore, 'Found Leo assigned chore');

    // Initial stats for kid1
    const initialKidStats = data1.stats.find((s) => s.memberId === 'mem-kid1');
    const initialTodayStars = initialKidStats ? initialKidStats.todayStars : 0;

    // Toggle complete
    const toggleRes1 = await app.request(`/api/chores/${kidChore.id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateStr: todayStr }),
    });
    assert.equal(toggleRes1.status, 200);
    const toggleData1 = (await toggleRes1.json()) as { completed: boolean };
    assert.equal(toggleData1.completed, true);

    // Verify stats updated
    const res2 = await app.request(`/api/chores?date=${todayStr}`);
    const data2 = (await res2.json()) as { stats: any[]; completions: any[] };
    const updatedKidStats = data2.stats.find((s) => s.memberId === 'mem-kid1');
    assert.equal(
      updatedKidStats.todayStars,
      initialTodayStars + kidChore.stars,
      'Leo stars must increment by chore stars'
    );

    // 3. Test Shared Chore claiming ("Up for grabs")
    // chore-12 is 'Feed the Dog', assignedMemberId is null
    const sharedChore = data1.chores.find((c) => c.assignedMemberId === null && c.id === 'chore-12');
    assert.ok(sharedChore, 'Found shared chore');

    // Dad ('mem-dad') claims the shared chore
    const dadInitialStats = data2.stats.find((s) => s.memberId === 'mem-dad');
    const dadInitialStars = dadInitialStats ? dadInitialStats.todayStars : 0;

    const toggleRes2 = await app.request(`/api/chores/${sharedChore.id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateStr: todayStr, completedByMemberId: 'mem-dad' }),
    });
    assert.equal(toggleRes2.status, 200);
    const toggleData2 = (await toggleRes2.json()) as { completed: boolean };
    assert.equal(toggleData2.completed, true);

    // Verify completion attributed to Dad and Dad's ledger updated
    const res3 = await app.request(`/api/chores?date=${todayStr}`);
    const data3 = (await res3.json()) as { completions: any[]; stats: any[] };
    const compRecord = data3.completions.find((c) => c.choreId === sharedChore.id);
    assert.ok(compRecord, 'Completion record exists');
    assert.equal(compRecord.completedByMemberId, 'mem-dad', 'Completion attributed to Dad');

    const dadUpdatedStats = data3.stats.find((s) => s.memberId === 'mem-dad');
    assert.equal(
      dadUpdatedStats.todayStars,
      dadInitialStars + sharedChore.stars,
      'Dad star ledger increments by chore stars'
    );

    // 4. Test Unchecking a completed chore: toggles off, removes completion, decrements stars
    const toggleRes3 = await app.request(`/api/chores/${sharedChore.id}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateStr: todayStr }),
    });
    assert.equal(toggleRes3.status, 200);
    const toggleData3 = (await toggleRes3.json()) as { completed: boolean };
    assert.equal(toggleData3.completed, false, 'Toggling again marks chore incomplete');

    const res4 = await app.request(`/api/chores?date=${todayStr}`);
    const data4 = (await res4.json()) as { completions: any[]; stats: any[] };
    const compRecordAfter = data4.completions.find((c) => c.choreId === sharedChore.id);
    assert.equal(compRecordAfter, undefined, 'Completion record deleted on uncheck');

    const dadRevertedStats = data4.stats.find((s) => s.memberId === 'mem-dad');
    assert.equal(dadRevertedStats.todayStars, dadInitialStars, 'Dad star ledger decrements back');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
