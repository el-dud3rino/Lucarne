import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db, runTransaction } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import {
  extractRecipeFromUrl,
  importMealsSeedJson,
  searchOrGenerateMealsWithGemini,
} from '../services/recipes.js';
import { classifyGroceryItem } from '../../shared/groceryClassifier.js';
import {
  aggregateIngredients,
  normalizeIngredientName,
  mergeQuantities,
} from '../../shared/ingredientAggregator.js';
import type { MealPlanEntry, Recipe, RecipeIngredient } from '../../shared/types.js';

export const mealsRouter = new Hono();

function mapRecipeRow(row: Record<string, unknown>): Recipe {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description || ''),
    imageUrl: row.image_url ? String(row.image_url) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    prepMinutes: row.prep_minutes !== null ? Number(row.prep_minutes) : null,
    cookMinutes: row.cook_minutes !== null ? Number(row.cook_minutes) : null,
    servings: row.servings !== null ? Number(row.servings) : null,
    tags: JSON.parse(String(row.tags_json || '[]')),
    ingredients: JSON.parse(String(row.ingredients_json || '[]')),
    instructions: JSON.parse(String(row.instructions_json || '[]')),
    favorite: Boolean(row.favorite),
    createdAt: String(row.created_at),
  };
}

mealsRouter.get('/recipes', (c) => {
  const q = (c.req.query('q') || '').trim().toLowerCase();
  const rows = db
    .prepare('SELECT * FROM recipes ORDER BY favorite DESC, title ASC')
    .all() as Record<string, unknown>[];
  let recipes = rows.map(mapRecipeRow);
  if (q) {
    recipes = recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    );
  }
  return c.json(recipes);
});

mealsRouter.post('/recipes', async (c) => {
  const body = await c.req.json<Partial<Recipe>>();
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO recipes (
      id, title, description, image_url, source_url, prep_minutes, cook_minutes, servings,
      tags_json, ingredients_json, instructions_json, favorite, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (body.title || 'Untitled Recipe').trim(),
    body.description || '',
    body.imageUrl || null,
    body.sourceUrl || null,
    body.prepMinutes ?? null,
    body.cookMinutes ?? null,
    body.servings ?? 4,
    JSON.stringify(body.tags || []),
    JSON.stringify(body.ingredients || []),
    JSON.stringify(body.instructions || []),
    body.favorite ? 1 : 0,
    nowIso
  );

  broadcastInvalidate(['recipes']);
  const created = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return c.json(mapRecipeRow(created), 201);
});

mealsRouter.put('/recipes/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<Recipe>>();
  const existing = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const cur = mapRecipeRow(existing);
  db.prepare(
    `UPDATE recipes
     SET title = ?, description = ?, image_url = ?, source_url = ?, prep_minutes = ?, cook_minutes = ?,
         servings = ?, tags_json = ?, ingredients_json = ?, instructions_json = ?, favorite = ?
     WHERE id = ?`
  ).run(
    (body.title ?? cur.title).trim(),
    body.description ?? cur.description,
    body.imageUrl !== undefined ? body.imageUrl : cur.imageUrl,
    body.sourceUrl !== undefined ? body.sourceUrl : cur.sourceUrl,
    body.prepMinutes !== undefined ? body.prepMinutes : cur.prepMinutes,
    body.cookMinutes !== undefined ? body.cookMinutes : cur.cookMinutes,
    body.servings !== undefined ? body.servings : cur.servings,
    JSON.stringify(body.tags ?? cur.tags),
    JSON.stringify(body.ingredients ?? cur.ingredients),
    JSON.stringify(body.instructions ?? cur.instructions),
    (body.favorite !== undefined ? body.favorite : cur.favorite) ? 1 : 0,
    id
  );

  broadcastInvalidate(['recipes', 'meals']);
  const updated = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return c.json(mapRecipeRow(updated));
});

mealsRouter.delete('/recipes/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  broadcastInvalidate(['recipes', 'meals']);
  return c.json({ ok: true });
});

mealsRouter.post('/recipes/import-url', async (c) => {
  const { url } = await c.req.json<{ url: string }>();
  if (!url?.trim()) return c.json({ error: 'URL is required' }, 400);
  try {
    const extracted = await extractRecipeFromUrl(url.trim());
    const id = crypto.randomUUID();
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO recipes (
        id, title, description, image_url, source_url, prep_minutes, cook_minutes, servings,
        tags_json, ingredients_json, instructions_json, favorite, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      id,
      extracted.title,
      extracted.description,
      extracted.imageUrl,
      extracted.sourceUrl,
      extracted.prepMinutes,
      extracted.cookMinutes,
      extracted.servings,
      JSON.stringify(extracted.tags),
      JSON.stringify(extracted.ingredients),
      JSON.stringify(extracted.instructions),
      nowIso
    );
    broadcastInvalidate(['recipes']);
    const created = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    return c.json(mapRecipeRow(created), 201);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to extract recipe' },
      400
    );
  }
});

mealsRouter.post('/recipes/search-ai', async (c) => {
  const { query } = await c.req.json<{ query: string }>();
  if (!query?.trim()) return c.json({ error: 'Search query required' }, 400);
  try {
    const suggestions = await searchOrGenerateMealsWithGemini(query.trim());
    return c.json(suggestions);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'AI search failed' },
      400
    );
  }
});

mealsRouter.post('/recipes/import-json', async (c) => {
  try {
    const payload = await c.req.json();
    const result = importMealsSeedJson(payload);
    broadcastInvalidate(['recipes']);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Invalid JSON payload' },
      400
    );
  }
});

