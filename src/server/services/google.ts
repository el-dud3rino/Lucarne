import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, MEDIA_PHOTOS_DIR, runTransaction } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';

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
    throw new Error(`OAuth token exchange failed: ${errTxt}`);
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
    throw new Error(`Token refresh failed (${res.status})`);
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
  if (!res.ok) throw new Error(`Failed to list calendars (${res.status})`);
  const data = (await res.json()) as {
    items?: Array<{ id: string; summary: string; accessRole: string; primary?: boolean }>;
  };

  const defaultMember = db
    .prepare('SELECT id FROM family_members ORDER BY sort_order ASC LIMIT 1')
    .get() as { id: string } | undefined;

  const upsert = db.prepare(`
    INSERT INTO calendar_sources (id, google_account_id, external_calendar_id, name, member_id, enabled, is_writable)
    VALUES (?, ?, ?, ?, ?, ?, ?)
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
      defaultMember?.id || null,
      cal.primary ? 1 : 0,
      writable
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
            throw new Error(`Google Calendar delete failed (${res.status})`);
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
            start: payload.allDay
              ? { date: payload.startIso.slice(0, 10) }
              : { dateTime: payload.startIso },
            end: payload.allDay
              ? { date: payload.endIso.slice(0, 10) }
              : { dateTime: payload.endIso },
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
            throw new Error(`Google Calendar write failed (${res.status})`);
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

export async function syncAllEnabledCalendars(force = false): Promise<void> {
  await flushOutboxMutations(force);

  const sources = db
    .prepare('SELECT * FROM calendar_sources WHERE enabled = 1')
    .all() as Array<{
    id: string;
    google_account_id: string;
    external_calendar_id: string;
    member_id: string | null;
    sync_token: string | null;
  }>;

  if (sources.length === 0) return;
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

      if (!res.ok) throw new Error(`Calendar sync HTTP ${res.status}`);

      const data = (await res.json()) as {
        nextSyncToken?: string;
        items?: Array<{
          id: string;
          status: string;
          summary?: string;
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
          const startIso =
            gEv.start?.dateTime ||
            (gEv.start?.date ? `${gEv.start.date}T00:00:00.000Z` : nowIso);
          const endIso =
            gEv.end?.dateTime ||
            (gEv.end?.date ? `${gEv.end.date}T23:59:59.000Z` : startIso);
          const memberIds = src.member_id ? [src.member_id] : [];

          if (existing) {
            db.prepare(
              `UPDATE events SET title = ?, description = ?, location = ?, start_iso = ?, end_iso = ?, all_day = ?, member_ids_json = ?, updated_at = ?
               WHERE id = ?`
            ).run(
              gEv.summary || '(Untitled)',
              gEv.description || '',
              gEv.location || '',
              startIso,
              endIso,
              allDay ? 1 : 0,
              JSON.stringify(memberIds),
              nowIso,
              existing.id
            );
          } else {
            db.prepare(
              `INSERT INTO events (id, title, description, location, start_iso, end_iso, all_day, member_ids_json, calendar_source_id, external_event_id, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
              nowIso
            );
          }
          anyChanged = true;
        }

        db.prepare(
          'UPDATE calendar_sources SET sync_token = ?, last_synced_at = ? WHERE id = ?'
        ).run(data.nextSyncToken || src.sync_token, nowIso, src.id);
        db.prepare(
          "UPDATE google_accounts SET last_synced_at = ?, sync_status = 'ok', sync_error = NULL WHERE id = ?"
        ).run(nowIso, src.google_account_id);
      });
    } catch (err) {
      db.prepare(
        "UPDATE google_accounts SET sync_status = 'error', sync_error = ? WHERE id = ?"
      ).run(err instanceof Error ? err.message : String(err), src.google_account_id);
    }
  }

  if (anyChanged) {
    broadcastInvalidate(['events']);
  }
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
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Photos Picker API error (${res.status}): ${txt}`);
  }
  const data = (await res.json()) as { id: string; pickerUri: string };
  return { sessionId: data.id, pickerUri: data.pickerUri };
}

export async function pollAndImportPhotosPickerSession(
  accountId: string,
  sessionId: string
): Promise<{ ready: boolean; importedCount: number }> {
  const token = await getValidAccessToken(accountId);
  const sRes = await fetch(
    `${getGooglePhotosPickerBaseUrl()}/v1/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!sRes.ok) throw new Error(`Failed to check picker session (${sRes.status})`);
  const session = (await sRes.json()) as { mediaItemsSet?: boolean };
  if (!session.mediaItemsSet) {
    return { ready: false, importedCount: 0 };
  }

  const mRes = await fetch(
    `${getGooglePhotosPickerBaseUrl()}/v1/mediaItems?sessionId=${encodeURIComponent(
      sessionId
    )}&pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!mRes.ok) throw new Error(`Failed to list picked photos (${mRes.status})`);
  const mediaData = (await mRes.json()) as {
    mediaItems?: Array<{
      id: string;
      mediaFile?: {
        baseUrl: string;
        mediaFileMetadata?: { width?: number; height?: number };
      };
    }>;
  };

  let imported = 0;
  const nowIso = new Date().toISOString();
  const insertStmt = db.prepare(`
    INSERT INTO photos (id, url, orientation, caption, source, external_id, created_at)
    VALUES (?, ?, ?, '', 'google_photos', ?, ?)
  `);

  for (const item of mediaData.mediaItems || []) {
    const baseUrl = item.mediaFile?.baseUrl;
    if (!baseUrl) continue;

    const already = db
      .prepare('SELECT id FROM photos WHERE external_id = ?')
      .get(item.id) as { id: string } | undefined;
    if (already) continue;

    // Download 1920x1080 version directly to local SSD so URLs never expire
    const itemDownloadUrl = baseUrl.startsWith('http')
      ? `${baseUrl}=w1920-h1080`
      : `${getGooglePhotosPickerBaseUrl()}${baseUrl.startsWith('/') ? '' : '/'}${baseUrl}=w1920-h1080`;

    const dlRes = await fetch(itemDownloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dlRes.ok) continue;
    const buf = Buffer.from(await dlRes.arrayBuffer());
    const filename = `${crypto.randomUUID()}.jpg`;
    fs.writeFileSync(path.join(MEDIA_PHOTOS_DIR, filename), buf);

    const w = item.mediaFile?.mediaFileMetadata?.width || 1920;
    const h = item.mediaFile?.mediaFileMetadata?.height || 1080;
    const orientation = h > w ? 'portrait' : 'landscape';

    insertStmt.run(crypto.randomUUID(), `/media/photos/${filename}`, orientation, item.id, nowIso);
    imported++;
  }

  if (imported > 0) {
    broadcastInvalidate(['photos']);
  }
  return { ready: true, importedCount: imported };
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

