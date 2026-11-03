import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db, runTransaction } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { localDateStr } from '../../shared/chores.js';
import type { ChoreTimeOfDay, Habit, Routine, RoutineStep } from '../../shared/types.js';

export const routinesRouter = new Hono();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMES: ChoreTimeOfDay[] = ['morning', 'afternoon', 'evening', 'anytime'];

function parseDays(v: unknown): number[] {
  try {
    const arr = JSON.parse(String(v || '[]'));
    return Array.isArray(arr) ? arr.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  } catch {
    return [];
  }
}

function cleanDays(v: unknown): number[] {
  return Array.isArray(v) ? [...new Set(v.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

// ---------------------------------------------------------------- routines

export function loadRoutines(dateStr: string, memberId?: string): Routine[] {
  const rows = (
    memberId
      ? db.prepare('SELECT * FROM routines WHERE member_id = ? ORDER BY sort_order, title').all(memberId)
      : db.prepare('SELECT * FROM routines ORDER BY sort_order, title').all()
  ) as Record<string, unknown>[];
  if (rows.length === 0) return [];
  const steps = db
    .prepare(
      `SELECT s.*, CASE WHEN k.step_id IS NULL THEN 0 ELSE 1 END AS done
         FROM routine_steps s
         LEFT JOIN routine_step_checks k ON k.step_id = s.id AND k.date_str = ?
        ORDER BY s.sort_order, s.rowid`
    )
    .all(dateStr) as Record<string, unknown>[];
  const byRoutine = new Map<string, RoutineStep[]>();
  for (const s of steps) {
    const list = byRoutine.get(String(s.routine_id)) ?? [];
    list.push({ id: String(s.id), title: String(s.title), emoji: String(s.emoji || '✅'), sortOrder: Number(s.sort_order), done: Boolean(s.done) });
    byRoutine.set(String(s.routine_id), list);
  }
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    emoji: String(r.emoji || '🌅'),
    memberId: String(r.member_id),
    timeOfDay: (TIMES.includes(r.time_of_day as ChoreTimeOfDay) ? r.time_of_day : 'morning') as ChoreTimeOfDay,
    daysOfWeek: parseDays(r.days_of_week_json),
    stars: Number(r.stars || 0),
    sortOrder: Number(r.sort_order || 0),
    steps: byRoutine.get(String(r.id)) ?? [],
  }));
}

export function routineAppliesToDate(r: Pick<Routine, 'daysOfWeek'>, dateStr: string): boolean {
  if (r.daysOfWeek.length === 0) return true;
  return r.daysOfWeek.includes(new Date(`${dateStr}T12:00:00`).getDay());
}

interface RoutineBody {
  title?: string;
  emoji?: string;
  memberId?: string;
  timeOfDay?: ChoreTimeOfDay;
  daysOfWeek?: number[];
  stars?: number;
  /** Full replacement list of steps; existing steps keep their id (and today's check) */
  steps?: Array<{ id?: string; title: string; emoji?: string }>;
}

function saveSteps(routineId: string, steps: NonNullable<RoutineBody['steps']>) {
  const keep = new Set<string>();
  const existing = new Set(
    (db.prepare('SELECT id FROM routine_steps WHERE routine_id = ?').all(routineId) as Array<{ id: string }>).map((r) => r.id)
  );
  steps
    .filter((s) => s.title && s.title.trim())
    .slice(0, 30)
    .forEach((s, i) => {
      if (s.id && existing.has(s.id)) {
        db.prepare('UPDATE routine_steps SET title = ?, emoji = ?, sort_order = ? WHERE id = ?').run(s.title.trim().slice(0, 80), s.emoji || '✅', i, s.id);
        keep.add(s.id);
      } else {
        const id = crypto.randomUUID();
        db.prepare('INSERT INTO routine_steps (id, routine_id, title, emoji, sort_order) VALUES (?, ?, ?, ?, ?)').run(
          id,
          routineId,
          s.title.trim().slice(0, 80),
          s.emoji || '✅',
          i
        );
        keep.add(id);
      }
    });
  for (const id of existing) if (!keep.has(id)) db.prepare('DELETE FROM routine_steps WHERE id = ?').run(id);
}

routinesRouter.get('/', (c) => {
  const dateStr = c.req.query('date') || localDateStr();
  if (!DATE_RE.test(dateStr)) return c.json({ error: 'Bad date' }, 400);
  return c.json(loadRoutines(dateStr));
});

