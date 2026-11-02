import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, MEDIA_PHOTOS_DIR, runTransaction } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { describeGoogleError, googleApiError } from './googleErrors.js';
import { categoryForCalendar, categoryForEvent, isEventCategory } from '../../shared/eventCategories.js';

export function getGoogleOAuthBaseUrl(): string {
  return (process.env.GOOGLE_OAUTH_BASE_URL || 'https://oauth2.googleapis.com').replace(/\/+$/, '');
}

export function getGoogleApiBaseUrl(): string {
  return (process.env.GOOGLE_API_BASE_URL || 'https://www.googleapis.com').replace(/\/+$/, '');
}

export function getGooglePhotosPickerBaseUrl(): string {
  return (
    process.env.GOOGLE_PHOTOS_PICKER_BASE_URL || 'https://photospicker.googleapis.com'
  ).replace(/\/+$/, '');
}

export function getGoogleAuthBaseUrl(): string {
  return (
    process.env.GOOGLE_AUTH_BASE_URL || 'https://accounts.google.com/o/oauth2/v2/auth'
  ).replace(/\/+$/, '');
}

function getSettingString(key: string, envFallback = ''): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    } catch {
      // ignore
    }
  }
  return envFallback.trim();
}

export function getGoogleOAuthConfig(originFallback?: string) {
  const clientId = getSettingString('googleClientId', process.env.GOOGLE_CLIENT_ID || '');
  const clientSecret = getSettingString(
    'googleClientSecret',
    process.env.GOOGLE_CLIENT_SECRET || ''
  );
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${originFallback || 'http://localhost:3001'}/api/google/callback`;
  return { clientId, clientSecret, redirectUri };
}

/**
 * All-day date conventions:
 * - Google: `end.date` is EXCLUSIVE (a one-day event on Nov 2 has end.date = Nov 3).
 * - Lucarne: endIso is the INCLUSIVE last day at T23:59:59.000Z (compared by date string).
 */
function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function googleAllDayToLocal(
  startDate: string,
  endDateExclusive?: string
): { startIso: string; endIso: string } {
  let lastDay = startDate;
  if (endDateExclusive) {
    const inclusive = shiftDateStr(endDateExclusive, -1);
    if (inclusive > startDate) lastDay = inclusive;
  }
  return { startIso: `${startDate}T00:00:00.000Z`, endIso: `${lastDay}T23:59:59.000Z` };
}

export function localAllDayToGoogle(
  startIso: string,
  endIso: string
): { start: { date: string }; end: { date: string } } {
  const startDate = startIso.slice(0, 10);
  let lastDay = endIso.slice(0, 10);
  if (lastDay < startDate) lastDay = startDate;
  return { start: { date: startDate }, end: { date: shiftDateStr(lastDay, 1) } };
}

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
].join(' ');

export function buildGoogleAuthUrl(origin: string): string {
  const { clientId, redirectUri } = getGoogleOAuthConfig(origin);
  if (!clientId) {
    throw new Error('Google Client ID is not configured yet.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
  });
  return `${getGoogleAuthBaseUrl()}?${params.toString()}`;
}

export async function exchangeCodeAndSaveAccount(code: string, origin: string): Promise<string> {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig(origin);
  const tokenRes = await fetch(`${getGoogleOAuthBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    const errTxt = await tokenRes.text();
    throw new Error(describeGoogleError('Google sign-in', tokenRes.status, errTxt));
  }
  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const userRes = await fetch(`${getGoogleApiBaseUrl()}/oauth2/v2/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error('Failed to fetch Google user profile');
  }
  const profile = (await userRes.json()) as {
    email: string;
    name?: string;
    picture?: string;
  };

  const existing = db
    .prepare('SELECT id, refresh_token FROM google_accounts WHERE email = ?')
    .get(profile.email) as { id: string; refresh_token: string } | undefined;

  const accountId = existing?.id || crypto.randomUUID();
  const refreshToken = tokens.refresh_token || existing?.refresh_token || '';
  const expiryDate = Date.now() + (tokens.expires_in - 60) * 1000;

  db.prepare(
    `INSERT INTO google_accounts (id, email, display_name, avatar_url, access_token, refresh_token, expiry_date, sync_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ok')
     ON CONFLICT(email) DO UPDATE SET
       display_name = excluded.display_name,
       avatar_url = excluded.avatar_url,
       access_token = excluded.access_token,
       refresh_token = CASE WHEN excluded.refresh_token != '' THEN excluded.refresh_token ELSE google_accounts.refresh_token END,
       expiry_date = excluded.expiry_date,
       sync_status = 'ok',
       sync_error = NULL`
  ).run(
    accountId,
    profile.email,
    profile.name || profile.email,
    profile.picture || null,
    tokens.access_token,
    refreshToken,
    expiryDate
  );

  await discoverAccountCalendars(accountId);
  await syncAllEnabledCalendars();
  broadcastInvalidate(['settings', 'events']);
  return accountId;
}

async function getValidAccessToken(accountId: string): Promise<string> {
  const acc = db
    .prepare('SELECT * FROM google_accounts WHERE id = ?')
    .get(accountId) as
    | {
        id: string;
        access_token: string;
        refresh_token: string;
        expiry_date: number;
      }
    | undefined;

  if (!acc) throw new Error('Google account not found');
  if (Date.now() < acc.expiry_date && acc.access_token) {
    return acc.access_token;
  }
  if (!acc.refresh_token) {
    throw new Error('Refresh token missing; please reconnect Google account');
  }

  const { clientId, clientSecret } = getGoogleOAuthConfig();
  const res = await fetch(`${getGoogleOAuthBaseUrl()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: acc.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw await googleApiError('Google sign-in refresh', res);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiry = Date.now() + (data.expires_in - 60) * 1000;
  db.prepare('UPDATE google_accounts SET access_token = ?, expiry_date = ? WHERE id = ?').run(
    data.access_token,
    expiry,
    accountId
  );
  return data.access_token;
}

export async function discoverAccountCalendars(accountId: string): Promise<void> {
  const token = await getValidAccessToken(accountId);
  const res = await fetch(`${getGoogleApiBaseUrl()}/calendar/v3/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await googleApiError('Google Calendar API', res);
  const data = (await res.json()) as {
    items?: Array<{ id: string; summary: string; accessRole: string; primary?: boolean }>;
  };

  const upsert = db.prepare(`
    INSERT INTO calendar_sources (id, google_account_id, external_calendar_id, name, member_id, enabled, is_writable, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_account_id, external_calendar_id) DO UPDATE SET
      name = excluded.name,
      is_writable = excluded.is_writable
  `);

  for (const cal of data.items || []) {
    const writable = cal.accessRole === 'owner' || cal.accessRole === 'writer' ? 1 : 0;
    upsert.run(
      crypto.randomUUID(),
      accountId,
      cal.id,
      cal.summary || cal.id,
      null, // new calendars start unassigned; mapped to people in Settings
      cal.primary ? 1 : 0,
      writable,
      categoryForCalendar(cal.id, cal.summary || cal.id) // holiday/birthday calendars are tagged automatically
    );
  }
}

export function ensureOutboxSchema(): void {
  try {
    const cols = db
      .prepare('PRAGMA table_info(outbox_mutations)')
      .all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.some((c) => c.name === 'next_retry_at')) {
      db.exec('ALTER TABLE outbox_mutations ADD COLUMN next_retry_at INTEGER DEFAULT NULL');
    }
  } catch {
    // Table may not exist yet
  }
}

export async function flushOutboxMutations(force = false): Promise<void> {
  ensureOutboxSchema();

  const nowMs = Date.now();
  const nowIso = new Date().toISOString();

  const pending = (force
    ? db.prepare('SELECT * FROM outbox_mutations ORDER BY created_at ASC LIMIT 25').all()
    : db
        .prepare(
          `SELECT * FROM outbox_mutations
           WHERE next_retry_at IS NULL
              OR (typeof(next_retry_at) = 'integer' AND next_retry_at <= ?)
              OR (typeof(next_retry_at) = 'text' AND next_retry_at <= ?)
           ORDER BY created_at ASC LIMIT 25`
        )
        .all(nowMs, nowIso)) as Array<{
    id: string;
    entity_type: string;
    entity_id: string;
    action: string;
    payload_json: string;
    attempts: number;
    next_retry_at?: number | string | null;
  }>;

  for (const item of pending) {
    try {
      if (item.entity_type === 'event') {
        const payload = JSON.parse(item.payload_json) as {
          calendarSourceId: string;
          externalEventId?: string | null;
          title: string;
          description: string;
          location: string;
          startIso: string;
          endIso: string;
          allDay: boolean;
        };

        const source = db
          .prepare('SELECT * FROM calendar_sources WHERE id = ?')
          .get(payload.calendarSourceId) as
          | { google_account_id: string; external_calendar_id: string; is_writable: number }
          | undefined;

        if (!source || !source.is_writable) {
          db.prepare('DELETE FROM outbox_mutations WHERE id = ?').run(item.id);
          continue;
        }

        const token = await getValidAccessToken(source.google_account_id);
        const encodedCal = encodeURIComponent(source.external_calendar_id);

        if (item.action === 'delete' && payload.externalEventId) {
          const res = await fetch(
            `${getGoogleApiBaseUrl()}/calendar/v3/calendars/${encodedCal}/events/${encodeURIComponent(
              payload.externalEventId
            )}`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }
          );

          // 404 and 410 indicate event was already deleted on remote
          if (!res.ok && res.status !== 404 && res.status !== 410) {
            throw await googleApiError('Google Calendar API', res);
          }
        } else if (item.action === 'upsert') {
          // If event was created offline and subsequently deleted before syncing, discard mutation
          if (!payload.externalEventId) {
            const localEvent = db.prepare('SELECT id FROM events WHERE id = ?').get(item.entity_id);
            if (!localEvent) {
              db.prepare('DELETE FROM outbox_mutations WHERE id = ?').run(item.id);
              continue;
            }
          }

          // Check if preceding mutation in queue already created remote event ID
          let targetExternalId = payload.externalEventId;
          if (!targetExternalId) {
            const ev = db
              .prepare('SELECT external_event_id FROM events WHERE id = ?')
              .get(item.entity_id) as { external_event_id?: string | null } | undefined;
            if (ev?.external_event_id) {
              targetExternalId = ev.external_event_id;
            }
          }

          const gBody = {
            summary: payload.title,
            description: payload.description,
            location: payload.location,
            ...(payload.allDay
              ? localAllDayToGoogle(payload.startIso, payload.endIso)
              : { start: { dateTime: payload.startIso }, end: { dateTime: payload.endIso } }),
          };

          const url = targetExternalId
            ? `${getGoogleApiBaseUrl()}/calendar/v3/calendars/${encodedCal}/events/${encodeURIComponent(
                targetExternalId
              )}`
            : `${getGoogleApiBaseUrl()}/calendar/v3/calendars/${encodedCal}/events`;

          const res = await fetch(url, {
            method: targetExternalId ? 'PUT' : 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(gBody),
          });
          if (res.ok) {
            const created = (await res.json()) as { id: string };
            db.prepare('UPDATE events SET external_event_id = ? WHERE id = ?').run(
              created.id,
              item.entity_id
            );
          } else {
            throw await googleApiError('Google Calendar API', res);
          }
        }
      }

      db.prepare('DELETE FROM outbox_mutations WHERE id = ?').run(item.id);
    } catch (err) {
      const nextAttempt = item.attempts + 1;
      const delaySeconds = Math.min(300, 5 * Math.pow(2, item.attempts));
      const nextRetryAt = Date.now() + delaySeconds * 1000;
      const errMsg = err instanceof Error ? err.message : String(err);

      db.prepare(
        'UPDATE outbox_mutations SET attempts = ?, last_error = ?, next_retry_at = ? WHERE id = ?'
      ).run(nextAttempt, errMsg, nextRetryAt, item.id);
    }
  }
}

/** People a calendar's events belong to (multi-select; falls back to the legacy single member_id). */
export function sourceMemberIds(src: { member_ids_json?: string | null; member_id?: string | null }): string[] {
  try {
    const ids = JSON.parse(src.member_ids_json || '[]');
    if (Array.isArray(ids) && ids.length > 0) return ids.map(String);
  } catch {
    // fall through
  }
  return src.member_id ? [src.member_id] : [];
}

export interface CalendarSyncSummary {
  synced: number;
  failed: Array<{ calendar: string; account: string; message: string }>;
}

export async function syncAllEnabledCalendars(force = false): Promise<CalendarSyncSummary> {
  await flushOutboxMutations(force);

  const sources = db
    .prepare(
      `SELECT cs.*, ga.email AS account_email FROM calendar_sources cs
       JOIN google_accounts ga ON ga.id = cs.google_account_id
       WHERE cs.enabled = 1`
    )
    .all() as Array<{
    id: string;
    name: string;
    account_email: string;
    google_account_id: string;
    external_calendar_id: string;
    member_id: string | null;
    member_ids_json: string | null;
    category: string | null;
    sync_token: string | null;
  }>;

  const summary: CalendarSyncSummary = { synced: 0, failed: [] };
  if (sources.length === 0) return summary;
  let anyChanged = false;

  for (const src of sources) {
    try {
      const token = await getValidAccessToken(src.google_account_id);
      const params = new URLSearchParams({ singleEvents: 'true', maxResults: '500' });
      if (src.sync_token) {
        params.set('syncToken', src.sync_token);
      } else {
        const minDate = new Date();
        minDate.setDate(minDate.getDate() - 45);
        params.set('timeMin', minDate.toISOString());
      }

      const encodedCal = encodeURIComponent(src.external_calendar_id);
      let res = await fetch(
        `${getGoogleApiBaseUrl()}/calendar/v3/calendars/${encodedCal}/events?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // 410 Gone means syncToken expired -> clear token & full resync
      if (res.status === 410) {
        db.prepare('UPDATE calendar_sources SET sync_token = NULL WHERE id = ?').run(src.id);
        params.delete('syncToken');
        const minDate = new Date();
        minDate.setDate(minDate.getDate() - 45);
        params.set('timeMin', minDate.toISOString());
        res = await fetch(
          `${getGoogleApiBaseUrl()}/calendar/v3/calendars/${encodedCal}/events?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }

      if (!res.ok) throw await googleApiError('Google Calendar API', res);

      const data = (await res.json()) as {
        nextSyncToken?: string;
        items?: Array<{
          id: string;
          status: string;
          summary?: string;
          eventType?: string;
          description?: string;
          location?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
        }>;
      };

      const nowIso = new Date().toISOString();
      runTransaction(() => {
        for (const gEv of data.items || []) {
          const existing = db
            .prepare(
              'SELECT id FROM events WHERE calendar_source_id = ? AND external_event_id = ?'
            )
            .get(src.id, gEv.id) as { id: string } | undefined;

          if (gEv.status === 'cancelled') {
            if (existing) {
              db.prepare('DELETE FROM events WHERE id = ?').run(existing.id);
              anyChanged = true;
            }
            continue;
          }

          const allDay = Boolean(gEv.start?.date && !gEv.start?.dateTime);
          let startIso: string;
          let endIso: string;
          if (allDay && gEv.start?.date) {
            ({ startIso, endIso } = googleAllDayToLocal(gEv.start.date, gEv.end?.date));
          } else {
            startIso = gEv.start?.dateTime || nowIso;
            endIso = gEv.end?.dateTime || startIso;
          }
          const memberIds = sourceMemberIds(src);
          const category = categoryForEvent(
            isEventCategory(src.category) ? src.category : null,
            gEv.summary || '',
            gEv.eventType
          );

          if (existing) {
            db.prepare(
              `UPDATE events SET title = ?, description = ?, location = ?, start_iso = ?, end_iso = ?, all_day = ?, member_ids_json = ?, category = ?, updated_at = ?
               WHERE id = ?`
            ).run(
              gEv.summary || '(Untitled)',
              gEv.description || '',
              gEv.location || '',
              startIso,
              endIso,
              allDay ? 1 : 0,
              JSON.stringify(memberIds),
              category,
              nowIso,
              existing.id
            );
          } else {
            db.prepare(
              `INSERT INTO events (id, title, description, location, start_iso, end_iso, all_day, member_ids_json, calendar_source_id, external_event_id, category, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              crypto.randomUUID(),
              gEv.summary || '(Untitled)',
              gEv.description || '',
              gEv.location || '',
              startIso,
              endIso,
              allDay ? 1 : 0,
              JSON.stringify(memberIds),
              src.id,
              gEv.id,
              category,
              nowIso
            );
          }
          anyChanged = true;
        }

        db.prepare(
          'UPDATE calendar_sources SET sync_token = ?, last_synced_at = ?, sync_error = NULL WHERE id = ?'
        ).run(data.nextSyncToken || src.sync_token, nowIso, src.id);
      });
      summary.synced += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.prepare('UPDATE calendar_sources SET sync_error = ? WHERE id = ?').run(message, src.id);
      summary.failed.push({ calendar: src.name, account: src.account_email, message });
    }
  }

  // Account status reflects ALL of its calendars (one success must not hide another's failure).
  const finishedAt = new Date().toISOString();
  for (const accountId of new Set(sources.map((s) => s.google_account_id))) {
    const email = sources.find((s) => s.google_account_id === accountId)!.account_email;
    const failures = summary.failed.filter((f) => f.account === email);
    if (failures.length === 0) {
      db.prepare(
        "UPDATE google_accounts SET last_synced_at = ?, sync_status = 'ok', sync_error = NULL WHERE id = ?"
      ).run(finishedAt, accountId);
    } else {
      db.prepare("UPDATE google_accounts SET sync_status = 'error', sync_error = ? WHERE id = ?").run(
        failures.map((f) => `${f.calendar}: ${f.message}`).join(' · '),
        accountId
      );
    }
  }

  if (anyChanged) {
    broadcastInvalidate(['events']);
  }
  return summary;
}

