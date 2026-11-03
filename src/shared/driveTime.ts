/**
 * Drive-time rules shared by the server and the event form.
 *
 * An event's travel setting (travel_minutes column) is the OVERRIDE:
 *   null → automatic (Google Maps drive time from home, when the location is a full address)
 *   0    → explicitly "no drive"
 *   n>0  → n minutes, as picked by hand
 */

/** True when the location looks like a real address Google can route to (street number or ZIP), not "Grandma's". */
export function isFullAddress(location: string | null | undefined): boolean {
  const loc = (location || '').trim();
  if (loc.length < 6 || /https?:\/\/|www\./i.test(loc)) return false;
  const streetNumber = /(^|[\s,])\d{1,6}[A-Za-z]?\s+[A-Za-z]/.test(loc);
  const zip = /\b\d{5}(-\d{4})?\b/.test(loc) || /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(loc); // US ZIP / Canadian postcode
  return streetNumber || zip;
}

/** The travel minutes that drive the "leave by" banner: the manual override wins, else the automatic estimate. */
export function effectiveTravelMinutes(manual: number | null | undefined, auto: number | null | undefined): number | null {
  if (manual != null) return manual > 0 ? manual : null;
  return auto != null && auto > 0 ? auto : null;
}

/** Cache key for an address: case/spacing-insensitive. */
export function addressKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ');
}
