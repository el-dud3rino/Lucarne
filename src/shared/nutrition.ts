/** Per-serving nutrition. Values are approximate (from the recipe site, or estimated by Gemini). */
export interface RecipeNutrition {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 ? Math.round(value) : null;
  if (typeof value === 'string') {
    const m = value.replace(',', '').match(/(\d+(?:\.\d+)?)/);
    if (m) return Math.round(Number(m[1]));
  }
  return null;
}

/**
 * Accepts Lucarne's own shape ({ calories, proteinG, carbsG, fatG }) or schema.org NutritionInformation
 * ({ calories: "350 kcal", proteinContent: "25 g", carbohydrateContent, fatContent }). Null if empty.
 */
export function normalizeNutrition(raw: unknown): RecipeNutrition | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const n: RecipeNutrition = {
    calories: toNumber(o.calories ?? o.kcal ?? o.energy),
    proteinG: toNumber(o.proteinG ?? o.protein ?? o.proteinContent),
    carbsG: toNumber(o.carbsG ?? o.carbs ?? o.carbohydrates ?? o.carbohydrateContent),
    fatG: toNumber(o.fatG ?? o.fat ?? o.fatContent),
  };
  return Object.values(n).some((v) => v !== null) ? n : null;
}

/** Share of calories from each macro (4/4/9 kcal per gram), as whole percents. */
export function macroShares(n: RecipeNutrition): { protein: number; carbs: number; fat: number } | null {
  const p = (n.proteinG ?? 0) * 4;
  const c = (n.carbsG ?? 0) * 4;
  const f = (n.fatG ?? 0) * 9;
  const total = p + c + f;
  if (total <= 0) return null;
  // Largest-remainder rounding so the three shares always add up to exactly 100.
  const raw = [p, c, f].map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  let missing = 100 - out.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of byRemainder) {
    if (missing <= 0) break;
    out[i]++;
    missing--;
  }
  return { protein: out[0], carbs: out[1], fat: out[2] };
}
