import { db } from '../db/connection.js';
import { classifyGroceryItem } from '../../shared/groceryClassifier.js';
import { normalizeIngredientName } from '../../shared/ingredientAggregator.js';
import { GROCERY_CATEGORIES, type GroceryCategory } from '../../shared/types.js';

/**
 * Household-learned aisles: when someone moves an item to another aisle, that choice is remembered
 * (by normalized name, so "Chicken Broth" / "chicken broths" match) and used whenever the item is added
 * again — from the wall, a phone, Google Keep or a recipe.
 */

export function aisleKey(text: string): string {
  return normalizeIngredientName(text);
}

function isCategory(value: unknown): value is GroceryCategory {
  return typeof value === 'string' && (GROCERY_CATEGORIES as readonly string[]).includes(value);
}

export function rememberedAisle(text: string): GroceryCategory | null {
  const key = aisleKey(text);
  if (!key) return null;
  const row = db.prepare('SELECT category FROM grocery_aisle_overrides WHERE name_key = ?').get(key) as
    | { category: string }
    | undefined;
  return row && isCategory(row.category) ? row.category : null;
}

/** Remembered aisle if the household chose one, otherwise the built-in keyword rules. */
export function aisleFor(text: string): GroceryCategory {
  return rememberedAisle(text) ?? classifyGroceryItem(text);
}

export function rememberAisle(text: string, category: GroceryCategory): void {
  const key = aisleKey(text);
  if (!key || !isCategory(category)) return;
  db.prepare(
    `INSERT INTO grocery_aisle_overrides (name_key, category, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(name_key) DO UPDATE SET category = excluded.category, updated_at = excluded.updated_at`
  ).run(key, category, new Date().toISOString());
}
