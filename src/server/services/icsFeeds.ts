import crypto from 'node:crypto';
import { db, runTransaction } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { parseIcs } from './ics.js';
import { categoryForEvent, isEventCategory, type EventCategory } from '../../shared/eventCategories.js';
import type { IcsFeed } from '../../shared/types.js';

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 15 * 1024 * 1024;
const SYNC_EVERY_MS = 30 * 60 * 1000;
const PAST_DAYS = 60;
const FUTURE_DAYS = 400;

export function mapFeedRow(r: Record<string, unknown>): IcsFeed {
  let memberIds: string[] = [];
  try {
    memberIds = JSON.parse(String(r.member_ids_json || '[]'));
  } catch {
    memberIds = [];
  }
  return {
    id: String(r.id),
    url: String(r.url),
    name: String(r.name),
    memberIds,
    category: isEventCategory(r.category) ? r.category : null,
    enabled: Boolean(r.enabled),
    eventCount: Number(r.event_count || 0),
    lastSyncedAt: r.last_synced_at ? String(r.last_synced_at) : null,
    syncError: r.sync_error ? String(r.sync_error) : null,
  };
}

/** webcal:// links (what "Subscribe" buttons hand out) are plain https. */
export function normalizeFeedUrl(input: string): string {
  const trimmed = input.trim();
  const url = new URL(trimmed.replace(/^webcals?:\/\//i, 'https://'));
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Calendar links must start with https://, http:// or webcal://');
  return url.toString();
}

export async function fetchFeedText(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5', 'User-Agent': 'Lucarne/0.1 (family calendar)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`The calendar link returned HTTP ${res.status}${res.status === 404 ? ' (not found — is the link still shared?)' : ''}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('That calendar file is too large (over 15 MB).');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('That calendar file is too large (over 15 MB).');
  return text;
}

function eventId(feedId: string, uid: string, startIso: string): string {
  const h = crypto.createHash('sha1').update(`${uid}|${startIso}`).digest('hex').slice(0, 20);
  return `ics-${feedId.slice(0, 8)}-${h}`;
}

/**
 * Downloads one feed and replaces its events. A failed download or parse leaves the existing
 * events untouched (the wall keeps showing the last good copy).
 */
export async function syncIcsFeed(feedId: string, fetchText: (url: string) => Promise<string> = fetchFeedText): Promise<IcsFeed> {
  const row = db.prepare('SELECT * FROM ics_feeds WHERE id = ?').get(feedId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Feed not found');
  const feed = mapFeedRow(row);
  const now = new Date().toISOString();
  try {
    const text = await fetchText(feed.url);
    const nowMs = Date.now();
    const { events } = parseIcs(text, nowMs - PAST_DAYS * 86_400_000, nowMs + FUTURE_DAYS * 86_400_000);
    const memberJson = JSON.stringify(feed.memberIds);
    runTransaction(() => {
      db.prepare('DELETE FROM events WHERE ics_feed_id = ?').run(feedId);
      const ins = db.prepare(
        `INSERT OR REPLACE INTO events (id, title, description, location, start_iso, end_iso, all_day, member_ids_json,
           calendar_source_id, external_event_id, recurrence_rule, exception_dates_json, deleted, updated_at, category, ics_feed_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, '[]', 0, ?, ?, ?)`
      );
      for (const ev of events) {
        const category: EventCategory | null = categoryForEvent(feed.category, ev.title);
        ins.run(
          eventId(feedId, ev.uid, ev.startIso),
          ev.title,
          ev.description,
          ev.location,
          ev.startIso,
          ev.endIso,
          ev.allDay ? 1 : 0,
          memberJson,
          ev.uid,
          now,
          category,
          feedId
        );
      }
      db.prepare('UPDATE ics_feeds SET event_count = ?, last_synced_at = ?, sync_error = NULL WHERE id = ?').run(events.length, now, feedId);
    });
  } catch (err) {
    const msg = err instanceof Error ? (err.name === 'TimeoutError' ? 'The calendar link took too long to respond.' : err.message) : String(err);
    db.prepare('UPDATE ics_feeds SET sync_error = ? WHERE id = ?').run(msg, feedId);
  }
  broadcastInvalidate(['events', 'settings']);
  return mapFeedRow(db.prepare('SELECT * FROM ics_feeds WHERE id = ?').get(feedId) as Record<string, unknown>);
}

export async function syncAllIcsFeeds(): Promise<void> {
  const ids = db.prepare('SELECT id FROM ics_feeds WHERE enabled = 1').all() as Array<{ id: string }>;
  for (const { id } of ids) {
    await syncIcsFeed(id).catch(() => {});
  }
}

let loopStarted = false;
export function startIcsFeedLoop(): void {
  if (loopStarted) return;
  loopStarted = true;
  setTimeout(() => syncAllIcsFeeds().catch(() => {}), 15_000).unref();
  setInterval(() => syncAllIcsFeeds().catch(() => {}), SYNC_EVERY_MS).unref();
}
