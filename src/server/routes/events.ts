import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { flushOutboxMutations } from '../services/google.js';
import { expandRecurringEvent } from '../services/recurrence.js';
import type { CalendarEvent, EventRecurrenceRule } from '../../shared/types.js';
import { isEventCategory } from '../../shared/eventCategories.js';

export const eventsRouter = new Hono();

function mapEventRow(row: Record<string, unknown>): CalendarEvent {
  let memberIds: string[] = [];
  try {
    memberIds = JSON.parse(String(row.member_ids_json || '[]'));
  } catch {
    memberIds = [];
  }

  let exceptionDates: string[] = [];
  try {
    exceptionDates = JSON.parse(String(row.exception_dates_json || '[]'));
  } catch {
    exceptionDates = [];
  }

  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description || ''),
    location: String(row.location || ''),
    startIso: String(row.start_iso),
    endIso: String(row.end_iso),
    allDay: Boolean(row.all_day),
    memberIds,
    calendarSourceId: row.calendar_source_id ? String(row.calendar_source_id) : null,
    externalEventId: row.external_event_id ? String(row.external_event_id) : null,
    updatedAt: String(row.updated_at),
    recurrenceRule: (row.recurrence_rule as EventRecurrenceRule) || null,
    exceptionDates,
    category: isEventCategory(row.category) ? row.category : null,
  };
}

