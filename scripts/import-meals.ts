import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../src/server/db/schema.js';
import { cacheRecipeImages, importMealsSeedJson } from '../src/server/services/recipes.js';

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: npm run import:meals -- <path-to-meals.json>');
  process.exit(1);
}

const resolved = path.resolve(fileArg);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(1);
}

initSchema();
const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
const res = importMealsSeedJson(raw);
const imagesCached = await cacheRecipeImages(res.imageIds);
const notes = [
  res.skipped ? `skipped ${res.skipped} already in the library` : '',
  res.imagesAdded ? `added photos to ${res.imagesAdded} existing recipe(s)` : '',
  res.imageIds.length ? `saved ${imagesCached} of ${res.imageIds.length} photo(s) locally` : '',
].filter(Boolean);
console.log(`✅ Imported ${res.imported} meal(s)${notes.length ? ` (${notes.join(', ')})` : ''}.`);
