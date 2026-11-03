import test from 'node:test';
import assert from 'node:assert/strict';
import { geocodePlace } from '../../src/client/lib/geocode.js';

// Shape of Open-Meteo's geocoding reply for "Springfield" (most populous first).
const SPRINGFIELD = {
  results: [
    { name: 'Springfield', latitude: 37.215, longitude: -93.298, admin1: 'Missouri', country: 'United States', country_code: 'US' },
    { name: 'Springfield', latitude: 39.801, longitude: -89.644, admin1: 'Illinois', country: 'United States', country_code: 'US' },
    { name: 'Springfield', latitude: 42.101, longitude: -72.59, admin1: 'Massachusetts', country: 'United States', country_code: 'US' },
  ],
};
const fakeFetch = (body: unknown, seen: string[] = []) =>
  (async (url: string) => {
    seen.push(url);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

test('"City, ST" picks the right state and searches by the city name only', async () => {
  const seen: string[] = [];
  const r = await geocodePlace('Springfield, il', fakeFetch(SPRINGFIELD, seen));
  assert.deepEqual(r, { lat: 39.801, lon: -89.644, label: 'Springfield, Illinois' });
  assert.match(seen[0], /name=Springfield&/);
  assert.equal((await geocodePlace('Springfield, Massachusetts', fakeFetch(SPRINGFIELD))).label, 'Springfield, Massachusetts');
});

test('no qualifier takes the top hit; an unknown state or place is an error, never a silent default', async () => {
  assert.equal((await geocodePlace('Springfield', fakeFetch(SPRINGFIELD))).label, 'Springfield, Missouri');
  await assert.rejects(geocodePlace('Springfield, ZZ', fakeFetch(SPRINGFIELD)), /Couldn't find "Springfield, ZZ"/);
  await assert.rejects(geocodePlace('Nowhereville', fakeFetch({})), /Couldn't find/);
  await assert.rejects(geocodePlace('  ', fakeFetch(SPRINGFIELD)), /Type a city/);
});

test('non-US places are labelled with the country', async () => {
  const r = await geocodePlace(
    'Paris, France',
    fakeFetch({ results: [{ name: 'Paris', latitude: 48.85, longitude: 2.35, admin1: 'Île-de-France', country: 'France', country_code: 'FR' }] })
  );
  assert.equal(r.label, 'Paris, France');
});
