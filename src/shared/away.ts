import type { CalendarEvent, Chore, FamilyMember } from './types.js';

/**
 * "Away" = someone is out of the house for the day (vacation, trip), so their chores go to the
 * shared Up-for-grabs queue instead of piling up as missed.
 *
 * Each event has an override: 'away' (always), 'home' (never), or null (automatic).
 * Automatic only fires for an all-day or multi-day event that sounds like a trip, is tagged with
 * specific people (never the whole Family, which would cancel everyone's chores for one
 * person's trip) and isn't at the home address.
 */
export type AwayMode = 'away' | 'home' | null;

export const TRIP_WORDS =
  /\b(vacation|vacay|trip|travel(?:ing|s)?|out of town|getaway|cruise|camping|away)\b/i;

export interface AwayEntry {
  memberId: string;
  eventId: string;
  eventTitle: string;
}

type EventLike = Pick<
  CalendarEvent,
  'id' | 'title' | 'description' | 'location' | 'startIso' | 'endIso' | 'allDay' | 'memberIds' | 'category'
> & { awayMode?: AwayMode };

type MemberLike = Pick<FamilyMember, 'id' | 'role'>;

function normalizeAddress(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when the location names the home address (or is a short form of it, like "123 Oak St"). */
export function isHomeLocation(location: string, homeAddress: string | undefined | null): boolean {
  const loc = normalizeAddress(location);
  const home = normalizeAddress(homeAddress || '');
  if (!loc || !home) return false;
  if (loc === 'home') return true;
  return home.startsWith(loc) || loc.startsWith(home);
}

/** Length of an event in hours (all-day events count as at least 24h). */
function durationHours(ev: EventLike): number {
  if (ev.allDay) {
    const s = new Date(`${ev.startIso.slice(0, 10)}T00:00:00`);
    const e = new Date(`${ev.endIso.slice(0, 10)}T00:00:00`);
    return Math.max(24, (e.getTime() - s.getTime()) / 3_600_000 + 24);
  }
  return (new Date(ev.endIso).getTime() - new Date(ev.startIso).getTime()) / 3_600_000;
}

/** Whether the automatic rule would call this event a trip (ignores the override). */
export function looksLikeTrip(ev: EventLike, members: MemberLike[], homeAddress?: string | null): boolean {
  if (ev.category === 'birthday' || ev.category === 'holiday') return false;
  if (durationHours(ev) < 20) return false;
  if (!TRIP_WORDS.test(`${ev.title} ${ev.description || ''}`)) return false;
  if (isHomeLocation(ev.location || '', homeAddress)) return false;
  const familyIds = new Set(members.filter((m) => m.role === 'family').map((m) => m.id));
  const people = ev.memberIds.filter((id) => !familyIds.has(id));
  return people.length > 0 && people.length === ev.memberIds.length;
}

/** People an event takes away from home (empty when it doesn't count as away). */
export function awayMembersForEvent(ev: EventLike, members: MemberLike[], homeAddress?: string | null): string[] {
  const individuals = members.filter((m) => m.role !== 'family');
  const familyIds = new Set(members.filter((m) => m.role === 'family').map((m) => m.id));
  const expand = () =>
    ev.memberIds.some((id) => familyIds.has(id))
      ? individuals.map((m) => m.id)
      : ev.memberIds.filter((id) => individuals.some((m) => m.id === id));

  if (ev.awayMode === 'home') return [];
  if (ev.awayMode === 'away') return expand();
  return looksLikeTrip(ev, members, homeAddress) ? expand() : [];
}

function occursOn(ev: EventLike, dateStr: string): boolean {
  if (ev.allDay) return ev.startIso.slice(0, 10) <= dateStr && ev.endIso.slice(0, 10) >= dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  // A timed trip only counts for a day it covers most of (leaving at 6pm doesn't skip that day).
  const s = Math.max(dayStart, new Date(ev.startIso).getTime());
  const e = Math.min(dayEnd, new Date(ev.endIso).getTime());
  return e - s >= 12 * 3_600_000;
}

/** Who is away on a given local date, and because of which event. */
export function awayOnDate(
  events: EventLike[],
  dateStr: string,
  members: MemberLike[],
  homeAddress?: string | null
): AwayEntry[] {
  const out = new Map<string, AwayEntry>();
  for (const ev of events) {
    if (!occursOn(ev, dateStr)) continue;
    for (const memberId of awayMembersForEvent(ev, members, homeAddress)) {
      if (!out.has(memberId)) out.set(memberId, { memberId, eventId: ev.id, eventTitle: ev.title });
    }
  }
  return [...out.values()];
}

export interface EffectiveChore<C extends Pick<Chore, 'id' | 'assignedMemberId'>> {
  chore: C;
  /** Who it belongs to today: the assignee, or null when it's up for grabs */
  ownerId: string | null;
  /** Set when an away person's chore was moved to Up for grabs */
  reassignedFrom: string | null;
  skipped: boolean;
}

/** Applies away people and skips to today's chores. */
export function effectiveChores<C extends Pick<Chore, 'id' | 'assignedMemberId'>>(
  chores: C[],
  away: Array<Pick<AwayEntry, 'memberId'>>,
  skippedChoreIds: Iterable<string>
): EffectiveChore<C>[] {
  const awayIds = new Set(away.map((a) => a.memberId));
  const skipped = new Set(skippedChoreIds);
  return chores.map((chore) => {
    const isAway = chore.assignedMemberId != null && awayIds.has(chore.assignedMemberId);
    return {
      chore,
      ownerId: isAway ? null : chore.assignedMemberId,
      reassignedFrom: isAway ? chore.assignedMemberId : null,
      skipped: skipped.has(chore.id),
    };
  });
}
