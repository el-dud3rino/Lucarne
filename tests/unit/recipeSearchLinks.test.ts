import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-unit-links-'));
const { parseCandidateLinks } = await import('../../src/server/services/recipes.js');

test('parses a JSON array of links, even inside a code fence with prose', () => {
  const reply = 'Here you go:\n```json\n[{"title":"Chili","url":"https://www.budgetbytes.com/chili/"},{"title":"Bad","url":"ftp://x"}]\n```';
  assert.deepEqual(parseCandidateLinks(reply), [{ title: 'Chili', url: 'https://www.budgetbytes.com/chili/' }]);
});

test('falls back to bare URLs when there is no JSON', () => {
  const reply = 'Try https://cookieandkate.com/best-lentil-soup-recipe/ and (https://www.recipetineats.com/chili-con-carne/).';
  assert.deepEqual(
    parseCandidateLinks(reply).map((c) => c.url),
    ['https://cookieandkate.com/best-lentil-soup-recipe/', 'https://www.recipetineats.com/chili-con-carne/']
  );
});

test('nothing usable -> empty list', () => {
  assert.deepEqual(parseCandidateLinks('Sorry, I cannot browse.'), []);
});
