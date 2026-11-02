import test from 'node:test';
import assert from 'node:assert/strict';
import { pairPhotos, isWithinNightHours } from '../../src/client/views/ScreensaverOverlay.js';
import type { PhotoItem } from '../../src/shared/types.js';

function makePhoto(id: string, orientation: 'portrait' | 'landscape'): PhotoItem {
  return {
    id,
    url: `http://localhost/photo-${id}.jpg`,
    orientation,
    caption: `Photo ${id}`,
    source: 'upload',
    createdAt: new Date().toISOString(),
  };
}

test('Challenger 2 - Task 1: Adversarial testing of pairPhotos', async (t) => {
  await t.test('Edge case: 0 photos (empty array, null, undefined)', () => {
    assert.deepEqual(pairPhotos([]), []);
    // @ts-expect-error test invalid inputs
    assert.deepEqual(pairPhotos(null), []);
    // @ts-expect-error test invalid inputs
    assert.deepEqual(pairPhotos(undefined), []);
  });

  await t.test('Edge case: 1 portrait photo', () => {
    const p0 = makePhoto('p0', 'portrait');
    const result = pairPhotos([p0]);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 1);
    assert.equal(result[0][0].id, 'p0');
  });

  await t.test('Edge case: 2 portraits', () => {
    const p0 = makePhoto('p0', 'portrait');
    const p1 = makePhoto('p1', 'portrait');
    const result = pairPhotos([p0, p1]);
    assert.equal(result.length, 1);
    assert.equal(result[0].length, 2);
    assert.equal(result[0][0].id, 'p0');
    assert.equal(result[0][1].id, 'p1');
  });

  await t.test('Edge case: 3 portraits (must pair [P0, P1], [P2, P0] circular wrap-around)', () => {
    const p0 = makePhoto('p0', 'portrait');
    const p1 = makePhoto('p1', 'portrait');
    const p2 = makePhoto('p2', 'portrait');
    const result = pairPhotos([p0, p1, p2]);
    assert.equal(result.length, 2);

    // Slide 0: [p0, p1]
    assert.equal(result[0].length, 2);
    assert.equal(result[0][0].id, 'p0');
    assert.equal(result[0][1].id, 'p1');

    // Slide 1: [p2, p0] circular wrap-around
    assert.equal(result[1].length, 2);
    assert.equal(result[1][0].id, 'p2');
    assert.equal(result[1][1].id, 'p0');
  });

  await t.test('Edge case: 5 portraits (circular wrap-around: [P0, P1], [P2, P3], [P4, P0])', () => {
    const photos = [0, 1, 2, 3, 4].map((i) => makePhoto(`p${i}`, 'portrait'));
    const result = pairPhotos(photos);
    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((s) => s.map((p) => p.id)),
      [
        ['p0', 'p1'],
        ['p2', 'p3'],
        ['p4', 'p0'],
      ]
    );
  });

  await t.test('Edge case: mixed portraits and landscapes (interleaving check)', () => {
    const l0 = makePhoto('l0', 'landscape');
    const l1 = makePhoto('l1', 'landscape');
    const p0 = makePhoto('p0', 'portrait');
    const p1 = makePhoto('p1', 'portrait');
    const p2 = makePhoto('p2', 'portrait');

    // Landscapes: [l0, l1] -> 2 slides
    // Portraits: [p0, p1, p2] -> paired to [[p0, p1], [p2, p0]] -> 2 slides
    // Interleaved: [l0], [p0, p1], [l1], [p2, p0]
    const result = pairPhotos([l0, p0, l1, p1, p2]);
    assert.equal(result.length, 4);
    assert.deepEqual(
      result.map((s) => s.map((p) => p.id)),
      [['l0'], ['p0', 'p1'], ['l1'], ['p2', 'p0']]
    );
  });

  await t.test('Edge case: mixed with unequal landscapes and portraits', () => {
    const l0 = makePhoto('l0', 'landscape');
    const l1 = makePhoto('l1', 'landscape');
    const l2 = makePhoto('l2', 'landscape');
    const p0 = makePhoto('p0', 'portrait');

    // 3 landscapes, 1 lone portrait
    const result = pairPhotos([l0, l1, l2, p0]);
    assert.equal(result.length, 4);
    assert.deepEqual(
      result.map((s) => s.map((p) => p.id)),
      [['l0'], ['p0'], ['l1'], ['l2']]
    );
  });

  await t.test('Edge case: 100 portraits', () => {
    const photos = Array.from({ length: 100 }, (_, i) => makePhoto(`p${i}`, 'portrait'));
    const result = pairPhotos(photos);
    assert.equal(result.length, 50, '100 portraits should result in exactly 50 paired slides');
    for (let i = 0; i < 50; i++) {
      assert.equal(result[i].length, 2);
      assert.equal(result[i][0].id, `p${i * 2}`);
      assert.equal(result[i][1].id, `p${i * 2 + 1}`);
    }
  });

  await t.test('Edge case: 101 portraits (stressing odd circular wrap at scale)', () => {
    const photos = Array.from({ length: 101 }, (_, i) => makePhoto(`p${i}`, 'portrait'));
    const result = pairPhotos(photos);
    assert.equal(result.length, 51, '101 portraits should result in 51 paired slides');
    // Check last pair is [p100, p0]
    assert.equal(result[50][0].id, 'p100');
    assert.equal(result[50][1].id, 'p0');
  });

  await t.test('Edge case: only landscapes', () => {
    const l0 = makePhoto('l0', 'landscape');
    const l1 = makePhoto('l1', 'landscape');
    const result = pairPhotos([l0, l1]);
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((s) => s.map((p) => p.id)),
      [['l0'], ['l1']]
    );
  });
});

