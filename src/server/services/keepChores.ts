import crypto from 'node:crypto';
import { db, runTransaction } from '../db/connection.js';
import { runBridge } from './keepBridge.js';
import { planKeepSync, TEMP_PREFIX, type KeepItemLink, type KeepListItem, type LocalListItem } from './keepMerge.js';
import { choreAppliesToDate, localDateStr } from '../../shared/chores.js';
import type { ChoreFrequency } from '../../shared/types.js';

/**
 * Per-person chore lists in Google Keep.
 *
 * Each linked family member's Keep list mirrors that person's chores due TODAY (local time);
 * a checked item means "completed today" and earns that person's stars, exactly like tapping it
 * on the wall. Lists roll over automatically at midnight. Lucarne owns the routines: adding an item
 * in Keep creates a one-off chore for today, renames sync both ways, and deleting a recurring
 * chore in Keep only removes today's copy (it comes back on the next sync).
 */

export interface ChoreLinkRow {
  member_id: string;
  keep_note_id: string;
  keep_note_title: string;
}

interface ChoreRow {
  id: string;
  title: string;
  frequency: ChoreFrequency;
  days_of_week_json: string;
  specific_date: string | null;
  stars: number;
}

export function getChoreLinkRows(): ChoreLinkRow[] {
  return db.prepare('SELECT * FROM keep_chore_links').all() as unknown as ChoreLinkRow[];
}

function dueChoresForMember(memberId: string, now: Date, dateStr: string): ChoreRow[] {
  const rows = db
    .prepare('SELECT * FROM chores WHERE active = 1 AND assigned_member_id = ? ORDER BY sort_order, title')
    .all(memberId) as unknown as ChoreRow[];
  return rows.filter((r) => {
    let daysOfWeek: number[] = [];
    try {
      daysOfWeek = JSON.parse(r.days_of_week_json || '[]');
    } catch {
      daysOfWeek = [];
    }
    return choreAppliesToDate({ frequency: r.frequency, daysOfWeek, specificDate: r.specific_date }, now, dateStr);
  });
}

function isCompleted(choreId: string, dateStr: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM chore_completions WHERE chore_id = ? AND date_str = ?').get(choreId, dateStr));
}

