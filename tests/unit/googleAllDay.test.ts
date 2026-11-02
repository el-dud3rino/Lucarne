import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// google.ts opens the database on import; point it at a throwaway directory first.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-unit-allday-'));
const { googleAllDayToLocal, localAllDayToGoogle } = await import('../../src/server/services/google.js');
const { eventOccursOnDay } = await import('../../src/client/lib/dates.js');

test('Google one-day all-day event (exclusive end) shows on exactly one day', () => {
  const { startIso, endIso } = googleAllDayToLocal('2026-10-15', '2026-10-16');
  assert.equal(startIso, '2026-10-15T00:00:00.000Z');
  assert.equal(endIso, '2026-10-15T23:59:59.000Z');
  const on = (d: number) => eventOccursOnDay(startIso, endIso, true, new Date(2026, 9, d, 12));
  assert.equal(on(14), false);
  assert.equal(on(15), true);
  assert.equal(on(16), false, 'must not leak onto the following day');
});

test('Google multi-day all-day event keeps its full inclusive span', () => {
  const { endIso } = googleAllDayToLocal('2026-12-24', '2026-12-27');
  assert.equal(endIso, '2026-12-26T23:59:59.000Z');
});

test('Google all-day across month/year boundary and missing end', () => {
  assert.equal(googleAllDayToLocal('2026-12-31', '2027-01-01').endIso, '2026-12-31T23:59:59.000Z');
  assert.equal(googleAllDayToLocal('2028-02-28', '2028-03-01').endIso, '2028-02-29T23:59:59.000Z');
  assert.equal(googleAllDayToLocal('2026-11-02').endIso, '2026-11-02T23:59:59.000Z');
});

test('Local all-day event is sent to Google with an exclusive end date', () => {
  assert.deepEqual(localAllDayToGoogle('2026-11-02T00:00:00.000Z', '2026-11-02T23:59:59.000Z'), {
    start: { date: '2026-11-02' },
    end: { date: '2026-11-03' },
  });
  assert.deepEqual(localAllDayToGoogle('2026-12-30T00:00:00.000Z', '2027-01-01T23:59:59.000Z'), {
    start: { date: '2026-12-30' },
    end: { date: '2027-01-02' },
  });
});

test('Round trip Google -> local -> Google is lossless', () => {
  for (const [s, e] of [['2026-11-02', '2026-11-03'], ['2026-12-24', '2026-12-27'], ['2028-02-28', '2028-03-01']]) {
    const local = googleAllDayToLocal(s, e);
    assert.deepEqual(localAllDayToGoogle(local.startIso, local.endIso), { start: { date: s }, end: { date: e } });
  }
});
