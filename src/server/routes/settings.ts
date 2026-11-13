import { Hono } from 'hono';
import { db, listBackups, performBackup, restoreBackup, runTransaction } from '../db/connection.js';
import { DEFAULT_SETTINGS } from '../db/seed.js';
import { broadcastInvalidate } from '../sse.js';
import {
  buildGoogleAuthUrl,
  discoverAccountCalendars,
  exchangeCodeAndSaveAccount,
  getGoogleOAuthConfig,
  revokeGoogleToken,
  syncAllEnabledCalendars,
  sourceMemberIds,
} from '../services/google.js';
import { getGeminiApiKey } from '../services/recipes.js';
import { getHomeAddress, getMapsApiKey, resetDriveCache, scheduleDriveRefresh } from '../services/driveTimes.js';
import { categoryForEvent, isEventCategory } from '../../shared/eventCategories.js';
import { orderAisles } from '../../shared/groceryClassifier.js';
import type { AppSettings, CalendarSource, FamilyMember, GoogleAccountInfo } from '../../shared/types.js';

export const settingsRouter = new Hono();

export function loadAppSettings(): AppSettings & {
  nightModeBrightness?: number;
  weatherRefreshMinutes?: number;
} {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, unknown> = {};
  for (const r of rows) {
    try {
      map[r.key] = JSON.parse(r.value);
    } catch {
      map[r.key] = r.value;
    }
  }
  const oauth = getGoogleOAuthConfig();
  return {
    familyName: String(map.familyName ?? DEFAULT_SETTINGS.familyName),
    kioskKeyboardEnabled: Boolean(
      map.kioskKeyboardEnabled ?? DEFAULT_SETTINGS.kioskKeyboardEnabled
    ),
    screensaverIdleMinutes: Number(
      map.screensaverIdleMinutes ?? DEFAULT_SETTINGS.screensaverIdleMinutes
    ),
    nightModeEnabled: Boolean(map.nightModeEnabled ?? DEFAULT_SETTINGS.nightModeEnabled),
    nightModeStart: String(map.nightModeStart ?? DEFAULT_SETTINGS.nightModeStart),
    nightModeEnd: String(map.nightModeEnd ?? DEFAULT_SETTINGS.nightModeEnd),
    nightModeBehavior:
      (map.nightModeBehavior as AppSettings['nightModeBehavior']) ??
      DEFAULT_SETTINGS.nightModeBehavior,
    nightModeBrightness: Number(map.nightModeBrightness ?? 25),
    weatherLat: Number(map.weatherLat ?? DEFAULT_SETTINGS.weatherLat),
    weatherLon: Number(map.weatherLon ?? DEFAULT_SETTINGS.weatherLon),
    weatherLocationName: String(
      map.weatherLocationName ?? DEFAULT_SETTINGS.weatherLocationName
    ),
    weatherUnit: (map.weatherUnit as 'F' | 'C') ?? DEFAULT_SETTINGS.weatherUnit,
    weatherRefreshMinutes: Number(map.weatherRefreshMinutes ?? 30),
    showDinnerOnCalendar: Boolean(
      map.showDinnerOnCalendar ?? DEFAULT_SETTINGS.showDinnerOnCalendar
    ),
    showBirthdays: Boolean(map.showBirthdays ?? DEFAULT_SETTINGS.showBirthdays),
    showHolidays: Boolean(map.showHolidays ?? DEFAULT_SETTINGS.showHolidays),
    showWeatherOnCalendar: Boolean(map.showWeatherOnCalendar ?? true),
    showBriefOnScreensaver: Boolean(map.showBriefOnScreensaver ?? DEFAULT_SETTINGS.showBriefOnScreensaver),
    groceryAisleOrder: orderAisles(Array.isArray(map.groceryAisleOrder) ? (map.groceryAisleOrder as string[]) : null),
    defaultGroceryListId: String(
      map.defaultGroceryListId ?? DEFAULT_SETTINGS.defaultGroceryListId
    ),
    googleClientId: oauth.clientId,
    googleClientSecretConfigured: Boolean(oauth.clientSecret),
    geminiApiKeyConfigured: Boolean(getGeminiApiKey()),
    mapsApiKeyConfigured: Boolean(getMapsApiKey()),
    homeAddress: getHomeAddress(),
    lastBackupAt: map.lastBackupAt ? String(map.lastBackupAt) : null,
  };
}

