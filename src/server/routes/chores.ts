import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import type { Chore, ChoreCompletion, FamilyMember, MemberStarStats } from '../../shared/types.js';
import { localDateStr } from '../../shared/chores.js';
import { awayOnDate, type AwayEntry } from '../../shared/away.js';
import { getEventsInRange } from './events.js';
import { getHomeAddress } from '../services/driveTimes.js';
import { scheduleKeepSync } from '../services/keepSync.js';

export const choresRouter = new Hono();

function mapChoreRow(row: Record<string, unknown>): Chore {
  let daysOfWeek: number[] = [];
  try {
    daysOfWeek = JSON.parse(String(row.days_of_week_json || '[]'));
  } catch {
    daysOfWeek = [];
  }
  return {
    id: String(row.id),
    title: String(row.title),
    emoji: String(row.emoji || '✨'),
    assignedMemberId: row.assigned_member_id ? String(row.assigned_member_id) : null,
    timeOfDay: row.time_of_day as Chore['timeOfDay'],
    frequency: row.frequency as Chore['frequency'],
    daysOfWeek,
    specificDate: row.specific_date ? String(row.specific_date) : null,
    stars: Number(row.stars ?? 1),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order ?? 0),
  };
}

function mapCompletionRow(row: Record<string, unknown>): ChoreCompletion {
  return {
    id: String(row.id),
    choreId: String(row.chore_id),
    dateStr: String(row.date_str),
    completedByMemberId: String(row.completed_by_member_id),
    starsEarned: Number(row.stars_earned),
    completedAt: String(row.completed_at),
  };
}

/** Who is away from home on a local date (vacations, trips), so their chores go up for grabs. */
export function awayForDate(dateStr: string): AwayEntry[] {
  const [y, m, d] = dateStr.split('-').map(Number);
  const events = getEventsInRange(
    new Date(y, m - 1, d, 0, 0, 0, 0).toISOString(),
    new Date(y, m - 1, d, 23, 59, 59, 999).toISOString()
  );
  const members = db.prepare('SELECT id, role FROM family_members').all() as Array<Pick<FamilyMember, 'id' | 'role'>>;
  return awayOnDate(events, dateStr, members, getHomeAddress());
}

/** Chore ids skipped on a local date. */
export function skippedChoreIds(dateStr: string): string[] {
  return (db.prepare('SELECT chore_id FROM chore_skips WHERE date_str = ?').all(dateStr) as Array<{ chore_id: string }>).map(
    (r) => r.chore_id
  );
}

choresRouter.get('/', (c) => {
  const dateStr = c.req.query('date') || localDateStr();

  const chores = (
    db
      .prepare('SELECT * FROM chores WHERE active = 1 ORDER BY sort_order ASC, title ASC')
      .all() as Record<string, unknown>[]
  ).map(mapChoreRow);

  const completions = (
    db
      .prepare('SELECT * FROM chore_completions WHERE date_str = ?')
      .all(dateStr) as Record<string, unknown>[]
  ).map(mapCompletionRow);

  // Compute household star & completion stats (kids + parents!)
  const d = new Date(`${dateStr}T12:00:00`);
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  const weekStartStr = localDateStr(weekStart);
  const monthStartStr = `${dateStr.slice(0, 7)}-01`;

  const members = db
    .prepare("SELECT id FROM family_members WHERE role != 'family'")
    .all() as Array<{ id: string }>;

  const stats: MemberStarStats[] = members.map((m) => {
    const todayAgg = db
      .prepare(
        'SELECT COALESCE(SUM(stars_earned), 0) as s, COUNT(*) as c FROM chore_completions WHERE completed_by_member_id = ? AND date_str = ?'
      )
      .get(m.id, dateStr) as { s: number; c: number };
    const weekAgg = db
      .prepare(
        'SELECT COALESCE(SUM(stars_earned), 0) as s, COUNT(*) as c FROM chore_completions WHERE completed_by_member_id = ? AND date_str >= ? AND date_str <= ?'
      )
      .get(m.id, weekStartStr, dateStr) as { s: number; c: number };
    const monthAgg = db
      .prepare(
        'SELECT COALESCE(SUM(stars_earned), 0) as s, COUNT(*) as c FROM chore_completions WHERE completed_by_member_id = ? AND date_str >= ? AND date_str <= ?'
      )
      .get(m.id, monthStartStr, dateStr) as { s: number; c: number };
    const allAgg = db
      .prepare(
        'SELECT COALESCE(SUM(stars_earned), 0) as s FROM chore_completions WHERE completed_by_member_id = ?'
      )
      .get(m.id) as { s: number };

    return {
      memberId: m.id,
      todayStars: Number(todayAgg.s),
      todayCount: Number(todayAgg.c),
      weekStars: Number(weekAgg.s),
      weekCount: Number(weekAgg.c),
      monthStars: Number(monthAgg.s),
      monthCount: Number(monthAgg.c),
      allTimeStars: Number(allAgg.s),
    };
  });

  return c.json({ chores, completions, stats, away: awayForDate(dateStr), skippedChoreIds: skippedChoreIds(dateStr) });
});

