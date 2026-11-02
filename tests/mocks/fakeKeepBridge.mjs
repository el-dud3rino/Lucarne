// Deterministic stand-in for keep-bridge/keep_bridge.py used by integration tests.
// "Keep" lives in $DATA_DIR/keep/fake-keep.json: { fail?: string, notes: { id: { title, items: [{id,text,checked}] } } }
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.env.DATA_DIR, 'keep', 'fake-keep.json');
const respond = (obj, code = 0) => {
  process.stdout.write(JSON.stringify(obj));
  process.exit(code);
};

const state = JSON.parse(fs.readFileSync(file, 'utf8'));
if (state.fail) respond({ ok: false, error: 'sync', message: state.fail }, 1);

const command = process.argv[2];
const input = command === 'notes' ? {} : JSON.parse(fs.readFileSync(0, 'utf8') || '{}');

if (command === 'notes') {
  respond({
    ok: true,
    notes: Object.entries(state.notes).map(([id, n]) => ({ id, title: n.title, itemCount: n.items.length })),
  });
} else if (command === 'read') {
  const notes = {};
  for (const id of input.noteIds) notes[id] = state.notes[id] ?? null;
  respond({ ok: true, notes });
} else if (command === 'apply') {
  const note = state.notes[input.noteId];
  if (!note) respond({ ok: false, error: 'note_missing', message: 'gone' }, 1);
  const created = {};
  for (const op of input.ops) {
    if (op.op === 'create') {
      const id = `fk-${Math.random().toString(36).slice(2, 10)}`;
      note.items.push({ id, text: op.text, checked: op.checked });
      created[op.tempId] = id;
    } else if (op.op === 'update') {
      const item = note.items.find((i) => i.id === op.keepId);
      if (item) Object.assign(item, { text: op.text, checked: op.checked });
    } else if (op.op === 'delete') {
      note.items = note.items.filter((i) => i.id !== op.keepId);
    }
  }
  state.applyCount = (state.applyCount || 0) + 1;
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  respond({ ok: true, created });
} else if (command === 'create_list') {
  const id = `fn-${Math.random().toString(36).slice(2, 10)}`;
  state.notes[id] = { title: input.title, items: [] };
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  respond({ ok: true, note: { id, title: input.title, itemCount: 0 } });
} else {
  respond({ ok: false, error: 'usage', message: 'bad command' }, 1);
}
