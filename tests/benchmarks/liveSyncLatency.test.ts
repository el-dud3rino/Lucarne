import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Live Sync Benchmark: multi-client mutation propagation via SSE stream must be < 1000ms', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-livesync-'));
  process.env.DATA_DIR = tempDir;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { registerSSEClient } = await import('../../src/server/sse.js');
    const { eventsRouter } = await import('../../src/server/routes/events.js');
    const { choresRouter } = await import('../../src/server/routes/chores.js');
    const { listsRouter } = await import('../../src/server/routes/lists.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/events', eventsRouter);
    app.route('/api/chores', choresRouter);
    app.route('/api/lists', listsRouter);

    // Set up Client 2 SSE listener queue
    const receivedEvents: Array<{ chunk: string; receivedAt: number }> = [];
    const client2Id = 'client-2-listener';

    const unregister = registerSSEClient(client2Id, (chunk) => {
      receivedEvents.push({
        chunk,
        receivedAt: performance.now(),
      });
    });

    const syncResults: Array<{ mutation: string; latencyMs: number; topic: string }> = [];

    // Helper: wait for a specific topic in Client 2 event stream
    async function waitForTopic(expectedTopic: string, startTime: number, timeoutMs = 1000): Promise<number> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const match = receivedEvents.find((e) => {
          if (e.receivedAt >= startTime && e.chunk.includes(`"${expectedTopic}"`)) {
            return true;
          }
          return false;
        });

        if (match) {
          return match.receivedAt - startTime;
        }

        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`Timeout waiting for live sync topic "${expectedTopic}" within ${timeoutMs}ms`);
    }

    // 1. Mutation: Client 1 adds a grocery item
    const t0_grocery = performance.now();
    const groceryRes = await app.request('/api/lists/list-groceries/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Sync Test Apples' }),
    });
    assert.equal(groceryRes.status, 201);
    const grocerySyncLatency = await waitForTopic('lists', t0_grocery);
    syncResults.push({ mutation: 'Add Grocery Item', latencyMs: Math.round(grocerySyncLatency * 100) / 100, topic: 'lists' });
    assert.ok(
      grocerySyncLatency < 1000,
      `Grocery live sync latency must be < 1000ms (was ${grocerySyncLatency}ms)`
    );

    // 2. Mutation: Client 1 completes a chore
    const t0_chore = performance.now();
    const todayStr = new Date().toISOString().slice(0, 10);
    const choreRes = await app.request('/api/chores/chore-1/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateStr: todayStr }),
    });
    assert.equal(choreRes.status, 200);
    const choreSyncLatency = await waitForTopic('chores', t0_chore);
    syncResults.push({ mutation: 'Toggle Chore', latencyMs: Math.round(choreSyncLatency * 100) / 100, topic: 'chores' });
    assert.ok(
      choreSyncLatency < 1000,
      `Chore live sync latency must be < 1000ms (was ${choreSyncLatency}ms)`
    );

    // 3. Mutation: Client 1 creates a calendar event
    const t0_event = performance.now();
    const nowIso = new Date().toISOString();
    const eventRes = await app.request('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Live Sync Event',
        startIso: nowIso,
        endIso: nowIso,
        allDay: false,
        memberIds: ['mem-dad'],
      }),
    });
    assert.equal(eventRes.status, 201);
    const eventSyncLatency = await waitForTopic('events', t0_event);
    syncResults.push({ mutation: 'Create Calendar Event', latencyMs: Math.round(eventSyncLatency * 100) / 100, topic: 'events' });
    assert.ok(
      eventSyncLatency < 1000,
      `Event live sync latency must be < 1000ms (was ${eventSyncLatency}ms)`
    );

    console.table(syncResults);
    unregister();

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
