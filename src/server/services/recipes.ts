import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { GoogleGenAI, Type } from '@google/genai';
import { db, MEDIA_RECIPES_DIR, runTransaction } from '../db/connection.js';
import { classifyGroceryItem } from '../../shared/groceryClassifier.js';
import { parseFractionNumber } from '../../shared/ingredientAggregator.js';
import {
  GROCERY_CATEGORIES,
  type GroceryCategory,
  type Recipe,
  type RecipeIngredient,
} from '../../shared/types.js';

export function getGeminiApiKey(): string {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = 'geminiApiKey'")
    .get() as { value: string } | undefined;
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    } catch {
      // ignore
    }
  }
  return (process.env.GEMINI_API_KEY || '').trim();
}

const UNITS = new Set([
  'cup', 'cups', 'c', 'tbsp', 'tbs', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams',
  'kg', 'ml', 'l', 'liter', 'can', 'cans', 'jar', 'jars', 'clove', 'cloves',
  'slice', 'slices', 'bunch', 'bunches', 'head', 'heads', 'pinch', 'package', 'pkg',
  'stick', 'sticks', 'quart', 'qt', 'pint', 'pt', 'gallon', 'gal',
]);

export function parseIngredientLine(raw: string): RecipeIngredient {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { name: 'Item', quantity: null, unit: '', notes: '', category: 'Other' };
  }

  // Split comma notes e.g. "2 lbs chicken breast, diced"
  const [mainPart, ...noteParts] = cleaned.split(',');
  const notes = noteParts.join(',').trim();

  // Match leading fraction, decimal, or vulgar fraction e.g. "1 1/2", "1/2", "2.5", "½", "1 ½"
  const qtyMatch = mainPart.trim().match(
    /^(\d+[-\s]+(?:\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞])|\d+[½⅓⅔¼¾⅛⅜⅝⅞]|\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\.\d+)?)(?:\s+(.*))?$/
  );
  let quantity: number | null = null;
  let rest = mainPart.trim();

  if (qtyMatch) {
    const qVal = parseFractionNumber(qtyMatch[1]);
    if (qVal !== null) {
      quantity = qVal;
      rest = (qtyMatch[2] || '').trim();
    }
  } else {
    // Check if entire mainPart is a single vulgar fraction or number e.g. "½"
    const soloVal = parseFractionNumber(mainPart.trim());
    if (soloVal !== null) {
      quantity = soloVal;
      rest = '';
    }
  }

  const words = rest.split(' ').filter(Boolean);
  let unit = '';
  let name = rest;
  if (words.length > 1 && UNITS.has(words[0].toLowerCase().replace(/\.$/, ''))) {
    unit = words[0].replace(/\.$/, '');
    name = words.slice(1).join(' ').replace(/^of\s+/i, '').trim();
  }

  return {
    name: name || cleaned,
    quantity: quantity !== null ? Math.round(quantity * 100) / 100 : null,
    unit,
    notes,
    category: classifyGroceryItem(name || cleaned),
  };
}

function parseIsoDurationMinutes(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
  if (typeof val !== 'string') return null;
  const iso = val.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (iso && (iso[1] || iso[2])) {
    return (Number(iso[1] || 0) * 60) + Number(iso[2] || 0);
  }
  const num = val.match(/(\d+)/);
  return num ? Number(num[1]) : null;
}

export async function cacheRemoteImageLocally(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
    return imageUrl || null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return imageUrl;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return imageUrl;

    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';

    const filename = `${crypto.randomUUID()}${ext}`;
    const dest = path.join(MEDIA_RECIPES_DIR, filename);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 500 || buf.byteLength > 15 * 1024 * 1024) return imageUrl;
    fs.writeFileSync(dest, buf);
    return `/media/recipes/${filename}`;
  } catch {
    return imageUrl;
  }
}

function findJsonLdRecipe(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJsonLdRecipe(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const typeVal = obj['@type'];
    const isRecipe =
      typeVal === 'Recipe' ||
      (Array.isArray(typeVal) && typeVal.includes('Recipe'));
    if (isRecipe) return obj;
    if (obj['@graph']) {
      return findJsonLdRecipe(obj['@graph']);
    }
  }
  return null;
}

