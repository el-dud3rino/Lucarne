import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

test('Moving an item to another aisle is remembered; store order is saved', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-aisles-'));
  const { initSchema } = await import('../../src/server/db/schema.js');
  const { seedIfNeeded } = await import('../../src/server/db/seed.js');
  const { db } = await import('../../src/server/db/connection.js');
  const { listsRouter } = await import('../../src/server/routes/lists.js');
  const { settingsRouter } = await import('../../src/server/routes/settings.js');
  const { aisleFor } = await import('../../src/server/services/aisles.js');
  initSchema();
  seedIfNeeded();
  const app = new Hono();
  app.route('/api/lists', listsRouter);
  app.route('/api/settings', settingsRouter);
  const json = (method: string, body?: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const listId = (db.prepare('SELECT id FROM lists WHERE is_grocery = 1 LIMIT 1').get() as any).id;

  // Built-in rules first
  const added = (await (await app.request(`/api/lists/${listId}/items`, json('POST', { text: 'oat milk' }))).json()) as any;
  assert.equal(added.category, 'Dairy & Eggs');

  // Household moves it to the Snacks & Drinks aisle (their store keeps it there)
  await app.request(`/api/lists/items/${added.id}`, json('PUT', { category: 'Snacks & Drinks' }));
  assert.equal(aisleFor('Oat Milks'), 'Snacks & Drinks', 'remembered by normalized name (case/plural)');

  // Checked off + cleared, then added again later: goes to the remembered aisle
  await app.request(`/api/lists/items/${added.id}`, json('PUT', { checked: true }));
  await app.request(`/api/lists/${listId}/clear-checked`, json('POST'));
  const again = (await (await app.request(`/api/lists/${listId}/items`, json('POST', { text: '2 cartons Oat Milk' }))).json()) as any;
  assert.equal(again.category, 'Snacks & Drinks');
  assert.equal(again.quantity, '2 cartons');

  // Other items unaffected
  const milk = (await (await app.request(`/api/lists/${listId}/items`, json('POST', { text: 'whole milk' }))).json()) as any;
  assert.equal(milk.category, 'Dairy & Eggs');

  // Store order round-trips through settings (and is sanitized)
  const saved = (await (await app.request('/api/settings', json('PUT', { groceryAisleOrder: ['Bakery', 'Produce', 'Nope'] }))).json()) as any;
  assert.deepEqual(saved.groceryAisleOrder.slice(0, 2), ['Bakery', 'Produce']);
  assert.ok(!saved.groceryAisleOrder.includes('Nope'));
  assert.equal(saved.groceryAisleOrder.length, 9);
});
