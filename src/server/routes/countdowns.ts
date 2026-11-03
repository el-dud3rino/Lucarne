import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { localDateStr } from '../../shared/chores.js';
import type { Countdown } from '../../shared/types.js';

export const countdownsRouter = new Hono();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole calendar days from `today` to `dateStr` (both local YYYY-MM-DD). */
export function daysUntil(dateStr: string, today: string = localDateStr()): number {
  const a = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const b = Date.UTC(Number(dateStr.slice(0, 4)), Number(dateStr.slice(5, 7)) - 1, Number(dateStr.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function mapCountdownRow(r: Record<string, unknown>, today = localDateStr()): Countdown {
  const dateStr = String(r.date_str);
  return {
    id: String(r.id),
    title: String(r.title),
    emoji: String(r.emoji || '🎉'),
    dateStr,
    memberId: r.member_id ? String(r.member_id) : null,
    daysLeft: daysUntil(dateStr, today),
  };
}

/** Upcoming countdowns (today or later), soonest first. */
export function listUpcomingCountdowns(today = localDateStr()): Countdown[] {
  return (
    db.prepare('SELECT * FROM countdowns WHERE date_str >= ? ORDER BY date_str ASC, title ASC').all(today) as Record<string, unknown>[]
  ).map((r) => mapCountdownRow(r, today));
}

countdownsRouter.get('/', (c) => {
  const today = c.req.query('today') || localDateStr();
  return c.json(listUpcomingCountdowns(today));
});

countdownsRouter.post('/', async (c) => {
  const body = await c.req.json<Partial<Countdown>>();
  const title = (body.title || '').trim();
  if (!title) return c.json({ error: 'Give the countdown a name' }, 400);
  if (!body.dateStr || !DATE_RE.test(body.dateStr)) return c.json({ error: 'Pick a date' }, 400);
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO countdowns (id, title, emoji, date_str, member_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    title.slice(0, 80),
    body.emoji || '🎉',
    body.dateStr,
    body.memberId || null,
    new Date().toISOString()
  );
  broadcastInvalidate(['countdowns']);
  return c.json(mapCountdownRow(db.prepare('SELECT * FROM countdowns WHERE id = ?').get(id) as Record<string, unknown>), 201);
});

countdownsRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM countdowns WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<Countdown>>();
  if (body.dateStr !== undefined && !DATE_RE.test(body.dateStr)) return c.json({ error: 'Pick a date' }, 400);
  const title = body.title !== undefined ? body.title.trim() : String(existing.title);
  if (!title) return c.json({ error: 'Give the countdown a name' }, 400);
  db.prepare('UPDATE countdowns SET title = ?, emoji = ?, date_str = ?, member_id = ? WHERE id = ?').run(
    title.slice(0, 80),
    body.emoji ?? String(existing.emoji),
    body.dateStr ?? String(existing.date_str),
    body.memberId !== undefined ? body.memberId || null : (existing.member_id as string | null),
    id
  );
  broadcastInvalidate(['countdowns']);
  return c.json(mapCountdownRow(db.prepare('SELECT * FROM countdowns WHERE id = ?').get(id) as Record<string, unknown>));
});

countdownsRouter.delete('/:id', (c) => {
  db.prepare('DELETE FROM countdowns WHERE id = ?').run(c.req.param('id'));
  broadcastInvalidate(['countdowns']);
  return c.json({ ok: true });
});