settingsRouter.get('/', (c) => {
  return c.json(loadAppSettings());
});

settingsRouter.put('/', async (c) => {
  const body = await c.req.json<
    Partial<AppSettings> & {
      googleClientSecret?: string;
      geminiApiKey?: string;
      googleMapsApiKey?: string;
      nightModeBrightness?: number;
      weatherRefreshMinutes?: number;
    }
  >();
  const upsert = db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  const allowedKeys = [
    'familyName',
    'kioskKeyboardEnabled',
    'screensaverIdleMinutes',
    'nightModeEnabled',
    'nightModeStart',
    'nightModeEnd',
    'nightModeBehavior',
    'nightModeBrightness',
    'weatherLat',
    'weatherLon',
    'weatherLocationName',
    'weatherUnit',
    'weatherRefreshMinutes',
    'showDinnerOnCalendar',
    'showBirthdays',
    'showHolidays',
    'showWeatherOnCalendar',
    'showBriefOnScreensaver',
    'groceryAisleOrder',
    'defaultGroceryListId',
    'googleClientId',
    'homeAddress',
  ] as const;

  for (const key of allowedKeys) {
    if (body[key as keyof typeof body] !== undefined) {
      upsert.run(key, JSON.stringify(body[key as keyof typeof body]));
    }
  }
  if (typeof body.googleClientSecret === 'string' && body.googleClientSecret.trim()) {
    upsert.run('googleClientSecret', JSON.stringify(body.googleClientSecret.trim()));
  }
  if (typeof body.geminiApiKey === 'string') {
    upsert.run('geminiApiKey', JSON.stringify(body.geminiApiKey.trim()));
  }
  if (typeof body.googleMapsApiKey === 'string') {
    upsert.run('googleMapsApiKey', JSON.stringify(body.googleMapsApiKey.trim()));
  }
  if (typeof body.googleMapsApiKey === 'string' || typeof body.homeAddress === 'string') {
    scheduleDriveRefresh(); // new key or new home: look up drive times again
    broadcastInvalidate(['events']);
  }

  broadcastInvalidate(['settings']);
  return c.json(loadAppSettings());
});

settingsRouter.post('/backup', (c) => {
  const file = performBackup();
  broadcastInvalidate(['settings']);
  return c.json({ ok: true, file });
});

settingsRouter.get('/backups', (c) => c.json(listBackups()));

/** Replaces everything with a backup (a safety copy of the current data is saved first). */
settingsRouter.post('/backups/:name/restore', (c) => {
  try {
    const result = restoreBackup(c.req.param('name'));
    resetDriveCache();
    broadcastInvalidate(['family', 'events', 'chores', 'lists', 'meals', 'recipes', 'photos', 'settings', 'countdowns', 'rewards', 'routines', 'habits']);
    return c.json({ ok: true, ...result });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Restore failed' }, 400);
  }
});

// Multi-Account Google OAuth & Calendar-to-Member Mapping
settingsRouter.get('/google/accounts', (c) => {
  const accRows = db
    .prepare(
      'SELECT id, email, display_name, avatar_url, last_synced_at, sync_status, sync_error FROM google_accounts ORDER BY email ASC'
    )
    .all() as Record<string, unknown>[];

  const accounts: GoogleAccountInfo[] = accRows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    displayName: String(r.display_name),
    avatarUrl: r.avatar_url ? String(r.avatar_url) : null,
    lastSyncedAt: r.last_synced_at ? String(r.last_synced_at) : null,
    syncStatus: (r.sync_status as GoogleAccountInfo['syncStatus']) || 'idle',
    syncError: r.sync_error ? String(r.sync_error) : null,
  }));

  const srcRows = db
    .prepare(
      `SELECT cs.*, ga.email as account_email
       FROM calendar_sources cs
       JOIN google_accounts ga ON ga.id = cs.google_account_id
       ORDER BY ga.email ASC, cs.name ASC`
    )
    .all() as Record<string, unknown>[];

  const sources: CalendarSource[] = srcRows.map((s) => ({
    id: String(s.id),
    googleAccountId: String(s.google_account_id),
    accountEmail: String(s.account_email),
    externalCalendarId: String(s.external_calendar_id),
    name: String(s.name),
    memberIds: sourceMemberIds(s as { member_ids_json?: string; member_id?: string }),
    syncError: s.sync_error ? String(s.sync_error) : null,
    category: isEventCategory(s.category) ? s.category : null,
    enabled: Boolean(s.enabled),
    isWritable: Boolean(s.is_writable),
    lastSyncedAt: s.last_synced_at ? String(s.last_synced_at) : null,
  }));

  return c.json({ accounts, sources });
});

