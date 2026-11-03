import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../db/connection.js';
import { generateWithCurrentModel, getGeminiApiKey } from './recipes.js';
import { localDateStr } from '../../shared/chores.js';

/**
 * "Plan my week": fills empty dinner slots ONLY with recipes already saved in Lucarne (never
 * invented ones). Gemini picks for variety and the family's notes ("no fish", "quick on Tuesdays");
 * without a Gemini key, a simple rotation is used (favorites first, least recently planned first).
 */

export interface PlannedDinner {
  dateStr: string;
  recipeId: string;
  title: string;
  reason: string;
}

interface RecipeLite {
  id: string;
  title: string;
  tags: string[];
  favorite: boolean;
  totalMinutes: number | null;
  lastPlanned: string | null;
}

function shift(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

export function emptyDinnerDates(startDate: string, days: number): string[] {
  const dates = Array.from({ length: days }, (_, i) => shift(startDate, i));
  const planned = new Set(
    (
      db
        .prepare("SELECT date_str FROM meal_plans WHERE slot = 'dinner' AND date_str >= ? AND date_str <= ?")
        .all(dates[0], dates[dates.length - 1]) as Array<{ date_str: string }>
    ).map((r) => r.date_str)
  );
  return dates.filter((d) => !planned.has(d));
}

function loadRecipes(): RecipeLite[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.title, r.tags_json, r.favorite, r.prep_minutes, r.cook_minutes,
              (SELECT MAX(date_str) FROM meal_plans m WHERE m.recipe_id = r.id) AS last_planned
         FROM recipes r ORDER BY r.favorite DESC, r.title`
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => {
    let tags: string[] = [];
    try {
      tags = JSON.parse(String(r.tags_json || '[]'));
    } catch {
      tags = [];
    }
    const prep = r.prep_minutes == null ? null : Number(r.prep_minutes);
    const cook = r.cook_minutes == null ? null : Number(r.cook_minutes);
    return {
      id: String(r.id),
      title: String(r.title),
      tags: Array.isArray(tags) ? tags.slice(0, 6) : [],
      favorite: Boolean(r.favorite),
      totalMinutes: prep == null && cook == null ? null : (prep ?? 0) + (cook ?? 0),
      lastPlanned: r.last_planned ? String(r.last_planned) : null,
    };
  });
}

/** No-AI plan: favorites first, then whatever hasn't been cooked in the longest time; no repeats. */
export function rotationPlan(dates: string[], recipes: RecipeLite[]): PlannedDinner[] {
  const ranked = [...recipes].sort(
    (a, b) =>
      (a.lastPlanned ?? '').localeCompare(b.lastPlanned ?? '') || Number(b.favorite) - Number(a.favorite) || a.title.localeCompare(b.title)
  );
  return dates.slice(0, ranked.length).map((dateStr, i) => ({
    dateStr,
    recipeId: ranked[i].id,
    title: ranked[i].title,
    reason: ranked[i].lastPlanned ? `Last planned ${ranked[i].lastPlanned}` : ranked[i].favorite ? 'A favorite' : 'Not planned yet',
  }));
}

/** Keeps only valid picks: a requested date, a saved recipe, no recipe twice. Exported for tests. */
export function validatePlan(raw: unknown, dates: string[], recipes: Array<Pick<RecipeLite, 'id' | 'title'>>): PlannedDinner[] {
  const list = Array.isArray((raw as { dinners?: unknown })?.dinners) ? (raw as { dinners: unknown[] }).dinners : [];
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const allowed = new Set(dates);
  const usedDates = new Set<string>();
  const usedRecipes = new Set<string>();
  const out: PlannedDinner[] = [];
  for (const item of list) {
    const r = item as Record<string, unknown>;
    const dateStr = String(r?.date ?? '');
    const recipe = byId.get(String(r?.recipeId ?? ''));
    if (!recipe || !allowed.has(dateStr) || usedDates.has(dateStr) || usedRecipes.has(recipe.id)) continue;
    usedDates.add(dateStr);
    usedRecipes.add(recipe.id);
    out.push({ dateStr, recipeId: recipe.id, title: recipe.title, reason: String(r?.reason ?? '').slice(0, 120) });
  }
  return out.sort((a, b) => a.dateStr.localeCompare(b.dateStr));
}

export async function planDinners(startDate: string, days: number, notes: string): Promise<{ dinners: PlannedDinner[]; usedAi: boolean; aiError?: string }> {
  const dates = emptyDinnerDates(startDate, Math.max(1, Math.min(14, days)));
  const recipes = loadRecipes();
  if (dates.length === 0) return { dinners: [], usedAi: false };
  if (recipes.length === 0) throw new Error('Save a few recipes first — the planner only picks from your own recipes.');

  const apiKey = getGeminiApiKey();
  if (!apiKey) return { dinners: rotationPlan(dates, recipes), usedAi: false };

  const catalog = recipes
    .slice(0, 300)
    .map(
      (r) =>
        `${r.id} | ${r.title}${r.tags.length ? ` | ${r.tags.join(', ')}` : ''}${r.totalMinutes ? ` | ${r.totalMinutes} min` : ''}${
          r.favorite ? ' | favorite' : ''
        }${r.lastPlanned ? ` | last planned ${r.lastPlanned}` : ''}`
    )
    .join('\n');
  const dayList = dates.map((d) => `${d} (${new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })})`).join(', ');
  const prompt = [
    `Plan family dinners for these dates: ${dayList}.`,
    'Choose ONLY from the saved recipes below (use their exact id). Never invent a recipe. Use each recipe at most once.',
    'Aim for variety (different proteins and cuisines on consecutive nights), prefer favorites and recipes not planned recently,',
    'and put quicker recipes on weeknights. Give a short reason for each pick (under 10 words).',
    notes.trim() ? `Family notes (follow these): ${notes.trim().slice(0, 500)}` : '',
    'If there are fewer suitable recipes than dates, leave the rest out.',
    `\nSaved recipes (id | title | tags | time | notes):\n${catalog}`,
  ].join(' ');

  const ai = new GoogleGenAI({ apiKey });
  let response: { text: string };
  try {
    response = await generateWithCurrentModel(
    ai,
    {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            dinners: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  date: { type: Type.STRING },
                  recipeId: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['date', 'recipeId'],
              },
            },
          },
          required: ['dinners'],
        },
      },
    },
    'light'
    );
  } catch (err) {
    // Gemini busy / out of free quota: still give a plan from the simple rotation.
    return { dinners: rotationPlan(dates, recipes), usedAi: false, aiError: err instanceof Error ? err.message : String(err) };
  }
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(response.text || '{}');
  } catch {
    parsed = {};
  }
  const dinners = validatePlan(parsed, dates, recipes);
  return { dinners: dinners.length ? dinners : rotationPlan(dates, recipes), usedAi: dinners.length > 0 };
}
