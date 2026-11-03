import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';

// ---- Fake Google Maps (Places API New + Routes API): tests never call the real, billed APIs ----
const calls: Array<{ path: string; key: string; fieldMask: string; body: Record<string, unknown> }> = [];
let routesReply: { status: number; body: unknown } = { status: 200, body: { routes: [{ duration: '1260s', distanceMeters: 15000 }] } };
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ path: req.url || '', key: String(req.headers['x-goog-api-key']), fieldMask: String(req.headers['x-goog-fieldmask']), body });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url?.startsWith('/v1/places:autocomplete'))
      return send(200, {
        suggestions: [
          {
            placePrediction: {
              placeId: 'ChIJdent',
              text: { text: 'Bright Smiles Dental, Springfield, IL' },
              structuredFormat: { mainText: { text: 'Bright Smiles Dental' }, secondaryText: { text: 'Lincoln Rd, Springfield, IL, USA' } },
            },
          },
        ],
      });
    if (req.url?.startsWith('/v1/places/ChIJdent'))
      return send(200, { displayName: { text: 'Bright Smiles Dental' }, formattedAddress: '4321 Lincoln Rd, Springfield, IL 62701, USA' });
    if (req.url?.startsWith('/directions/v2:computeRoutes')) return send(routesReply.status, routesReply.body);
    send(404, {});
  });
});
await new Promise<void>((r) => fake.listen(0, r));
const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
process.env.GOOGLE_PLACES_BASE_URL = base;
process.env.GOOGLE_ROUTES_BASE_URL = base;
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-drive-'));
delete process.env.GOOGLE_MAPS_API_KEY;

const { initSchema } = await import('../../src/server/db/schema.js');
const { seedIfNeeded } = await import('../../src/server/db/seed.js');
const { eventsRouter } = await import('../../src/server/routes/events.js');
const { settingsRouter } = await import('../../src/server/routes/settings.js');
const { mapsRouter } = await import('../../src/server/routes/maps.js');
const { refreshUpcomingDriveTimes } = await import('../../src/server/services/driveTimes.js');
initSchema();
seedIfNeeded();

const app = new Hono();
app.route('/api/events', eventsRouter);
app.route('/api/settings', settingsRouter);
app.route('/api/maps', mapsRouter);
const send = async <T>(method: string, url: string, body?: unknown) =>
  (await (
    await app.request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  ).json()) as T;

type Ev = { id: string; travelMinutes: number | null; travelManualMinutes: number | null; travelAutoMinutes: number | null };
const inDays = (d: number, hour = 15) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  t.setHours(hour, 0, 0, 0);
  return t.toISOString();
};
const addEvent = (title: string, location: string, extra: Record<string, unknown> = {}) =>
  send<Ev>('POST', '/api/events', { title, location, startIso: inDays(2), endIso: inDays(2, 16), memberIds: [], ...extra });
const getEv = async (id: string) => (await send<Ev[]>('GET', '/api/events')).find((e) => e.id === id)!;
const routeCalls = () => calls.filter((c) => c.path.startsWith('/directions'));

test.after(() => fake.close());

test('without a Maps key nothing is looked up and manual drive times work as before', async () => {
  const ev = await addEvent('Dentist', '4321 Lincoln Rd, Springfield, IL 62701');
  assert.equal(await refreshUpcomingDriveTimes(), 0);
  assert.deepEqual([ev.travelMinutes, ev.travelAutoMinutes], [null, null]);
  assert.deepEqual(await send('GET', '/api/maps/autocomplete?q=bright&session=s1'), []);
  assert.equal(calls.length, 0);
});

