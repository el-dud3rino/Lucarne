import crypto from 'node:crypto';
import { Hono } from 'hono';
import { db, runTransaction } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { fetchFeedText, mapFeedRow, normalizeFeedUrl, syncIcsFeed } from '../services/icsFeeds.js';
import { parseIcs } from '../services/ics.js';
import { isEventCategory } from '../../shared/eventCategories.js';
import type { IcsFeed } from '../../shared/types.js';

/** Read-only calendar subscriptions (.ics / webcal links). */
export const feedsRouter = new Hono();

feedsRouter.get('/', (c) => {
  const rows = db.prepare('SELECT * FROM ics_feeds ORDER BY name').all() as Record<string, unknown>[];
  return c.json(rows.map(mapFeedRow));
});

feedsRouter.post('/', async (c) => {
  const body = await c.req.json<Partial<IcsFeed>>();
  let url: string;
  try {
    url = normalizeFeedUrl(body.url || '');
  } catch (err) {
    return c.json({ error: err instanceof Error && err.message.startsWith('Calendar') ? err.message : 'That doesn\'t look like a link. Paste the full https:// or webcal:// address.' }, 400);
  }
  // Check the link works before saving it, and use the calendar's own name if none was given.
  let detectedName: string | null = null;
  try {
    const text = await fetchFeedText(url);
    detectedName = parseIcs(text, Date.now(), Date.now()).calendarName;
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Could not read that calendar' }, 400);
  }
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO ics_feeds (id, url, name, member_ids_json, category, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)'
  ).run(
    id,
    url,
    ((body.name || '').trim() || detectedName || new URL(url).hostname).slice(0, 80),
    JSON.stringify(Array.isArray(body.memberIds) ? body.memberIds : []),
    isEventCategory(body.category) ? body.category : null,
    new Date().toISOString()
  );
  const feed = await syncIcsFeed(id);
  return c.json(feed, 201);
});

feedsRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT * FROM ics_feeds WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<IcsFeed>>();
  const cur = mapFeedRow(existing);
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds : cur.memberIds;
  const category = body.category !== undefined ? (isEventCategory(body.category) ? body.category : null) : cur.category;
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : cur.enabled;
  runTransaction(() => {
    db.prepare('UPDATE ics_feeds SET name = ?, member_ids_json = ?, category = ?, enabled = ? WHERE id = ?').run(
      ((body.name ?? cur.name).trim() || cur.name).slice(0, 80),
      JSON.stringify(memberIds),
      category,
      enabled ? 1 : 0,
      id
    );
    // Apply the new people / category to the feed's existing events right away.
    db.prepare('UPDATE events SET member_ids_json = ? WHERE ics_feed_id = ?').run(JSON.stringify(memberIds), id);
    if (category) db.prepare('UPDATE events SET category = ? WHERE ics_feed_id = ?').run(category, id);
    if (!enabled) {
      db.prepare('DELETE FROM events WHERE ics_feed_id = ?').run(id);
      db.prepare('UPDATE ics_feeds SET event_count = 0 WHERE id = ?').run(id);
    }
  });
  if (enabled && (!cur.enabled || (cur.category && !category))) await syncIcsFeed(id);
  broadcastInvalidate(['events', 'settings']);
  return c.json(mapFeedRow(db.prepare('SELECT * FROM ics_feeds WHERE id = ?').get(id) as Record<string, unknown>));
});

feedsRouter.post('/:id/sync', async (c) => {
  const id = c.req.param('id');
  if (!db.prepare('SELECT 1 FROM ics_feeds WHERE id = ?').get(id)) return c.json({ error: 'Not found' }, 404);
  return c.json(await syncIcsFeed(id));
});

feedsRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  runTransaction(() => {
    db.prepare('DELETE FROM events WHERE ics_feed_id = ?').run(id);
    db.prepare('DELETE FROM ics_feeds WHERE id = ?').run(id);
  });
  broadcastInvalidate(['events', 'settings']);
  return c.json({ ok: true });
});
