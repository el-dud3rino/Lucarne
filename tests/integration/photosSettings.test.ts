import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { MockGoogleServer } from '../mocks/googleMockServer.js';

function createTestJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x0b, 0x08, // SOF0, len=11, precision=8
    (height >> 8) & 0xff, height & 0xff, // Height
    (width >> 8) & 0xff, width & 0xff,   // Width
    0x01, 0x01, 0x11, 0x00, // 1 component
    0xff, 0xd9, // EOI
  ]);
}

function createTestPng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 2;
  buf[26] = 0;
  buf[27] = 0;
  buf[28] = 0;
  buf.writeUInt32BE(0, 29);
  return buf;
}

function createTestWebp(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(22, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUInt32LE(10, 16);
  buf[20] = 0;
  const w = width - 1;
  buf[24] = w & 0xff;
  buf[25] = (w >> 8) & 0xff;
  buf[26] = (w >> 16) & 0xff;
  const h = height - 1;
  buf[27] = h & 0xff;
  buf[28] = (h >> 8) & 0xff;
  buf[29] = (h >> 16) & 0xff;
  return buf;
}

test('Photos & Settings Integration: orientation sniffing, static media serving, 404 deletion, settings persistence, Google disconnect & member profile updates', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-photos-settings-'));
  const mockServer = new MockGoogleServer();
  const mockUrl = await mockServer.start();

  process.env.DATA_DIR = tempDir;
  process.env.GOOGLE_OAUTH_BASE_URL = mockUrl;
  process.env.GOOGLE_API_BASE_URL = mockUrl;
  process.env.GOOGLE_PHOTOS_PICKER_BASE_URL = mockUrl;
  process.env.GOOGLE_AUTH_BASE_URL = `${mockUrl}/auth`;
  process.env.GOOGLE_CLIENT_ID = 'test_photos_client_id';
  process.env.GOOGLE_CLIENT_SECRET = 'test_photos_client_secret';

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { db, MEDIA_PHOTOS_DIR } = await import('../../src/server/db/connection.js');
    const { photosRouter, detectOrientationFromBuffer } = await import('../../src/server/routes/photos.js');
    const { settingsRouter } = await import('../../src/server/routes/settings.js');
    const { exchangeCodeAndSaveAccount } = await import('../../src/server/services/google.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/photos', photosRouter);
    app.route('/api/settings', settingsRouter);

    // 1. Direct Buffer Sniffing Unit Assertions (JPEG, PNG, WebP)
    const portraitJpegBuf = createTestJpeg(1080, 1920);
    const landscapeJpegBuf = createTestJpeg(1920, 1080);
    assert.equal(detectOrientationFromBuffer(portraitJpegBuf), 'portrait', 'JPEG 1080x1920 is portrait');
    assert.equal(detectOrientationFromBuffer(landscapeJpegBuf), 'landscape', 'JPEG 1920x1080 is landscape');

    const portraitPngBuf = createTestPng(600, 1200);
    const landscapePngBuf = createTestPng(1200, 600);
    assert.equal(detectOrientationFromBuffer(portraitPngBuf), 'portrait', 'PNG 600x1200 is portrait');
    assert.equal(detectOrientationFromBuffer(landscapePngBuf), 'landscape', 'PNG 1200x600 is landscape');

    const portraitWebpBuf = createTestWebp(720, 1280);
    const landscapeWebpBuf = createTestWebp(1280, 720);
    assert.equal(detectOrientationFromBuffer(portraitWebpBuf), 'portrait', 'WebP 720x1280 is portrait');
    assert.equal(detectOrientationFromBuffer(landscapeWebpBuf), 'landscape', 'WebP 1280x720 is landscape');

    // 2. Photo Upload with Automatic Buffer Orientation Sniffing
    // Upload Portrait without providing orientation in JSON payload
    const portraitDataUrl = `data:image/jpeg;base64,${portraitJpegBuf.toString('base64')}`;
    const uploadRes1 = await app.request('/api/photos/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: portraitDataUrl, caption: 'Vertical Family Portrait' }),
    });
    assert.equal(uploadRes1.status, 201, 'Upload succeeds with 201');
    const photo1 = (await uploadRes1.json()) as { id: string; url: string; orientation: string };
    assert.ok(photo1.id, 'Photo ID generated');
    assert.equal(photo1.orientation, 'portrait', 'Sniffer auto-detects portrait orientation from JPEG SOF header');

    // Verify persisted orientation in SQLite
    const row1 = db.prepare('SELECT * FROM photos WHERE id = ?').get(photo1.id) as any;
    assert.equal(row1.orientation, 'portrait');
    assert.equal(row1.caption, 'Vertical Family Portrait');

    // Upload Landscape PNG without providing orientation
    const landscapeDataUrl = `data:image/png;base64,${landscapePngBuf.toString('base64')}`;
    const uploadRes2 = await app.request('/api/photos/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: landscapeDataUrl, caption: 'Mountain Lake Horizon' }),
    });
    assert.equal(uploadRes2.status, 201);
    const photo2 = (await uploadRes2.json()) as { id: string; url: string; orientation: string };
    assert.equal(photo2.orientation, 'landscape', 'Sniffer auto-detects landscape orientation from PNG IHDR header');

    // 3. Media Static Serving with Immutable Cache Headers: GET /api/photos/media/:id
    const mediaRes = await app.request(`/api/photos/media/${photo1.id}`);
    assert.equal(mediaRes.status, 200, 'Media serving returns 200');
    assert.equal(mediaRes.headers.get('Content-Type'), 'image/jpeg');
    assert.equal(
      mediaRes.headers.get('Cache-Control'),
      'public, max-age=31536000, immutable',
      'Immutable cache headers must be present for 0ms repeat loads'
    );
    const mediaBuffer = Buffer.from(await mediaRes.arrayBuffer());
    assert.equal(mediaBuffer.length, portraitJpegBuf.length);

    // Media serving 404 for non-existent photo
    const missingMediaRes = await app.request('/api/photos/media/non-existent-photo-uuid-12345');
    assert.equal(missingMediaRes.status, 404, 'Non-existent media ID returns 404');

    // 4. Photo Deletion & 404 on Missing Photo
    // First, verify file exists on disk
    const filename1 = path.basename(photo1.url);
    const diskPath1 = path.join(MEDIA_PHOTOS_DIR, filename1);
    assert.ok(fs.existsSync(diskPath1), 'Uploaded photo must exist on disk');

    // Delete photo
    const deleteRes1 = await app.request(`/api/photos/${photo1.id}`, { method: 'DELETE' });
    assert.equal(deleteRes1.status, 200, 'Photo delete returns 200');
    const deleteJson = await deleteRes1.json();
    assert.deepEqual(deleteJson, { ok: true });

    // Assert row removed from SQLite and file unlinked from disk
    const checkRow = db.prepare('SELECT id FROM photos WHERE id = ?').get(photo1.id);
    assert.equal(checkRow, undefined, 'Photo row must be removed from SQLite');
    assert.equal(fs.existsSync(diskPath1), false, 'Photo file must be unlinked from disk');

    // Assert deleting non-existent photo returns 404
    const deleteMissingRes = await app.request('/api/photos/non-existent-id-99999', { method: 'DELETE' });
    assert.equal(deleteMissingRes.status, 404, 'DELETE on non-existent photo ID must return 404');

    // 5. Settings Persistence via PUT /api/settings (Night Mode & Weather)
    const updateSettingsRes = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        familyName: 'The Millers Appliance',
        nightModeEnabled: true,
        nightModeStart: '21:45',
        nightModeEnd: '06:15',
        nightModeBehavior: 'clock',
        nightModeBrightness: 10,
        weatherLocationName: 'Austin, TX',
        weatherUnit: 'C',
        weatherRefreshMinutes: 15,
      }),
    });
    assert.equal(updateSettingsRes.status, 200, 'PUT /api/settings returns 200');
    const updatedSettings = (await updateSettingsRes.json()) as any;
    assert.equal(updatedSettings.familyName, 'The Millers Appliance');
    assert.equal(updatedSettings.nightModeEnabled, true);
    assert.equal(updatedSettings.nightModeStart, '21:45');
    assert.equal(updatedSettings.nightModeEnd, '06:15');
    assert.equal(updatedSettings.nightModeBehavior, 'clock');
    assert.equal(updatedSettings.nightModeBrightness, 10);
    assert.equal(updatedSettings.weatherLocationName, 'Austin, TX');
    assert.equal(updatedSettings.weatherUnit, 'C');
    assert.equal(updatedSettings.weatherRefreshMinutes, 15);

    // Verify GET /api/settings returns persisted values
    const getSettingsRes = await app.request('/api/settings');
    assert.equal(getSettingsRes.status, 200);
    const loadedSettings = (await getSettingsRes.json()) as any;
    assert.equal(loadedSettings.familyName, 'The Millers Appliance');
    assert.equal(loadedSettings.nightModeBehavior, 'clock');
    assert.equal(loadedSettings.nightModeBrightness, 10);
    assert.equal(loadedSettings.weatherUnit, 'C');

    // 6. Family Member Updates & Reordering
    const membersRes = await app.request('/api/settings/members');
    assert.equal(membersRes.status, 200);
    const members = (await membersRes.json()) as any[];
    assert.ok(members.length >= 2, 'Seeded family members exist');

    const firstMember = members[0];
    const updateMemberRes = await app.request(`/api/settings/members/${firstMember.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Super Dad',
        emoji: '🦸',
        role: 'parent',
        colorBg: '#DCFCE7',
        colorText: '#14532D',
        colorAccent: '#16A34A',
      }),
    });
    assert.equal(updateMemberRes.status, 200);
    const updatedMember = (await updateMemberRes.json()) as any;
    assert.equal(updatedMember.name, 'Super Dad');
    assert.equal(updatedMember.emoji, '🦸');
    assert.equal(updatedMember.role, 'parent');
    assert.equal(updatedMember.colorAccent, '#16A34A');

    // Test member update 404
    const missingMemberRes = await app.request('/api/settings/members/missing-uuid-999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Phantom' }),
    });
    assert.equal(missingMemberRes.status, 404, 'Non-existent member update returns 404');

    // Test member reordering
    const reversedIds = members.map((m) => m.id).reverse();
    const reorderRes = await app.request('/api/settings/members/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: reversedIds }),
    });
    assert.equal(reorderRes.status, 200);
    const reorderJson = await reorderRes.json();
    assert.deepEqual(reorderJson, { ok: true });

    // Verify sort_order in SQLite matches new order
    for (let i = 0; i < reversedIds.length; i++) {
      const dbRow = db.prepare('SELECT sort_order FROM family_members WHERE id = ?').get(reversedIds[i]) as any;
      assert.equal(dbRow.sort_order, i, `Member ${reversedIds[i]} must have sort_order ${i}`);
    }

    // 7. Google OAuth Disconnect & Token Revocation
    // First link an account to generate google_accounts, calendar_sources, and events
    const linkedAccId = await exchangeCodeAndSaveAccount('code_parent1', 'http://localhost:3001');
    assert.ok(linkedAccId, 'Account linked');

    const accRowBefore = db.prepare('SELECT * FROM google_accounts WHERE id = ?').get(linkedAccId);
    assert.ok(accRowBefore, 'Account exists before disconnect');

    const sourcesBefore = db.prepare('SELECT COUNT(*) as c FROM calendar_sources WHERE google_account_id = ?').get(linkedAccId) as any;
    assert.ok(sourcesBefore.c >= 1, 'Sources exist before disconnect');

    const recordedBefore = mockServer.recordedRequests.length;

    // Call POST /api/settings/disconnect-google with accountId
    const disconnectRes = await app.request('/api/settings/disconnect-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: linkedAccId }),
    });
    assert.equal(disconnectRes.status, 200, 'POST /api/settings/disconnect-google returns 200');
    const disconnectJson = await disconnectRes.json();
    assert.deepEqual(disconnectJson, { ok: true });

    // Assert token revocation endpoint was called on mock server
    const revokeRequests = mockServer.recordedRequests
      .slice(recordedBefore)
      .filter((r) => r.url.includes('/revoke'));
    assert.ok(revokeRequests.length >= 1, 'Google OAuth token revocation must be called upon disconnect');

    // Assert Google account, sources, and cached events were cleaned from SQLite
    const accRowAfter = db.prepare('SELECT * FROM google_accounts WHERE id = ?').get(linkedAccId);
    assert.equal(accRowAfter, undefined, 'Google account row must be deleted');

    const sourcesAfter = db.prepare('SELECT COUNT(*) as c FROM calendar_sources WHERE google_account_id = ?').get(linkedAccId) as any;
    assert.equal(sourcesAfter.c, 0, 'Calendar sources must be deleted for disconnected account');

    // Also test disconnect-google with no body (disconnects all accounts)
    const disconnectAllRes = await app.request('/api/settings/disconnect-google', {
      method: 'POST',
    });
    assert.equal(disconnectAllRes.status, 200);

  } finally {
    await mockServer.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore temp dir cleanup errors on Windows
    }
  }
});
