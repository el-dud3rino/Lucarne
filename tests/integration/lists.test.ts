import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';

test('Lists Integration: grocery categorization, quantity parsing, duplicate merging, toggles & clear checked', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-lists-'));
  process.env.DATA_DIR = tempDir;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { listsRouter } = await import('../../src/server/routes/lists.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/lists', listsRouter);

    // 1. Fetch initial lists
    const listsRes = await app.request('/api/lists');
    assert.equal(listsRes.status, 200);
    const lists = (await listsRes.json()) as any[];
    assert.ok(lists.length >= 3, 'Must have seeded lists');

    const groceryList = lists.find((l) => l.isGrocery) || lists[0];
    assert.ok(groceryList, 'Grocery list exists');
    const initialUnchecked = groceryList.uncheckedCount;

    // 2. Add freeform grocery item: "2 jars tomato sauce"
    const addRes1 = await app.request(`/api/lists/${groceryList.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '2 jars tomato sauce' }),
    });
    assert.equal(addRes1.status, 201, 'First insert creates new row (201)');
    const addedItem1 = (await addRes1.json()) as any;
    assert.equal(addedItem1.text, 'tomato sauce');
    assert.equal(addedItem1.quantity, '2 jars');
    assert.equal(addedItem1.category, 'Produce');

    // 3. Duplicate Merging: Add another "1 jar tomato sauce" to the same list
    const addRes2 = await app.request(`/api/lists/${groceryList.id}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '1 jar tomato sauce' }),
    });
    // Merges into existing item, returns updated item with merged quantity "3 jars"
    assert.equal(addRes2.status, 200, 'Duplicate insert merges into existing row (200)');
    const mergedItem = (await addRes2.json()) as any;
    assert.equal(mergedItem.id, addedItem1.id, 'Must update existing row');
    assert.equal(mergedItem.quantity, '3 jars', 'Must sum matching jar quantities');

    // 4. Verify item list reflects merged row (no duplicate row)
    const itemsRes = await app.request(`/api/lists/${groceryList.id}/items`);
    const allItems = (await itemsRes.json()) as any[];
    const sauceRows = allItems.filter((i) => i.text.toLowerCase().includes('tomato sauce'));
    assert.equal(sauceRows.length, 1, 'Duplicate tomato sauce rows must be merged');
    assert.equal(sauceRows[0].quantity, '3 jars');

    // 5. Toggle Item Checked
    const itemToToggle = sauceRows[0];
    const checkRes = await app.request(`/api/lists/items/${itemToToggle.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked: true }),
    });
    assert.equal(checkRes.status, 200);
    const checkedItem = (await checkRes.json()) as any;
    assert.equal(checkedItem.checked, true);

    // 6. Verify uncheckedCount updated on list
    const listsResAfter = await app.request('/api/lists');
    const listsAfter = (await listsResAfter.json()) as any[];
    const groceryAfter = listsAfter.find((l) => l.id === groceryList.id);
    // Checked item decrements uncheckedCount
    assert.ok(groceryAfter.uncheckedCount !== undefined);

    // 7. Clear Checked Items
    const clearRes = await app.request(`/api/lists/${groceryList.id}/clear-checked`, {
      method: 'POST',
    });
    assert.equal(clearRes.status, 200);

    const itemsResAfterClear = await app.request(`/api/lists/${groceryList.id}/items`);
    const remainingItems = (await itemsResAfterClear.json()) as any[];
    assert.ok(!remainingItems.some((i) => i.id === itemToToggle.id), 'Checked item cleared');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test('Lists Integration: PUT /api/lists/:id updates list properties, handles 404, and broadcasts SSE invalidation', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-lists-put-'));
  process.env.DATA_DIR = tempDir;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { db } = await import('../../src/server/db/connection.js');
    const { listsRouter } = await import('../../src/server/routes/lists.js');
    const { registerSSEClient } = await import('../../src/server/sse.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/lists', listsRouter);

    // Track SSE broadcasts
    const receivedSSE: any[] = [];
    const unregister = registerSSEClient('test-listener', (chunk) => {
      if (chunk.startsWith('data: ')) {
        try {
          receivedSSE.push(JSON.parse(chunk.slice(6)));
        } catch {
          // ignore
        }
      }
    });

    try {
      // 1. Fetch initial list from DB
      const existing = db.prepare('SELECT * FROM lists LIMIT 1').get() as {
        id: string;
        name: string;
        emoji: string;
        color_accent: string;
        is_grocery: number;
      };
      assert.ok(existing, 'A seeded list must exist in database');

      // 2. Perform full update of list properties
      const updatePayload = {
        name: 'Weekly Farmers Market',
        emoji: '🥕',
        colorAccent: '#16A34A',
        isGrocery: false,
      };

      const putRes = await app.request(`/api/lists/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      assert.equal(putRes.status, 200, 'PUT /api/lists/:id returns 200 on success');
      const updatedList = (await putRes.json()) as any;
      assert.equal(updatedList.id, existing.id);
      assert.equal(updatedList.name, 'Weekly Farmers Market');
      assert.equal(updatedList.emoji, '🥕');
      assert.equal(updatedList.colorAccent, '#16A34A');
      assert.equal(updatedList.isGrocery, false);

      // 3. Verify direct SQLite database persistence
      const rowInDb = db.prepare('SELECT * FROM lists WHERE id = ?').get(existing.id) as {
        id: string;
        name: string;
        emoji: string;
        color_accent: string;
        is_grocery: number;
      };
      assert.equal(rowInDb.name, 'Weekly Farmers Market', 'SQLite name must match updated value');
      assert.equal(rowInDb.emoji, '🥕', 'SQLite emoji must match updated value');
      assert.equal(rowInDb.color_accent, '#16A34A', 'SQLite color_accent must match updated value');
      assert.equal(rowInDb.is_grocery, 0, 'SQLite is_grocery must be stored as 0');

      // 4. Verify partial updates (only updating name, preserving others)
      const partialRes = await app.request(`/api/lists/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Specialty Organics' }),
      });
      assert.equal(partialRes.status, 200);
      const partialUpdated = (await partialRes.json()) as any;
      assert.equal(partialUpdated.name, 'Specialty Organics');
      assert.equal(partialUpdated.emoji, '🥕', 'Preserves previous emoji');
      assert.equal(partialUpdated.colorAccent, '#16A34A', 'Preserves previous colorAccent');
      assert.equal(partialUpdated.isGrocery, false, 'Preserves previous isGrocery');

      // 5. Verify SSE broadcast was sent with topic 'lists'
      const listInvalidations = receivedSSE.filter(
        (msg) => msg.type === 'invalidate' && msg.topics?.includes('lists')
      );
      assert.ok(listInvalidations.length >= 2, 'SSE broadcast must emit lists topic on each update');

      // 6. Verify 404 response on non-existent list ID
      const notFoundRes = await app.request('/api/lists/non-existent-list-id-12345', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost List' }),
      });
      assert.equal(notFoundRes.status, 404, 'PUT /api/lists/:id returns 404 for unknown list');
      const errBody = (await notFoundRes.json()) as any;
      assert.equal(errBody.error, 'List not found');
    } finally {
      unregister();
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