settingsRouter.get('/google/auth-url', (c) => {
  try {
    const origin = new URL(c.req.url).origin;
    const url = buildGoogleAuthUrl(origin);
    return c.json({ url });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'OAuth config missing' }, 400);
  }
});

async function disconnectAccount(accountId: string) {
  const acc = db
    .prepare('SELECT access_token, refresh_token FROM google_accounts WHERE id = ?')
    .get(accountId) as { access_token?: string; refresh_token?: string } | undefined;

  if (acc) {
    if (acc.refresh_token) {
      await revokeGoogleToken(acc.refresh_token);
    } else if (acc.access_token) {
      await revokeGoogleToken(acc.access_token);
    }
  }

  db.prepare(
    `DELETE FROM events WHERE calendar_source_id IN (
       SELECT id FROM calendar_sources WHERE google_account_id = ?
     )`
  ).run(accountId);
  db.prepare('DELETE FROM calendar_sources WHERE google_account_id = ?').run(accountId);
  db.prepare('DELETE FROM google_accounts WHERE id = ?').run(accountId);
}

settingsRouter.delete('/google/accounts/:id', async (c) => {
  const id = c.req.param('id');
  await disconnectAccount(id);
  broadcastInvalidate(['settings', 'events']);
  return c.json({ ok: true });
});

settingsRouter.post('/disconnect-google', async (c) => {
  let targetId: string | undefined;
  try {
    const body = await c.req.json<{ accountId?: string }>();
    targetId = body?.accountId;
  } catch {
    // optional body
  }

  if (targetId) {
    await disconnectAccount(targetId);
  } else {
    const accounts = db.prepare('SELECT id FROM google_accounts').all() as Array<{ id: string }>;
    for (const acc of accounts) {
      await disconnectAccount(acc.id);
    }
  }
  broadcastInvalidate(['settings', 'events']);
  return c.json({ ok: true });
});

settingsRouter.post('/google/disconnect', async (c) => {
  let targetId: string | undefined;
  try {
    const body = await c.req.json<{ accountId?: string }>();
    targetId = body?.accountId;
  } catch {
    // optional body
  }

  if (targetId) {
    await disconnectAccount(targetId);
  } else {
    const accounts = db.prepare('SELECT id FROM google_accounts').all() as Array<{ id: string }>;
    for (const acc of accounts) {
      await disconnectAccount(acc.id);
    }
  }
  broadcastInvalidate(['settings', 'events']);
  return c.json({ ok: true });
});

settingsRouter.put('/google/sources/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ enabled?: boolean; memberIds?: string[]; category?: string | null }>();
  const existing = db.prepare('SELECT * FROM calendar_sources WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const enabled = body.enabled !== undefined ? (body.enabled ? 1 : 0) : Number(existing.enabled);
  const validIds = new Set(
    (db.prepare('SELECT id FROM family_members').all() as Array<{ id: string }>).map((m) => m.id)
  );
  const memberIds =
    body.memberIds !== undefined
      ? [...new Set(body.memberIds.map(String))].filter((m) => validIds.has(m))
      : sourceMemberIds(existing as { member_ids_json?: string; member_id?: string });

  db.prepare(
    'UPDATE calendar_sources SET enabled = ?, member_ids_json = ?, member_id = ? WHERE id = ?'
  ).run(enabled, JSON.stringify(memberIds), memberIds[0] ?? null, id);

  // Birthday/holiday tag for the whole calendar (null = normal calendar; "…Birthday" titles still detected).
  if (body.category !== undefined) {
    const category = isEventCategory(body.category) ? body.category : null;
    db.prepare('UPDATE calendar_sources SET category = ? WHERE id = ?').run(category, id);
    const evs = db.prepare('SELECT id, title FROM events WHERE calendar_source_id = ?').all(id) as Array<{
      id: string;
      title: string;
    }>;
    const setCat = db.prepare('UPDATE events SET category = ? WHERE id = ?');
    for (const ev of evs) setCat.run(categoryForEvent(category, ev.title), ev.id);
  }

  // Re-assign already-synced events from this calendar to the new set of people.
  if (body.memberIds !== undefined) {
    db.prepare('UPDATE events SET member_ids_json = ? WHERE calendar_source_id = ?').run(
      JSON.stringify(memberIds),
      id
    );
  }

  syncAllEnabledCalendars().catch(() => {});
  broadcastInvalidate(['settings', 'events']);
  return c.json({ ok: true });
});

