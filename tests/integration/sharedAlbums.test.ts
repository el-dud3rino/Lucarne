import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { batchResponse, rawItem, shareHtml } from '../mocks/sharedAlbumFixtures.js';

// 1x1 JPEG
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

test('Shared Google Photos album: full import past 2,000-style paging, mirroring, safety', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-albums-'));
  process.env.DATA_DIR = tempDir;
  process.env.SHARED_ALBUM_ALLOW_LOCAL = '1';

  // ---- Fake Google Photos (share page + batchexecute paging + images) ----
  let albumIds = Array.from({ length: 250 }, (_, i) => `photo_${i}`);
  let failPage2 = false;
  let publicPage = true;
  let base = '';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, base);
    if (url.pathname === '/short') {
      res.writeHead(302, { Location: `${base}/share/AF1QalbumKEY?key=AuthKEY1` });
      return res.end();
    }
    if (url.pathname.startsWith('/share/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(publicPage ? shareHtml('AF1QalbumKEY', 'AuthKEY1', 'Kids 2026') : '<html>Sign in</html>');
    }
    if (url.pathname === '/u/0/_/PhotosUi/data/batchexecute' && req.method === 'POST') {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        const envelope = JSON.parse(decodeURIComponent(body.replace(/^f\.req=/, '')));
        const [albumKey, token, , authKey] = JSON.parse(envelope[0][0][1]);
        assert.equal(albumKey, 'AF1QalbumKEY');
        assert.equal(authKey, 'AuthKEY1');
        const offset = token ? Number(token) : 0;
        if (failPage2 && offset > 0) {
          res.writeHead(500);
          return res.end('boom');
        }
        const all = [...albumIds.map((id) => rawItem(id, `${base}/img/${id}`, 4000, id.endsWith('7') ? 6000 : 3000)), rawItem('video_1', `${base}/img/video_1`, 1920, 1080, true)];
        const page = all.slice(offset, offset + 100);
        const next = offset + 100 < all.length ? String(offset + 100) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(batchResponse(page, next));
      });
      return;
    }
    if (url.pathname.startsWith('/img/')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      return res.end(JPEG);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { db } = await import('../../src/server/db/connection.js');
    const { photosRouter } = await import('../../src/server/routes/photos.js');
    const { waitForAlbumSyncs } = await import('../../src/server/services/sharedAlbums.js');
    initSchema();
    const app = new Hono();
    app.route('/api/photos', photosRouter);
    const post = (p: string, body?: unknown) =>
      app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const albumPhotos = () => db.prepare("SELECT * FROM photos WHERE source = 'shared_album'").all() as any[];

    // 1. Non-Google link is rejected; non-public album gives a clear message
    const bad = await post('/api/photos/albums', { url: 'https://example.com/album' });
    assert.equal(bad.status, 400);
    assert.match(((await bad.json()) as any).error, /Google Photos shared-album link/);
    publicPage = false;
    const priv = await post('/api/photos/albums', { url: `${base}/short` });
    assert.equal(priv.status, 400);
    assert.match(((await priv.json()) as any).error, /link sharing is turned on/);
    publicPage = true;

    // 2. Add via short link -> follows redirect, imports all 250 photos (3 pages), skips the video
    const added = await post('/api/photos/albums', { url: `${base}/short` });
    assert.equal(added.status, 201);
    await waitForAlbumSyncs();
    let albums = (await (await app.request('/api/photos/albums')).json()) as any[];
    assert.equal(albums.length, 1);
    assert.equal(albums[0].title, 'Kids 2026');
    assert.equal(albums[0].photoCount, 250);
    assert.equal(albums[0].syncError, null);
    assert.equal(albumPhotos().length, 250);
    assert.ok(albumPhotos().every((p) => fs.existsSync(path.join(tempDir, p.url.replace(/^\//, '')))), 'files on disk');
    assert.ok(albumPhotos().some((p) => p.orientation === 'portrait'));

    // 3. Re-adding the same album doesn't duplicate
    await post('/api/photos/albums', { url: `${base}/short` });
    await waitForAlbumSyncs();
    assert.equal(albumPhotos().length, 250);

    // 4. Photos removed from the album are removed locally; new ones are added
    albumIds = [...albumIds.slice(10), 'photo_new_1'];
    const albumId = albums[0].id;
    await post(`/api/photos/albums/${albumId}/sync`);
    await waitForAlbumSyncs();
    assert.equal(albumPhotos().length, 241);
    assert.ok(albumPhotos().some((p) => p.external_id === 'photo_new_1'));
    assert.ok(!albumPhotos().some((p) => p.external_id === 'photo_0'));

    // 5. Partial listing (page 2 fails) must NOT delete anything
    failPage2 = true; // only page 1 (100 of 241) can be read; the other 141 must not be treated as deleted
    await post(`/api/photos/albums/${albumId}/sync`);
    await waitForAlbumSyncs();
    assert.equal(albumPhotos().length, 241, 'no deletions on incomplete listing');
    albums = (await (await app.request('/api/photos/albums')).json()) as any[];
    assert.match(albums[0].syncError, /partway/);
    failPage2 = false;

    // 6. Removing the album deletes its photos and files
    const files = albumPhotos().map((p) => path.join(tempDir, p.url.replace(/^\//, '')));
    await app.request(`/api/photos/albums/${albumId}`, { method: 'DELETE' });
    assert.equal(albumPhotos().length, 0);
    assert.ok(files.every((f) => !fs.existsSync(f)), 'files removed');
  } finally {
    server.close();
  }
});
