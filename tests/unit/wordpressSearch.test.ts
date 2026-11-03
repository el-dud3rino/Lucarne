import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-unit-wp-'));
const { rankByTitleMatch, wordpressRecipeLinks } = await import('../../src/server/services/recipes.js');

test('blog search: interleaves sites, skips failing/non-JSON sites, keeps only http(s) links', async () => {
  const seen: string[] = [];
  const fetchFn = (async (url: string) => {
    seen.push(url);
    const host = new URL(url).hostname;
    if (host === 'a.test')
      return Response.json([
        { title: 'A1', url: 'https://a.test/1' },
        { title: 'A2', url: 'https://a.test/2' },
      ]);
    if (host === 'b.test') return Response.json([{ title: 'B1', url: 'https://b.test/1' }, { title: 'bad', url: 'javascript:x' }]);
    if (host === 'c.test') return new Response('blocked', { status: 403 });
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const links = await wordpressRecipeLinks('chicken tacos', { fetchFn, sites: ['a.test', 'b.test', 'c.test', 'd.test'] });
  assert.deepEqual(links.map((l) => l.url), ['https://a.test/1', 'https://b.test/1', 'https://a.test/2']);
  assert.match(seen[0], /\/wp-json\/wp\/v2\/search\?search=chicken%20tacos&per_page=3&type=post/);
});

test('title matches rank first; filler words like "easy" do not count; ties keep site order', () => {
  const links = [
    { title: 'Chicken with Cajun Sauce', url: 'https://a.test/cajun-chicken' },
    { title: 'Our Easy Chilli Crisp', url: 'https://b.test/chilli-crisp' },
    { title: 'Shredded Chicken Tacos', url: 'https://c.test/shredded-chicken-tacos' },
    { title: 'Crispy Chicken Taco', url: 'https://d.test/crispy-taco' },
  ];
  assert.deepEqual(
    rankByTitleMatch('easy chicken tacos', links).map((l) => l.title),
    ['Shredded Chicken Tacos', 'Crispy Chicken Taco', 'Chicken with Cajun Sauce', 'Our Easy Chilli Crisp']
  );
});