/** Returns true if anything changed locally. */
export async function syncMemberChores(link: ChoreLinkRow, keepItems: KeepListItem[], now = new Date()): Promise<boolean> {
  const dateStr = localDateStr(now);
  const due = dueChoresForMember(link.member_id, now, dateStr);
  const localItems: LocalListItem[] = due.map((c) => ({
    id: c.id,
    text: c.title.trim(),
    quantity: '',
    checked: isCompleted(c.id, dateStr),
  }));
  const plannedState = new Map(localItems.map((l) => [l.id, { text: l.text, checked: l.checked }]));
  const choreById = new Map(due.map((c) => [c.id, c]));

  const previousLinks: KeepItemLink[] = (
    db.prepare('SELECT * FROM keep_chore_item_links WHERE member_id = ?').all(link.member_id) as Array<Record<string, unknown>>
  ).map((r) => ({
    localId: String(r.chore_id),
    keepId: String(r.keep_item_id),
    lastKeepText: String(r.last_keep_text),
    lastLocalText: String(r.last_local_text),
    lastChecked: Boolean(r.last_checked),
  }));
  const prevLinkByLocal = new Map(previousLinks.map((l) => [l.localId, l]));

  const plan = planKeepSync(localItems, keepItems, previousLinks, {
    newLocalId: () => crypto.randomUUID(),
    localAuthoritativeDeletes: true,
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
    const keepOldSnapshot = new Set<string>();
    const dropLink = new Set<string>();

    const setCompleted = (choreId: string, done: boolean, stars: number) => {
      if (done) {
        db.prepare(
          `INSERT OR IGNORE INTO chore_completions (id, chore_id, date_str, completed_by_member_id, stars_earned, completed_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), choreId, dateStr, link.member_id, stars, nowIso);
      } else {
        db.prepare('DELETE FROM chore_completions WHERE chore_id = ? AND date_str = ?').run(choreId, dateStr);
      }
    };

    for (const op of plan.localOps) {
      if (op.op === 'create') {
        const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM chores').get() as { m: number };
        db.prepare(
          `INSERT INTO chores (id, title, emoji, assigned_member_id, time_of_day, frequency, days_of_week_json, specific_date, stars, active, sort_order)
           VALUES (?, ?, '✨', ?, 'anytime', 'once', '[]', ?, 1, 1, ?)`
        ).run(op.localId, op.text.trim(), link.member_id, dateStr, maxOrder.m + 1);
        if (op.checked) setCompleted(op.localId, true, 1);
        localChanged = true;
        continue;
      }

      const chore = choreById.get(op.localId);
      const planned = plannedState.get(op.localId);
      if (!chore || !planned) continue;

      // Never overwrite a change made on the wall while this sync was running.
      const currentTitle = (db.prepare('SELECT title FROM chores WHERE id = ?').get(op.localId) as { title: string } | undefined)?.title;
      if (currentTitle === undefined) continue;
      if (currentTitle.trim() !== planned.text || isCompleted(op.localId, dateStr) !== planned.checked) {
        keepOldSnapshot.add(op.localId);
        continue;
      }

      if (op.op === 'delete') {
        if (chore.frequency === 'once') {
          db.prepare('DELETE FROM chores WHERE id = ?').run(op.localId);
          localChanged = true;
        } else {
          dropLink.add(op.localId); // recurring routine: re-added to Keep on the next sync
        }
        continue;
      }

      if (op.text !== null && op.text.trim() && op.text.trim() !== currentTitle.trim()) {
        db.prepare('UPDATE chores SET title = ? WHERE id = ?').run(op.text.trim(), op.localId);
        localChanged = true;
      }
      if (op.checked !== planned.checked) {
        setCompleted(op.localId, op.checked, Number(chore.stars ?? 1));
        localChanged = true;
      }
    }

    db.prepare('DELETE FROM keep_chore_item_links WHERE member_id = ?').run(link.member_id);
    const insert = db.prepare(
      `INSERT OR REPLACE INTO keep_chore_item_links (member_id, chore_id, keep_item_id, last_keep_text, last_local_text, last_checked)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const l of plan.links) {
      if (dropLink.has(l.localId)) continue;
      let finalLink: KeepItemLink | undefined = l;
      if (l.keepId.startsWith(TEMP_PREFIX)) {
        const realId = created[l.keepId];
        finalLink = realId ? { ...l, keepId: realId } : undefined;
      }
      if (keepOldSnapshot.has(l.localId)) finalLink = prevLinkByLocal.get(l.localId);
      if (!finalLink) continue;
      insert.run(
        link.member_id,
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

export function linkChoreNote(memberId: string, keepNoteId: string, keepNoteTitle: string): void {
  runTransaction(() => {
    db.prepare('DELETE FROM keep_chore_item_links WHERE member_id = ?').run(memberId);
    db.prepare(
      `INSERT INTO keep_chore_links (member_id, keep_note_id, keep_note_title, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET keep_note_id = excluded.keep_note_id,
         keep_note_title = excluded.keep_note_title, created_at = excluded.created_at`
    ).run(memberId, keepNoteId, keepNoteTitle, new Date().toISOString());
  });
}

export function unlinkChoreNote(memberId: string): void {
  runTransaction(() => {
    db.prepare('DELETE FROM keep_chore_item_links WHERE member_id = ?').run(memberId);
    db.prepare('DELETE FROM keep_chore_links WHERE member_id = ?').run(memberId);
  });
}

export function getChoreLinks(): Array<{ memberId: string; keepNoteId: string; keepNoteTitle: string }> {
  return getChoreLinkRows().map((r) => ({
    memberId: r.member_id,
    keepNoteId: r.keep_note_id,
    keepNoteTitle: r.keep_note_title,
  }));
}
