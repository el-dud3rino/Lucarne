import { Hono } from 'hono';
import { db } from '../db/connection.js';
import {
  autocompletePlaces,
  driveTimeFor,
  getHomeAddress,
  getMapsApiKey,
  lastDriveRefreshError,
  MapsError,
  placeDetails,
  refreshUpcomingDriveTimes,
} from '../services/driveTimes.js';
import { isFullAddress } from '../../shared/driveTime.js';

/** Google Maps helpers for the event form and Settings (the API key stays on the server). */
export const mapsRouter = new Hono();

const fail = (err: unknown) => (err instanceof MapsError ? err.message : `Google Maps request failed: ${(err as Error).message}`);

function weatherBias(): { lat: number; lon: number } | undefined {
  const get = (k: string) => {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k) as { value: string } | undefined;
    return row ? Number(JSON.parse(row.value)) : NaN;
  };
  try {
    const lat = get('weatherLat');
    const lon = get('weatherLon');
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : undefined;
  } catch {
    return undefined;
  }
}

mapsRouter.get('/status', (c) =>
  c.json({ configured: Boolean(getMapsApiKey()), homeAddress: getHomeAddress(), lastError: lastDriveRefreshError() })
);

mapsRouter.get('/autocomplete', async (c) => {
  const q = c.req.query('q') || '';
  const session = c.req.query('session') || '';
  if (!getMapsApiKey()) return c.json([]);
  try {
    return c.json(await autocompletePlaces(q, session, weatherBias()));
  } catch (err) {
    return c.json({ error: fail(err) }, 502);
  }
});

mapsRouter.get('/place/:id', async (c) => {
  try {
    return c.json(await placeDetails(c.req.param('id'), c.req.query('session') || ''));
  } catch (err) {
    return c.json({ error: fail(err) }, 502);
  }
});

/** Drive time preview for the event form: { minutes, error, isAddress }. */
mapsRouter.post('/drive', async (c) => {
  const { location, startIso } = await c.req.json<{ location?: string; startIso?: string }>();
  const loc = (location || '').trim();
  if (!getMapsApiKey()) return c.json({ minutes: null, error: null, isAddress: isFullAddress(loc) });
  const r = await driveTimeFor(loc, startIso);
  return c.json({ ...r, isAddress: isFullAddress(loc) });
});

/** Settings "Test" button: drive time from home to an address, always asking Google fresh. */
mapsRouter.post('/test', async (c) => {
  const { destination } = await c.req.json<{ destination?: string }>();
  const r = await driveTimeFor((destination || '').trim(), null, { force: true });
  if (r.error) return c.json({ error: r.error }, 400);
  refreshUpcomingDriveTimes().catch(() => {});
  return c.json(r);
});
