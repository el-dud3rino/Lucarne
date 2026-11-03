import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-unit-race-'));
const { raceGeminiModels } = await import('../../src/server/services/recipes.js');

type Behaviour =
  | { kind: 'ok'; firstChunkMs: number; doneMs: number }
  | { kind: 'silent' } // never answers (overloaded / stuck)
  | { kind: 'fail'; afterMs: number; message: string };

function fakeModels(spec: Record<string, Behaviour>) {
  const started: string[] = [];
  const aborted: string[] = [];
  const attempt = (model: string, signal: AbortSignal, onFirstChunk: () => void) =>
    new Promise<string>((resolve, reject) => {
      started.push(model);
      const b = spec[model];
      const timers: NodeJS.Timeout[] = [];
      signal.addEventListener('abort', () => {
        aborted.push(model);
        timers.forEach(clearTimeout);
        reject(signal.reason ?? new Error('aborted'));
      });
      if (b.kind === 'ok') {
        timers.push(setTimeout(onFirstChunk, b.firstChunkMs));
        timers.push(setTimeout(() => resolve(`result from ${model}`), b.doneMs));
      } else if (b.kind === 'fail') {
        timers.push(setTimeout(() => reject(new Error(b.message)), b.afterMs));
      }
    });
  return { attempt, started, aborted };
}

const fast = { hedgeAfterMs: 40, firstChunkTimeoutMs: 120, deadline: Date.now() + 5000 };
const BUSY = '{"error":{"code":503,"message":"high demand","status":"UNAVAILABLE"}}';

test('healthy first model: only one request is made', async () => {
  const f = fakeModels({ a: { kind: 'ok', firstChunkMs: 5, doneMs: 80 }, b: { kind: 'ok', firstChunkMs: 5, doneMs: 10 } });
  const result = await raceGeminiModels(['a', 'b'], f.attempt, fast);
  assert.equal(result, 'result from a');
  assert.deepEqual(f.started, ['a'], 'no hedge once the first model starts streaming');
});

test('silent first model: the next one starts after the hedge delay and wins; the slow one is cancelled', async () => {
  const busy: string[] = [];
  const good: string[] = [];
  const f = fakeModels({ a: { kind: 'silent' }, b: { kind: 'ok', firstChunkMs: 5, doneMs: 20 } });
  const result = await raceGeminiModels(['a', 'b'], f.attempt, { ...fast, onBusy: (m) => busy.push(m), onSuccess: (m) => good.push(m) });
  assert.equal(result, 'result from b');
  assert.deepEqual(f.started, ['a', 'b']);
  assert.ok(f.aborted.includes('a'), 'slow model cancelled');
  assert.deepEqual(good, ['b']);
});

test('busy (503) model is replaced immediately and marked busy', async () => {
  const busy: string[] = [];
  const f = fakeModels({ a: { kind: 'fail', afterMs: 5, message: BUSY }, b: { kind: 'ok', firstChunkMs: 5, doneMs: 10 } });
  const result = await raceGeminiModels(['a', 'b'], f.attempt, { ...fast, onBusy: (m) => busy.push(m) });
  assert.equal(result, 'result from b');
  assert.deepEqual(busy, ['a']);
});

test('stuck model (no output) is given up on and the next one used, even with one request at a time', async () => {
  const busy: string[] = [];
  const f = fakeModels({ a: { kind: 'silent' }, b: { kind: 'ok', firstChunkMs: 5, doneMs: 10 } });
  const result = await raceGeminiModels(['a', 'b'], f.attempt, {
    ...fast,
    hedgeAfterMs: 10_000,
    maxInFlight: 1,
    onBusy: (m) => busy.push(m),
  });
  assert.equal(result, 'result from b');
  assert.deepEqual(busy, ['a']);
});

test('the last model left is not abandoned for being slow: it gets until the deadline', async () => {
  // Under heavy load a working model can take longer than the stuck timeout just to start answering.
  const f = fakeModels({
    a: { kind: 'fail', afterMs: 5, message: BUSY },
    b: { kind: 'ok', firstChunkMs: 300, doneMs: 350 },
  });
  const result = await raceGeminiModels(['a', 'b'], f.attempt, { ...fast, maxInFlight: 1 });
  assert.equal(result, 'result from b');
  assert.deepEqual(f.aborted, []);
});

test('retired model is remembered; a non-retryable error (bad key) stops immediately', async () => {
  const retired: string[] = [];
  const f1 = fakeModels({
    a: { kind: 'fail', afterMs: 5, message: '{"error":{"code":404,"message":"is no longer available"}}' },
    b: { kind: 'ok', firstChunkMs: 5, doneMs: 10 },
  });
  assert.equal(await raceGeminiModels(['a', 'b'], f1.attempt, { ...fast, onRetired: (m) => retired.push(m) }), 'result from b');
  assert.deepEqual(retired, ['a']);

  const f2 = fakeModels({
    a: { kind: 'fail', afterMs: 5, message: 'API key not valid' },
    b: { kind: 'ok', firstChunkMs: 5, doneMs: 10 },
  });
  await assert.rejects(raceGeminiModels(['a', 'b'], f2.attempt, fast), /API key not valid/);
  assert.deepEqual(f2.started, ['a'], 'other models not tried');
});

test('everything busy: rejects with the last error', async () => {
  const f = fakeModels({ a: { kind: 'fail', afterMs: 5, message: BUSY }, b: { kind: 'fail', afterMs: 5, message: BUSY } });
  await assert.rejects(raceGeminiModels(['a', 'b'], f.attempt, fast), /high demand/);
});
