import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { MockGoogleServer } from '../mocks/googleMockServer.js';

test('Google Integration: multi-account, calendar mapping, syncToken, 410 recovery, outbox queue & Photos Picker', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-googlesync-'));
  const mockServer = new MockGoogleServer();
  const mockUrl = await mockServer.start();

  // Redirect all Google endpoints to our local deterministic mock server
  process.env.DATA_DIR = tempDir;
  process.env.GOOGLE_OAUTH_BASE_URL = mockUrl;
  process.env.GOOGLE_API_BASE_URL = mockUrl;
  process.env.GOOGLE_PHOTOS_PICKER_BASE_URL = mockUrl;
  process.env.GOOGLE_AUTH_BASE_URL = `${mockUrl}/auth`;
  process.env.GOOGLE_CLIENT_ID = 'test_client_id';
  process.env.GOOGLE_CLIENT_SECRET = 'test_client_secret';

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { db } = await import('../../src/server/db/connection.js');
    const {
      exchangeCodeAndSaveAccount,
      syncAllEnabledCalendars,
      flushOutboxMutations,
      createPhotosPickerSession,
      pollAndImportPhotosPickerSession,
    } = await import('../../src/server/services/google.js');

    initSchema();
    seedIfNeeded();

    // 1. Link First Google Account (Dad)
    const accId1 = await exchangeCodeAndSaveAccount('code_parent1', 'http://localhost:3001');
    assert.ok(accId1, 'First account ID must be returned');

    const acc1Row = db.prepare('SELECT * FROM google_accounts WHERE id = ?').get(accId1) as any;
    assert.equal(acc1Row.email, 'parent1@example.com');
    assert.equal(acc1Row.sync_status, 'ok');

    // Verify sub-calendars discovered for Account 1
    const calSources1 = db
      .prepare('SELECT * FROM calendar_sources WHERE google_account_id = ?')
      .all(accId1) as any[];
    assert.ok(calSources1.length >= 2, 'Must discover sub-calendars for account 1');

    // 2. Link Second Distinct Google Account (Mom)
    const accId2 = await exchangeCodeAndSaveAccount('code_parent2_user2', 'http://localhost:3001');
    assert.ok(accId2, 'Second account ID must be returned');
    assert.notEqual(accId1, accId2, 'Accounts must have distinct IDs');

    const acc2Row = db.prepare('SELECT * FROM google_accounts WHERE id = ?').get(accId2) as any;
    assert.equal(acc2Row.email, 'parent2@example.com');

    const totalAccounts = db.prepare('SELECT COUNT(*) as c FROM google_accounts').get() as { c: number };
    assert.equal(totalAccounts.c, 2, 'Must link two distinct Google accounts');

    // 3. Map Sub-Calendars to Family Members
    const primaryCal1 = calSources1.find((c) => c.external_calendar_id === 'primary') || calSources1[0];
    db.prepare('UPDATE calendar_sources SET member_id = ?, enabled = 1 WHERE id = ?').run(
      'mem-dad',
      primaryCal1.id
    );

    const calSources2 = db
      .prepare('SELECT * FROM calendar_sources WHERE google_account_id = ?')
      .all(accId2) as any[];
    const primaryCal2 = calSources2.find((c) => c.external_calendar_id === 'primary') || calSources2[0];
    db.prepare('UPDATE calendar_sources SET member_id = ?, enabled = 1 WHERE id = ?').run(
      'mem-mom',
      primaryCal2.id
    );

    const mappedDad = db.prepare('SELECT member_id FROM calendar_sources WHERE id = ?').get(primaryCal1.id) as any;
    assert.equal(mappedDad.member_id, 'mem-dad', 'Primary cal 1 mapped to Dad');

    const mappedMom = db.prepare('SELECT member_id FROM calendar_sources WHERE id = ?').get(primaryCal2.id) as any;
    assert.equal(mappedMom.member_id, 'mem-mom', 'Primary cal 2 mapped to Mom');

    // 4. Incremental syncToken Synchronization
    await syncAllEnabledCalendars();
    const updatedSource = db.prepare('SELECT sync_token FROM calendar_sources WHERE id = ?').get(primaryCal1.id) as any;
    assert.ok(updatedSource.sync_token, 'Sync token must be stored after sync');
    assert.equal(updatedSource.sync_token, mockServer.nextSyncToken);

    // 5. Automatic Recovery from HTTP 410 Gone (Expired syncToken)
    mockServer.syncTokenExpired = true;
    mockServer.nextSyncToken = 'token_recovered_after_410';

    // Must not throw; must catch 410, clear token, and do full sync
    await syncAllEnabledCalendars();

    const recoveredSource = db.prepare('SELECT sync_token FROM calendar_sources WHERE id = ?').get(primaryCal1.id) as any;
    assert.equal(recoveredSource.sync_token, 'token_recovered_after_410', 'Recovers and stores new token after 410');
    mockServer.syncTokenExpired = false;

    // 6. Outbox Queue Resilience: Offline Retention and Online Flush
    const testEventId = crypto.randomUUID();
    const testNow = new Date().toISOString();
    db.prepare(`
      INSERT INTO events (id, title, description, location, start_iso, end_iso, all_day, member_ids_json, calendar_source_id, updated_at)
      VALUES (?, 'Soccer Tournament Final', 'Field 1', 'City Sports Center', ?, ?, 0, '["mem-dad"]', ?, ?)
    `).run(testEventId, testNow, testNow, primaryCal1.id, testNow);

    const outboxPayload = {
      calendarSourceId: primaryCal1.id,
      externalEventId: null,
      title: 'Soccer Tournament Final',
      description: 'Field 1',
      location: 'City Sports Center',
      startIso: testNow,
      endIso: testNow,
      allDay: false,
    };

    const outboxId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO outbox_mutations (id, entity_type, entity_id, action, payload_json, attempts, created_at)
      VALUES (?, 'event', ?, 'upsert', ?, 0, ?)
    `).run(outboxId, testEventId, JSON.stringify(outboxPayload), testNow);

    // Simulate mock server offline (503 Service Unavailable)
    mockServer.isOffline = true;
    await flushOutboxMutations(true);

    // Mutation MUST NOT be deleted; attempts incremented, error recorded
    const pendingOffline = db.prepare('SELECT * FROM outbox_mutations WHERE id = ?').get(outboxId) as any;
    assert.ok(pendingOffline, 'Mutation must be retained in outbox while offline');
    assert.ok(pendingOffline.attempts >= 1, 'Attempts counter must be incremented');
    assert.ok(pendingOffline.last_error, 'Last error must be captured');

    // Simulate connection restored
    mockServer.isOffline = false;
    await flushOutboxMutations(true);

    const pendingOnline = db.prepare('SELECT * FROM outbox_mutations WHERE id = ?').get(outboxId) as any;
    assert.equal(pendingOnline, undefined, 'Mutation must be flushed and deleted from outbox once online');

    const syncedEvent = db.prepare('SELECT external_event_id FROM events WHERE id = ?').get(testEventId) as any;
    assert.ok(syncedEvent.external_event_id, 'Event must receive external_event_id from Google');

    // 7. Google Photos Picker 2025+ API Integration
    const pickerSession = await createPhotosPickerSession(accId1);
    assert.ok(pickerSession.sessionId, 'Session ID returned');
    assert.ok(pickerSession.pickerUri.includes('/picker-ui'), 'Picker URI returned');

    // Initially media not yet selected
    const initialPoll = await pollAndImportPhotosPickerSession(accId1, pickerSession.sessionId);
    assert.equal(initialPoll.ready, false);
    assert.equal(initialPoll.importedCount, 0);

    // User selects photos in picker
    mockServer.photosSessions.set(pickerSession.sessionId, { mediaItemsSet: true });
    const completedPoll = await pollAndImportPhotosPickerSession(accId1, pickerSession.sessionId);
    assert.equal(completedPoll.ready, true);
    assert.ok(completedPoll.importedCount >= 2, 'Imports picked photos locally');

    const importedPhotos = db.prepare("SELECT * FROM photos WHERE source = 'google_photos'").all() as any[];
    assert.ok(importedPhotos.length >= 2, 'Photos stored in database');
    assert.ok(importedPhotos.some((p) => p.orientation === 'landscape'), 'Must identify landscape photo');
    assert.ok(importedPhotos.some((p) => p.orientation === 'portrait'), 'Must identify portrait photo');

    // Verify downloaded photo bytes exist on local disk
    for (const photo of importedPhotos) {
      const localFile = path.join(tempDir, photo.url.replace(/^\//, ''));
      assert.ok(fs.existsSync(localFile), `Local photo file must exist: ${localFile}`);
      const stats = fs.statSync(localFile);
      assert.ok(stats.size > 0, 'Photo file must have valid bytes');
    }

  } finally {
    await mockServer.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
