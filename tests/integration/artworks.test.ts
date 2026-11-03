import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-art-'));
process.env.DATA_DIR = tempDir;

const { initSchema } = await import('../../src/server/db/schema.js');
const { seedIfNeeded } = await import('../../src/server/db/seed.js');
const { db, MEDIA_ART_DIR } = await import('../../src/server/db/connection.js');
const { artRouter } = await import('../../src/server/routes/art.js');

initSchema();
seedIfNeeded();

const app = new Hono();
app.route('/api/art', artRouter);

const kid = (db.prepare("SELECT id FROM family_members WHERE role = 'child' ORDER BY sort_order LIMIT 1").get() as { id: string }).id;
const png = (fill: number) =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, fill)]);
const send = (method: string, url: string, body: Buffer) =>
  app.request(url, { method, headers: { 'Content-Type': 'image/png' }, body });
const filesOnDisk = () => fs.readdirSync(MEDIA_ART_DIR);

test('art: save a drawing, resume it (replacing the file), list it, delete it', async () => {
  const created = await send('POST', `/api/art?memberId=${kid}`, png(1));
  assert.equal(created.status, 201);
  const art = (await created.json()) as { id: string; memberId: string; url: string };
  assert.equal(art.memberId, kid);
  assert.match(art.url, /^\/media\/art\/[0-9a-f-]+\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(MEDIA_ART_DIR, path.basename(art.url))), png(1));

  const updated = await send('PUT', `/api/art/${art.id}`, png(2));
  assert.equal(updated.status, 200);
  const after = (await updated.json()) as { url: string };
  assert.notEqual(after.url, art.url, 'each save gets a new file name so cached copies never go stale');
  assert.deepEqual(filesOnDisk(), [path.basename(after.url)], 'the old version is removed');

  const list = (await (await app.request('/api/art')).json()) as Array<{ id: string }>;
  assert.deepEqual(list.map((a) => a.id), [art.id]);

  assert.equal((await app.request(`/api/art/${art.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(filesOnDisk(), []);
  assert.equal(((await (await app.request('/api/art')).json()) as unknown[]).length, 0);
});

test('art: rejects unknown artists, non-PNG bodies and saves to deleted drawings', async () => {
  assert.equal((await send('POST', '/api/art?memberId=nobody', png(1))).status, 400);
  assert.equal((await send('POST', `/api/art?memberId=${kid}`, Buffer.from('<svg/>'))).status, 400);
  assert.equal((await send('POST', `/api/art?memberId=${kid}`, Buffer.alloc(0))).status, 400);
  assert.equal((await send('PUT', '/api/art/missing', png(1))).status, 404);
  assert.deepEqual(filesOnDisk(), []);
});
