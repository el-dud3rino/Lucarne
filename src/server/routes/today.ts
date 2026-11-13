import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { getEventsInRange } from './events.js';
import { listUpcomingCountdowns } from './countdowns.js';
import { loadHabits, loadRoutines, routineAppliesToDate } from './routines.js';
import { choreAppliesToDate, localDateStr } from '../../shared/chores.js';
import { effectiveChores } from '../../shared/away.js';
import { awayForDate, skippedChoreIds } from './chores.js';
import { extractEventsWithGemini } from '../services/magicImport.js';
import type { Chore, TodaySummary } from '../../shared/types.js';

export const todayRouter = new Hono();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One request with everything "today" needs: morning brief, leave-by alerts and kid mode. */
export function buildTodaySummary(dateStr: string, memberId?: string): TodaySummary {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0);
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  const jsDay = new Date(y, m - 1, d, 12);

  let events = getEventsInRange(dayStart.toISOString(), dayEnd.toISOString()).filter((ev) =>
    ev.allDay ? ev.startIso.slice(0, 10) <= dateStr && ev.endIso.slice(0, 10) >= dateStr : true
  );
  if (memberId) events = events.filter((ev) => ev.memberIds.length === 0 || ev.memberIds.includes(memberId));

  const dinnerRow = db
    .prepare(
      `SELECT mp.custom_title, r.title AS recipe_title, r.image_url
         FROM meal_plans mp LEFT JOIN recipes r ON r.id = mp.recipe_id
        WHERE mp.date_str = ? AND mp.slot = 'dinner'`
    )
    .get(dateStr) as { custom_title: string; recipe_title: string | null; image_url: string | null } | undefined;
  const dinnerTitle = dinnerRow ? dinnerRow.recipe_title || dinnerRow.custom_title || null : null;

  // Chores still to do today, per person (shared chores count for everyone).
  const choreRows = db
    .prepare('SELECT id, title, emoji, assigned_member_id, time_of_day, frequency, days_of_week_json, specific_date, stars FROM chores WHERE active = 1 ORDER BY sort_order')
    .all() as Record<string, unknown>[];
  const done = new Set(
    (db.prepare('SELECT chore_id FROM chore_completions WHERE date_str = ?').all(dateStr) as Array<{ chore_id: string }>).map((r) => r.chore_id)
  );
  const dueChores = choreRows
    .map((r) => ({
      id: String(r.id),
      title: String(r.title),
      emoji: String(r.emoji || '✨'),
      assignedMemberId: r.assigned_member_id ? String(r.assigned_member_id) : null,
      timeOfDay: String(r.time_of_day) as Chore['timeOfDay'],
      frequency: String(r.frequency) as Chore['frequency'],
      daysOfWeek: (() => {
        try {
          return JSON.parse(String(r.days_of_week_json || '[]')) as number[];
        } catch {
          return [];
        }
      })(),
      specificDate: r.specific_date ? String(r.specific_date) : null,
      stars: Number(r.stars || 1),
      done: done.has(String(r.id)),
    }))
    .filter((c) => choreAppliesToDate(c, jsDay, dateStr));

  // Away people's chores go up for grabs; skipped chores drop out for the day.
  const effective = effectiveChores(dueChores, awayForDate(dateStr), skippedChoreIds(dateStr)).filter((e) => !e.skipped);
  const chores = effective
    .filter((e) => !memberId || e.ownerId === memberId || e.ownerId === null)
    .map((e) => ({ ...e.chore, assignedMemberId: e.ownerId }));

  const members = db.prepare("SELECT id FROM family_members WHERE role != 'family' ORDER BY sort_order").all() as Array<{ id: string }>;
  const choresLeft = members.map(({ id }) => {
    const mine = effective.filter((e) => e.ownerId === id);
    return { memberId: id, left: mine.filter((e) => !e.chore.done).length, total: mine.length };
  });

  const routines = loadRoutines(dateStr, memberId).filter((r) => routineAppliesToDate(r, dateStr));

  return {
    dateStr,
    events,
    dinner: dinnerTitle ? { title: dinnerTitle, imageUrl: dinnerRow?.image_url ?? null } : null,
    chores: memberId ? chores : [],
    choresLeft,
    sharedChoresLeft: effective.filter((e) => e.ownerId === null && !e.chore.done).length,
    routines,
    habits: memberId ? loadHabits(dateStr, memberId) : [],
    countdowns: listUpcomingCountdowns(dateStr).slice(0, 6),
  };
}

todayRouter.get('/', (c) => {
  const dateStr = c.req.query('date') || localDateStr();
  if (!DATE_RE.test(dateStr)) return c.json({ error: 'Bad date' }, 400);
  return c.json(buildTodaySummary(dateStr, c.req.query('memberId') || undefined));
});

/** Magic Import: photo or pasted text -> draft events for review (nothing is saved). */
todayRouter.post('/magic-import', async (c) => {
  try {
    const body = await c.req.json<{ text?: string; imageBase64?: string; mimeType?: string }>();
    const drafts = await extractEventsWithGemini(body);
    return c.json({ drafts });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Magic Import failed' }, 400);
  }
});
