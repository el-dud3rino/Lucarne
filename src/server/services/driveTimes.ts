import { db } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import { getEventsInRange } from '../routes/events.js';
import { addressKey, isFullAddress } from '../../shared/driveTime.js';

/**
 * Google Maps integration: place search for the event form (Places API "New") and drive times from
 * home with predicted traffic (Routes API). The API key never leaves the server.
 *
 * Drive times are cached per destination address in `drive_times` and refreshed in the background:
 * once when an address first appears, weekly after that, and once more in the hours before an event
 * so the estimate reflects that day's traffic. A household uses a few hundred requests a month.
 */

const placesBase = () => (process.env.GOOGLE_PLACES_BASE_URL || 'https://places.googleapis.com').replace(/\/+$/, '');
const routesBase = () => (process.env.GOOGLE_ROUTES_BASE_URL || 'https://routes.googleapis.com').replace(/\/+$/, '');

const REFRESH_AFTER_MS = 7 * 86_400_000;
const NEAR_EVENT_MS = 3 * 3600_000; // re-check traffic when an event is this close...
const NEAR_EVENT_STALE_MS = 6 * 3600_000; // ...and the estimate is older than this
const MAX_REASONABLE_KM = 2000; // road trips are fine; farther than ~20 h of driving is surely the wrong place
const MAX_ROUTES_PER_RUN = 25;

function readSetting(key: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return '';
  try {
    const v = JSON.parse(row.value);
    return typeof v === 'string' ? v : '';
  } catch {
    return row.value;
  }
}

export function getMapsApiKey(): string {
  return readSetting('googleMapsApiKey').trim() || (process.env.GOOGLE_MAPS_API_KEY || '').trim();
}

export function getHomeAddress(): string {
  return readSetting('homeAddress').trim();
}

export class MapsError extends Error {}

/** Short, human message from a Google Maps API error reply. */
function describeMapsError(status: number, body: string, api: string): string {
  const msg = body.match(/"message":\s*"([^"]+)"/)?.[1] ?? '';
  if (/API_KEY_INVALID|API key not valid/i.test(body)) return 'Google rejected the Maps API key. Check it in Settings.';
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(body))
    return `The ${api} isn't enabled for this key's Google Cloud project. Enable it in the Cloud console, wait a minute, then try again.`;
  if (/BILLING|billing/i.test(body)) return 'Google Maps needs billing turned on for this Google Cloud project.';
  if (/API_KEY_SERVICE_BLOCKED|referer|IP address/i.test(body))
    return `This Maps API key isn't allowed to use the ${api}. Check the key's API restrictions.`;
  if (status === 429) return 'Google Maps request limit reached. Try again later.';
  return `Google Maps error (${status})${msg ? `: ${msg.slice(0, 160)}` : ''}`;
}

async function mapsFetch(url: string, init: RequestInit, api: string, fieldMask: string): Promise<unknown> {
  const key = getMapsApiKey();
  if (!key) throw new MapsError('Add a Google Maps API key in Settings first.');
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask, ...(init.headers || {}) },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new MapsError(describeMapsError(res.status, text, api));
  return JSON.parse(text || '{}');
}

// ---------- Places: search as you type ----------

export interface PlaceSuggestion {
  placeId: string;
  main: string;
  secondary: string;
}

export async function autocompletePlaces(
  input: string,
  sessionToken: string,
  bias?: { lat: number; lon: number }
): Promise<PlaceSuggestion[]> {
  if (input.trim().length < 2) return [];
  const body: Record<string, unknown> = { input: input.trim(), sessionToken };
  if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
    body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lon }, radius: 50_000 } };
  }
  const data = (await mapsFetch(
    `${placesBase()}/v1/places:autocomplete`,
    { method: 'POST', body: JSON.stringify(body) },
    'Places API (New)',
    'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text'
  )) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
      };
    }>;
  };
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      placeId: p.placeId!,
      main: p.structuredFormat?.mainText?.text || p.text?.text || '',
      secondary: p.structuredFormat?.secondaryText?.text || '',
    }));
}