routinesRouter.post('/', async (c) => {
  const body = await c.req.json<RoutineBody>();
  const title = (body.title || '').trim();
  if (!title) return c.json({ error: 'Name the routine' }, 400);
  if (!body.memberId) return c.json({ error: 'Who is this routine for?' }, 400);
  const id = crypto.randomUUID();
  runTransaction(() => {
    const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM routines').get() as { m: number };
    db.prepare(
      'INSERT INTO routines (id, title, emoji, member_id, time_of_day, days_of_week_json, stars, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      id,
      title.slice(0, 80),
      body.emoji || '🌅',
      body.memberId!,
      TIMES.includes(body.timeOfDay as ChoreTimeOfDay) ? body.timeOfDay! : 'morning',
      JSON.stringify(cleanDays(body.daysOfWeek)),
      Math.max(0, Math.min(100, Math.round(Number(body.stars) || 0))),
      Number(max.m) + 1
    );
    saveSteps(id, body.steps || []);
  });
  broadcastInvalidate(['routines', 'rewards']);
  return c.json(loadRoutines(localDateStr()).find((r) => r.id === id), 201);
});

routinesRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM routines WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<RoutineBody>();
  const title = body.title !== undefined ? body.title.trim() : String(existing.title);
  if (!title) return c.json({ error: 'Name the routine' }, 400);
  runTransaction(() => {
    db.prepare('UPDATE routines SET title = ?, emoji = ?, member_id = ?, time_of_day = ?, days_of_week_json = ?, stars = ? WHERE id = ?').run(
      title.slice(0, 80),
      body.emoji ?? String(existing.emoji),
      body.memberId ?? String(existing.member_id),
      body.timeOfDay && TIMES.includes(body.timeOfDay) ? body.timeOfDay : String(existing.time_of_day),
      body.daysOfWeek !== undefined ? JSON.stringify(cleanDays(body.daysOfWeek)) : String(existing.days_of_week_json),
      body.stars !== undefined ? Math.max(0, Math.min(100, Math.round(Number(body.stars) || 0))) : Number(existing.stars),
      id
    );
    if (body.steps) saveSteps(id, body.steps);
  });
  broadcastInvalidate(['routines', 'rewards']);
  return c.json(loadRoutines(localDateStr()).find((r) => r.id === id));
});

routinesRouter.delete('/:id', (c) => {
  db.prepare('DELETE FROM routines WHERE id = ?').run(c.req.param('id'));
  broadcastInvalidate(['routines', 'rewards']);
  return c.json({ ok: true });
});

/** Check / uncheck one step for a date. */
routinesRouter.post('/steps/:stepId/toggle', async (c) => {
  const stepId = c.req.param('stepId');
  const { dateStr = localDateStr(), done } = await c.req.json<{ dateStr?: string; done?: boolean }>();
  if (!DATE_RE.test(dateStr)) return c.json({ error: 'Bad date' }, 400);
  const step = db.prepare('SELECT id FROM routine_steps WHERE id = ?').get(stepId);
  if (!step) return c.json({ error: 'Step not found' }, 404);
  const isDone = Boolean(db.prepare('SELECT 1 FROM routine_step_checks WHERE step_id = ? AND date_str = ?').get(stepId, dateStr));
  const want = done ?? !isDone;
  if (want && !isDone) {
    db.prepare('INSERT OR IGNORE INTO routine_step_checks (step_id, date_str, checked_at) VALUES (?, ?, ?)').run(stepId, dateStr, new Date().toISOString());
  } else if (!want && isDone) {
    db.prepare('DELETE FROM routine_step_checks WHERE step_id = ? AND date_str = ?').run(stepId, dateStr);
  }
  broadcastInvalidate(['routines', 'rewards']);
  return c.json({ done: want });
});

// ---------------------------------------------------------------- habits

