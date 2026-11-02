/** Special event categories that get their own color/icon and can be shown or hidden as a group. */
export type EventCategory = 'birthday' | 'holiday';

export const EVENT_CATEGORIES: EventCategory[] = ['birthday', 'holiday'];

export const CATEGORY_STYLES: Record<
  EventCategory,
  { label: string; icon: string; bg: string; text: string; accent: string }
> = {
  birthday: { label: 'Birthdays', icon: '🎂', bg: '#FCE7F3', text: '#9D174D', accent: '#EC4899' },
  holiday: { label: 'Holidays', icon: '🎉', bg: '#CCFBF1', text: '#115E59', accent: '#14B8A6' },
};

export const BIRTHDAY_TITLE_RE = /\b(birthday|bday|b-day)\b/i;

/** Category implied by a Google calendar itself (its ID or name), e.g. "Holidays in United States". */
export function categoryForCalendar(externalCalendarId: string, name: string): EventCategory | null {
  if (/#holiday@group\.v\.calendar\.google\.com$/i.test(externalCalendarId) || /^holidays?\b/i.test(name.trim())) {
    return 'holiday';
  }
  if (/^addressbook#contacts@group\.v\.calendar\.google\.com$/i.test(externalCalendarId) || /birthdays?/i.test(name)) {
    return 'birthday';
  }
  return null;
}

/** Category for one event: the calendar's category wins; otherwise Google's birthday type or a "…Birthday" title. */
export function categoryForEvent(
  calendarCategory: EventCategory | null,
  title: string,
  googleEventType?: string | null
): EventCategory | null {
  if (calendarCategory) return calendarCategory;
  if (googleEventType === 'birthday' || BIRTHDAY_TITLE_RE.test(title)) return 'birthday';
  return null;
}

export function isEventCategory(value: unknown): value is EventCategory {
  return value === 'birthday' || value === 'holiday';
}