choresRouter.post('/', async (c) => {
  const body = await c.req.json<Partial<Chore>>();
  const id = crypto.randomUUID();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM chores')
    .get() as { m: number };

  db.prepare(
    `INSERT INTO chores (id, title, emoji, assigned_member_id, time_of_day, frequency, days_of_week_json, specific_date, stars, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    id,
    (body.title || 'New Chore').trim(),
    body.emoji || '✨',
    body.assignedMemberId || null,
    body.timeOfDay || 'anytime',
    body.frequency || 'daily',
    JSON.stringify(body.daysOfWeek || []),
    body.specificDate || null,
    body.stars ?? 1,
    maxOrder.m + 1
  );

  broadcastInvalidate(['chores']);
  scheduleKeepSync();
  const created = db.prepare('SELECT * FROM chores WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return c.json(mapChoreRow(created), 201);
});

choresRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<Chore>>();
  const existing = db.prepare('SELECT * FROM chores WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);

  db.prepare(
    `UPDATE chores
     SET title = ?, emoji = ?, assigned_member_id = ?, time_of_day = ?, frequency = ?, days_of_week_json = ?, specific_date = ?, stars = ?
     WHERE id = ?`
  ).run(
    (body.title ?? String(existing.title)).trim(),
    body.emoji ?? String(existing.emoji),
    body.assignedMemberId !== undefined
      ? body.assignedMemberId
      : existing.assigned_member_id
      ? String(existing.assigned_member_id)
      : null,
    body.timeOfDay ?? String(existing.time_of_day),
    body.frequency ?? String(existing.frequency),
    JSON.stringify(body.daysOfWeek ?? JSON.parse(String(existing.days_of_week_json || '[]'))),
    body.specificDate !== undefined
      ? body.specificDate
      : existing.specific_date
      ? String(existing.specific_date)
      : null,
    body.stars ?? Number(existing.stars),
    id
  );

  broadcastInvalidate(['chores']);
  scheduleKeepSync();
  const updated = db.prepare('SELECT * FROM chores WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return c.json(mapChoreRow(updated));
});

choresRouter.post('/:id/toggle', async (c) => {
  const choreId = c.req.param('id');
  const body = await c.req.json<{ dateStr: string; completedByMemberId?: string }>();
  const dateStr = body.dateStr || localDateStr();

  const chore = db.prepare('SELECT * FROM chores WHERE id = ?').get(choreId) as
    | Record<string, unknown>
    | undefined;
  if (!chore) return c.json({ error: 'Chore not found' }, 404);

  const existing = db
    .prepare('SELECT id FROM chore_completions WHERE chore_id = ? AND date_str = ?')
    .get(choreId, dateStr) as { id: string } | undefined;

  if (existing) {
    db.prepare('DELETE FROM chore_completions WHERE id = ?').run(existing.id);
    broadcastInvalidate(['chores']);
  scheduleKeepSync();
    return c.json({ completed: false });
  }

  const memberId =
    body.completedByMemberId ||
    (chore.assigned_member_id ? String(chore.assigned_member_id) : null);

  if (!memberId) {
    return c.json({ error: 'Please select who completed this shared chore' }, 400);
  }

  db.prepare(
    `INSERT INTO chore_completions (id, chore_id, date_str, completed_by_member_id, stars_earned, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    choreId,
    dateStr,
    memberId,
    Number(chore.stars ?? 1),
    new Date().toISOString()
  );

  broadcastInvalidate(['chores']);
  scheduleKeepSync();
  return c.json({ completed: true });
});

/** Skip (or un-skip) a chore for one day: no stars, and it doesn't count as missed. */
choresRouter.post('/:id/skip', async (c) => {
  const choreId = c.req.param('id');
  const body = await c.req.json<{ dateStr?: string }>().catch(() => ({} as { dateStr?: string }));
  const dateStr = body.dateStr && /^\d{4}-\d{2}-\d{2}$/.test(body.dateStr) ? body.dateStr : localDateStr();
  const chore = db.prepare('SELECT id FROM chores WHERE id = ?').get(choreId);
  if (!chore) return c.json({ error: 'Chore not found' }, 404);

  const existing = db.prepare('SELECT 1 FROM chore_skips WHERE chore_id = ? AND date_str = ?').get(choreId, dateStr);
  if (existing) {
    db.prepare('DELETE FROM chore_skips WHERE chore_id = ? AND date_str = ?').run(choreId, dateStr);
  } else {
    db.prepare('DELETE FROM chore_completions WHERE chore_id = ? AND date_str = ?').run(choreId, dateStr);
    db.prepare('INSERT INTO chore_skips (chore_id, date_str, created_at) VALUES (?, ?, ?)').run(
      choreId,
      dateStr,
      new Date().toISOString()
    );
  }
  broadcastInvalidate(['chores']);
  scheduleKeepSync();
  return c.json({ skipped: !existing });
});

choresRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  db.prepare('DELETE FROM chores WHERE id = ?').run(id);
  broadcastInvalidate(['chores']);
  scheduleKeepSync();
  return c.json({ ok: true });
});
