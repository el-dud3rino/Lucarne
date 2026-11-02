import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { Hono } from 'hono';
import { MockGoogleServer } from '../mocks/googleMockServer.js';

// --- Binary Image Generation Helpers ---

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

function createTestWebpVP8(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(24, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8 ', 12, 'ascii');
  buf.writeUInt32LE(12, 16);
  buf[20] = 0x00;
  buf[21] = 0x00;
  buf[22] = 0x00;
  buf[23] = 0x9d;
  buf[24] = 0x01;
  buf[25] = 0x2a;
  buf[26] = width & 0xff;
  buf[27] = (width >> 8) & 0x3f;
  buf[28] = height & 0xff;
  buf[29] = (height >> 8) & 0x3f;
  return buf;
}

function createTestWebpVP8L(width: number, height: number): Buffer {
  const buf = Buffer.alloc(36);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(28, 4);
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8L', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf[20] = 0x2f;
  const w = width - 1;
  const h = height - 1;
  buf[21] = w & 0xff;
  buf[22] = ((w >> 8) & 0x3f) | ((h & 0x03) << 6);
  buf[23] = (h >> 2) & 0xff;
  buf[24] = (h >> 10) & 0x0f;
  return buf;
}

function createTestWebpVP8X(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(24, 4);
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

function createPlainJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, 0x00, 0x0b, 0x08, // SOF0, len=11, precision=8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9, // EOI
  ]);
}

