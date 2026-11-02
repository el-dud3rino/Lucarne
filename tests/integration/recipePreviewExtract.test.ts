import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

test('Recipe verification (preview mode): real page data only, follows redirects, saves nothing', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-preview-'));
  process.env.DATA_DIR = dataDir;
  const jsonLdPage = fs.readFileSync(path.resolve('tests/fixtures/recipe_jsonld_ads.html'), 'utf8');
  const plainPage = fs.readFileSync(path.resolve('tests/fixtures/recipe_unstructured.html'), 'utf8');
  let base = '';
  const server = http.createServer((req, res) => {
    if (req.url === '/go') {
      res.writeHead(302, { Location: `${base}/recipe#jump` });
      return res.end();
    }
    if (req.url === '/recipe') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(jsonLdPage);
    }
    if (req.url === '/plain') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(plainPage);
    }
    if (req.url === '/blocked') {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    initSchema();
    const { extractRecipeFromUrl } = await import('../../src/server/services/recipes.js');
    const mediaDir = path.join(dataDir, 'media', 'recipes');
    const filesBefore = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).length : 0;

    // A link that redirects to a real recipe page is verified and reports the page's real address
    const r = await extractRecipeFromUrl(`${base}/go`, { preview: true });
    assert.ok(r.title, 'title from the page');
    assert.ok(r.ingredients.length > 0 && r.instructions.length > 0, 'real ingredients and steps');
    assert.equal(r.sourceUrl, `${base}/recipe`, 'final address after redirect, without #fragment');
    assert.ok(!r.imageUrl || r.imageUrl.startsWith('http'), 'photo stays a remote link in preview');
    const filesAfter = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).length : 0;
    assert.equal(filesAfter, filesBefore, 'nothing written to disk while previewing');

    // Pages without real recipe data, missing pages and blocked sites are rejected (never guessed)
    await assert.rejects(extractRecipeFromUrl(`${base}/plain`, { preview: true }), /No structured recipe data/);
    await assert.rejects(extractRecipeFromUrl(`${base}/missing`, { preview: true }), /\(404\)/);
    await assert.rejects(extractRecipeFromUrl(`${base}/blocked`, { preview: true }), /\(403\)/);
  } finally {
    server.close();
  }
});
