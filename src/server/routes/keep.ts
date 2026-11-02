import { Hono } from 'hono';
import { db } from '../db/connection.js';
import {
  getKeepLinks,
  getKeepStatus,
  isKeepConfigured,
  KeepBridgeError,
  linkKeepNote,
  runBridge,
  syncKeepLists,
  unlinkKeepNote,
} from '../services/keepSync.js';
import { getChoreLinks, linkChoreNote, unlinkChoreNote } from '../services/keepChores.js';

export const keepRouter = new Hono();

const fullStatus = () => ({ ...getKeepStatus(), links: getKeepLinks(), choreLinks: getChoreLinks() });

keepRouter.get('/status', (c) => c.json(fullStatus()));

/** Keep list notes available to link (slow-ish: runs the bridge). */
keepRouter.get('/notes', async (c) => {
  if (!isKeepConfigured()) return c.json({ error: 'Google Keep is not linked yet.' }, 400);
  try {
    const res = await runBridge<{ notes: Array<{ id: string; title: string; itemCount: number }> }>('notes');
    return c.json({ notes: res.notes });
  } catch (err) {
    const message = err instanceof KeepBridgeError ? err.message : 'Could not reach Google Keep.';
    return c.json({ error: message }, 502);
  }
});

keepRouter.put('/links/:listId', async (c) => {
  const listId = c.req.param('listId');
  const body = await c.req.json<{ keepNoteId?: string; keepNoteTitle?: string }>();
  if (!body.keepNoteId) return c.json({ error: 'keepNoteId required' }, 400);
  const list = db.prepare('SELECT id FROM lists WHERE id = ?').get(listId);
  if (!list) return c.json({ error: 'List not found' }, 404);
  linkKeepNote(listId, body.keepNoteId, body.keepNoteTitle || '');
  await syncKeepLists(true);
  return c.json(fullStatus());
});

keepRouter.delete('/links/:listId', (c) => {
  unlinkKeepNote(c.req.param('listId'));
  return c.json(fullStatus());
});

keepRouter.post('/sync', async (c) => {
  await syncKeepLists(true);
  return c.json(fullStatus());
});

/** Link a family member's chores to a Keep list: an existing one, or create "<title>" in Keep. */
keepRouter.put('/chore-links/:memberId', async (c) => {
  const memberId = c.req.param('memberId');
  const body = await c.req.json<{ keepNoteId?: string; keepNoteTitle?: string; createTitle?: string }>();
  const member = db.prepare('SELECT id FROM family_members WHERE id = ?').get(memberId);
  if (!member) return c.json({ error: 'Family member not found' }, 404);

  let noteId = body.keepNoteId;
  let noteTitle = body.keepNoteTitle || '';
  if (!noteId && body.createTitle) {
    try {
      const res = await runBridge<{ note: { id: string; title: string } }>('create_list', { title: body.createTitle });
      noteId = res.note.id;
      noteTitle = res.note.title;
    } catch (err) {
      const message = err instanceof KeepBridgeError ? err.message : 'Could not create the Keep list.';
      return c.json({ error: message }, 502);
    }
  }
  if (!noteId) return c.json({ error: 'keepNoteId or createTitle required' }, 400);

  linkChoreNote(memberId, noteId, noteTitle);
  await syncKeepLists(true);
  return c.json(fullStatus());
});

keepRouter.delete('/chore-links/:memberId', (c) => {
  unlinkChoreNote(c.req.param('memberId'));
  return c.json(fullStatus());
});