function createExifJpeg(width: number, height: number, orientation: number, isLittleEndian = true): Buffer {
  const tiffLen = 8 + 2 + 12 + 4;
  const app1PayloadLen = 6 + tiffLen;
  const app1Len = 2 + app1PayloadLen;

  const app1 = Buffer.alloc(app1Len + 2);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(app1Len, 2);
  app1.write('Exif\0\0', 4, 'ascii');

  const tiffStart = 10;
  if (isLittleEndian) {
    app1.write('II', tiffStart, 'ascii');
    app1.writeUInt16LE(42, tiffStart + 2);
    app1.writeUInt32LE(8, tiffStart + 4);
    const ifdStart = tiffStart + 8;
    app1.writeUInt16LE(1, ifdStart);
    app1.writeUInt16LE(0x0112, ifdStart + 2);
    app1.writeUInt16LE(3, ifdStart + 4);
    app1.writeUInt32LE(1, ifdStart + 6);
    app1.writeUInt16LE(orientation, ifdStart + 10);
    app1.writeUInt16LE(0, ifdStart + 12);
    app1.writeUInt32LE(0, ifdStart + 14);
  } else {
    app1.write('MM', tiffStart, 'ascii');
    app1.writeUInt16BE(42, tiffStart + 2);
    app1.writeUInt32BE(8, tiffStart + 4);
    const ifdStart = tiffStart + 8;
    app1.writeUInt16BE(1, ifdStart);
    app1.writeUInt16BE(0x0112, ifdStart + 2);
    app1.writeUInt16BE(3, ifdStart + 4);
    app1.writeUInt32BE(1, ifdStart + 6);
    app1.writeUInt16BE(orientation, ifdStart + 10);
    app1.writeUInt16BE(0, ifdStart + 12);
    app1.writeUInt32BE(0, ifdStart + 14);
  }

  const sof = Buffer.from([
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
  ]);

  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

test('Milestone 4 Adversarial Challenger Suite (Tasks 1-4)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-adv-m4-challenger-'));
  const mockServer = new MockGoogleServer();
  const mockUrl = await mockServer.start();

  process.env.DATA_DIR = tempDir;
  process.env.GOOGLE_OAUTH_BASE_URL = mockUrl;
  process.env.GOOGLE_API_BASE_URL = mockUrl;
  process.env.GOOGLE_PHOTOS_PICKER_BASE_URL = mockUrl;
  process.env.GOOGLE_AUTH_BASE_URL = `${mockUrl}/auth`;
  process.env.GOOGLE_CLIENT_ID = 'm4_adv_client_id';
  process.env.GOOGLE_CLIENT_SECRET = 'm4_adv_client_secret';

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

    // =========================================================================
    // TASK 1: Adversarial detectOrientationFromBuffer edge cases & Exif tags 1-8
    // =========================================================================
    // 1. Truncated & null buffers
    assert.equal(detectOrientationFromBuffer(null as unknown as Buffer), 'landscape');
    assert.equal(detectOrientationFromBuffer(undefined as unknown as Buffer), 'landscape');
    assert.equal(detectOrientationFromBuffer(Buffer.alloc(0)), 'landscape');
    assert.equal(detectOrientationFromBuffer(Buffer.alloc(1)), 'landscape');
    assert.equal(detectOrientationFromBuffer(Buffer.alloc(15)), 'landscape');
    assert.equal(detectOrientationFromBuffer(Buffer.alloc(16)), 'landscape');

    // 2. Corrupt PNG
    const pngShort = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    assert.equal(detectOrientationFromBuffer(pngShort), 'landscape');

    // 3. Valid PNG: Landscape, Portrait, Square
    assert.equal(detectOrientationFromBuffer(createTestPng(1920, 1080)), 'landscape');
    assert.equal(detectOrientationFromBuffer(createTestPng(1080, 1920)), 'portrait');
    assert.equal(detectOrientationFromBuffer(createTestPng(1000, 1000)), 'landscape');

    // 4. WebP: Truncated, Unknown, VP8, VP8L, VP8X
    const webpTrunc = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ');
    assert.equal(detectOrientationFromBuffer(webpTrunc), 'landscape');

    const webpUnknown = Buffer.alloc(32);
    webpUnknown.write('RIFF', 0, 'ascii');
    webpUnknown.write('WEBP', 8, 'ascii');
    webpUnknown.write('XXXX', 12, 'ascii');
    assert.equal(detectOrientationFromBuffer(webpUnknown), 'landscape');

    assert.equal(detectOrientationFromBuffer(createTestWebpVP8(1920, 1080)), 'landscape');
    assert.equal(detectOrientationFromBuffer(createTestWebpVP8(1080, 1920)), 'portrait');
    assert.equal(detectOrientationFromBuffer(createTestWebpVP8L(1920, 1080)), 'landscape');
    assert.equal(detectOrientationFromBuffer(createTestWebpVP8L(1080, 1920)), 'portrait');
    assert.equal(detectOrientationFromBuffer(createTestWebpVP8X(1920, 1080)), 'landscape');
    assert.equal(detectOrientationFromBuffer(createTestWebpVP8X(1080, 1920)), 'portrait');

    // 5. Corrupt JPEG
    assert.equal(detectOrientationFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xc0])), 'landscape');
    assert.equal(detectOrientationFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), 'landscape');

    // 6. Plain JPEG without Exif
    assert.equal(detectOrientationFromBuffer(createPlainJpeg(1920, 1080)), 'landscape');
    assert.equal(detectOrientationFromBuffer(createPlainJpeg(1080, 1920)), 'portrait');
    assert.equal(detectOrientationFromBuffer(createPlainJpeg(1000, 1000)), 'landscape');

    // 7. Exif Orientations 1-8 for Raw Landscape (1920x1080)
    // Orientations 1-4 maintain landscape; 5-8 transpose width and height into portrait
    for (const isLE of [true, false]) {
      const endian = isLE ? 'II' : 'MM';
      for (let o = 1; o <= 4; o++) {
        assert.equal(
          detectOrientationFromBuffer(createExifJpeg(1920, 1080, o, isLE)),
          'landscape',
          `Raw landscape + orientation ${o} (${endian}) must be landscape`
        );
      }
      for (let o = 5; o <= 8; o++) {
        assert.equal(
          detectOrientationFromBuffer(createExifJpeg(1920, 1080, o, isLE)),
          'portrait',
          `Raw landscape + orientation ${o} (${endian}) must transpose to portrait`
        );
      }
    }

    // 8. Exif Orientations 1-8 for Raw Portrait (1080x1920)
    // Orientations 1-4 maintain portrait; 5-8 transpose width and height into landscape
    for (const isLE of [true, false]) {
      const endian = isLE ? 'II' : 'MM';
      for (let o = 1; o <= 4; o++) {
        assert.equal(
          detectOrientationFromBuffer(createExifJpeg(1080, 1920, o, isLE)),
          'portrait',
          `Raw portrait + orientation ${o} (${endian}) must be portrait`
        );
      }
      for (let o = 5; o <= 8; o++) {
        assert.equal(
          detectOrientationFromBuffer(createExifJpeg(1080, 1920, o, isLE)),
          'landscape',
          `Raw portrait + orientation ${o} (${endian}) must transpose to landscape`
        );
      }
    }

    // =========================================================================
    // TASK 2: Adversarial DELETE /api/photos/:id
    // =========================================================================
    const adversarialMissingIds = [
      'non-existent-uuid-99999999-9999',
      'null',
      'undefined',
      '0',
      '\' OR \'1\'=\'1',
      '../../etc/passwd',
      'photo%20with%20spaces',
      '__proto__',
      'constructor',
    ];

    for (const missingId of adversarialMissingIds) {
      const res = await app.request(`/api/photos/${encodeURIComponent(missingId)}`, {
        method: 'DELETE',
      });
      assert.equal(res.status, 404, `DELETE /api/photos/${missingId} must return 404`);
      const body = await res.json();
      assert.equal(body.error, 'Photo not found');
    }

    // Double deletion test: upload real photo, delete once (200), delete again (404)
    const jpegBuf = createPlainJpeg(1920, 1080);
    const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
    const uploadRes = await app.request('/api/photos/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl, caption: 'Double delete verification' }),
    });
    assert.equal(uploadRes.status, 201);
    const uploaded = (await uploadRes.json()) as { id: string; url: string };

    const diskFile = path.join(MEDIA_PHOTOS_DIR, path.basename(uploaded.url));
    assert.ok(fs.existsSync(diskFile), 'Uploaded photo binary exists on disk');

    const del1 = await app.request(`/api/photos/${uploaded.id}`, { method: 'DELETE' });
    assert.equal(del1.status, 200);
    assert.deepEqual(await del1.json(), { ok: true });
    assert.equal(fs.existsSync(diskFile), false, 'Disk file unlinked after first deletion');

    const del2 = await app.request(`/api/photos/${uploaded.id}`, { method: 'DELETE' });
    assert.equal(del2.status, 404, 'Second deletion of same ID must return 404');
    const del2Body = await del2.json();
    assert.equal(del2Body.error, 'Photo not found');

    // =========================================================================
    // TASK 3: Adversarial Google Disconnect
    // =========================================================================
    const acc1Id = await exchangeCodeAndSaveAccount('code_parent1', 'http://localhost:3001');
    const acc2Id = await exchangeCodeAndSaveAccount('code_user2', 'http://localhost:3001');

    assert.ok(acc1Id, 'Account 1 linked');
    assert.ok(acc2Id, 'Account 2 linked');
    assert.notEqual(acc1Id, acc2Id, 'Account IDs must be distinct');

    const localEvId = `local-manual-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO events (id, title, start_iso, end_iso, all_day, member_ids_json, calendar_source_id, updated_at)
      VALUES (?, 'Family Board Game Night', '2026-11-05T18:00:00Z', '2026-11-05T20:00:00Z', 0, '[]', NULL, datetime('now'))
    `).run(localEvId);

    const countSources = (accId: string) =>
      (db.prepare('SELECT COUNT(*) as c FROM calendar_sources WHERE google_account_id = ?').get(accId) as { c: number }).c;
    assert.ok(countSources(acc1Id) > 0, 'Acc 1 has calendar sources');
    assert.ok(countSources(acc2Id) > 0, 'Acc 2 has calendar sources');

    const countEvents = (accId: string) =>
      (db.prepare(`
        SELECT COUNT(*) as c FROM events
        WHERE calendar_source_id IN (SELECT id FROM calendar_sources WHERE google_account_id = ?)
      `).get(accId) as { c: number }).c;

    const initialRevokes = mockServer.recordedRequests.filter((r) => r.url.includes('/revoke')).length;

    // Disconnect ONLY Account 1 via POST /api/settings/disconnect-google
    const disconnect1Res = await app.request('/api/settings/disconnect-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: acc1Id }),
    });
    assert.equal(disconnect1Res.status, 200);
    assert.deepEqual(await disconnect1Res.json(), { ok: true });

    // Assert /revoke was called on MockGoogleServer
    const revokesAfter1 = mockServer.recordedRequests.filter((r) => r.url.includes('/revoke')).length;
    assert.equal(revokesAfter1, initialRevokes + 1, 'Token revocation called exactly once for Account 1');

    // Assert Account 1 records are removed
    assert.equal(db.prepare('SELECT id FROM google_accounts WHERE id = ?').get(acc1Id), undefined);
    assert.equal(countSources(acc1Id), 0);
    assert.equal(countEvents(acc1Id), 0);

    // Assert Account 2 is completely preserved
    assert.ok(db.prepare('SELECT id FROM google_accounts WHERE id = ?').get(acc2Id), 'Account 2 must remain in google_accounts');
    assert.ok(countSources(acc2Id) > 0, 'Account 2 sources must remain intact');

    // Assert local manual family event is preserved
    const localEv = db.prepare('SELECT * FROM events WHERE id = ?').get(localEvId) as { title: string } | undefined;
    assert.ok(localEv, 'Local manual family event must NOT be deleted');
    assert.equal(localEv.title, 'Family Board Game Night');

    // Disconnect Account 2 via POST /api/settings/google/disconnect (alternate route)
    const disconnect2Res = await app.request('/api/settings/google/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: acc2Id }),
    });
    assert.equal(disconnect2Res.status, 200);

    const revokesAfter2 = mockServer.recordedRequests.filter((r) => r.url.includes('/revoke')).length;
    assert.equal(revokesAfter2, initialRevokes + 2);
    assert.equal(db.prepare('SELECT id FROM google_accounts WHERE id = ?').get(acc2Id), undefined);
    assert.equal(countSources(acc2Id), 0);

    // Disconnecting a non-existent account ID succeeds gracefully without error
    const disconnectMissing = await app.request('/api/settings/disconnect-google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: 'fake-non-existent-account' }),
    });
    assert.equal(disconnectMissing.status, 200);

    // Test resilience: disconnect account when mock revoke fails
    const acc3Id = await exchangeCodeAndSaveAccount('code_parent1', 'http://localhost:3001');
    assert.ok(acc3Id);
    process.env.GOOGLE_OAUTH_BASE_URL = 'http://127.0.0.1:1'; // unreachable port
    const disconnect3Res = await app.request(`/api/settings/google/accounts/${acc3Id}`, {
      method: 'DELETE',
    });
    assert.equal(disconnect3Res.status, 200);
    assert.equal(db.prepare('SELECT id FROM google_accounts WHERE id = ?').get(acc3Id), undefined);
    process.env.GOOGLE_OAUTH_BASE_URL = mockUrl;

    // Local event remains preserved throughout
    assert.ok(db.prepare('SELECT * FROM events WHERE id = ?').get(localEvId));

    // =========================================================================
    // TASK 4: Adversarial Member Reordering
    // =========================================================================
    const initialMembers = (await (await app.request('/api/settings/members')).json()) as Array<{
      id: string;
      sortOrder: number;
    }>;
    assert.ok(initialMembers.length >= 2, 'Initial members exist');

    // 1. Empty array: PUT /api/settings/members/reorder with { order: [] }
    const emptyRes = await app.request('/api/settings/members/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: [] }),
    });
    assert.equal(emptyRes.status, 200);
    assert.deepEqual(await emptyRes.json(), { ok: true });

    // Verify sort orders are unchanged
    const afterEmptyMembers = (await (await app.request('/api/settings/members')).json()) as Array<{
      id: string;
      sortOrder: number;
    }>;
    for (let i = 0; i < initialMembers.length; i++) {
      assert.equal(afterEmptyMembers[i].id, initialMembers[i].id);
      assert.equal(afterEmptyMembers[i].sortOrder, initialMembers[i].sortOrder);
    }

    // 2. Invalid IDs: PUT /api/settings/members/reorder with { order: ['fake-1', 'fake-2'] }
    const invalidIdsRes = await app.request('/api/settings/members/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: ['non-existent-member-1', 'non-existent-member-2'] }),
    });
    assert.equal(invalidIdsRes.status, 200);
    assert.deepEqual(await invalidIdsRes.json(), { ok: true });

    // Verify existing member sort orders remain unharmed
    const afterInvalidMembers = (await (await app.request('/api/settings/members')).json()) as Array<{
      id: string;
      sortOrder: number;
    }>;
    for (let i = 0; i < initialMembers.length; i++) {
      assert.equal(afterInvalidMembers[i].id, initialMembers[i].id);
      assert.equal(afterInvalidMembers[i].sortOrder, initialMembers[i].sortOrder);
    }

    // 3. Reversed Array: completely reverse member ordering
    const reversedIds = initialMembers.map((m) => m.id).reverse();
    const reverseRes = await app.request('/api/settings/members/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: reversedIds }),
    });
    assert.equal(reverseRes.status, 200);
    assert.deepEqual(await reverseRes.json(), { ok: true });

    const afterReverseMembers = (await (await app.request('/api/settings/members')).json()) as Array<{
      id: string;
      sortOrder: number;
    }>;
    assert.equal(afterReverseMembers.length, reversedIds.length);
    for (let i = 0; i < reversedIds.length; i++) {
      assert.equal(afterReverseMembers[i].id, reversedIds[i], `Position ${i} must match reversed ID`);
      assert.equal(afterReverseMembers[i].sortOrder, i, `Member at position ${i} must have sortOrder ${i}`);
    }

    // 4. Malformed payloads
    for (const badPayload of [{}, { order: 'not-array' }, { order: 12345 }]) {
      const malformedRes = await app.request('/api/settings/members/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(badPayload),
      });
      assert.equal(malformedRes.status, 200);
      assert.deepEqual(await malformedRes.json(), { ok: true });
    }
  } finally {
    await mockServer.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
});
