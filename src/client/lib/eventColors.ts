import type { CalendarEvent, FamilyMember } from '../../shared/types.js';
import { CATEGORY_STYLES } from '../../shared/eventCategories.js';

export interface EventLook {
  /** CSS `background` for the card: a solid pastel, or diagonal stripes of each person's pastel. */
  background: string;
  text: string;
  /** CSS `background` for the left bar: solid accent, or one segment per person. */
  bar: string;
  striped: boolean;
}

const STRIPE_PX = 12;
const NEUTRAL = { bg: '#F1F5F9', text: '#1E293B', accent: '#64748B' };

/** Everyone except the "Family" placeholder member(s), in the household's display order. */
export function realPeople(members: FamilyMember[]): FamilyMember[] {
  return members.filter((m) => m.role !== 'family');
}

/**
 * The people whose colors an event shows. An event for "Family" (or for nobody) stands for
 * everyone, so it shows every person's color; otherwise just the assigned people.
 */
export function eventPeople(ev: Pick<CalendarEvent, 'memberIds'>, members: FamilyMember[]): FamilyMember[] {
  const byId = new Map(members.map((m) => [m.id, m]));
  const assigned = ev.memberIds.map((id) => byId.get(id)).filter((m): m is FamilyMember => Boolean(m));
  const people = realPeople(members);
  if (assigned.length === 0 || assigned.some((m) => m.role === 'family')) {
    return people.length > 0 ? people : assigned;
  }
  return assigned;
}

/** Diagonal (135°) stripes, Skylight-style, one band per color. */
export function stripes(colors: string[], px = STRIPE_PX): string {
  if (colors.length === 0) return NEUTRAL.bg;
  if (colors.length === 1) return colors[0];
  const stops = colors.map((c, i) => `${c} ${i * px}px ${(i + 1) * px}px`).join(', ');
  return `repeating-linear-gradient(135deg, ${stops})`;
}

/** Vertical segments for the left accent bar, one per person. */
export function segments(colors: string[]): string {
  if (colors.length === 0) return NEUTRAL.accent;
  if (colors.length === 1) return colors[0];
  const step = 100 / colors.length;
  const stops = colors.map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(', ');
  return `linear-gradient(to bottom, ${stops})`;
}

export function eventLook(ev: Pick<CalendarEvent, 'memberIds' | 'category'>, members: FamilyMember[]): EventLook {
  if (ev.category) {
    const c = CATEGORY_STYLES[ev.category];
    return { background: c.bg, text: c.text, bar: c.accent, striped: false };
  }
  const people = eventPeople(ev, members);
  if (people.length <= 1) {
    const p = people[0];
    return {
      background: p?.colorBg || NEUTRAL.bg,
      text: p?.colorText || NEUTRAL.text,
      bar: p?.colorAccent || NEUTRAL.accent,
      striped: false,
    };
  }
  return {
    background: stripes(people.map((p) => p.colorBg)),
    text: NEUTRAL.text,
    bar: segments(people.map((p) => p.colorAccent)),
    striped: true,
  };
}

/** Avatar fill for a member: the Family member shows everyone's accent colors as stripes. */
export function memberSwatch(member: FamilyMember, members: FamilyMember[]): string {
  if (member.role !== 'family') return member.colorAccent;
  const people = realPeople(members);
  return people.length > 1 ? stripes(people.map((p) => p.colorAccent), 6) : member.colorAccent;
}
