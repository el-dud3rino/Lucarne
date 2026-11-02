import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('examples/meals.sample.json imports every documented field form, and re-import skips duplicates', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-mealsjson-'));
  const { initSchema } = await import('../../src/server/db/schema.js');
  const { db } = await import('../../src/server/db/connection.js');
  const { importMealsSeedJson } = await import('../../src/server/services/recipes.js');
  initSchema();

  const sample = JSON.parse(fs.readFileSync(path.resolve('examples/meals.sample.json'), 'utf8'));
  const first = importMealsSeedJson(sample);
  assert.equal(first.imported, 3);
  assert.equal(first.skipped, 0);

  const byTitle = (t: string) => {
    const r = db.prepare('SELECT * FROM recipes WHERE title = ?').get(t) as any;
    assert.ok(r, `${t} imported`);
    return { ...r, ingredients: JSON.parse(r.ingredients_json), steps: JSON.parse(r.instructions_json), tags: JSON.parse(r.tags_json) };
  };

  // Object ingredients, numeric minutes, tags, favorite
  const chicken = byTitle('Sheet Pan Lemon Herb Chicken');
  assert.equal(chicken.prep_minutes, 15);
  assert.equal(chicken.cook_minutes, 40);
  assert.equal(chicken.servings, 4);
  assert.equal(chicken.favorite, 1);
  assert.deepEqual(chicken.tags, ['dinner', 'sheet pan', 'kid-friendly']);
  assert.equal(chicken.ingredients.length, 6);
  assert.deepEqual(
    { name: chicken.ingredients[0].name, quantity: chicken.ingredients[0].quantity, unit: chicken.ingredients[0].unit, category: chicken.ingredients[0].category },
    { name: 'boneless chicken thighs', quantity: 2, unit: 'lb', category: 'Meat & Seafood' }
  );
  assert.equal(chicken.steps.length, 4);

  // Alternate keys: name/summary/url, ISO durations, "6 servings", string ingredients, numbered step text
  const soup = byTitle('Slow Cooker Black Bean Soup');
  assert.equal(soup.description, 'Set it in the morning, top it at dinner.');
  assert.equal(soup.source_url, 'https://example.com/slow-cooker-black-bean-soup');
  assert.equal(soup.prep_minutes, 15);
  assert.equal(soup.cook_minutes, 360);
  assert.equal(soup.servings, 6);
  assert.deepEqual(soup.tags, ['soup']);
  assert.equal(soup.ingredients.length, 6);
  assert.equal(soup.ingredients[0].quantity, 3);
  assert.equal(soup.steps.length, 3);
  assert.ok(!/^\d/.test(soup.steps[0]), 'step numbers stripped');

  // Minimal recipe with {text} step objects
  const oats = byTitle('Overnight Oats');
  assert.equal(oats.steps.length, 2);
  assert.equal(oats.ingredients.length, 5);

  // Re-importing the same file creates no duplicates
  const second = importMealsSeedJson(sample);
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 3);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM recipes').get() as any).n, 3);

  // Re-importing with photos fills in a MISSING photo (downloaded locally) but never replaces one
  const http = await import('node:http');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]);
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    res.end(jpeg);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const img = `http://127.0.0.1:${(server.address() as any).port}/photo.jpg`;
  try {
    const { cacheRecipeImages } = await import('../../src/server/services/recipes.js');
    const chickenImgBefore = byTitle('Sheet Pan Lemon Herb Chicken').image_url;
    const third = importMealsSeedJson([
      { title: 'Overnight Oats', imageUrl: img },
      { title: 'Sheet Pan Lemon Herb Chicken', sourceUrl: 'https://example.com/sheet-pan-lemon-herb-chicken', imageUrl: img },
    ]);
    assert.equal(third.imported, 0);
    assert.equal(third.imagesAdded, 1, 'only the recipe without a photo gets one');
    assert.equal(await cacheRecipeImages(third.imageIds), 1);
    const oatsImg = byTitle('Overnight Oats').image_url as string;
    assert.match(oatsImg, /^\/media\/recipes\/.+\.jpg$/, 'photo saved locally');
    assert.ok(fs.existsSync(path.join(process.env.DATA_DIR!, oatsImg.replace(/^\//, ''))));
    assert.equal(byTitle('Sheet Pan Lemon Herb Chicken').image_url, chickenImgBefore, 'existing photo kept');
  } finally {
    server.close();
  }
});