export async function extractRecipeFromUrl(url: string): Promise<Omit<Recipe, 'id' | 'createdAt'>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(`Failed to fetch URL (${res.status})`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // 1. Try schema.org/Recipe JSON-LD first (fast, deterministic, skips all life-story prose)
  let ldRecipe = null as Record<string, unknown> | null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ldRecipe) return;
    try {
      const parsed = JSON.parse($(el).contents().text());
      ldRecipe = findJsonLdRecipe(parsed);
    } catch {
      // ignore malformed ld+json block
    }
  });

  const ogImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null;

  if (ldRecipe) {
    const rawTitle = String(ldRecipe.name || $('title').text() || 'Imported Recipe').trim();
    const rawDesc = String(ldRecipe.description || '').replace(/<[^>]+>/g, '').trim();

    let heroImg: string | null = ogImage;
    const imgField = ldRecipe.image;
    if (typeof imgField === 'string') heroImg = imgField;
    else if (Array.isArray(imgField) && imgField.length > 0) {
      heroImg = typeof imgField[0] === 'string' ? imgField[0] : (imgField[0]?.url ?? ogImage);
    } else if (imgField && typeof imgField === 'object' && 'url' in imgField) {
      heroImg = String((imgField as { url: unknown }).url);
    }

    const rawIngs = Array.isArray(ldRecipe.recipeIngredient)
      ? ldRecipe.recipeIngredient.map((x) => String(x))
      : [];

    const rawSteps: string[] = [];
    const inst = ldRecipe.recipeInstructions;
    const processStepObj = (step: unknown) => {
      if (typeof step === 'string') {
        const s = step.replace(/<[^>]+>/g, '').trim();
        if (s) rawSteps.push(s);
      } else if (step && typeof step === 'object') {
        const sObj = step as Record<string, unknown>;
        if (typeof sObj.text === 'string') {
          const s = sObj.text.replace(/<[^>]+>/g, '').trim();
          if (s) rawSteps.push(s);
        } else if (typeof sObj.name === 'string' && sObj['@type'] === 'HowToStep') {
          const s = sObj.name.replace(/<[^>]+>/g, '').trim();
          if (s) rawSteps.push(s);
        }
        if (Array.isArray(sObj.itemListElement)) {
          for (const sub of sObj.itemListElement) {
            processStepObj(sub);
          }
        }
      }
    };

    if (typeof inst === 'string') {
      rawSteps.push(...inst.split(/\n+/).map((s) => s.trim()).filter(Boolean));
    } else if (Array.isArray(inst)) {
      for (const step of inst) {
        processStepObj(step);
      }
    } else if (inst && typeof inst === 'object') {
      processStepObj(inst);
    }

    const yieldVal = Array.isArray(ldRecipe.recipeYield)
      ? ldRecipe.recipeYield[0]
      : ldRecipe.recipeYield;
    const servingsMatch = String(yieldVal || '').match(/(\d+)/);

    const tags: string[] = [];
    for (const field of [ldRecipe.recipeCategory, ldRecipe.recipeCuisine]) {
      if (typeof field === 'string') tags.push(...field.split(',').map((t) => t.trim()));
      else if (Array.isArray(field)) tags.push(...field.map((t) => String(t).trim()));
    }

    // If Gemini is configured, optionally refine ingredient parsing; otherwise local parser handles it immediately
    let ingredients = rawIngs.map(parseIngredientLine);
    const apiKey = getGeminiApiKey();
    if (apiKey && rawIngs.length > 0) {
      try {
        ingredients = await normalizeIngredientsWithGemini(apiKey, rawIngs);
      } catch {
        // Fallback silently to deterministic parser
      }
    }

    const localImg = await cacheRemoteImageLocally(heroImg);
    return {
      title: rawTitle,
      description: rawDesc,
      imageUrl: localImg,
      sourceUrl: url,
      prepMinutes: parseIsoDurationMinutes(ldRecipe.prepTime),
      cookMinutes: parseIsoDurationMinutes(ldRecipe.cookTime),
      servings: servingsMatch ? Number(servingsMatch[1]) : 4,
      tags: Array.from(new Set(tags.filter(Boolean))).slice(0, 6),
      ingredients,
      instructions: rawSteps.filter(Boolean),
      favorite: false,
    };
  }

  // 2. Fallback: Clean DOM text + Gemini structured extraction for non-JSON-LD sites
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'This website does not embed structured Recipe metadata. Add a Gemini API Key in Settings to extract recipes from unstructured pages.'
    );
  }

  $('script, style, nav, footer, header, iframe, ads, .ad, .advertisement, .comments').remove();
  const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 28_000);
  const extracted = await extractRecipeWithGeminiFromText(apiKey, pageText);
  const localImg = await cacheRemoteImageLocally(ogImage);

  return {
    ...extracted,
    imageUrl: localImg,
    sourceUrl: url,
    favorite: false,
  };
}

