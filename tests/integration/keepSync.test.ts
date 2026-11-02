import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Google Keep two-way list sync via bridge (fake Keep)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-keep-'));
  process.env.DATA_DIR = tempDir;
  process.env.KEEP_BRIDGE_CMD = JSON.stringify([process.execPath, path.resolve('tests/mocks/fakeKeepBridge.mjs')]);

  const keepFile = path.join(tempDir, 'keep', 'fake-keep.json');
  fs.mkdirSync(path.dirname(keepFile), { recursive: true });
  const writeKeep = (s: any) => fs.writeFileSync(keepFile, JSON.stringify(s, null, 2));
  const readKeep = () => JSON.parse(fs.readFileSync(keepFile, 'utf8'));
  writeKeep({
    notes: {
      n1: {
        title: 'Shopping list',
        items: [
          { id: 'k-milk', text: 'Milk', checked: false },
          { id: 'k-eggs', text: 'eggs', checked: true },
        ],
      },
    },
  });

  const { initSchema } = await import('../../src/server/db/schema.js');
  const { seedIfNeeded } = await import('../../src/server/db/seed.js');
  const { db } = await import('../../src/server/db/connection.js');
  const { listsRouter } = await import('../../src/server/routes/lists.js');
  const { keepRouter } = await import('../../src/server/routes/keep.js');
  initSchema();
  seedIfNeeded();

  const app = new Hono();
  app.route('/api/lists', listsRouter);
  app.route('/api/keep', keepRouter);
  const json = (method: string, body?: unknown) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Start from an empty Groceries list holding only "milk" (should pair with Keep's "Milk").
  const grocery = (db.prepare("SELECT id FROM lists WHERE is_grocery = 1 ORDER BY sort_order LIMIT 1").get() as any).id;
  db.prepare('DELETE FROM list_items WHERE list_id = ?').run(grocery);
  const addRes = await app.request(`/api/lists/${grocery}/items`, json('POST', { text: 'milk' }));
  assert.equal(addRes.status, 201);
  await app.request(`/api/lists/${grocery}/items`, json('POST', { text: 'paper towels' }));

  const localItems = () =>
    db.prepare('SELECT * FROM list_items WHERE list_id = ? ORDER BY text').all(grocery) as any[];
  const keepItems = () => readKeep().notes.n1.items as Array<{ id: string; text: string; checked: boolean }>;

  // 1. Notes listing + link triggers first sync
  const notes = (await (await app.request('/api/keep/notes')).json()) as any;
  assert.equal(notes.notes[0].title, 'Shopping list');
  const linkRes = (await (await app.request(`/api/keep/links/${grocery}`, json('PUT', { keepNoteId: 'n1', keepNoteTitle: 'Shopping list' }))).json()) as any;
  assert.equal(linkRes.state, 'ok', `status: ${linkRes.message}`);

  assert.deepEqual(localItems().map((i) => i.text).sort(), ['eggs', 'milk', 'paper towels'], 'milk paired, not duplicated');
  assert.equal(localItems().find((i) => i.text === 'eggs').checked, 1, 'checked state imported');
  assert.equal(keepItems().length, 3, 'paper towels pushed to Keep, milk not duplicated');
  assert.ok(keepItems().some((i) => i.text === 'paper towels'));

  // 2. Steady state: another sync changes nothing on either side
  const applyCountBefore = readKeep().applyCount || 0;
  await app.request('/api/keep/sync', json('POST'));
  assert.equal(readKeep().applyCount || 0, applyCountBefore, 'no Keep writes when nothing changed');

  // 3. Wall check-off reaches Keep
  const milk = localItems().find((i) => i.text === 'milk');
  await app.request(`/api/lists/items/${milk.id}`, json('PUT', { checked: true }));
  await app.request('/api/keep/sync', json('POST'));
  assert.equal(keepItems().find((i) => i.id === 'k-milk')!.checked, true);

  // 4. "Hey Google, add 2 cans black beans" + unchecking eggs in Keep reach the wall
  const s = readKeep();
  s.notes.n1.items.push({ id: 'k-beans', text: '2 cans black beans', checked: false });
  s.notes.n1.items.find((i: any) => i.id === 'k-eggs').checked = false;
  writeKeep(s);
  await app.request('/api/keep/sync', json('POST'));
  const beans = localItems().find((i) => i.text === 'black beans');
  assert.ok(beans, 'voice-added item imported');
  assert.equal(beans.quantity, '2 cans', 'quantity parsed');
  assert.equal(localItems().find((i) => i.text === 'eggs').checked, 0);

  // 5. Steady again after an import (reformatting must not cause churn)
  const before = JSON.stringify(readKeep().notes);
  await app.request('/api/keep/sync', json('POST'));
  assert.equal(JSON.stringify(readKeep().notes), before, 'imported items not rewritten in Keep');

  // 6. Deleted in Keep -> deleted on wall; "clear checked" on wall -> deleted in Keep
  const s2 = readKeep();
  s2.notes.n1.items = s2.notes.n1.items.filter((i: any) => i.id !== 'k-beans');
  writeKeep(s2);
  await app.request('/api/keep/sync', json('POST'));
  assert.ok(!localItems().some((i) => i.text === 'black beans'));

  await app.request(`/api/lists/${grocery}/clear-checked`, json('POST'));
  await app.request('/api/keep/sync', json('POST'));
  assert.ok(!keepItems().some((i) => i.id === 'k-milk'), 'cleared milk removed from Keep');

  // 7. Bridge failure: sync pauses, lists keep working, then recovers and catches up
  writeKeep({ ...readKeep(), fail: 'simulated Google outage' });
  const failed = (await (await app.request('/api/keep/sync', json('POST'))).json()) as any;
  assert.equal(failed.state, 'error');
  assert.match(failed.message, /simulated Google outage/);
  const offlineAdd = await app.request(`/api/lists/${grocery}/items`, json('POST', { text: 'bananas' }));
  assert.equal(offlineAdd.status, 201, 'local list unaffected by Keep outage');

  const recovered = readKeep();
  delete recovered.fail;
  writeKeep(recovered);
  const ok = (await (await app.request('/api/keep/sync', json('POST'))).json()) as any;
  assert.equal(ok.state, 'ok');
  assert.ok(keepItems().some((i) => i.text === 'bananas'), 'item added during outage reaches Keep');

  // 8. Unlink stops syncing
  await app.request(`/api/keep/links/${grocery}`, json('DELETE'));
  const status = (await (await app.request('/api/keep/status')).json()) as any;
  assert.equal(status.links.length, 0);
});
