import test from 'node:test';
import assert from 'node:assert/strict';
import { addressKey, effectiveTravelMinutes, isFullAddress } from '../../src/shared/driveTime.js';

test('full addresses: street number or ZIP; not names, links or empty', () => {
  for (const a of ['4321 Lincoln Rd, Springfield, IL', 'Bright Smiles Dental, 4321 Lincoln Rd, Springfield, IL 62701', 'Springfield, IL 62701', '12B Baker St, London'])
    assert.equal(isFullAddress(a), true, a);
  for (const a of ["Grandma's house", 'Oak Elementary', 'Home', '', 'https://zoom.us/j/12345 Meeting', 'Room 101'])
    assert.equal(isFullAddress(a), false, a);
});

test('manual override wins; 0 means no drive; null means automatic', () => {
  assert.equal(effectiveTravelMinutes(15, 21), 15);
  assert.equal(effectiveTravelMinutes(0, 21), null);
  assert.equal(effectiveTravelMinutes(null, 21), 21);
  assert.equal(effectiveTravelMinutes(null, null), null);
  assert.equal(addressKey('  4321 Lincoln  Rd '), '4321 lincoln rd');
});
