import crypto from 'node:crypto';
import { db, runTransaction } from '../db/connection.js';
import { isKeepConfigured, KeepBridgeError, readKeepEmail, runBridge } from './keepBridge.js';
import { getChoreLinkRows, syncMemberChores } from './keepChores.js';
import { broadcastInvalidate } from '../sse.js';
import { aisleFor } from './aisles.js';
import { parseItemInput } from '../../shared/ingredientAggregator.js';
import {
  planKeepSync,
  localDisplayText,
  TEMP_PREFIX,
  type KeepItemLink,
  type KeepListItem,
  type LocalListItem,
} from './keepMerge.js';

/**
 * Two-way sync between Lucarne lists and Google Keep list notes via the Python keep-bridge.
 * Lucarne stays the source of truth for the UI; any bridge failure only pauses sync and is
 * reported in Settings. It never blocks or breaks local list usage.
 */

const BASE_INTERVAL_MS = 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;

export interface KeepStatus {
  configured: boolean;
  email: string | null;
  state: 'idle' | 'syncing' | 'ok' | 'error';
  message: string;
  lastSyncAt: string | null;
  lastErrorAt: string | null;
}

const status: KeepStatus = {
  configured: false,
  email: null,
  state: 'idle',
  message: '',
  lastSyncAt: null,
  lastErrorAt: null,
};
let consecutiveFailures = 0;
let nextAllowedAt = 0;

export { KeepBridgeError, isKeepConfigured, runBridge } from './keepBridge.js';

export function getKeepStatus(): KeepStatus {
  return { ...status, configured: isKeepConfigured(), email: readKeepEmail() };
}

/** Lucarne display text produced by importing a Keep string. */
function importedDisplay(keepText: string): string {
  const parsed = parseItemInput(keepText);
  return localDisplayText({ text: parsed.text, quantity: parsed.quantity });
}

interface LinkRow {
  list_id: string;
  keep_note_id: string;
  keep_note_title: string;
}

