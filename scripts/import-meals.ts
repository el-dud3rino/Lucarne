import fs from 'node:fs';
import path from 'node:path';
import { initSchema } from '../src/server/db/schema.js';
import { importMealsSeedJson } from '../src/server/services/recipes.js';

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
console.log(`✅ Imported ${res.imported} meals into Lucarne SQLite database!`);
