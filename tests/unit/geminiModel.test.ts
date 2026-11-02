import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-unit-gemini-'));
const { pickNewestFlashModel } = await import('../../src/server/services/recipes.js');

test('picks the newest stable Flash model, ignoring lite/preview/pro variants', () => {
  const names = [
    'models/gemini-2.5-flash',
    'models/gemini-2.5-pro',
    'models/gemini-3.8-flash',
    'models/gemini-3.8-flash-lite',
    'models/gemini-3.10-flash-preview',
    'models/gemini-3.9-flash',
    'models/text-embedding-004',
  ];
  assert.equal(pickNewestFlashModel(names), 'gemini-3.9-flash');
});

test('compares versions numerically (3.10 > 3.9) and skips retired models', () => {
  assert.equal(pickNewestFlashModel(['models/gemini-3.9-flash', 'models/gemini-3.10-flash']), 'gemini-3.10-flash');
  assert.equal(
    pickNewestFlashModel(['models/gemini-3.9-flash', 'models/gemini-3.10-flash'], new Set(['gemini-3.10-flash'])),
    'gemini-3.9-flash'
  );
  assert.equal(pickNewestFlashModel(['models/gemini-2.5-pro']), null);
});

test('Gemini errors become short, actionable messages', async () => {
  const { describeGeminiError } = await import('../../src/server/services/recipes.js');
  const busy = new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}');
  assert.match(describeGeminiError(busy), /^Gemini is busy right now/);
  assert.match(describeGeminiError(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}')), /free per-minute limit/);
  assert.match(
    describeGeminiError(new Error('{"error":{"code":429,"message":"Quota exceeded ... requests per day"}}')),
    /free daily limit is used up\. It resets at .+ \(midnight Pacific\)/
  );
  assert.match(describeGeminiError(new Error('API key not valid. Please pass a valid API key.')), /rejected the API key/);
  assert.match(
    describeGeminiError(new Error('{"error":{"code":404,"message":"This model models/gemini-2.5-flash is no longer available to new users."}}')),
    /no longer available/
  );
  assert.equal(describeGeminiError(new Error('{"error":{"code":400,"message":"Bad schema"}}')), 'Gemini error: Bad schema');
});

test('ranks stable Flash models newest-first for fallback', async () => {
  const { rankFlashModels } = await import('../../src/server/services/recipes.js');
  const names = ['models/gemini-3.6-flash', 'models/gemini-3.8-flash', 'models/gemini-3.8-flash-lite', 'models/gemini-3.7-flash', 'models/gemini-flash-latest'];
  assert.deepEqual(rankFlashModels(names), ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']);
});

test('model order: last working model first, busy ones last, out-of-quota models skipped', async () => {
  const { orderGeminiModels } = await import('../../src/server/services/recipes.js');
  const ranked = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.6-flash'];
  const now = 1_000_000;
  // Fresh start: preference order as given
  assert.deepEqual(orderGeminiModels(ranked, { now }), ranked);
  // 3.5-lite overloaded recently; 3.6 answered last time; 3.8 is out of daily quota
  const busy = new Map([['gemini-3.5-flash-lite', now + 60_000]]);
  const blocked = (m: string) => (m === 'gemini-3.8-flash' ? now + 3_600_000 : 0);
  assert.deepEqual(
    orderGeminiModels(ranked, { now, busyUntil: busy, blockedUntil: blocked, lastGood: 'gemini-3.6-flash' }),
    ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']
  );
  // Retired models never come back; everything blocked -> empty list
  assert.deepEqual(orderGeminiModels(ranked, { now, retired: new Set(ranked.slice(1)) }), ['gemini-3.5-flash-lite']);
  assert.deepEqual(orderGeminiModels(ranked, { now, blockedUntil: () => now + 1 }), []);
});

test('Lite models are ranked separately from full Flash models', async () => {
  const { rankLiteModels, rankFlashModels } = await import('../../src/server/services/recipes.js');
  const names = ['models/gemini-3.5-flash-lite', 'models/gemini-3.1-flash-lite', 'models/gemini-3.8-flash', 'models/gemini-3.8-flash-lite-tts', 'models/gemini-flash-lite-latest'];
  assert.deepEqual(rankLiteModels(names), ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  assert.deepEqual(rankFlashModels(names), ['gemini-3.8-flash']);
});