test('with a key + home: full addresses get a drive time; overrides win; one lookup per address', async () => {
  await send('PUT', '/api/settings', { googleMapsApiKey: 'AIza-test', homeAddress: '100 Home St, Springfield, IL 62701' });
  const settings = await send<{ mapsApiKeyConfigured: boolean; homeAddress: string }>('GET', '/api/settings');
  assert.equal(settings.mapsApiKeyConfigured, true);
  assert.equal(settings.homeAddress, '100 Home St, Springfield, IL 62701');

  const dentist = await addEvent('Dentist 2', '4321 lincoln rd,  Springfield, IL 62701'); // same place, different spacing/case
  const grandma = await addEvent("Grandma's", "Grandma's house");
  const manual = await addEvent('Soccer', '55 Field Way, Springfield, IL 62701', { travelMinutes: 15 });
  const none = await addEvent('Walk', '9 Park Ave, Springfield, IL 62701', { travelMinutes: 0 });
  calls.length = 0;

  assert.equal(await refreshUpcomingDriveTimes(), 1, 'one lookup covers both dentist events; overrides and non-addresses skipped');
  const [call] = routeCalls();
  assert.equal(call.key, 'AIza-test');
  assert.equal(call.fieldMask, 'routes.duration,routes.distanceMeters');
  assert.deepEqual(call.body.origin, { address: '100 Home St, Springfield, IL 62701' });
  assert.equal(call.body.routingPreference, 'TRAFFIC_AWARE');
  assert.ok(Date.parse(String(call.body.departureTime)) < Date.parse(inDays(2)), 'departs before the event starts');

  const d = await getEv(dentist.id);
  assert.deepEqual([d.travelMinutes, d.travelManualMinutes, d.travelAutoMinutes], [21, null, 21]);
  assert.equal((await getEv(grandma.id)).travelMinutes, null);
  assert.equal((await getEv(manual.id)).travelMinutes, 15);
  assert.equal((await getEv(none.id)).travelMinutes, null, '"No drive" stays off even for an address');

  // Switching an override back to automatic picks up the Google estimate.
  const back = await send<Ev>('PUT', `/api/events/${manual.id}`, { travelMinutes: null });
  assert.equal(back.travelManualMinutes, null);
  await refreshUpcomingDriveTimes();
  assert.equal((await getEv(manual.id)).travelMinutes, 21);

  calls.length = 0;
  assert.equal(await refreshUpcomingDriveTimes(), 0, 'fresh cache: no repeat lookups');
  assert.equal(calls.length, 0);
});

test('place search returns suggestions and a full address to save on the event', async () => {
  const list = await send<Array<{ placeId: string; main: string }>>('GET', '/api/maps/autocomplete?q=bright%20smiles&session=abc');
  assert.deepEqual(list.map((s) => s.main), ['Bright Smiles Dental']);
  const place = await send<{ location: string }>('GET', `/api/maps/place/${list[0].placeId}?session=abc`);
  assert.equal(place.location, 'Bright Smiles Dental, 4321 Lincoln Rd, Springfield, IL 62701');
  assert.ok(calls.some((c) => c.path.includes('sessionToken=abc')), 'details close the billing session');
});

test('road trips: 650 km gets a drive time; custom overrides up to 24 h are kept', async () => {
  routesReply = { status: 200, body: { routes: [{ duration: '24600s', distanceMeters: 650_000 }] } };
  const trip = await send<{ minutes: number | null; error: string | null }>('POST', '/api/maps/drive', { location: '6000 Universal Blvd, Orlando, FL 32819' });
  assert.deepEqual(trip, { minutes: 410, error: null, isAddress: true });
  const ev = await addEvent('Beach trip', 'Gainesville, FL 32601', { travelMinutes: 390 });
  assert.equal((await getEv(ev.id)).travelMinutes, 390);
  const capped = await send<Ev>('PUT', `/api/events/${ev.id}`, { travelMinutes: 5000 });
  assert.equal(capped.travelManualMinutes, 1440);
});

test('setup problems come back as plain-language errors', async () => {
  routesReply = {
    status: 403,
    body: {
      error: {
        code: 403,
        message: 'Routes API has not been used in project 123 before or it is disabled.',
        status: 'PERMISSION_DENIED',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    },
  };
  const res = await app.request('/api/maps/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination: '77 New Rd, Springfield, IL 62701' }),
  });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /Routes API isn't enabled/);

  routesReply = { status: 200, body: { routes: [{ duration: '600s', distanceMeters: 2_500_000 }] } };
  const far = await send<{ minutes: number | null; error: string }>('POST', '/api/maps/drive', { location: '1 Far Away Rd, Seattle, WA 98101' });
  assert.equal(far.minutes, null);
  assert.match(far.error, /too far away/);
});