/** The location text saved on the event: "Bright Smiles Dental, 123 Main St, Springfield, IL 62701". */
export function placeLocationText(name: string, address: string): string {
  const addr = address.replace(/,\s*(USA|United States)$/i, '').trim();
  if (!name || addr.toLowerCase().startsWith(name.toLowerCase())) return addr || name;
  return `${name}, ${addr}`;
}

export async function placeDetails(placeId: string, sessionToken: string): Promise<{ location: string }> {
  if (!/^[A-Za-z0-9_-]+$/.test(placeId)) throw new MapsError('Unknown place');
  const data = (await mapsFetch(
    `${placesBase()}/v1/places/${placeId}?sessionToken=${encodeURIComponent(sessionToken)}`,
    { method: 'GET' },
    'Places API (New)',
    'displayName,formattedAddress'
  )) as { displayName?: { text?: string }; formattedAddress?: string };
  const location = placeLocationText(data.displayName?.text || '', data.formattedAddress || '');
  if (!location) throw new MapsError('Google returned no address for that place');
  return { location };
}

// ---------- Routes: drive time from home ----------

export async function computeDriveMinutes(
  origin: string,
  destination: string,
  departIso?: string | null
): Promise<{ minutes: number; distanceM: number }> {
  const body: Record<string, unknown> = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
  };
  // Predicted traffic for the actual departure (must be in the future, else "now" is used).
  if (departIso && Date.parse(departIso) > Date.now() + 60_000) body.departureTime = new Date(departIso).toISOString();
  const data = (await mapsFetch(
    `${routesBase()}/directions/v2:computeRoutes`,
    { method: 'POST', body: JSON.stringify(body) },
    'Routes API',
    'routes.duration,routes.distanceMeters'
  )) as { routes?: Array<{ duration?: string; distanceMeters?: number }> };
  const route = data.routes?.[0];
  const seconds = Number(String(route?.duration ?? '').replace(/s$/, ''));
  if (!route || !Number.isFinite(seconds) || seconds <= 0) throw new MapsError("Google couldn't find a driving route to that address");
  const distanceM = Number(route.distanceMeters ?? 0);
  if (distanceM > MAX_REASONABLE_KM * 1000) throw new MapsError('That address is too far away for a drive time (wrong place?)');
  return { minutes: Math.max(1, Math.ceil(seconds / 60)), distanceM };
}

interface CachedDrive {
  homeKey: string;
  minutes: number | null;
  distanceM: number | null;
  error: string | null;
  computedAt: number;
}

let cache: Map<string, CachedDrive> | null = null;

function loadCache(): Map<string, CachedDrive> {
  if (cache) return cache;
  cache = new Map();
  // "Too far" answers saved under the old 400 km limit: forget them so road trips get looked up.
  db.prepare("DELETE FROM drive_times WHERE error LIKE '%too far away%' AND distance_m IS NULL").run();
  for (const r of db.prepare('SELECT * FROM drive_times').all() as Record<string, unknown>[]) {
    cache.set(String(r.dest_key), {
      homeKey: String(r.home_key),
      minutes: r.minutes == null ? null : Number(r.minutes),
      distanceM: r.distance_m == null ? null : Number(r.distance_m),
      error: r.error ? String(r.error) : null,
      computedAt: Date.parse(String(r.computed_at)) || 0,
    });
  }
  return cache;
}

/** Forget the in-memory copy (tests, backup restore). */
export function resetDriveCache(): void {
  cache = null;
}

function store(destKey: string, entry: CachedDrive): void {
  loadCache().set(destKey, entry);
  db.prepare(
    `INSERT INTO drive_times (dest_key, home_key, minutes, distance_m, error, computed_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(dest_key) DO UPDATE SET home_key = excluded.home_key, minutes = excluded.minutes,
       distance_m = excluded.distance_m, error = excluded.error, computed_at = excluded.computed_at`
  ).run(destKey, entry.homeKey, entry.minutes, entry.distanceM, entry.error, new Date(entry.computedAt).toISOString());
}

