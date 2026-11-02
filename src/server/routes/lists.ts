import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { classifyGroceryItem } from '../../shared/groceryClassifier.js';
import {
  parseItemInput,
  normalizeIngredientName,
  mergeQuantities,
} from '../../shared/ingredientAggregator.js';
import type { GroceryCategory, ListItem, TaskList } from '../../shared/types.js';

export const listsRouter = new Hono();

function mapListRow(row: Record<string, unknown>): TaskList {
  return {
    id: String(row.id),
    name: String(row.name),
    emoji: String(row.emoji || '🛒'),
    colorAccent: String(row.color_accent || '#0284C7'),
    isGrocery: Boolean(row.is_grocery),
    sortOrder: Number(row.sort_order ?? 0),
    uncheckedCount: Number(row.unchecked_count ?? 0),
  };
}

function mapItemRow(row: Record<string, unknown>): ListItem {
  return {
    id: String(row.id),
    listId: String(row.list_id),
    text: String(row.text),
    quantity: String(row.quantity || ''),
    category: (row.category as GroceryCategory) || 'Other',
    checked: Boolean(row.checked),
    addedByMemberId: row.added_by_member_id ? String(row.added_by_member_id) : null,
    recipeSourceTitle: row.recipe_source_title ? String(row.recipe_source_title) : null,
    updatedAt: String(row.updated_at),
  };
}

listsRouter.get('/', (c) => {
  const rows = db
    .prepare(
      `SELECT l.*,
              (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id AND li.checked = 0) AS unchecked_count
       FROM lists l
       ORDER BY l.sort_order ASC, l.name ASC`
    )
    .all() as Record<string, unknown>[];
  return c.json(rows.map(mapListRow));
});

listsRouter.post('/', async (c) => {
  const body = await c.req.json<Partial<TaskList>>();
  const id = crypto.randomUUID();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM lists')
    .get() as { m: number };

  db.prepare(
    `INSERT INTO lists (id, name, emoji, color_accent, is_grocery, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (body.name || 'New List').trim(),
    body.emoji || '📝',
    body.colorAccent || '#0284C7',
    body.isGrocery ? 1 : 0,
    maxOrder.m + 1
  );

  broadcastInvalidate(['lists']);
  const created = db
    .prepare('SELECT *, 0 as unchecked_count FROM lists WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return c.json(mapListRow(created), 201);
});

listsRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<TaskList>>();
  const existing = db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  if (!existing) {
    return c.json({ error: 'List not found' }, 404);
  }

  const name = body.name !== undefined ? body.name.trim() : (existing.name as string);
  const emoji = body.emoji !== undefined ? body.emoji : (existing.emoji as string);
  const colorAccent =
    body.colorAccent !== undefined
      ? body.colorAccent
      : (existing.color_accent as string);
  const isGrocery =
    body.isGrocery !== undefined
      ? (body.isGrocery ? 1 : 0)
      : (existing.is_grocery as number);

  db.prepare(
    `UPDATE lists
     SET name = ?, emoji = ?, color_accent = ?, is_grocery = ?
     WHERE id = ?`
  ).run(name, emoji, colorAccent, isGrocery, id);

  broadcastInvalidate(['lists']);
  const updated = db
    .prepare(
      `SELECT l.*,
              (SELECT COUNT(*) FROM list_items li WHERE li.list_id = l.id AND li.checked = 0) AS unchecked_count
       FROM lists l
       WHERE l.id = ?`
    )
    .get(id) as Record<string, unknown>;

  return c.json(mapListRow(updated));
});

listsRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM lists WHERE id = ?').run(id);
  broadcastInvalidate(['lists']);
  return c.json({ ok: true });
});

listsRouter.get('/:id/items', (c) => {
  const listId = c.req.param('id');
  const rows = db
    .prepare(
      'SELECT * FROM list_items WHERE list_id = ? ORDER BY checked ASC, updated_at DESC'
    )
    .all(listId) as Record<string, unknown>[];
  return c.json(rows.map(mapItemRow));
});

listsRouter.post('/:id/items', async (c) => {
  const listId = c.req.param('id');
  const body = await c.req.json<Partial<ListItem>>();
  const rawText = (body.text || '').trim();
  if (!rawText) return c.json({ error: 'Item text required' }, 400);

  let text = rawText;
  let quantity = (body.quantity || '').trim();
  let category = body.category;

  // 1. If quantity was not explicitly supplied, parse freeform string
  if (!quantity) {
    const parsed = parseItemInput(rawText);
    text = parsed.text;
    quantity = parsed.quantity;
    if (!category) {
      category = parsed.category as GroceryCategory;
    }
  } else if (!category) {
    category = classifyGroceryItem(text);
  }

  const nowIso = new Date().toISOString();
  const normName = normalizeIngredientName(text);

  // 2. Check if an unchecked item with matching normalized name already exists
  const existingRows = db
    .prepare('SELECT * FROM list_items WHERE list_id = ? AND checked = 0')
    .all(listId) as Record<string, unknown>[];

  const existing = existingRows.find(
    (row) => normalizeIngredientName(String(row.text)) === normName
  );

  if (existing) {
    // 3. Merge quantity into existing unchecked row
    const mergedQty = mergeQuantities(String(existing.quantity || ''), quantity);

    db.prepare(
      `UPDATE list_items
       SET quantity = ?, updated_at = ?
       WHERE id = ?`
    ).run(mergedQty, nowIso, String(existing.id));

    broadcastInvalidate(['lists']);
    const updated = db
      .prepare('SELECT * FROM list_items WHERE id = ?')
      .get(String(existing.id)) as Record<string, unknown>;
    return c.json(mapItemRow(updated), 200);
  }

  // 4. Otherwise insert new row
  const id = body.id || crypto.randomUUID();
  db.prepare(
    `INSERT INTO list_items (id, list_id, text, quantity, category, checked, added_by_member_id, recipe_source_title, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    id,
    listId,
    text,
    quantity,
    category,
    body.addedByMemberId || null,
    body.recipeSourceTitle || null,
    nowIso
  );

  broadcastInvalidate(['lists']);
  const created = db.prepare('SELECT * FROM list_items WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return c.json(mapItemRow(created), 201);
});

listsRouter.put('/items/:itemId', async (c) => {
  const itemId = c.req.param('itemId');
  const body = await c.req.json<Partial<ListItem>>();
  const existing = db.prepare('SELECT * FROM list_items WHERE id = ?').get(itemId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE list_items
     SET text = ?, quantity = ?, category = ?, checked = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    (body.text ?? String(existing.text)).trim(),
    body.quantity ?? String(existing.quantity),
    body.category ?? String(existing.category),
    body.checked !== undefined ? (body.checked ? 1 : 0) : Number(existing.checked),
    nowIso,
    itemId
  );

  broadcastInvalidate(['lists']);
  const updated = db.prepare('SELECT * FROM list_items WHERE id = ?').get(itemId) as Record<
    string,
    unknown
  >;
  return c.json(mapItemRow(updated));
});

listsRouter.delete('/items/:itemId', (c) => {
  const itemId = c.req.param('itemId');
  db.prepare('DELETE FROM list_items WHERE id = ?').run(itemId);
  broadcastInvalidate(['lists']);
  return c.json({ ok: true });
});

listsRouter.post('/:id/clear-checked', (c) => {
  const listId = c.req.param('id');
  db.prepare('DELETE FROM list_items WHERE list_id = ? AND checked = 1').run(listId);
  broadcastInvalidate(['lists']);
  return c.json({ ok: true });
});