export function loadHabits(dateStr: string, memberId?: string): Habit[] {
  const rows = (
    memberId
      ? db.prepare('SELECT * FROM habits WHERE member_id = ? ORDER BY sort_order, title').all(memberId)
      : db.prepare('SELECT * FROM habits ORDER BY sort_order, title').all()
  ) as Record<string, unknown>[];
  if (rows.length === 0) return [];
  const from = shiftDate(dateStr, -60);
  const logs = db
    .prepare('SELECT habit_id, date_str, count FROM habit_logs WHERE date_str >= ? AND date_str <= ?')
    .all(from, dateStr) as Array<{ habit_id: string; date_str: string; count: number }>;
  const byHabit = new Map<string, Map<string, number>>();
  for (const l of logs) {
    if (!byHabit.has(l.habit_id)) byHabit.set(l.habit_id, new Map());
    byHabit.get(l.habit_id)!.set(l.date_str, Number(l.count));
  }
  return rows.map((r) => {
    const id = String(r.id);
    const target = Math.max(1, Number(r.target_per_day || 1));
    const counts = byHabit.get(id) ?? new Map<string, number>();
    const week = Array.from({ length: 7 }, (_, i) => counts.get(shiftDate(dateStr, i - 6)) ?? 0);
    // Streak: today counts if met; if today isn't met yet, the streak up to yesterday still shows.
    let streak = 0;
    let offset = (counts.get(dateStr) ?? 0) >= target ? 0 : -1;
    while (streak < 60 && (counts.get(shiftDate(dateStr, offset)) ?? 0) >= target) {
      streak++;
      offset--;
    }
    return {
      id,
      title: String(r.title),
      emoji: String(r.emoji || '💧'),
      memberId: String(r.member_id),
      targetPerDay: target,
      unit: String(r.unit || ''),
      sortOrder: Number(r.sort_order || 0),
      today: counts.get(dateStr) ?? 0,
      week,
      streak,
    };
  });
}

routinesRouter.get('/habits', (c) => {
  const dateStr = c.req.query('date') || localDateStr();
  if (!DATE_RE.test(dateStr)) return c.json({ error: 'Bad date' }, 400);
  return c.json(loadHabits(dateStr));
});

interface HabitBody {
  title?: string;
  emoji?: string;
  memberId?: string;
  targetPerDay?: number;
  unit?: string;
}

const cleanTarget = (v: unknown) => Math.max(1, Math.min(100, Math.round(Number(v) || 1)));

routinesRouter.post('/habits', async (c) => {
  const body = await c.req.json<HabitBody>();
  const title = (body.title || '').trim();
  if (!title) return c.json({ error: 'Name the habit' }, 400);
  if (!body.memberId) return c.json({ error: 'Who is tracking this habit?' }, 400);
  const id = crypto.randomUUID();
  const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM habits').get() as { m: number };
  db.prepare('INSERT INTO habits (id, title, emoji, member_id, target_per_day, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    title.slice(0, 80),
    body.emoji || '💧',
    body.memberId,
    cleanTarget(body.targetPerDay),
    (body.unit || '').trim().slice(0, 20),
    Number(max.m) + 1
  );
  broadcastInvalidate(['habits']);
  return c.json(loadHabits(localDateStr()).find((h) => h.id === id), 201);
});

routinesRouter.put('/habits/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM habits WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<HabitBody>();
  const title = body.title !== undefined ? body.title.trim() : String(existing.title);
  if (!title) return c.json({ error: 'Name the habit' }, 400);
  db.prepare('UPDATE habits SET title = ?, emoji = ?, member_id = ?, target_per_day = ?, unit = ? WHERE id = ?').run(
    title.slice(0, 80),
    body.emoji ?? String(existing.emoji),
    body.memberId ?? String(existing.member_id),
    body.targetPerDay !== undefined ? cleanTarget(body.targetPerDay) : Number(existing.target_per_day),
    body.unit !== undefined ? body.unit.trim().slice(0, 20) : String(existing.unit),
    id
  );
  broadcastInvalidate(['habits']);
  return c.json(loadHabits(localDateStr()).find((h) => h.id === id));
});

routinesRouter.delete('/habits/:id', (c) => {
  db.prepare('DELETE FROM habits WHERE id = ?').run(c.req.param('id'));
  broadcastInvalidate(['habits']);
  return c.json({ ok: true });
});

/** Add (delta +1) or remove (delta -1) one unit for a date. */
routinesRouter.post('/habits/:id/log', async (c) => {
  const id = c.req.param('id');
  const { dateStr = localDateStr(), delta = 1 } = await c.req.json<{ dateStr?: string; delta?: number }>();
  if (!DATE_RE.test(dateStr)) return c.json({ error: 'Bad date' }, 400);
  if (!db.prepare('SELECT 1 FROM habits WHERE id = ?').get(id)) return c.json({ error: 'Habit not found' }, 404);
  const step = Math.max(-100, Math.min(100, Math.round(Number(delta) || 0)));
  db.prepare(
    `INSERT INTO habit_logs (habit_id, date_str, count) VALUES (?, ?, MAX(0, ?))
     ON CONFLICT(habit_id, date_str) DO UPDATE SET count = MAX(0, MIN(999, count + ?))`
  ).run(id, dateStr, step, step);
  broadcastInvalidate(['habits']);
  const row = db.prepare('SELECT count FROM habit_logs WHERE habit_id = ? AND date_str = ?').get(id, dateStr) as { count: number };
  return c.json({ count: Number(row.count) });
});
