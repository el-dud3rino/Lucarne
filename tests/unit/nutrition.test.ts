import test from 'node:test';
import assert from 'node:assert/strict';
import { macroShares, normalizeNutrition } from '../../src/shared/nutrition.js';

test('accepts Gemini-style numbers', () => {
  assert.deepEqual(normalizeNutrition({ calories: 520, proteinG: 38, carbsG: 45, fatG: 18 }), {
    calories: 520,
    proteinG: 38,
    carbsG: 45,
    fatG: 18,
  });
});

test('accepts schema.org NutritionInformation text from recipe sites', () => {
  assert.deepEqual(
    normalizeNutrition({
      '@type': 'NutritionInformation',
      calories: '1,250 kcal',
      proteinContent: '25.4 g',
      carbohydrateContent: '30g',
      fatContent: '12 grams',
    }),
    { calories: 1250, proteinG: 25, carbsG: 30, fatG: 12 }
  );
});

test('missing or empty nutrition becomes null; partial data kept', () => {
  assert.equal(normalizeNutrition(null), null);
  assert.equal(normalizeNutrition({}), null);
  assert.equal(normalizeNutrition({ servingSize: '1 cup' }), null);
  assert.deepEqual(normalizeNutrition({ calories: '300 calories' }), { calories: 300, proteinG: null, carbsG: null, fatG: null });
});

test('macro shares use 4/4/9 kcal per gram', () => {
  // 25 g protein (100 kcal) + 50 g carbs (200 kcal) + 20 g fat (180 kcal) = 480 kcal -> 20.8 / 41.7 / 37.5 %
  const shares = macroShares({ calories: 480, proteinG: 25, carbsG: 50, fatG: 20 })!;
  assert.deepEqual(shares, { protein: 21, carbs: 42, fat: 37 });
  assert.equal(shares.protein + shares.carbs + shares.fat, 100, 'always sums to 100 (bar never overflows)');
  assert.equal(macroShares({ calories: 100, proteinG: null, carbsG: null, fatG: null }), null);
});

test('cooking times read naturally', async () => {
  const { formatMinutes } = await import('../../src/client/lib/time.js');
  assert.equal(formatMinutes(45), '45 min');
  assert.equal(formatMinutes(60), '1 h');
  assert.equal(formatMinutes(75), '1 h 15 min');
  assert.equal(formatMinutes(480), '8 h');
  assert.equal(formatMinutes(null), '—');
});
