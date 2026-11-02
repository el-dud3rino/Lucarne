import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Calendar mapped to several people + sync reports errors per calendar', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-calmembers-'));
  process.env.DATA_DIR = tempDir;
  // Point Google at a closed local port so every sync fails fast and deterministically.
  process.env.GOOGLE_API_BASE_URL = 'http://127.0.0.1:9';
  process.env.GOOGLE_OAUTH_BASE_URL = 'http://127.0.0.1:9';

  const { initSchema } = await import('../../src/server/db/schema.js');
  const { seedIfNeeded } = await import('../../src/server/db/seed.js');
  const { db } = await import('../../src/server/db/connection.js');
  const { settingsRouter } = await import('../../src/server/routes/settings.js');
  const { sourceMemberIds } = await import('../../src/server/services/google.js');
  initSchema();
  seedIfNeeded();

  const app = new Hono();
  app.route('/api/settings', settingsRouter);
  const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const kids = db.prepare("SELECT id FROM family_members WHERE role = 'child' ORDER BY sort_order LIMIT 2").all() as Array<{ id: string }>;
  assert.equal(kids.length, 2);
  const [twinA, twinB] = kids.map((k) => k.id);

  db.prepare(
    `INSERT INTO google_accounts (id, email, display_name, access_token, refresh_token, expiry_date)
     VALUES ('acc1', 'parent@example.com', 'Parent', 'fake-access', 'fake-refresh', ?)`
  ).run(Date.now() + 3_600_000);
  db.prepare(
    `INSERT INTO calendar_sources (id, google_account_id, external_calendar_id, name, enabled, is_writable)
     VALUES ('cs-twins', 'acc1', 'twins@group.calendar.google.com', 'Twins', 1, 1)`
  ).run();
  for (const [id, title] of [['ev1', 'Swim'], ['ev2', 'Dentist']]) {
    db.prepare(
      `INSERT INTO events (id, title, start_iso, end_iso, all_day, member_ids_json, calendar_source_id, external_event_id, updated_at)
       VALUES (?, ?, '2026-11-10T15:00:00.000Z', '2026-11-10T16:00:00.000Z', 0, '[]', 'cs-twins', ?, ?)`
    ).run(id, title, `g-${id}`, new Date().toISOString());
  }

  // 1. Legacy single member_id still honored until multi-select is saved
  assert.deepEqual(sourceMemberIds({ member_ids_json: '[]', member_id: twinA }), [twinA]);

  // 2. Assign both twins (unknown ids are ignored) -> existing events get both
  const put = await app.request('/api/settings/google/sources/cs-twins', json('PUT', { memberIds: [twinA, twinB, 'bogus'] }));
  assert.equal(put.status, 200);
  const evMembers = (db.prepare("SELECT member_ids_json FROM events WHERE calendar_source_id = 'cs-twins'").all() as any[]).map(
    (r) => JSON.parse(r.member_ids_json)
  );
  assert.deepEqual(evMembers, [[twinA, twinB], [twinA, twinB]]);

  const listing = (await (await app.request('/api/settings/google/accounts')).json()) as any;
  assert.deepEqual(listing.sources[0].memberIds, [twinA, twinB]);

  // 3. Removing one twin updates events again
  await app.request('/api/settings/google/sources/cs-twins', json('PUT', { memberIds: [twinB] }));
  const after = JSON.parse((db.prepare("SELECT member_ids_json FROM events WHERE id = 'ev1'").get() as any).member_ids_json);
  assert.deepEqual(after, [twinB]);

  // 4. Sync Now must report failure clearly (not a silent "ok")
  const sync = (await (await app.request('/api/settings/google/sync-now', json('POST'))).json()) as any;
  assert.equal(sync.ok, false);
  assert.ok(sync.failed.some((f: any) => f.calendar === 'Twins' && f.account === 'parent@example.com' && f.message));

  const status = (await (await app.request('/api/settings/google/accounts')).json()) as any;
  assert.equal(status.accounts[0].syncStatus, 'error');
  assert.match(status.accounts[0].syncError, /Twins/);
  assert.ok(status.sources[0].syncError, 'per-calendar error recorded');
});