async function syncList(link: LinkRow, keepItems: KeepListItem[]): Promise<boolean> {
  const localRows = db
    .prepare('SELECT id, text, quantity, checked, updated_at FROM list_items WHERE list_id = ?')
    .all(link.list_id) as Array<{ id: string; text: string; quantity: string; checked: number; updated_at: string }>;
  const localItems: LocalListItem[] = localRows.map((r) => ({
    id: r.id,
    text: r.text,
    quantity: r.quantity,
    checked: Boolean(r.checked),
  }));
  const updatedAtAtPlan = new Map(localRows.map((r) => [r.id, r.updated_at]));

  const previousLinks: KeepItemLink[] = (
    db
      .prepare('SELECT * FROM keep_item_links WHERE list_id = ?')
      .all(link.list_id) as Array<Record<string, unknown>>
  ).map((r) => ({
    localId: String(r.local_item_id),
    keepId: String(r.keep_item_id),
    lastKeepText: String(r.last_keep_text),
    lastLocalText: String(r.last_local_text),
    lastChecked: Boolean(r.last_checked),
  }));
  const prevLinkByLocal = new Map(previousLinks.map((l) => [l.localId, l]));

  const plan = planKeepSync(localItems, keepItems, previousLinks, {
    newLocalId: () => crypto.randomUUID(),
    importedDisplay,
  });

  let created: Record<string, string> = {};
  if (plan.keepOps.length > 0) {
    const res = await runBridge<{ created: Record<string, string> }>('apply', {
      noteId: link.keep_note_id,
      ops: plan.keepOps,
    });
    created = res.created || {};
  }

  let localChanged = false;
  runTransaction(() => {
    const nowIso = new Date().toISOString();
    const changedDuringSync = new Set<string>();
    const currentUpdatedAt = (id: string) =>
      (db.prepare('SELECT updated_at FROM list_items WHERE id = ?').get(id) as { updated_at: string } | undefined)
        ?.updated_at;

    for (const op of plan.localOps) {
      if (op.op === 'create') {
        const parsed = parseItemInput(op.text);
        db.prepare(
          `INSERT INTO list_items (id, list_id, text, quantity, category, checked, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(op.localId, link.list_id, parsed.text, parsed.quantity, aisleFor(parsed.text), op.checked ? 1 : 0, nowIso);
        localChanged = true;
        continue;
      }
      // Never overwrite an edit made on the wall/phone while this sync was running.
      const now = currentUpdatedAt(op.localId);
      if (now === undefined) continue;
      if (now !== updatedAtAtPlan.get(op.localId)) {
        changedDuringSync.add(op.localId);
        continue;
      }
      if (op.op === 'delete') {
        db.prepare('DELETE FROM list_items WHERE id = ?').run(op.localId);
      } else if (op.text !== null) {
        const parsed = parseItemInput(op.text);
        db.prepare(
          'UPDATE list_items SET text = ?, quantity = ?, category = ?, checked = ?, updated_at = ? WHERE id = ?'
        ).run(
          parsed.text,
          parsed.quantity,
          aisleFor(parsed.text),
          op.checked ? 1 : 0,
          nowIso,
          op.localId
        );
      } else {
        db.prepare('UPDATE list_items SET checked = ?, updated_at = ? WHERE id = ?').run(
          op.checked ? 1 : 0,
          nowIso,
          op.localId
        );
      }
      localChanged = true;
    }

    db.prepare('DELETE FROM keep_item_links WHERE list_id = ?').run(link.list_id);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO keep_item_links (list_id, local_item_id, keep_item_id, last_keep_text, last_local_text, last_checked)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const l of plan.links) {
      let finalLink: KeepItemLink | undefined = l;
      if (l.keepId.startsWith(TEMP_PREFIX)) {
        const realId = created[l.keepId];
        finalLink = realId ? { ...l, keepId: realId } : undefined;
      }
      if (changedDuringSync.has(l.localId)) {
        // Keep the old snapshot so the wall edit is merged on the next cycle.
        finalLink = prevLinkByLocal.get(l.localId);
      }
      if (!finalLink) continue;
      insert.run(
        link.list_id,
        finalLink.localId,
        finalLink.keepId,
        finalLink.lastKeepText,
        finalLink.lastLocalText,
        finalLink.lastChecked ? 1 : 0
      );
    }
  });
  return localChanged;
}

async function syncOnce(): Promise<void> {
  const links = db.prepare('SELECT * FROM keep_list_links').all() as unknown as LinkRow[];
  const choreLinks = getChoreLinkRows();
  if ((links.length === 0 && choreLinks.length === 0) || !isKeepConfigured()) return;

  status.state = 'syncing';
  try {
    const noteIds = [...new Set([...links, ...choreLinks].map((l) => l.keep_note_id))];
    const read = await runBridge<{ notes: Record<string, { title: string; items: KeepListItem[] } | null> }>(
      'read',
      { noteIds }
    );
    let listsChanged = false;
    let choresChanged = false;
    const missing: string[] = [];
    for (const link of links) {
      const note = read.notes[link.keep_note_id];
      if (!note) {
        missing.push(link.keep_note_title || link.keep_note_id);
        continue;
      }
      if (note.title && note.title !== link.keep_note_title) {
        db.prepare('UPDATE keep_list_links SET keep_note_title = ? WHERE list_id = ?').run(note.title, link.list_id);
      }
      if (await syncList(link, note.items)) listsChanged = true;
    }
    for (const link of choreLinks) {
      const note = read.notes[link.keep_note_id];
      if (!note) {
        missing.push(link.keep_note_title || link.keep_note_id);
        continue;
      }
      if (note.title && note.title !== link.keep_note_title) {
        db.prepare('UPDATE keep_chore_links SET keep_note_title = ? WHERE member_id = ?').run(note.title, link.member_id);
      }
      if (await syncMemberChores(link, note.items)) choresChanged = true;
    }
    if (listsChanged) broadcastInvalidate(['lists']);
    if (choresChanged) broadcastInvalidate(['chores']);
    if (missing.length > 0) {
      throw new KeepBridgeError('note_missing', `Linked Keep list not found: ${missing.join(', ')}. Pick another list in Settings.`);
    }
    consecutiveFailures = 0;
    nextAllowedAt = 0;
    status.state = 'ok';
    status.message = '';
    status.lastSyncAt = new Date().toISOString();
  } catch (err) {
    consecutiveFailures += 1;
    nextAllowedAt = Date.now() + Math.min(BASE_INTERVAL_MS * 2 ** (consecutiveFailures - 1), MAX_BACKOFF_MS);
    status.state = 'error';
    status.message = err instanceof Error ? err.message : String(err);
    status.lastErrorAt = new Date().toISOString();
  }
}

let running: Promise<void> | null = null;
let rerunRequested = false;

/** Runs a sync now (coalescing concurrent requests). `force` ignores failure backoff. */
export function syncKeepLists(force = false): Promise<void> {
  if (!force && Date.now() < nextAllowedAt) return Promise.resolve();
  if (running) {
    rerunRequested = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        rerunRequested = false;
        await syncOnce();
      } while (rerunRequested);
    } finally {
      running = null;
    }
  })();
  return running;
}

let debounceTimer: NodeJS.Timeout | null = null;

/** Called after local list edits so check-offs reach Keep within a couple of seconds. */
export function scheduleKeepSync(delayMs = 1500): void {
  if (!isKeepConfigured()) return;
  const hasLinks =
    db.prepare('SELECT 1 FROM keep_list_links LIMIT 1').get() ||
    db.prepare('SELECT 1 FROM keep_chore_links LIMIT 1').get();
  if (!hasLinks) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncKeepLists().catch(() => {});
  }, delayMs);
  debounceTimer.unref?.();
}

export function startKeepSyncLoop(): void {
  setInterval(() => {
    syncKeepLists().catch(() => {});
  }, BASE_INTERVAL_MS).unref();
  setTimeout(() => syncKeepLists().catch(() => {}), 5_000).unref();
}

export function linkKeepNote(listId: string, keepNoteId: string, keepNoteTitle: string): void {
  runTransaction(() => {
    db.prepare('DELETE FROM keep_item_links WHERE list_id = ?').run(listId);
    db.prepare(
      `INSERT INTO keep_list_links (list_id, keep_note_id, keep_note_title, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(list_id) DO UPDATE SET keep_note_id = excluded.keep_note_id,
         keep_note_title = excluded.keep_note_title, created_at = excluded.created_at`
    ).run(listId, keepNoteId, keepNoteTitle, new Date().toISOString());
  });
}

export function unlinkKeepNote(listId: string): void {
  runTransaction(() => {
    db.prepare('DELETE FROM keep_item_links WHERE list_id = ?').run(listId);
    db.prepare('DELETE FROM keep_list_links WHERE list_id = ?').run(listId);
  });
}

export function getKeepLinks(): Array<{ listId: string; keepNoteId: string; keepNoteTitle: string }> {
  return (db.prepare('SELECT * FROM keep_list_links').all() as unknown as LinkRow[]).map((r) => ({
    listId: r.list_id,
    keepNoteId: r.keep_note_id,
    keepNoteTitle: r.keep_note_title,
  }));
}