/**
 * Google Photos Picker API (2025+ compliant replacement for deprecated Library API)
 */
export async function createPhotosPickerSession(accountId: string): Promise<{
  sessionId: string;
  pickerUri: string;
}> {
  const token = await getValidAccessToken(accountId);
  const res = await fetch(`${getGooglePhotosPickerBaseUrl()}/v1/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw await googleApiError('Google Photos Picker API', res);
  const data = (await res.json()) as { id: string; pickerUri: string };
  return { sessionId: data.id, pickerUri: data.pickerUri };
}

export interface PickerPollResult {
  ready: boolean;
  importedCount: number;
  alreadyHadCount: number;
  skippedVideoCount: number;
  failedCount: number;
  /** Suggested wait before polling again (from Google's pollingConfig). */
  pollIntervalMs?: number;
}

/**
 * Checks a Photos Picker session; once the user finishes picking, downloads every selected photo
 * (all pages, so whole albums work) as 1920x1080 JPEGs to local storage.
 */
export async function pollAndImportPhotosPickerSession(
  accountId: string,
  sessionId: string
): Promise<PickerPollResult> {
  const token = await getValidAccessToken(accountId);
  const base = getGooglePhotosPickerBaseUrl();
  const sRes = await fetch(`${base}/v1/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!sRes.ok) throw await googleApiError('Google Photos Picker API', sRes);
  const session = (await sRes.json()) as {
    mediaItemsSet?: boolean;
    pollingConfig?: { pollInterval?: string };
  };
  const result: PickerPollResult = {
    ready: false,
    importedCount: 0,
    alreadyHadCount: 0,
    skippedVideoCount: 0,
    failedCount: 0,
  };
  if (!session.mediaItemsSet) {
    const secs = parseFloat(session.pollingConfig?.pollInterval || '');
    if (Number.isFinite(secs) && secs > 0) result.pollIntervalMs = Math.round(secs * 1000);
    return result;
  }
  result.ready = true;

  type PickedItem = {
    id: string;
    type?: string;
    mediaFile?: { baseUrl: string; mimeType?: string; mediaFileMetadata?: { width?: number; height?: number } };
  };
  const items: PickedItem[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ sessionId, pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const mRes = await fetch(`${base}/v1/mediaItems?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!mRes.ok) throw await googleApiError('Google Photos Picker API', mRes);
    const page = (await mRes.json()) as { mediaItems?: PickedItem[]; nextPageToken?: string };
    items.push(...(page.mediaItems || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);

  const nowIso = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO photos (id, url, orientation, caption, source, external_id, created_at)
    VALUES (?, ?, ?, '', 'google_photos', ?, ?)
  `);

  for (const item of items) {
    const baseUrl = item.mediaFile?.baseUrl;
    const isVideo = item.type === 'VIDEO' || (item.mediaFile?.mimeType || '').startsWith('video/');
    if (isVideo) {
      result.skippedVideoCount++;
      continue;
    }
    if (!baseUrl) {
      result.failedCount++;
      continue;
    }
    if (db.prepare('SELECT 1 FROM photos WHERE external_id = ?').get(item.id)) {
      result.alreadyHadCount++;
      continue;
    }

    // Download a 1920x1080 version to local storage so URLs never expire
    const itemDownloadUrl = baseUrl.startsWith('http')
      ? `${baseUrl}=w1920-h1080`
      : `${base}${baseUrl.startsWith('/') ? '' : '/'}${baseUrl}=w1920-h1080`;
    try {
      const dlRes = await fetch(itemDownloadUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!dlRes.ok) {
        result.failedCount++;
        continue;
      }
      const buf = Buffer.from(await dlRes.arrayBuffer());
      const filename = `${crypto.randomUUID()}.jpg`;
      fs.writeFileSync(path.join(MEDIA_PHOTOS_DIR, filename), buf);

      const w = item.mediaFile?.mediaFileMetadata?.width || 1920;
      const h = item.mediaFile?.mediaFileMetadata?.height || 1080;
      insertStmt.run(crypto.randomUUID(), `/media/photos/${filename}`, h > w ? 'portrait' : 'landscape', item.id, nowIso);
      result.importedCount++;
    } catch {
      result.failedCount++;
    }
  }

  // Google asks apps to delete finished sessions; best effort.
  fetch(`${base}/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});

  if (result.importedCount > 0) broadcastInvalidate(['photos']);
  return result;
}

export async function revokeGoogleToken(token: string): Promise<void> {
  if (!token) return;
  try {
    await fetch(`${getGoogleOAuthBaseUrl()}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Best-effort token revocation
  }
}

