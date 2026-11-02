import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planKeepSync,
  type KeepItemLink,
  type KeepListItem,
  type LocalListItem,
} from '../../src/server/services/keepMerge.js';

let n = 0;
const opts = { newLocalId: () => `new-${++n}` };
const local = (id: string, text: string, checked = false, quantity = ''): LocalListItem => ({ id, text, quantity, checked });
const keep = (id: string, text: string, checked = false): KeepListItem => ({ id, text, checked });
const link = (localId: string, keepId: string, text: string, checked = false): KeepItemLink => ({
  localId,
  keepId,
  lastKeepText: text,
  lastLocalText: text,
  lastChecked: checked,
});

test('first sync pairs matching items (case/space-insensitive) and creates the rest on each side', () => {
  const plan = planKeepSync(
    [local('l1', 'Milk'), local('l2', 'paper towels')],
    [keep('k1', 'milk '), keep('k2', 'eggs')],
    [],
    opts
  );
  assert.deepEqual(plan.keepOps, [{ op: 'create', tempId: 'tmp:l2', text: 'paper towels', checked: false }]);
  assert.equal(plan.localOps.length, 1);
  assert.deepEqual({ ...plan.localOps[0], localId: 'x' }, { op: 'create', localId: 'x', text: 'eggs', checked: false });
  assert.equal(plan.links.length, 3);
  assert.ok(plan.links.some((l) => l.localId === 'l1' && l.keepId === 'k1'), 'Milk paired, not duplicated');
});

test('first sync: an item needed on either side stays unchecked', () => {
  const plan = planKeepSync([local('l1', 'milk', true)], [keep('k1', 'milk', false)], [], opts);
  assert.deepEqual(plan.localOps, [{ op: 'update', localId: 'l1', text: null, checked: false }]);
  assert.deepEqual(plan.keepOps, []);
});

test('quantity is included in Keep text', () => {
  const plan = planKeepSync([local('l1', 'milk', false, '2 gallons')], [], [], opts);
  assert.deepEqual(plan.keepOps, [{ op: 'create', tempId: 'tmp:l1', text: '2 gallons milk', checked: false }]);
});

test('check-off on the wall propagates to Keep', () => {
  const plan = planKeepSync([local('l1', 'milk', true)], [keep('k1', 'milk')], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(plan.keepOps, [{ op: 'update', keepId: 'k1', text: 'milk', checked: true }]);
  assert.deepEqual(plan.localOps, []);
  assert.equal(plan.links[0].lastChecked, true);
});

test('check-off in Keep propagates to the wall', () => {
  const plan = planKeepSync([local('l1', 'milk')], [keep('k1', 'milk', true)], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(plan.localOps, [{ op: 'update', localId: 'l1', text: null, checked: true }]);
  assert.deepEqual(plan.keepOps, []);
});

test('text edits flow both ways; Keep wins when both edited', () => {
  const fromKeep = planKeepSync([local('l1', 'milk')], [keep('k1', 'oat milk')], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(fromKeep.localOps, [{ op: 'update', localId: 'l1', text: 'oat milk', checked: false }]);

  const fromLocal = planKeepSync([local('l1', 'whole milk')], [keep('k1', 'milk')], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(fromLocal.keepOps, [{ op: 'update', keepId: 'k1', text: 'whole milk', checked: false }]);

  const both = planKeepSync([local('l1', 'whole milk')], [keep('k1', 'oat milk')], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(both.localOps, [{ op: 'update', localId: 'l1', text: 'oat milk', checked: false }]);
  assert.deepEqual(both.keepOps, []);
});

test('independent field edits merge: wall checks off while Keep renames', () => {
  const plan = planKeepSync([local('l1', 'milk', true)], [keep('k1', 'oat milk')], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(plan.keepOps, [{ op: 'update', keepId: 'k1', text: 'oat milk', checked: true }]);
  assert.deepEqual(plan.localOps, [{ op: 'update', localId: 'l1', text: 'oat milk', checked: true }]);
});

test('deletes propagate both ways', () => {
  const localDeleted = planKeepSync([], [keep('k1', 'milk')], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(localDeleted.keepOps, [{ op: 'delete', keepId: 'k1' }]);
  assert.equal(localDeleted.links.length, 0);

  const keepDeleted = planKeepSync([local('l1', 'milk')], [], [link('l1', 'k1', 'milk')], opts);
  assert.deepEqual(keepDeleted.localOps, [{ op: 'delete', localId: 'l1' }]);
});

test('delete vs. concurrent edit: the edited item survives', () => {
  const plan = planKeepSync([], [keep('k1', 'milk', true)], [link('l1', 'k1', 'milk')], opts);
  assert.equal(plan.keepOps.length, 0, 'not deleted from Keep');
  assert.equal(plan.localOps[0].op, 'create', 're-created locally');
});

test('Lucarne reformatting of imported text does not cause endless re-syncs', () => {
  // Lucarne imports "2 Gallons Milk" as quantity "2 gallons" + "Milk" (display "2 gallons Milk").
  const importedDisplay = (t: string) => (t === '2 Gallons Milk' ? '2 gallons Milk' : t);
  const first = planKeepSync([], [keep('k1', '2 Gallons Milk')], [], { ...opts, importedDisplay });
  const createdId = (first.localOps[0] as { localId: string }).localId;
  // Next cycle: local now shows the reformatted text, Keep is unchanged.
  const second = planKeepSync(
    [local(createdId, 'Milk', false, '2 gallons')],
    [keep('k1', '2 Gallons Milk')],
    first.links,
    { ...opts, importedDisplay }
  );
  assert.deepEqual(second.keepOps, [], 'Keep text left alone');
  assert.deepEqual(second.localOps, [], 'no churn');
});

test('steady state produces no operations', () => {
  const plan = planKeepSync(
    [local('l1', 'milk'), local('l2', 'eggs', true)],
    [keep('k1', 'milk'), keep('k2', 'eggs', true)],
    [link('l1', 'k1', 'milk'), link('l2', 'k2', 'eggs', true)],
    opts
  );
  assert.deepEqual(plan.keepOps, []);
  assert.deepEqual(plan.localOps, []);
});

test('duplicate names pair one-to-one', () => {
  const plan = planKeepSync([local('l1', 'milk')], [keep('k1', 'milk'), keep('k2', 'milk')], [], opts);
  assert.equal(plan.links.length, 2);
  assert.equal(plan.localOps.filter((o) => o.op === 'create').length, 1, 'second milk created locally');
});
