import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Calendar Integration: range queries, multi-member associations, recurring events expansion, and lifecycle', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-calendar-'));
  process.env.DATA_DIR = tempDir;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { eventsRouter } = await import('../../src/server/routes/events.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/events', eventsRouter);

    // 1. Query Range around Today
    const now = new Date();
    const startRange = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2).toISOString();
    const endRange = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5).toISOString();

    const res1 = await app.request(`/api/events?start=${encodeURIComponent(startRange)}&end=${encodeURIComponent(endRange)}`);
    assert.equal(res1.status, 200);
    const initialEvents = (await res1.json()) as any[];
    assert.ok(initialEvents.length >= 4, 'Must return seeded calendar events within range');

    // 2. Create New Event with Multi-Member Associations
    const eventStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 15, 0, 0).toISOString();
    const eventEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 16, 30, 0).toISOString();

    const createRes = await app.request('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Piano Recital & Rehearsal',
        description: 'Auditorium stage left',
        location: 'Community Center',
        startIso: eventStart,
        endIso: eventEnd,
        allDay: false,
        memberIds: ['mem-mom', 'mem-kid2'],
      }),
    });
    assert.equal(createRes.status, 201);
    const createdEvent = (await createRes.json()) as any;
    assert.ok(createdEvent.id);
    assert.equal(createdEvent.title, 'Piano Recital & Rehearsal');
    assert.deepEqual(createdEvent.memberIds, ['mem-mom', 'mem-kid2']);

    // 3. Update Event
    const updateRes = await app.request(`/api/events/${createdEvent.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Grand Piano Recital',
        location: 'Main Concert Hall',
      }),
    });
    assert.equal(updateRes.status, 200);
    const updatedEvent = (await updateRes.json()) as any;
    assert.equal(updatedEvent.title, 'Grand Piano Recital');
    assert.equal(updatedEvent.location, 'Main Concert Hall');
    assert.deepEqual(updatedEvent.memberIds, ['mem-mom', 'mem-kid2'], 'Member associations preserved');

    // 4. Recurring Event Engine: Daily recurring event
    const recurStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0).toISOString();
    const recurEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 30, 0).toISOString();

    const recurRes = await app.request('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Morning Household Huddle',
        description: 'Review day schedule',
        location: 'Kitchen Counter',
        startIso: recurStart,
        endIso: recurEnd,
        allDay: false,
        memberIds: ['mem-family'],
        recurrenceRule: 'daily',
      }),
    });
    assert.equal(recurRes.status, 201);
    const recurMaster = (await recurRes.json()) as any;
    assert.equal(recurMaster.recurrenceRule, 'daily');

    // Query 4-day rolling window to verify projected recurrence instances
    const queryStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).toISOString();
    const queryEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3, 23, 59, 59).toISOString();

    const recurQueryRes = await app.request(`/api/events?start=${encodeURIComponent(queryStart)}&end=${encodeURIComponent(queryEnd)}`);
    assert.equal(recurQueryRes.status, 200);
    const eventsWithRecur = (await recurQueryRes.json()) as any[];

    const huddleInstances = eventsWithRecur.filter((e) => e.title === 'Morning Household Huddle');
    assert.ok(
      huddleInstances.length >= 3,
      `Must project multiple recurring instances for daily rule (got ${huddleInstances.length})`
    );

    // Verify virtual synthetic IDs or recurrence instance markers
    const hasInstanceFlag = huddleInstances.some((e) => e.isRecurringInstance || e.id.includes('_'));
    assert.ok(hasInstanceFlag, 'Recurring projection must tag instance or use composite ID');

    // 5. Delete Event
    const delRes = await app.request(`/api/events/${createdEvent.id}`, { method: 'DELETE' });
    assert.equal(delRes.status, 200);

    const postDelRes = await app.request(`/api/events?start=${encodeURIComponent(startRange)}&end=${encodeURIComponent(endRange)}`);
    const afterDelEvents = (await postDelRes.json()) as any[];
    assert.ok(
      !afterDelEvents.some((e) => e.id === createdEvent.id),
      'Deleted event must not appear in active event queries'
    );

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