mealsRouter.get('/plan', (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');

  let rows: Record<string, unknown>[];
  if (start && end) {
    rows = db
      .prepare('SELECT * FROM meal_plans WHERE date_str >= ? AND date_str <= ? ORDER BY date_str ASC')
      .all(start, end) as Record<string, unknown>[];
  } else {
    rows = db.prepare('SELECT * FROM meal_plans ORDER BY date_str ASC').all() as Record<
      string,
      unknown
    >[];
  }

  const recipeStmt = db.prepare('SELECT * FROM recipes WHERE id = ?');
  const entries: MealPlanEntry[] = rows.map((row) => {
    const recRow = row.recipe_id
      ? (recipeStmt.get(String(row.recipe_id)) as Record<string, unknown> | undefined)
      : undefined;
    return {
      id: String(row.id),
      dateStr: String(row.date_str),
      slot: row.slot as MealPlanEntry['slot'],
      recipeId: row.recipe_id ? String(row.recipe_id) : null,
      customTitle: String(row.custom_title || ''),
      notes: String(row.notes || ''),
      recipe: recRow ? mapRecipeRow(recRow) : null,
    };
  });

  return c.json(entries);
});

mealsRouter.post('/plan', async (c) => {
  const body = await c.req.json<{
    dateStr: string;
    slot: MealPlanEntry['slot'];
    recipeId?: string | null;
    customTitle?: string;
    notes?: string;
  }>();

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO meal_plans (id, date_str, slot, recipe_id, custom_title, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date_str, slot) DO UPDATE SET
       recipe_id = excluded.recipe_id,
       custom_title = excluded.custom_title,
       notes = excluded.notes`
  ).run(
    id,
    body.dateStr,
    body.slot || 'dinner',
    body.recipeId || null,
    (body.customTitle || '').trim(),
    (body.notes || '').trim()
  );

  broadcastInvalidate(['meals']);
  return c.json({ ok: true });
});

mealsRouter.delete('/plan/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM meal_plans WHERE id = ?').run(id);
  broadcastInvalidate(['meals']);
  return c.json({ ok: true });
});

mealsRouter.post('/send-to-groceries', async (c) => {
  const body = await c.req.json<{
    listId: string;
    items: Array<RecipeIngredient & { recipeTitle?: string; mealName?: string }>;
  }>();

  const listId = body.listId || 'list-groceries';
  const rawItems = body.items || [];
  if (rawItems.length === 0) {
    return c.json({ added: 0, merged: 0, total: 0 });
  }

  // 1. Run smart ingredient aggregation across all incoming items
  const aggregated = aggregateIngredients(rawItems);

  const nowIso = new Date().toISOString();
  let addedCount = 0;
  let mergedCount = 0;

  runTransaction(() => {
    // 2. Fetch all unchecked items on the target list
    const existingRows = db
      .prepare('SELECT * FROM list_items WHERE list_id = ? AND checked = 0')
      .all(listId) as Record<string, unknown>[];

    const uncheckedMap = new Map<
      string,
      { id: string; text: string; quantity: string; recipeSourceTitle: string | null }
    >();

    for (const row of existingRows) {
      const norm = normalizeIngredientName(String(row.text));
      if (!uncheckedMap.has(norm)) {
        uncheckedMap.set(norm, {
          id: String(row.id),
          text: String(row.text),
          quantity: String(row.quantity || ''),
          recipeSourceTitle: row.recipe_source_title ? String(row.recipe_source_title) : null,
        });
      }
    }

    const insertStmt = db.prepare(
      `INSERT INTO list_items (id, list_id, text, quantity, category, checked, recipe_source_title, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    );

    const updateStmt = db.prepare(
      `UPDATE list_items
       SET quantity = ?, recipe_source_title = ?, updated_at = ?
       WHERE id = ?`
    );

    for (const agg of aggregated) {
      const norm = normalizeIngredientName(agg.name);
      const existing = uncheckedMap.get(norm);

      if (existing) {
        // Merge quantities with existing unchecked item
        const mergedQty = mergeQuantities(existing.quantity, agg.quantity);

        // Combine contributing recipe source titles
        const sources = new Set<string>();
        if (existing.recipeSourceTitle) {
          existing.recipeSourceTitle.split(',').forEach((s) => {
            const trimmed = s.trim();
            if (trimmed) sources.add(trimmed);
          });
        }
        agg.sourceMeals.forEach((s) => {
          const trimmed = s.trim();
          if (trimmed) sources.add(trimmed);
        });
        const combinedSources = Array.from(sources).filter(Boolean).join(', ') || null;

        updateStmt.run(mergedQty, combinedSources, nowIso, existing.id);

        existing.quantity = mergedQty;
        existing.recipeSourceTitle = combinedSources;
        mergedCount++;
      } else {
        const newId = crypto.randomUUID();
        const sources = agg.sourceMeals.join(', ') || null;

        insertStmt.run(
          newId,
          listId,
          agg.name,
          agg.quantity,
          agg.category,
          sources,
          nowIso
        );

        uncheckedMap.set(norm, {
          id: newId,
          text: agg.name,
          quantity: agg.quantity,
          recipeSourceTitle: sources,
        });
        addedCount++;
      }
    }
  });

  broadcastInvalidate(['lists']);
  return c.json({
    added: addedCount,
    merged: mergedCount,
    total: addedCount + mergedCount,
  });
});