/** Automatic drive time for an event location, from the cache (null when unknown / not an address / Maps off). */
export function autoDriveMinutes(location: string | null | undefined): number | null {
  if (!location || !isFullAddress(location)) return null;
  const home = getHomeAddress();
  if (!home || !getMapsApiKey()) return null;
  const hit = loadCache().get(addressKey(location));
  return hit && hit.homeKey === addressKey(home) ? hit.minutes : null;
}

/** Looks up (or reuses a fresh cached) drive time from home to `location`, departing for an event at `startIso`. */
export async function driveTimeFor(
  location: string,
  startIso?: string | null,
  opts: { force?: boolean } = {}
): Promise<{ minutes: number | null; error: string | null }> {
  const home = getHomeAddress();
  if (!home) return { minutes: null, error: 'Add your home address in Settings → Maps & drive times.' };
  if (!isFullAddress(location)) return { minutes: null, error: null };
  const destKey = addressKey(location);
  const homeKey = addressKey(home);
  const hit = loadCache().get(destKey);
  if (!opts.force && hit && hit.homeKey === homeKey && Date.now() - hit.computedAt < REFRESH_AFTER_MS) {
    return { minutes: hit.minutes, error: hit.error };
  }
  const guess = hit?.minutes ?? 20;
  const departIso = startIso ? new Date(Date.parse(startIso) - guess * 60_000).toISOString() : null;
  try {
    const r = await computeDriveMinutes(home, location, departIso);
    store(destKey, { homeKey, minutes: r.minutes, distanceM: r.distanceM, error: null, computedAt: Date.now() });
    return { minutes: r.minutes, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // Remember "no route" answers so we don't ask again every run; key/billing problems aren't cached.
    if (/couldn't find a driving route|too far away/.test(error)) {
      store(destKey, { homeKey, minutes: null, distanceM: null, error, computedAt: Date.now() });
    }
    return { minutes: null, error };
  }
}

let running: Promise<number> | null = null;
let lastRunError: string | null = null;

export function lastDriveRefreshError(): string | null {
  return lastRunError;
}

/**
 * Fills in drive times for the coming week's timed events whose location is a full address and that
 * have no manual override. Returns how many addresses were looked up.
 */
export function refreshUpcomingDriveTimes(now = Date.now()): Promise<number> {
  if (running) return running;
  running = (async () => {
    if (!getMapsApiKey() || !getHomeAddress()) return 0;
    const homeKey = addressKey(getHomeAddress());
    const events = getEventsInRange(new Date(now).toISOString(), new Date(now + 7 * 86_400_000).toISOString());
    const due = new Map<string, { location: string; startIso: string; force: boolean }>();
    for (const ev of events) {
      if (ev.allDay || ev.travelManualMinutes != null || !isFullAddress(ev.location)) continue;
      const start = Date.parse(ev.startIso);
      if (start <= now) continue;
      const key = addressKey(ev.location);
      if (due.has(key)) continue;
      const hit = loadCache().get(key);
      const fresh = hit && hit.homeKey === homeKey && now - hit.computedAt < REFRESH_AFTER_MS;
      const nearAndStale = Boolean(hit?.minutes) && start - now < NEAR_EVENT_MS && now - (hit?.computedAt ?? 0) > NEAR_EVENT_STALE_MS;
      if (!fresh || nearAndStale) due.set(key, { location: ev.location, startIso: ev.startIso, force: nearAndStale });
    }
    let looked = 0;
    lastRunError = null;
    for (const { location, startIso, force } of [...due.values()].slice(0, MAX_ROUTES_PER_RUN)) {
      const r = await driveTimeFor(location, startIso, { force });
      looked++;
      if (r.error && !/couldn't find a driving route|too far away/.test(r.error)) {
        lastRunError = r.error; // key / billing / API not enabled: stop, every lookup would fail the same way
        break;
      }
    }
    if (looked > 0) broadcastInvalidate(['events']);
    return looked;
  })().finally(() => {
    running = null;
  });
  return running;
}

let debounce: NodeJS.Timeout | null = null;
/** Called after events or Maps settings change: refresh shortly, once. */
export function scheduleDriveRefresh(delayMs = 1500): void {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    refreshUpcomingDriveTimes().catch(() => {});
  }, delayMs);
  debounce.unref?.();
}