/** The same birthday often comes from two calendars (e.g. Family + Birthdays); show it once per day. */
export function dedupeBirthdays(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((ev) => {
    if (ev.category !== 'birthday') return true;
    const key = `${ev.title.trim().toLowerCase()}|${ev.startIso.slice(0, 10)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

eventsRouter.get('/', (c) => {
  const start = c.req.query('start');
  const end = c.req.query('end');

  if (start && end) {
    const rows = db
      .prepare(
        `SELECT * FROM events
         WHERE deleted = 0
           AND (
             ((recurrence_rule IS NULL OR recurrence_rule = '') AND end_iso >= ? AND start_iso <= ?)
             OR
             (recurrence_rule IS NOT NULL AND recurrence_rule != '' AND start_iso <= ?)
           )
         ORDER BY all_day DESC, start_iso ASC`
      )
      .all(start, end, end) as Record<string, unknown>[];

    const mappedEvents = rows.map(mapEventRow);
    const resultList: CalendarEvent[] = [];

    for (const ev of mappedEvents) {
      if (ev.recurrenceRule) {
        const instances = expandRecurringEvent(ev, start, end);
        resultList.push(...instances);
      } else {
        resultList.push(ev);
      }
    }

    resultList.sort((a, b) => {
      const ad = (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0);
      if (ad !== 0) return ad;
      return a.startIso.localeCompare(b.startIso);
    });

    return c.json(dedupeBirthdays(resultList));
  }

  const rows = db
    .prepare('SELECT * FROM events WHERE deleted = 0 ORDER BY all_day DESC, start_iso ASC')
    .all() as Record<string, unknown>[];

  return c.json(rows.map(mapEventRow));
});

eventsRouter.post('/', async (c) => {
  const body = await c.req.json<Partial<CalendarEvent>>();
  const id = body.id || crypto.randomUUID();
  const nowIso = new Date().toISOString();

  // If no explicit calendarSourceId was chosen, see if primary member maps to a writable Google Calendar
  let calendarSourceId = body.calendarSourceId || null;
  if (!calendarSourceId && body.memberIds && body.memberIds.length > 0) {
    const mappedSource = db
      .prepare(
        'SELECT id FROM calendar_sources WHERE member_id = ? AND enabled = 1 AND is_writable = 1 LIMIT 1'
      )
      .get(body.memberIds[0]) as { id: string } | undefined;
    if (mappedSource) calendarSourceId = mappedSource.id;
  }

  const recurrenceRule = body.recurrenceRule || null;
  const exceptionDates = body.exceptionDates || [];

  db.prepare(
    `INSERT INTO events (
       id, title, description, location, start_iso, end_iso, all_day,
       member_ids_json, calendar_source_id, external_event_id, recurrence_rule,
       exception_dates_json, deleted, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    (body.title || 'New Event').trim(),
    body.description || '',
    body.location || '',
    body.startIso || nowIso,
    body.endIso || nowIso,
    body.allDay ? 1 : 0,
    JSON.stringify(body.memberIds || []),
    calendarSourceId,
    body.externalEventId || null,
    recurrenceRule,
    JSON.stringify(exceptionDates),
    nowIso
  );

  if (calendarSourceId) {
    db.prepare(
      `INSERT INTO outbox_mutations (id, entity_type, entity_id, action, payload_json, created_at)
       VALUES (?, 'event', ?, 'upsert', ?, ?)`
    ).run(
      crypto.randomUUID(),
      id,
      JSON.stringify({
        calendarSourceId,
        externalEventId: null,
        title: (body.title || 'New Event').trim(),
        description: body.description || '',
        location: body.location || '',
        startIso: body.startIso || nowIso,
        endIso: body.endIso || nowIso,
        allDay: Boolean(body.allDay),
      }),
      nowIso
    );
    flushOutboxMutations().catch(() => {});
  }

  broadcastInvalidate(['events']);
  const created = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Record<
    string,
    unknown
  >;
  return c.json(mapEventRow(created), 201);
});

eventsRouter.put('/:id', async (c) => {
  const paramId = c.req.param('id');
  const body = await c.req.json<Partial<CalendarEvent>>();

  // Resolve virtual recurrence instance ID (${originalId}_YYYY-MM-DD) to master series ID
  let targetId = paramId;
  let existing = db.prepare('SELECT * FROM events WHERE id = ?').get(paramId) as
    | Record<string, unknown>
    | undefined;

  if (!existing) {
    const match = paramId.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
    if (match) {
      targetId = match[1];
      existing = db.prepare('SELECT * FROM events WHERE id = ?').get(targetId) as
        | Record<string, unknown>
        | undefined;
    } else if (body.originalEventId) {
      targetId = body.originalEventId;
      existing = db.prepare('SELECT * FROM events WHERE id = ?').get(targetId) as
        | Record<string, unknown>
        | undefined;
    }
  }

  if (!existing) return c.json({ error: 'Not found' }, 404);

  const nowIso = new Date().toISOString();
  const title = (body.title ?? String(existing.title)).trim();
  const description = body.description ?? String(existing.description);
  const location = body.location ?? String(existing.location);
  const startIso = body.startIso ?? String(existing.start_iso);
  const endIso = body.endIso ?? String(existing.end_iso);
  const allDay = body.allDay !== undefined ? body.allDay : Boolean(existing.all_day);
  const memberIds =
    body.memberIds ?? (JSON.parse(String(existing.member_ids_json || '[]')) as string[]);
  const recurrenceRule =
    body.recurrenceRule !== undefined
      ? body.recurrenceRule
      : (existing.recurrence_rule as EventRecurrenceRule | null);
  const exceptionDates =
    body.exceptionDates !== undefined
      ? body.exceptionDates
      : (JSON.parse(String(existing.exception_dates_json || '[]')) as string[]);

  db.prepare(
    `UPDATE events
     SET title = ?, description = ?, location = ?, start_iso = ?, end_iso = ?,
         all_day = ?, member_ids_json = ?, recurrence_rule = ?, exception_dates_json = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    title,
    description,
    location,
    startIso,
    endIso,
    allDay ? 1 : 0,
    JSON.stringify(memberIds),
    recurrenceRule,
    JSON.stringify(exceptionDates),
    nowIso,
    targetId
  );

  if (existing.calendar_source_id) {
    db.prepare(
      `INSERT INTO outbox_mutations (id, entity_type, entity_id, action, payload_json, created_at)
       VALUES (?, 'event', ?, 'upsert', ?, ?)`
    ).run(
      crypto.randomUUID(),
      targetId,
      JSON.stringify({
        calendarSourceId: String(existing.calendar_source_id),
        externalEventId: existing.external_event_id ? String(existing.external_event_id) : null,
        title,
        description,
        location,
        startIso,
        endIso,
        allDay,
      }),
      nowIso
    );
    flushOutboxMutations().catch(() => {});
  }

  broadcastInvalidate(['events']);
  const updated = db.prepare('SELECT * FROM events WHERE id = ?').get(targetId) as Record<
    string,
    unknown
  >;
  return c.json(mapEventRow(updated));
});

eventsRouter.delete('/:id', (c) => {
  const paramId = c.req.param('id');
  let targetId = paramId;
  let instanceDate: string | null = null;

  let existing = db.prepare('SELECT * FROM events WHERE id = ?').get(paramId) as
    | Record<string, unknown>
    | undefined;

  if (!existing) {
    const match = paramId.match(/^(.*)_(\d{4}-\d{2}-\d{2})$/);
    if (match) {
      targetId = match[1];
      instanceDate = match[2];
      existing = db.prepare('SELECT * FROM events WHERE id = ?').get(targetId) as
        | Record<string, unknown>
        | undefined;
    }
  }

  if (!existing) return c.json({ error: 'Not found' }, 404);

  const scope = c.req.query('scope');

  // If deleting only "this" instance of a recurring series, add occurrence date to exception_dates
  if (scope === 'this' && instanceDate) {
    let exceptions: string[] = [];
    try {
      exceptions = JSON.parse(String(existing.exception_dates_json || '[]'));
    } catch {
      exceptions = [];
    }
    if (!exceptions.includes(instanceDate)) {
      exceptions.push(instanceDate);
    }

    db.prepare('UPDATE events SET exception_dates_json = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(exceptions),
      new Date().toISOString(),
      targetId
    );
  } else {
    // Delete master series
    if (existing.calendar_source_id && existing.external_event_id) {
      db.prepare(
        `INSERT INTO outbox_mutations (id, entity_type, entity_id, action, payload_json, created_at)
         VALUES (?, 'event', ?, 'delete', ?, ?)`
      ).run(
        crypto.randomUUID(),
        targetId,
        JSON.stringify({
          calendarSourceId: String(existing.calendar_source_id),
          externalEventId: String(existing.external_event_id),
        }),
        new Date().toISOString()
      );
      flushOutboxMutations().catch(() => {});
    }

    db.prepare('DELETE FROM events WHERE id = ?').run(targetId);
  }

  broadcastInvalidate(['events']);
  return c.json({ ok: true });
});
