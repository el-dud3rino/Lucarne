import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

interface LatencyStats {
  endpoint: string;
  samples: number;
  min: number;
  median: number;
  mean: number;
  p95: number;
  max: number;
}

function calculateStats(endpoint: string, latencies: number[]): LatencyStats {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0];
  const max = sorted[n - 1];
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / n;
  const p95 = sorted[Math.floor(n * 0.95)];

  return {
    endpoint,
    samples: n,
    min: Math.round(min * 100) / 100,
    median: Math.round(median * 100) / 100,
    mean: Math.round(mean * 100) / 100,
    p95: Math.round(p95 * 100) / 100,
    max: Math.round(max * 100) / 100,
  };
}

test('Benchmark: median local server response latency must be < 25ms across core APIs', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-bench-'));
  process.env.DATA_DIR = tempDir;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { eventsRouter } = await import('../../src/server/routes/events.js');
    const { choresRouter } = await import('../../src/server/routes/chores.js');
    const { listsRouter } = await import('../../src/server/routes/lists.js');
    const { mealsRouter } = await import('../../src/server/routes/meals.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/events', eventsRouter);
    app.route('/api/chores', choresRouter);
    app.route('/api/lists', listsRouter);
    app.route('/api/meals', mealsRouter);

    const ITERATIONS = 100;
    const statsSummary: LatencyStats[] = [];

    // 1. Calendar query benchmark
    const now = new Date();
    const startRange = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString();
    const endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 4).toISOString();
    const calQueryUrl = `/api/events?start=${encodeURIComponent(startRange)}&end=${encodeURIComponent(endRange)}`;

    const calLatencies: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const res = await app.request(calQueryUrl);
      await res.json();
      calLatencies.push(performance.now() - t0);
    }
    const calStats = calculateStats('GET /api/events (calendar query)', calLatencies);
    statsSummary.push(calStats);
    assert.ok(
      calStats.median < 25.0,
      `Calendar query median latency must be < 25ms (was ${calStats.median}ms)`
    );

    // 2. Chore toggle benchmark
    const choreLatencies: number[] = [];
    const todayStr = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const res = await app.request('/api/chores/chore-1/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStr: todayStr }),
      });
      await res.json();
      choreLatencies.push(performance.now() - t0);
    }
    const choreStats = calculateStats('POST /api/chores/:id/toggle (chore toggle)', choreLatencies);
    statsSummary.push(choreStats);
    assert.ok(
      choreStats.median < 25.0,
      `Chore toggle median latency must be < 25ms (was ${choreStats.median}ms)`
    );

    // 3. Grocery addition benchmark
    const groceryAddLatencies: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const res = await app.request('/api/lists/list-groceries/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Benchmark Item ${i}` }),
      });
      await res.json();
      groceryAddLatencies.push(performance.now() - t0);
    }
    const addStats = calculateStats('POST /api/lists/:id/items (grocery add)', groceryAddLatencies);
    statsSummary.push(addStats);
    assert.ok(
      addStats.median < 25.0,
      `Grocery add median latency must be < 25ms (was ${addStats.median}ms)`
    );

    // 4. Grocery item toggle benchmark
    // Get an existing grocery item
    const itemsRes = await app.request('/api/lists/list-groceries/items');
    const items = (await itemsRes.json()) as any[];
    const targetItemId = items[0].id;

    const toggleLatencies: number[] = [];
    let checked = false;
    for (let i = 0; i < ITERATIONS; i++) {
      checked = !checked;
      const t0 = performance.now();
      const res = await app.request(`/api/lists/items/${targetItemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked }),
      });
      await res.json();
      toggleLatencies.push(performance.now() - t0);
    }
    const toggleStats = calculateStats('PUT /api/lists/items/:id (grocery check toggle)', toggleLatencies);
    statsSummary.push(toggleStats);
    assert.ok(
      toggleStats.median < 25.0,
      `Grocery check toggle median latency must be < 25ms (was ${toggleStats.median}ms)`
    );

    // 5. Meal plan update benchmark
    const mealLatencies: number[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const targetDate = `2026-11-${String((i % 28) + 1).padStart(2, '0')}`;
      const t0 = performance.now();
      const res = await app.request('/api/meals/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateStr: targetDate,
          slot: 'dinner',
          recipeId: 'rec-fajitas',
          customTitle: '',
          notes: `Batch ${i}`,
        }),
      });
      await res.json();
      mealLatencies.push(performance.now() - t0);
    }
    const mealStats = calculateStats('POST /api/meals/plan (meal plan update)', mealLatencies);
    statsSummary.push(mealStats);
    assert.ok(
      mealStats.median < 25.0,
      `Meal plan update median latency must be < 25ms (was ${mealStats.median}ms)`
    );

    // Pretty-print benchmark results table
    console.table(statsSummary);

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