test('Challenger 2 - Task 2: Adversarial testing of isWithinNightHours', async (t) => {
  const createDate = (hour: number, minute: number) => {
    const d = new Date(2026, 9, 30, hour, minute, 0, 0);
    return d;
  };

  await t.test('Standard range 22:00 - 06:30 across midnight', () => {
    // Before night hours
    assert.equal(isWithinNightHours(createDate(21, 59), '22:00', '06:30'), false);
    assert.equal(isWithinNightHours(createDate(14, 0), '22:00', '06:30'), false);
    assert.equal(isWithinNightHours(createDate(20, 30), '22:00', '06:30'), false);

    // Exact start boundary
    assert.equal(isWithinNightHours(createDate(22, 0), '22:00', '06:30'), true);
    assert.equal(isWithinNightHours(createDate(22, 1), '22:00', '06:30'), true);
    assert.equal(isWithinNightHours(createDate(23, 59), '22:00', '06:30'), true);

    // Midnight transition and early morning
    assert.equal(isWithinNightHours(createDate(0, 0), '22:00', '06:30'), true);
    assert.equal(isWithinNightHours(createDate(3, 45), '22:00', '06:30'), true);
    assert.equal(isWithinNightHours(createDate(6, 29), '22:00', '06:30'), true);

    // Exact end boundary
    assert.equal(isWithinNightHours(createDate(6, 30), '22:00', '06:30'), false);
    assert.equal(isWithinNightHours(createDate(6, 31), '22:00', '06:30'), false);
    assert.equal(isWithinNightHours(createDate(7, 0), '22:00', '06:30'), false);
  });

  await t.test('Inverted / daytime range 08:00 - 17:00 (non-crossing midnight)', () => {
    // Before start
    assert.equal(isWithinNightHours(createDate(7, 59), '08:00', '17:00'), false);
    assert.equal(isWithinNightHours(createDate(0, 0), '08:00', '17:00'), false);
    assert.equal(isWithinNightHours(createDate(23, 0), '08:00', '17:00'), false);

    // Inside range
    assert.equal(isWithinNightHours(createDate(8, 0), '08:00', '17:00'), true);
    assert.equal(isWithinNightHours(createDate(12, 30), '08:00', '17:00'), true);
    assert.equal(isWithinNightHours(createDate(16, 59), '08:00', '17:00'), true);

    // At or after end
    assert.equal(isWithinNightHours(createDate(17, 0), '08:00', '17:00'), false);
    assert.equal(isWithinNightHours(createDate(17, 1), '08:00', '17:00'), false);
    assert.equal(isWithinNightHours(createDate(21, 0), '08:00', '17:00'), false);
  });

  await t.test('Null, undefined, and empty string handling (defaults to 22:00 - 06:30)', () => {
    // Default range is 22:00 to 06:30
    assert.equal(isWithinNightHours(createDate(23, 0), null, null), true);
    assert.equal(isWithinNightHours(createDate(12, 0), null, null), false);

    assert.equal(isWithinNightHours(createDate(23, 0), undefined, undefined), true);
    assert.equal(isWithinNightHours(createDate(12, 0), undefined, undefined), false);

    assert.equal(isWithinNightHours(createDate(23, 0), '', ''), true);
    assert.equal(isWithinNightHours(createDate(12, 0), '', ''), false);

    assert.equal(isWithinNightHours(createDate(23, 0), '   ', '   '), true);
    assert.equal(isWithinNightHours(createDate(12, 0), '   ', '   '), false);

    // Partial null/undefined with one explicit value
    assert.equal(isWithinNightHours(createDate(6, 45), null, '07:00'), true);
    assert.equal(isWithinNightHours(createDate(7, 15), null, '07:00'), false);
    assert.equal(isWithinNightHours(createDate(21, 30), '21:00', undefined), true);
    assert.equal(isWithinNightHours(createDate(20, 30), '21:00', undefined), false);
  });

  await t.test('Boundary edge case: start == end (0-length window)', () => {
    // 08:00 to 08:00
    assert.equal(isWithinNightHours(createDate(8, 0), '08:00', '08:00'), false);
    assert.equal(isWithinNightHours(createDate(8, 1), '08:00', '08:00'), false);
    assert.equal(isWithinNightHours(createDate(12, 0), '08:00', '08:00'), false);
  });

  await t.test('Boundary edge case: full day 00:00 to 23:59', () => {
    assert.equal(isWithinNightHours(createDate(0, 0), '00:00', '23:59'), true);
    assert.equal(isWithinNightHours(createDate(12, 0), '00:00', '23:59'), true);
    assert.equal(isWithinNightHours(createDate(23, 58), '00:00', '23:59'), true);
    assert.equal(isWithinNightHours(createDate(23, 59), '00:00', '23:59'), false);
  });

  await t.test('Robustness against malformed strings', () => {
    // Malformed strings evaluate to 0:00 without throwing exceptions
    assert.doesNotThrow(() => {
      isWithinNightHours(createDate(12, 0), 'invalid', 'times');
    });
  });
});