settingsRouter.post('/google/sync-now', async (c) => {
  const accounts = db.prepare('SELECT id, email FROM google_accounts').all() as Array<{ id: string; email: string }>;
  const failed: Array<{ calendar: string; account: string; message: string }> = [];
  for (const acc of accounts) {
    try {
      await discoverAccountCalendars(acc.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed.push({ calendar: 'Calendar list', account: acc.email, message });
      db.prepare("UPDATE google_accounts SET sync_status = 'error', sync_error = ? WHERE id = ?").run(
        `Could not list calendars: ${message}`,
        acc.id
      );
    }
  }
  let synced = 0;
  try {
    const summary = await syncAllEnabledCalendars(true);
    synced = summary.synced;
    failed.push(...summary.failed);
  } catch (err) {
    failed.push({ calendar: 'All calendars', account: '', message: err instanceof Error ? err.message : String(err) });
  }
  const eventCount = (db.prepare('SELECT COUNT(*) AS n FROM events WHERE calendar_source_id IS NOT NULL').get() as { n: number }).n;
  broadcastInvalidate(['settings', 'events']);
  return c.json({ ok: failed.length === 0, accounts: accounts.length, synced, failed, eventCount });
});

function mapMemberRow(row: Record<string, unknown>): FamilyMember {
  return {
    id: String(row.id),
    name: String(row.name),
    initial: String(row.initial),
    emoji: String(row.emoji),
    role: row.role as FamilyMember['role'],
    colorBg: String(row.color_bg),
    colorText: String(row.color_text),
    colorAccent: String(row.color_accent),
    sortOrder: Number(row.sort_order),
  };
}

settingsRouter.get('/members', (c) => {
  const rows = db
    .prepare('SELECT * FROM family_members ORDER BY sort_order ASC, name ASC')
    .all() as Record<string, unknown>[];
  return c.json(rows.map(mapMemberRow));
});

settingsRouter.put('/members/reorder', async (c) => {
  const body = await c.req.json<{ order: string[] }>();
  const order = Array.isArray(body?.order) ? body.order : [];
  if (order.length > 0) {
    const stmt = db.prepare('UPDATE family_members SET sort_order = ? WHERE id = ?');
    runTransaction(() => {
      order.forEach((id, index) => {
        stmt.run(index, id);
      });
    });
    broadcastInvalidate(['family']);
  }
  return c.json({ ok: true });
});

settingsRouter.put('/members/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<FamilyMember>>();
  const existing = db
    .prepare('SELECT * FROM family_members WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = (body.name ?? String(existing.name)).trim();
  db.prepare(
    `UPDATE family_members
     SET name = ?, initial = ?, emoji = ?, role = ?, color_bg = ?, color_text = ?, color_accent = ?, sort_order = ?
     WHERE id = ?`
  ).run(
    name,
    (body.initial ?? name[0] ?? '?').toUpperCase(),
    body.emoji ?? String(existing.emoji),
    body.role ?? String(existing.role),
    body.colorBg ?? String(existing.color_bg),
    body.colorText ?? String(existing.color_text),
    body.colorAccent ?? String(existing.color_accent),
    body.sortOrder ?? Number(existing.sort_order),
    id
  );

  broadcastInvalidate(['family']);
  const updated = db
    .prepare('SELECT * FROM family_members WHERE id = ?')
    .get(id) as Record<string, unknown>;
  return c.json(mapMemberRow(updated));
});

export async function handleGoogleOAuthCallbackRoute(code: string, origin: string) {
  await exchangeCodeAndSaveAccount(code, origin);
}