async function normalizeIngredientsWithGemini(
  apiKey: string,
  lines: string[]
): Promise<RecipeIngredient[]> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Parse these recipe ingredient strings into clean shopping list objects:\n${JSON.stringify(lines)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Clean grocery item name, e.g. Chicken Breasts' },
            quantity: { type: Type.NUMBER, nullable: true },
            unit: { type: Type.STRING, description: 'Unit like lbs, cup, tbsp, or empty string' },
            notes: { type: Type.STRING, description: 'Prep notes like diced, softened, or empty string' },
            category: {
              type: Type.STRING,
              enum: GROCERY_CATEGORIES,
            },
          },
          required: ['name', 'unit', 'notes', 'category'],
        },
      },
    },
  });

  const parsed = JSON.parse(response.text || '[]') as RecipeIngredient[];
  return parsed.map((ing) => ({
    name: ing.name || 'Ingredient',
    quantity: typeof ing.quantity === 'number' ? Math.round(ing.quantity * 100) / 100 : null,
    unit: ing.unit || '',
    notes: ing.notes || '',
    category: GROCERY_CATEGORIES.includes(ing.category)
      ? ing.category
      : classifyGroceryItem(ing.name || ''),
  }));
}

async function extractRecipeWithGeminiFromText(
  apiKey: string,
  text: string
): Promise<Omit<Recipe, 'id' | 'createdAt' | 'imageUrl' | 'sourceUrl' | 'favorite'>> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Extract ONLY the recipe from the webpage text below. Strip all blog stories, ads, and commentary.\n\n${text}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepMinutes: { type: Type.INTEGER, nullable: true },
          cookMinutes: { type: Type.INTEGER, nullable: true },
          servings: { type: Type.INTEGER, nullable: true },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                quantity: { type: Type.NUMBER, nullable: true },
                unit: { type: Type.STRING },
                notes: { type: Type.STRING },
                category: { type: Type.STRING, enum: GROCERY_CATEGORIES },
              },
              required: ['name', 'unit', 'notes', 'category'],
            },
          },
          instructions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'description', 'tags', 'ingredients', 'instructions'],
      },
    },
  });

  return JSON.parse(response.text || '{}');
}

export async function searchOrGenerateMealsWithGemini(
  query: string
): Promise<Omit<Recipe, 'id' | 'createdAt'>[]> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Configure your Gemini API Key in Settings to use AI Meal Search & Recipe Discovery.');
  }
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `The user is searching for family meals matching: "${query}".
Return 3 practical, delicious, well-tested home-cooked recipes with exact ingredient quantities and clear step-by-step instructions (no fluff).`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            prepMinutes: { type: Type.INTEGER },
            cookMinutes: { type: Type.INTEGER },
            servings: { type: Type.INTEGER },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            ingredients: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quantity: { type: Type.NUMBER, nullable: true },
                  unit: { type: Type.STRING },
                  notes: { type: Type.STRING },
                  category: { type: Type.STRING, enum: GROCERY_CATEGORIES },
                },
                required: ['name', 'unit', 'notes', 'category'],
              },
            },
            instructions: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['title', 'description', 'prepMinutes', 'cookMinutes', 'servings', 'tags', 'ingredients', 'instructions'],
        },
      },
    },
  });

  const items = JSON.parse(response.text || '[]') as Array<
    Omit<Recipe, 'id' | 'createdAt' | 'imageUrl' | 'sourceUrl' | 'favorite'>
  >;
  return items.map((r) => ({
    ...r,
    imageUrl: null,
    sourceUrl: null,
    favorite: false,
  }));
}

