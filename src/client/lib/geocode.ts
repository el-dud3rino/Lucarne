/** Turns a typed place ("Springfield, IL", "Paris, France", "Denver") into coordinates via Open-Meteo (free, no key). */

const US_STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
  in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
  vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
};

export interface GeocodeResult {
  lat: number;
  lon: number;
  /** Tidy display name, e.g. "Springfield, Illinois" */
  label: string;
}

interface OpenMeteoPlace {
  name: string;
  latitude: number;
  longitude: number;
  admin1?: string;
  country?: string;
  country_code?: string;
}

/** Picks the place matching the part after the comma (state, abbreviation or country), else the top hit. */
export function pickPlace(places: OpenMeteoPlace[], qualifier: string): OpenMeteoPlace | null {
  if (places.length === 0) return null;
  const q = qualifier.trim().toLowerCase().replace(/\./g, '');
  if (!q) return places[0];
  const state = US_STATES[q] ?? q;
  const matches = (p: OpenMeteoPlace) =>
    (p.admin1 ?? '').toLowerCase() === state ||
    (p.country ?? '').toLowerCase() === q ||
    (p.country_code ?? '').toLowerCase() === q ||
    (q === 'usa' || q === 'us' ? p.country_code === 'US' : false);
  return places.find(matches) ?? places.find((p) => (p.admin1 ?? '').toLowerCase().startsWith(state)) ?? null;
}

export async function geocodePlace(query: string, fetchFn: typeof fetch = fetch): Promise<GeocodeResult> {
  const [name, ...rest] = query.split(',');
  const qualifier = rest.join(',').trim();
  if (!name.trim()) throw new Error('Type a city name');
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.trim())}&count=20&language=en&format=json`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error("Couldn't reach the place lookup. Check the internet connection.");
  const data = (await res.json()) as { results?: OpenMeteoPlace[] };
  const place = pickPlace(data.results ?? [], qualifier);
  if (!place) throw new Error(`Couldn't find "${query.trim()}". Try "City, State" or "City, Country".`);
  const region = place.country_code === 'US' ? place.admin1 : place.country;
  return { lat: place.latitude, lon: place.longitude, label: region ? `${place.name}, ${region}` : place.name };
}
