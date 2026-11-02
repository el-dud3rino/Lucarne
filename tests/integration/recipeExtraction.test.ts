import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as cheerio from 'cheerio';
import { MockGemini } from '../mocks/mockGemini.js';

test('Recipe Extraction: JSON-LD with ads stripping, unstructured extraction, and JSON seed imports', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-recipes-'));
  process.env.DATA_DIR = tempDir;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { db } = await import('../../src/server/db/connection.js');
    const {
      parseIngredientLine,
      importMealsSeedJson,
    } = await import('../../src/server/services/recipes.js');

    initSchema();

    // 1. Cluttered Recipe HTML with JSON-LD and heavy advertising
    const fixtureJsonLdPath = path.resolve('tests/fixtures/recipe_jsonld_ads.html');
    const htmlCluttered = fs.readFileSync(fixtureJsonLdPath, 'utf-8');

    const t0 = performance.now();
    const $ = cheerio.load(htmlCluttered);

    let ldRecipe: any = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (ldRecipe) return;
      try {
        const parsed = JSON.parse($(el).contents().text());
        if (parsed['@type'] === 'Recipe') ldRecipe = parsed;
      } catch {
        // ignore
      }
    });

    const parseDuration = performance.now() - t0;
    assert.ok(parseDuration < 50, `Extraction must complete in under 50ms (took ${parseDuration.toFixed(2)}ms)`);
    assert.ok(ldRecipe, 'Must extract schema.org/Recipe JSON-LD');

    // Verify structured recipe data extracted cleanly
    assert.equal(ldRecipe.name, 'Rustic Apple Cinnamon Skillet Tart');
    assert.equal(ldRecipe.prepTime, 'PT20M');
    assert.equal(ldRecipe.cookTime, 'PT40M');
    assert.equal(ldRecipe.recipeYield, '6 servings');

    // Parse ingredients and verify grocery aisle classification
    const ingredients = ldRecipe.recipeIngredient.map(parseIngredientLine);
    assert.equal(ingredients.length, 7);

    const apples = ingredients.find((i: any) => i.name.toLowerCase().includes('apple'));
    assert.ok(apples, 'Apples must be present');
    assert.equal(apples.category, 'Produce');

    const butter = ingredients.find((i: any) => i.name.toLowerCase().includes('butter'));
    assert.ok(butter, 'Butter must be present');
    assert.equal(butter.category, 'Dairy & Eggs');

    const sugar = ingredients.find((i: any) => i.name.toLowerCase().includes('sugar'));
    assert.ok(sugar, 'Sugar must be present');
    assert.equal(sugar.category, 'Pantry');

    const pastry = ingredients.find((i: any) => i.name.toLowerCase().includes('pastry'));
    assert.ok(pastry, 'Puff pastry must be present');
    assert.ok(pastry.category === 'Bakery' || pastry.category === 'Other');

    // Verify instructions
    assert.ok(Array.isArray(ldRecipe.recipeInstructions));
    assert.equal(ldRecipe.recipeInstructions.length, 6);
    assert.ok(ldRecipe.recipeInstructions[0].text.includes('Preheat oven'));

    // Verify advertising and blog prose are NOT part of the recipe data
    assert.equal(typeof ldRecipe.name, 'string');
    assert.ok(!ldRecipe.name.includes('Buy Gourmet Baking Pans'));
    assert.ok(!ldRecipe.name.includes('A Love Letter to Autumn Apples'));

    // 2. Unstructured HTML Fixture Extraction via MockGemini
    const fixtureUnstructuredPath = path.resolve('tests/fixtures/recipe_unstructured.html');
    const htmlUnstructured = fs.readFileSync(fixtureUnstructuredPath, 'utf-8');
    const $u = cheerio.load(htmlUnstructured);

    $u('script, style, nav, footer, header, iframe, ads, .ad, .advertisement, .newsletter-signup').remove();
    const cleanBodyText = $u('body').text().replace(/\s+/g, ' ').trim();

    assert.ok(cleanBodyText.includes('Old Fashioned Beef Stew'));
    assert.ok(!cleanBodyText.includes('Ad: Subscribe to ButcherBox'));

    const geminiExtracted = MockGemini.mockExtractedRecipeFromText(cleanBodyText);
    assert.ok(geminiExtracted.title);
    assert.ok(geminiExtracted.ingredients.length > 0);
    assert.ok(geminiExtracted.instructions.length > 0);

    // 3. Import JSON Seed Format 1 (Standard Array)
    const seed1Path = path.resolve('tests/fixtures/meals_seed_format1.json');
    const seed1Data = JSON.parse(fs.readFileSync(seed1Path, 'utf-8'));

    const import1 = importMealsSeedJson(seed1Data);
    assert.equal(import1.imported, 2, 'Must import 2 recipes from seed format 1');
    assert.equal(import1.ids.length, 2);

    const recipe1 = db.prepare('SELECT * FROM recipes WHERE id = ?').get(import1.ids[0]) as any;
    assert.equal(recipe1.title, 'Mediterranean Lemon Herb Salmon');
    const ing1 = JSON.parse(recipe1.ingredients_json);
    assert.ok(ing1.some((i: any) => i.name.toLowerCase().includes('salmon')));

    // 4. Import JSON Seed Format 2 (Nested Object with custom keys: meal, items, directions, prep_time)
    const seed2Path = path.resolve('tests/fixtures/meals_seed_format2.json');
    const seed2Data = JSON.parse(fs.readFileSync(seed2Path, 'utf-8'));

    const import2 = importMealsSeedJson(seed2Data);
    assert.equal(import2.imported, 2, 'Must import 2 recipes from seed format 2');
    assert.equal(import2.ids.length, 2);

    const recipe2 = db.prepare('SELECT * FROM recipes WHERE id = ?').get(import2.ids[0]) as any;
    assert.equal(recipe2.title, 'Sunday Pot Roast & Carrots');
    assert.equal(recipe2.prep_minutes, 15);
    assert.equal(recipe2.cook_minutes, 180);
    const ing2 = JSON.parse(recipe2.ingredients_json);
    assert.ok(ing2.some((i: any) => i.name.toLowerCase().includes('chuck roast')));
    const inst2 = JSON.parse(recipe2.instructions_json);
    assert.ok(inst2.length >= 5);

    // 5. Total Imported Recipes in SQLite
    const totalInDb = db.prepare('SELECT COUNT(*) as c FROM recipes').get() as { c: number };
    assert.equal(totalInDb.c, 4, 'Must have 4 imported recipes in SQLite database');

    // 6. Culinary Mixed Number & Vulgar Fraction Parsing
    const parsedMixed = parseIngredientLine('1 1/2 cups flour');
    assert.equal(parsedMixed.quantity, 1.5, '1 1/2 must evaluate to 1.5');
    assert.equal(parsedMixed.unit, 'cups');
    assert.equal(parsedMixed.name, 'flour');
    assert.equal(parsedMixed.category, 'Pantry');

    const parsedVulgarMixed = parseIngredientLine('2 ¼ cups flour');
    assert.equal(parsedVulgarMixed.quantity, 2.25, '2 ¼ must evaluate to 2.25');
    assert.equal(parsedVulgarMixed.unit, 'cups');
    assert.equal(parsedVulgarMixed.name, 'flour');

    const parsedTsp = parseIngredientLine('1 ½ tsp salt');
    assert.equal(parsedTsp.quantity, 1.5, '1 ½ must evaluate to 1.5');
    assert.equal(parsedTsp.unit, 'tsp');
    assert.equal(parsedTsp.name, 'salt');

    const parsedStandalone = parseIngredientLine('¾ cup sugar');
    assert.equal(parsedStandalone.quantity, 0.75, '¾ must evaluate to 0.75');
    assert.equal(parsedStandalone.unit, 'cup');
    assert.equal(parsedStandalone.name, 'sugar');

    const parsedHyphenated = parseIngredientLine('1-1/2 cups warm water');
    assert.equal(parsedHyphenated.quantity, 1.5, '1-1/2 must evaluate to 1.5');
    assert.equal(parsedHyphenated.unit, 'cups');
    assert.equal(parsedHyphenated.name, 'warm water');

  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