/**
 * Flexible JSON Seed Importer for Phase 3:
 * Accepts `[...]`, `{ meals: [...] }`, or `{ recipes: [...] }` with flexible property names.
 */
export function importMealsSeedJson(payload: unknown): { imported: number; ids: string[] } {
  let rawList: unknown[] = [];
  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.meals)) rawList = obj.meals;
    else if (Array.isArray(obj.recipes)) rawList = obj.recipes;
    else if (Array.isArray(obj.items)) rawList = obj.items;
    else rawList = [obj];
  }

  const nowIso = new Date().toISOString();
  const ids: string[] = [];

  const insertStmt = db.prepare(`
    INSERT INTO recipes (
      id, title, description, image_url, source_url, prep_minutes, cook_minutes, servings,
      tags_json, ingredients_json, instructions_json, favorite, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  runTransaction(() => {
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const title = String(item.title || item.name || item.meal || '').trim();
      if (!title) continue;

      const description = String(item.description || item.summary || item.notes || '').trim();
      const imageUrl =
        typeof (item.imageUrl || item.image || item.photo || item.thumbnail) === 'string'
          ? String(item.imageUrl || item.image || item.photo || item.thumbnail)
          : null;
      const sourceUrl =
        typeof (item.sourceUrl || item.url || item.link) === 'string'
          ? String(item.sourceUrl || item.url || item.link)
          : null;

      const prepMinutes = parseIsoDurationMinutes(item.prepMinutes ?? item.prepTime ?? item.prep_time);
      const cookMinutes = parseIsoDurationMinutes(item.cookMinutes ?? item.cookTime ?? item.cook_time);
      const servings = parseIsoDurationMinutes(item.servings ?? item.yield) ?? 4;

      let tags: string[] = [];
      if (Array.isArray(item.tags)) tags = item.tags.map((t) => String(t).trim()).filter(Boolean);
      else if (typeof item.category === 'string') tags = [item.category.trim()];

      let ingredients: RecipeIngredient[] = [];
      const rawIngs = item.ingredients ?? item.items;
      if (Array.isArray(rawIngs)) {
        ingredients = rawIngs.map((ing): RecipeIngredient => {
          if (typeof ing === 'string') return parseIngredientLine(ing);
          if (ing && typeof ing === 'object') {
            const io = ing as Record<string, unknown>;
            const name = String(io.name || io.item || io.ingredient || 'Item').trim();
            const qty =
              typeof io.quantity === 'number'
                ? io.quantity
                : typeof io.amount === 'number'
                ? io.amount
                : io.quantity
                ? Number(io.quantity) || null
                : null;
            const unit = String(io.unit || '').trim();
            const notes = String(io.notes || io.prep || '').trim();
            const cat =
              typeof io.category === 'string' &&
              GROCERY_CATEGORIES.includes(io.category as GroceryCategory)
                ? (io.category as GroceryCategory)
                : classifyGroceryItem(name);
            return { name, quantity: qty, unit, notes, category: cat };
          }
          return parseIngredientLine(String(ing));
        });
      }

      let instructions: string[] = [];
      const rawSteps = item.instructions ?? item.steps ?? item.directions;
      if (Array.isArray(rawSteps)) {
        instructions = rawSteps
          .map((s) =>
            typeof s === 'string'
              ? s.trim()
              : s && typeof s === 'object' && 'text' in s
              ? String((s as { text: unknown }).text).trim()
              : ''
          )
          .filter(Boolean);
      } else if (typeof rawSteps === 'string') {
        instructions = rawSteps
          .split(/\n+/)
          .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
          .filter(Boolean);
      }

      const id = crypto.randomUUID();
      insertStmt.run(
        id,
        title,
        description,
        imageUrl,
        sourceUrl,
        prepMinutes,
        cookMinutes,
        servings,
        JSON.stringify(tags),
        JSON.stringify(ingredients),
        JSON.stringify(instructions),
        item.favorite ? 1 : 0,
        nowIso
      );
      ids.push(id);
    }
  });

  return { imported: ids.length, ids };
}
