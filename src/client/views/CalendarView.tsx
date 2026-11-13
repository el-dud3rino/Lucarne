import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock,
  Hourglass,
  List as ListIcon,
  MoreHorizontal,
  SlidersHorizontal,
  Lock,
  MapPin,
  Plus,
  Trash2,
  Utensils,
  Wand2,
  X,
} from 'lucide-react';
import { CountdownStrip, CountdownsSheet } from '../components/Countdowns.js';
import { MagicImportSheet } from '../components/MagicImport.js';
import { Sheet } from '../components/Sheet.js';
import { useIsPhone, useSwipePaging } from '../lib/gestures.js';
import {
  daysBetween,
  eventDayRange,
  isMultiDay,
  itemsThatFit,
  lanesPerColumn,
  layoutSpanBars,
  splitForMore,
  type SpanBar,
} from '../../shared/calendarLayout.js';
import { apiFetch } from '../lib/api.js';
import { PlaceInput } from '../components/PlaceInput.js';
import { isFullAddress } from '../../shared/driveTime.js';
import { eventLook, memberSwatch } from '../lib/eventColors.js';
import { DayWeather, useDailyForecast } from '../lib/weather.js';
import { CATEGORY_STYLES, EVENT_CATEGORIES, type EventCategory } from '../../shared/eventCategories.js';
import { looksLikeTrip, type AwayMode } from '../../shared/away.js';
import {
  addDays,
  eventOccursOnDay,
  formatTimeShort,
  isSameDay,
  startOfMonthGrid,
  startOfWeek,
  toDateStr,
} from '../lib/dates.js';
import type {
  AppSettings,
  CalendarEvent,
  FamilyMember,
  MealPlanEntry,
} from '../../shared/types.js';

export type CalendarSubView = 'schedule' | 'people' | 'week' | 'month';

/** A multi-day bar is 40px tall (touch size) with 10px below it, matching the event list spacing. */
const SPAN_ROW_PX = 50;
/** Day column header (h-16) plus its 1px border and the list's 12px padding */
const COLUMN_BODY_TOP_PX = 64 + 1 + 12;
/** Month cells: 40px tall date row, 40px items with 4px gaps */
const MONTH_HEADER_PX = 40;
const MONTH_ITEM_PX = 44;

interface CalendarViewProps {
  members: FamilyMember[];
  selectedMemberIds: string[];
  settings: AppSettings;
  onOpenMealTab: () => void;
}

const QUICK_HOURS = [
  { label: '8:00 AM', h: 8, m: 0 },
  { label: '9:30 AM', h: 9, m: 30 },
  { label: '12:00 PM', h: 12, m: 0 },
  { label: '3:30 PM', h: 15, m: 30 },
  { label: '5:00 PM', h: 17, m: 0 },
  { label: '6:30 PM', h: 18, m: 30 },
];

export const CalendarView: React.FC<CalendarViewProps> = ({
  members,
  selectedMemberIds,
  settings,
  onOpenMealTab,
}) => {
  const queryClient = useQueryClient();
  const isPhone = useIsPhone();
  // Phones get a list (agenda) or month; the wall gets 5-Day, People, Week and Month.
  const [wallView, setWallView] = useState<CalendarSubView>('schedule');
  const [phoneView, setPhoneView] = useState<'agenda' | 'month'>('agenda');
  const subView: CalendarSubView | 'agenda' = isPhone ? (phoneView === 'month' ? 'month' : 'agenda') : wallView;
  const setSubView = setWallView;
  const [dayPopover, setDayPopover] = useState<Date | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const [page, setPage] = useState<{ direction: 'left' | 'right' | null; key: number }>({ direction: null, key: 0 });
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | null>(null);
  const [showMagic, setShowMagic] = useState(false);
  const [countdownSheet, setCountdownSheet] = useState<null | { initial?: { title: string; dateStr: string; emoji: string; memberId: string | null } }>(null);

  const memberMap = useMemo(() => {
    const m = new Map<string, FamilyMember>();
    for (const item of members) m.set(item.id, item);
    return m;
  }, [members]);

  // Compute query date window generously so tab switches within the month are 0ms
  const range = useMemo(() => {
    const start = addDays(startOfMonthGrid(anchorDate), -7);
    const end = addDays(start, 56);
    return {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      startStr: toDateStr(start),
      endStr: toDateStr(end),
    };
  }, [anchorDate]);

  const monthGridInfo = useMemo(() => {
    const firstDayOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const lastDayOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0);
    const startDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();
    const numWeeks = Math.max(5, Math.ceil((startDayOfWeek + daysInMonth) / 7));
    const totalCells = numWeeks * 7;
    const maxEvents = numWeeks >= 6 ? 2 : 3;
    return { numWeeks, totalCells, maxEvents };
  }, [anchorDate]);

  const { data: events = [] } = useQuery({
    queryKey: ['events', range.startStr, range.endStr],
    queryFn: () =>
      apiFetch<CalendarEvent[]>(
        `/api/events?start=${encodeURIComponent(range.startIso)}&end=${encodeURIComponent(
          range.endIso
        )}`
      ),
  });

  const { data: meals = [] } = useQuery({
    queryKey: ['meals', range.startStr, range.endStr],
    queryFn: () =>
      apiFetch<MealPlanEntry[]>(
        `/api/meals/plan?start=${range.startStr}&end=${range.endStr}`
      ),
    enabled: settings.showDinnerOnCalendar,
  });

  const { data: forecast } = useDailyForecast(
    settings.weatherLat,
    settings.weatherLon,
    settings.weatherUnit
  );

  const hiddenCategories = useMemo(() => {
    const hidden = new Set<EventCategory>();
    if (!settings.showBirthdays) hidden.add('birthday');
    if (!settings.showHolidays) hidden.add('holiday');
    return hidden;
  }, [settings.showBirthdays, settings.showHolidays]);

  const filteredEvents = useMemo(() => {
    const visible = events.filter((ev) => !ev.category || !hiddenCategories.has(ev.category));
    if (selectedMemberIds.length === 0) return visible;
    return visible.filter(
      (ev) =>
        ev.memberIds.length === 0 ||
        ev.memberIds.some((id) => selectedMemberIds.includes(id))
    );
  }, [events, selectedMemberIds, hiddenCategories]);

  // Show/hide birthdays & holidays from the toolbar (remembered in settings).
  const toggleCategoryMutation = useMutation({
    mutationFn: (patch: Partial<AppSettings>) =>
      apiFetch<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
    onMutate: (patch) => {
      queryClient.setQueryData<AppSettings>(['settings'], (prev) => (prev ? { ...prev, ...patch } : prev));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const dinnerByDate = useMemo(() => {
    const map = new Map<string, MealPlanEntry>();
    for (const m of meals) {
      if (m.slot === 'dinner') map.set(m.dateStr, m);
    }
    return map;
  }, [meals]);

  const saveMutation = useMutation({
    mutationFn: async (draft: Partial<CalendarEvent>) => {
      if (draft.id) {
        return apiFetch<CalendarEvent>(`/api/events/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(draft),
        });
      }
      return apiFetch<CalendarEvent>('/api/events', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setEditingEvent(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/events/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      setEditingEvent(null);
    },
  });

  const openNewEventForDay = (day: Date, preselectedMemberId?: string) => {
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    const end = new Date(day);
    end.setHours(10, 0, 0, 0);
    setEditingEvent({
      title: '',
      description: '',
      location: '',
      allDay: false,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      memberIds: preselectedMemberId
        ? [preselectedMemberId]
        : members[0]
        ? [members[0].id]
        : [],
    });
  };

  const [selectedDay, setSelectedDay] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const stepAnchor = (dir: -1 | 1) => {
    setPage((p) => ({ direction: dir === 1 ? 'left' : 'right', key: p.key + 1 }));
    if (subView === 'agenda') setAnchorDate((d) => addDays(d, dir * 7));
    else if (subView === 'schedule') setAnchorDate((d) => addDays(d, dir * 5));
    else if (subView === 'people') setAnchorDate((d) => addDays(d, dir * 1));
    else if (subView === 'week') setAnchorDate((d) => addDays(d, dir * 7));
    else {
      setAnchorDate((d) => {
        const next = new Date(d.getFullYear(), d.getMonth() + dir, 1);
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        setSelectedDay(next.getMonth() === now.getMonth() && next.getFullYear() === now.getFullYear() ? now : next);
        return next;
      });
    }
  };

  const goToday = () => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    setAnchorDate(now);
    setSelectedDay(now);
  };

  // Swipe left/right anywhere on the calendar to page through days (or months).
  const swipeRef = useRef<HTMLDivElement>(null);
  useSwipePaging(swipeRef, { onPrev: () => stepAnchor(-1), onNext: () => stepAnchor(1) });


  const today = new Date();

  // Days currently on screen, for the toolbar heading and the "Today" button state.
  const visibleRange = useMemo((): [Date, Date] => {
    if (subView === 'agenda') return [anchorDate, addDays(anchorDate, 6)];
    if (subView === 'schedule') return [anchorDate, addDays(anchorDate, 4)];
    if (subView === 'week') {
      const start = startOfWeek(anchorDate, 0);
      return [start, addDays(start, 6)];
    }
    if (subView === 'people') return [anchorDate, anchorDate];
    return [
      new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1),
      new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0),
    ];
  }, [subView, anchorDate]);
  const todayMidnight = new Date(today);
  todayMidnight.setHours(0, 0, 0, 0);
  const showingToday = todayMidnight >= visibleRange[0] && todayMidnight <= visibleRange[1];

  const rangeLabel = (() => {
    const [a, b] = visibleRange;
    if (subView === 'month') return a.toLocaleDateString([], { month: 'long', year: 'numeric' });
    if (subView === 'people') {
      return a.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    }
    const sameMonth = a.getMonth() === b.getMonth();
    const yearSuffix = a.getFullYear() !== today.getFullYear() || b.getFullYear() !== today.getFullYear()
      ? `, ${b.getFullYear()}`
      : '';
    const end = sameMonth
      ? String(b.getDate())
      : b.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${a.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${end}${yearSuffix}`;
  })();

  // Phones stack the days in a scroll list: jump back to the first day when the range changes.
  const dayListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dayListRef.current?.scrollTo({ top: 0 });
  }, [anchorDate, subView]);

  const renderAvatars = (list: FamilyMember[], max: number) => {
    if (list.length === 0) return null;
    const shown = list.length > max ? list.slice(0, max - 1) : list;
    const extra = list.length - shown.length;
    return (
      <div className="flex -space-x-1 shrink-0">
        {shown.map((m) => (
          <span
            key={m.id}
            style={{ background: memberSwatch(m, members) }}
            className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-white [text-shadow:0_0_2px_rgba(0,0,0,0.45)]"
            title={m.name}
          >
            {m.initial}
          </span>
        ))}
        {extra > 0 && (
          <span className="w-5 h-5 rounded-full text-[9px] font-bold bg-slate-600 text-white flex items-center justify-center ring-2 ring-white">+{extra}</span>
        )}
      </div>
    );
  };

  const nowMs = Date.now();
  const todayStr = toDateStr(today);
  /** Finished events fade out, like crossing them off. */
  const isPast = (ev: CalendarEvent) => (ev.allDay ? eventDayRange(ev).end < todayStr : new Date(ev.endIso).getTime() < nowMs);
  const showWeather = settings.showWeatherOnCalendar !== false;

  const renderEventCard = (ev: CalendarEvent, compact = false) => {
    const look = eventLook(ev, members);
    const pastCls = isPast(ev) ? 'opacity-50' : '';
    const assigned = ev.memberIds.map((id) => memberMap.get(id)).filter((x): x is FamilyMember => Boolean(x));
    // A Family event shows one striped Family badge rather than every person's initial.
    const evMembers = assigned.some((m) => m.role === 'family') ? assigned.filter((m) => m.role === 'family') : assigned;
    const bar = <span aria-hidden className="absolute left-0 inset-y-0 w-1" style={{ background: look.bar }} />;

    if (compact) {
      return (
        <button
          key={ev.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditingEvent(ev);
          }}
          style={{ background: look.background, color: look.text }}
          data-striped={look.striped || undefined}
          className={`relative w-full text-left rounded-xl shadow-2xs transition active:scale-[0.98] hover:brightness-[0.98] h-10 min-h-[40px] max-h-[40px] pl-3.5 pr-2.5 py-1.5 flex items-center gap-2 overflow-hidden ${pastCls}`}
        >
          {bar}
          {!ev.allDay && (
            <span className="text-[11px] font-bold opacity-75 shrink-0">
              {formatTimeShort(ev.startIso)}
            </span>
          )}
          <span className="text-xs font-bold truncate flex-1">
            {ev.category && <span aria-hidden className="mr-1">{CATEGORY_STYLES[ev.category].icon}</span>}
            {ev.title}
          </span>
          {renderAvatars(evMembers, 3)}
        </button>
      );
    }

    return (
      <button
        key={ev.id}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditingEvent(ev);
        }}
        style={{ background: look.background, color: look.text }}
        data-striped={look.striped || undefined}
        className={`relative overflow-hidden w-full text-left rounded-xl shadow-2xs transition active:scale-[0.98] hover:brightness-[0.98] min-h-[40px] flex flex-col justify-center pl-[18px] pr-3.5 py-2.5 ${pastCls}`}
      >
        {bar}
        <div className="flex items-start justify-between gap-2">
          <span className="font-bold leading-snug text-sm md:text-[15px]">
            {ev.category && <span aria-hidden className="mr-1">{CATEGORY_STYLES[ev.category].icon}</span>}
            {ev.title}
          </span>
          {renderAvatars(evMembers, 4)}
        </div>

        {!ev.allDay && (
          <div className="text-xs opacity-80 font-medium mt-0.5 flex items-center gap-1.5">
            <span>
              {formatTimeShort(ev.startIso)} – {formatTimeShort(ev.endIso)}
            </span>
          </div>
        )}
        {ev.location && (
          <div className="text-xs opacity-75 mt-1 flex items-center gap-1 truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{ev.location}</span>
          </div>
        )}
        {(Boolean(ev.driverMemberId) || (ev.travelMinutes ?? 0) > 0) && (
          <div className="text-xs opacity-80 mt-1 flex items-center gap-1 font-semibold">
            <Car className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {ev.driverMemberId && memberMap.get(ev.driverMemberId) ? `${memberMap.get(ev.driverMemberId)!.name} driving` : 'Drive'}
              {ev.travelMinutes ? ` · ${formatDrive(ev.travelMinutes)} · leave ${formatTimeShort(new Date(Date.parse(ev.startIso) - ev.travelMinutes * 60_000).toISOString())}` : ''}
            </span>
          </div>
        )}
      </button>
    );
  };

  const renderDayColumn = (day: Date, showWeekdayBig = true, reservedLanes = 0) => {
    const dayStr = toDateStr(day);
    const isToday = isSameDay(day, today);
    const allDayEventsToday = filteredEvents.filter((ev) => eventOccursOnDay(ev.startIso, ev.endIso, ev.allDay, day));
    // Multi-day events are drawn as one bar across the columns instead of once per day.
    const dayEvents = allDayEventsToday.filter((ev) => !isMultiDay(ev));
    const allDayEvents = dayEvents.filter((e) => e.allDay);
    const timedEvents = dayEvents.filter((e) => !e.allDay);
    const dinner = dinnerByDate.get(dayStr);

    return (
      <div
        key={dayStr}
        onClick={() => openNewEventForDay(day)}
        className={`flex flex-col h-full min-w-0 rounded-2xl border transition cursor-pointer overflow-hidden ${
          isToday
            ? 'bg-white border-sky-300 ring-2 ring-sky-100 shadow-sm'
            : 'bg-white/95 border-stone-200/90 shadow-2xs'
        }`}
      >
        {/* Day Header */}
        <div
          className={`h-16 shrink-0 px-3 xl:px-4 border-b flex items-center justify-between gap-1 ${
            isToday ? 'bg-sky-50/70 border-sky-200/70' : 'border-stone-100'
          }`}
        >
          <div className="min-w-0">
            <div
              className={`text-xs font-bold uppercase tracking-wider truncate ${
                isToday ? 'text-sky-600' : 'text-stone-400'
              }`}
            >
              {day.toLocaleDateString([], { weekday: showWeekdayBig ? 'long' : 'short' })}
              {!showWeekdayBig && allDayEventsToday.length > 0 && (
                <span className="normal-case tracking-normal font-semibold text-stone-400"> · {allDayEventsToday.length}</span>
              )}
            </div>
            <div className="text-xl font-extrabold text-slate-800 leading-tight">
              {day.toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </div>
          </div>

          <span className="hidden xl:block">{showWeather && <DayWeather forecast={forecast?.get(dayStr)} />}</span>
          <span className="xl:hidden">{showWeather && <DayWeather forecast={forecast?.get(dayStr)} variant="compact" />}</span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openNewEventForDay(day);
            }}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-stone-100 hover:bg-stone-200 active:scale-95 flex items-center justify-center text-stone-600"
            title="Add event"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Events Scroll List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
          {reservedLanes > 0 && <div aria-hidden style={{ height: reservedLanes * SPAN_ROW_PX - 10 }} />}
          {allDayEvents.map((ev) => renderEventCard(ev))}
          {timedEvents.map((ev) => renderEventCard(ev))}
          {dayEvents.length === 0 && reservedLanes === 0 && (
            <div className="h-28 flex items-center justify-center text-sm text-stone-300 font-medium">
              Tap + to add event
            </div>
          )}
        </div>

        {/* Skylight-style Tonight's Dinner Strip */}
        {settings.showDinnerOnCalendar && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onOpenMealTab();
            }}
            className="px-3.5 py-2.5 bg-amber-50/75 border-t border-amber-200/60 flex items-center gap-2 hover:bg-amber-100/70 transition"
          >
            <Utensils className="w-4 h-4 text-amber-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700/70">
                Dinner
              </div>
              <div className="text-xs font-semibold text-amber-950 truncate">
                {dinner
                  ? dinner.recipe?.title || dinner.customTitle
                  : 'Tap to plan dinner'}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // Month cells measure their real height so a day never shows half an event.
  const monthBodyRef = useRef<HTMLDivElement>(null);
  const [monthBodyH, setMonthBodyH] = useState(0);
  useEffect(() => {
    const el = monthBodyRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setMonthBodyH(el.clientHeight));
    ro.observe(el);
    setMonthBodyH(el.clientHeight);
    return () => ro.disconnect();
  }, [subView, isPhone, page.key]);

  const evMembersFor = (ev: CalendarEvent) => {
    const assigned = ev.memberIds.map((id) => memberMap.get(id)).filter((x): x is FamilyMember => Boolean(x));
    return assigned.some((m) => m.role === 'family') ? assigned.filter((m) => m.role === 'family') : assigned;
  };

  const shortDate = (d: string) =>
    new Date(`${d}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });

  /** One bar for an event that spans several days, positioned over the day columns or month cells. */
  const renderSpanBar = (b: SpanBar<CalendarEvent>, style: React.CSSProperties) => {
    const look = eventLook(b.ev, members);
    const r = eventDayRange(b.ev);
    return (
      <button
        key={`${b.ev.id}-${b.col}`}
        type="button"
        data-span-bar
        onClick={(e) => {
          e.stopPropagation();
          setEditingEvent(b.ev);
        }}
        title={`${b.ev.title} · ${shortDate(r.start)} – ${shortDate(r.end)}`}
        style={{ ...style, background: look.background, color: look.text }}
        data-striped={look.striped || undefined}
        className={`absolute z-10 h-10 min-h-[40px] flex items-center gap-2 pl-3.5 pr-2.5 shadow-2xs overflow-hidden text-left transition active:scale-[0.99] hover:brightness-[0.98] ${
          b.continuesBefore ? 'rounded-l-md' : 'rounded-l-xl'
        } ${b.continuesAfter ? 'rounded-r-md' : 'rounded-r-xl'} ${isPast(b.ev) ? 'opacity-50' : ''}`}
      >
        {!b.continuesBefore && <span aria-hidden className="absolute left-0 inset-y-0 w-1" style={{ background: look.bar }} />}
        {b.continuesBefore && <ChevronLeft aria-hidden className="w-4 h-4 -ml-2 shrink-0 opacity-60" />}
        <span className="text-xs md:text-sm font-bold truncate">
          {b.ev.category && <span aria-hidden className="mr-1">{CATEGORY_STYLES[b.ev.category].icon}</span>}
          {b.ev.title}
        </span>
        {b.span >= 2 && (
          <span className="text-[11px] font-semibold opacity-70 whitespace-nowrap hidden lg:inline">
            {shortDate(r.start)} – {shortDate(r.end)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {renderAvatars(evMembersFor(b.ev), 3)}
          {b.continuesAfter && <ChevronRight aria-hidden className="w-4 h-4 opacity-60" />}
        </span>
      </button>
    );
  };

  /** 5-Day and Week: day columns with multi-day events drawn once across them. */
  const renderColumns = (days: Date[], big: boolean) => {
    const n = days.length;
    const gap = n === 5 ? 14 : 10;
    const bars = layoutSpanBars(filteredEvents, toDateStr(days[0]), n);
    const lanes = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
    const colW = `((100% - ${(n - 1) * gap}px) / ${n})`;
    return (
      <div className="h-full relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap }}>
        {days.map((d) => renderDayColumn(d, big, lanes))}
        {bars.map((b) =>
          renderSpanBar(b, {
            top: COLUMN_BODY_TOP_PX + b.lane * SPAN_ROW_PX,
            left: `calc(${colW} * ${b.col} + ${b.col * gap}px + 12px)`,
            width: `calc(${colW} * ${b.span} + ${(b.span - 1) * gap}px - 24px)`,
          })
        )}
      </div>
    );
  };

  /** Phone list row for one event: title, time (or how far into a trip), people. */
  const renderAgendaCard = (ev: CalendarEvent, day: Date, firstListedDay = false) => {
    const look = eventLook(ev, members);
    const r = eventDayRange(ev);
    const multi = r.end > r.start;
    const dayStr = toDateStr(day);
    // Later days of a trip get a slim reminder row instead of a full card.
    if (multi && dayStr > r.start && !firstListedDay) {
      const total = daysBetween(r.start, r.end) + 1;
      const n = daysBetween(r.start, dayStr) + 1;
      return (
        <button
          key={`${ev.id}-${dayStr}`}
          type="button"
          onClick={() => setEditingEvent(ev)}
          style={{ background: look.background, color: look.text }}
          data-striped={look.striped || undefined}
          className={`relative overflow-hidden w-full text-left rounded-xl min-h-[40px] h-10 pl-4 pr-3 flex items-center gap-2 opacity-80 active:scale-[0.99] transition ${
            isPast(ev) ? 'opacity-40' : ''
          }`}
        >
          <span aria-hidden className="absolute left-0 inset-y-0 w-1" style={{ background: look.bar }} />
          <span className="text-xs font-bold truncate flex-1">{ev.title}</span>
          <span className="text-[11px] font-semibold opacity-75 whitespace-nowrap">
            Day {n} of {total}
          </span>
        </button>
      );
    }
    let when: string;
    if (multi) {
      const total = daysBetween(r.start, r.end) + 1;
      const n = daysBetween(r.start, dayStr) + 1;
      when = `Day ${n} of ${total} · ${shortDate(r.start)} – ${shortDate(r.end)}`;
    } else if (ev.allDay) {
      when = 'All day';
    } else {
      when = `${formatTimeShort(ev.startIso)} – ${formatTimeShort(ev.endIso)}`;
    }
    return (
      <button
        key={`${ev.id}-${dayStr}`}
        type="button"
        onClick={() => setEditingEvent(ev)}
        style={{ background: look.background, color: look.text }}
        data-striped={look.striped || undefined}
        className={`relative overflow-hidden w-full text-left rounded-xl shadow-2xs min-h-[48px] pl-4 pr-3 py-2 flex items-center gap-2 active:scale-[0.99] transition ${
          isPast(ev) ? 'opacity-50' : ''
        }`}
      >
        <span aria-hidden className="absolute left-0 inset-y-0 w-1" style={{ background: look.bar }} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold leading-snug truncate">
            {ev.category && <span aria-hidden className="mr-1">{CATEGORY_STYLES[ev.category].icon}</span>}
            {ev.title}
          </span>
          <span className="block text-xs font-semibold opacity-75 truncate">
            {when}
            {ev.location && !multi ? ` · ${ev.location}` : ''}
          </span>
        </span>
        {renderAvatars(evMembersFor(ev), 3)}
      </button>
    );
  };

  const eventsOn = (day: Date) => filteredEvents.filter((ev) => eventOccursOnDay(ev.startIso, ev.endIso, ev.allDay, day));

  /** One day in the phone list: date on the left, that day's events on the right. */
  const renderAgendaDay = (day: Date, firstListedDay = false) => {
    const dayStr = toDateStr(day);
    const isToday = isSameDay(day, today);
    const list = eventsOn(day);
    const dinner = settings.showDinnerOnCalendar ? dinnerByDate.get(dayStr) : undefined;
    return (
      <div key={dayStr} className="flex gap-3 py-2.5 border-b border-stone-200/70 last:border-b-0" data-agenda-day={dayStr}>
        <button
          type="button"
          onClick={() => openNewEventForDay(day)}
          aria-label={`Add an event on ${day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}`}
          className="w-12 min-h-[48px] shrink-0 flex flex-col items-center justify-start pt-0.5"
        >
          <span className={`text-[11px] font-bold uppercase tracking-wider ${isToday ? 'text-sky-600' : 'text-stone-400'}`}>
            {day.toLocaleDateString([], { weekday: 'short' })}
          </span>
          <span
            className={`w-9 h-9 rounded-full flex items-center justify-center text-lg font-extrabold ${
              isToday ? 'bg-sky-600 text-white' : 'text-slate-800'
            }`}
          >
            {day.getDate()}
          </span>
          {showWeather && (
            <span className="mt-0.5">
              <DayWeather forecast={forecast?.get(dayStr)} variant="compact" />
            </span>
          )}
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          {[...list]
            .sort((a, b) => Number(isMultiDay(b) && eventDayRange(b).start < toDateStr(day)) - Number(isMultiDay(a) && eventDayRange(a).start < toDateStr(day)))
            .map((ev) => renderAgendaCard(ev, day, firstListedDay))}
          {dinner && (
            <button
              type="button"
              onClick={onOpenMealTab}
              className="w-full min-h-[40px] px-3 rounded-xl bg-amber-50 border border-amber-200/70 text-amber-950 text-sm font-semibold flex items-center gap-2 text-left"
            >
              <Utensils className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="truncate">{dinner.recipe?.title || dinner.customTitle}</span>
            </button>
          )}
          {list.length === 0 && !dinner && (
            <button
              type="button"
              onClick={() => openNewEventForDay(day)}
              className="w-full h-10 min-h-[40px] px-1 text-left text-sm text-stone-300 font-medium"
            >
              Nothing planned
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderAgenda = () => (
    <div ref={dayListRef} className="h-full overflow-y-auto pb-24 -mx-1 px-1">
      {Array.from({ length: 7 }, (_, i) => renderAgendaDay(addDays(anchorDate, i), i === 0))}
    </div>
  );

  const weekdayHeader = (
    <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50/70 shrink-0">
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
        <div key={d} className="py-2 text-center text-xs font-bold uppercase tracking-wider text-stone-500">
          {isPhone ? d.slice(0, 1) : d}
        </div>
      ))}
    </div>
  );

  const renderWallMonth = () => {
    const gridStart = startOfMonthGrid(anchorDate);
    const rowH = monthBodyH > 0 ? monthBodyH / monthGridInfo.numWeeks : 150;
    // Items that fit under the date row (multi-day bars and single events share the space).
    const capacity = Math.max(1, itemsThatFit(rowH - MONTH_HEADER_PX - 6, 40, 4));
    return (
      <div className="h-full flex flex-col bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden" data-month-grid>
        {weekdayHeader}
        <div ref={monthBodyRef} className="flex-1 min-h-0 flex flex-col divide-y divide-stone-100">
          {Array.from({ length: monthGridInfo.numWeeks }, (_, w) => {
            const weekStart = addDays(gridStart, w * 7);
            const allBars = layoutSpanBars(filteredEvents, toDateStr(weekStart), 7);
            const shownBars = allBars.filter((b) => b.lane < capacity);
            const lanesInCol = lanesPerColumn(shownBars, 7);
            return (
              <div key={w} className="relative flex-1 min-h-0 grid grid-cols-7 divide-x divide-stone-100" data-month-week>
                {Array.from({ length: 7 }, (_, c) => {
                  const cellDay = addDays(weekStart, c);
                  const inMonth = cellDay.getMonth() === anchorDate.getMonth();
                  const isToday = isSameDay(cellDay, today);
                  const singles = eventsOn(cellDay).filter((ev) => !isMultiDay(ev));
                  const hiddenBars = allBars.filter((b) => b.lane >= capacity && c >= b.col && c < b.col + b.span).length;
                  const { shown, more } = splitForMore(singles, capacity - lanesInCol[c]);
                  const moreCount = more + hiddenBars;
                  return (
                    <div
                      key={c}
                      data-month-cell
                      onClick={() => openNewEventForDay(cellDay)}
                      className={`min-w-0 px-1 pb-1 flex flex-col gap-1 overflow-hidden cursor-pointer hover:bg-stone-50/70 transition ${
                        !inMonth ? 'bg-stone-50/40 opacity-50' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDayPopover(cellDay);
                        }}
                        aria-label={`${cellDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}${
                          moreCount ? `, ${moreCount} more` : ''
                        }`}
                        className="h-10 min-h-[40px] w-full shrink-0 flex items-center gap-1 px-0.5 rounded-lg hover:bg-stone-100/70"
                      >
                        <span
                          className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${
                            isToday ? 'bg-sky-600 text-white' : 'text-slate-700'
                          }`}
                        >
                          {cellDay.getDate()}
                        </span>
                        {showWeather && (
                          <span className="ml-auto">
                            <DayWeather forecast={forecast?.get(toDateStr(cellDay))} variant="compact" />
                          </span>
                        )}
                        {moreCount > 0 && (
                          <span
                            data-more-chip
                            className={`${showWeather ? '' : 'ml-auto'} px-2 h-6 rounded-full bg-slate-700 text-white text-[11px] font-bold flex items-center whitespace-nowrap`}
                          >
                            +{moreCount} more
                          </span>
                        )}
                      </button>
                      {lanesInCol[c] > 0 && <div aria-hidden className="shrink-0" style={{ height: lanesInCol[c] * MONTH_ITEM_PX - 4 }} />}
                      {shown.map((ev) => renderEventCard(ev, true))}
                    </div>
                  );
                })}
                {shownBars.map((b) =>
                  renderSpanBar(b, {
                    top: MONTH_HEADER_PX + 4 + b.lane * MONTH_ITEM_PX,
                    left: `calc(100% / 7 * ${b.col} + 4px)`,
                    width: `calc(100% / 7 * ${b.span} - 8px)`,
                  })
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /** Phone month: dots on each day; tap a day to list its events underneath. */
  const renderPhoneMonth = () => {
    const gridStart = startOfMonthGrid(anchorDate);
    return (
      <div className="h-full flex flex-col gap-2 min-h-0">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden shrink-0" data-month-grid>
          {weekdayHeader}
          <div className="grid grid-cols-7">
            {Array.from({ length: monthGridInfo.totalCells }, (_, idx) => {
              const cellDay = addDays(gridStart, idx);
              const inMonth = cellDay.getMonth() === anchorDate.getMonth();
              const isToday = isSameDay(cellDay, today);
              const selected = isSameDay(cellDay, selectedDay);
              const list = eventsOn(cellDay);
              const dots = list.slice(0, 3);
              return (
                <button
                  key={idx}
                  type="button"
                  data-month-cell
                  onClick={() => setSelectedDay(cellDay)}
                  aria-pressed={selected}
                  aria-label={`${cellDay.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${list.length} event${list.length === 1 ? '' : 's'}`}
                  className={`h-12 min-h-[44px] flex flex-col items-center justify-center gap-1 transition ${!inMonth ? 'opacity-40' : ''} ${
                    selected ? 'bg-sky-50' : ''
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center ${
                      isToday ? 'bg-sky-600 text-white' : selected ? 'ring-2 ring-sky-400 text-slate-800' : 'text-slate-700'
                    }`}
                  >
                    {cellDay.getDate()}
                  </span>
                  <span className="flex items-center gap-0.5 h-1.5">
                    {dots.map((ev) => (
                      <span key={ev.id} className="w-1.5 h-1.5 rounded-full" style={{ background: eventLook(ev, members).bar }} />
                    ))}
                    {list.length > 3 && <span className="text-[9px] leading-none font-bold text-stone-400">+</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto pb-24">{renderAgendaDay(selectedDay, true)}</div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Calendar Sub-Toolbar */}
      {isPhone ? (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => stepAnchor(-1)}
            aria-label="Previous"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95 shadow-2xs"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => stepAnchor(1)}
            aria-label="Next"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95 shadow-2xs"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <h2 className="flex-1 min-w-0 ml-1 text-base font-extrabold text-slate-800 tracking-tight truncate" aria-live="polite">
            {rangeLabel}
          </h2>
          <div className="bg-stone-200/75 p-1 rounded-xl flex items-center gap-0.5 shrink-0">
            {(
              [
                ['agenda', 'List view', ListIcon],
                ['month', 'Month view', CalendarDays],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                aria-label={label}
                aria-pressed={phoneView === key}
                onClick={() => {
                  setPhoneView(key);
                  if (key === 'month') setSelectedDay(anchorDate);
                }}
                className={`w-10 h-10 min-w-[40px] rounded-lg flex items-center justify-center transition ${
                  phoneView === key ? 'bg-white text-slate-900 shadow-xs' : 'text-stone-500'
                }`}
              >
                <Icon className="w-5 h-5" />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowOptions(true)}
            aria-label="Calendar options"
            className="w-10 h-10 min-w-[40px] rounded-xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95 shadow-2xs shrink-0"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>
        </div>
      ) : (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepAnchor(-1)}
            aria-label="Previous"
            className="w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 hover:bg-stone-50 active:scale-95 shadow-2xs"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={goToday}
            aria-pressed={showingToday}
            className={`px-4 h-11 rounded-2xl border font-bold text-sm active:scale-95 shadow-2xs ${
              showingToday
                ? 'bg-sky-50 border-sky-200 text-sky-700'
                : 'bg-white border-stone-200 text-slate-700 hover:bg-stone-50'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => stepAnchor(1)}
            aria-label="Next"
            className="w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 hover:bg-stone-50 active:scale-95 shadow-2xs"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <h2
            className="ml-1 sm:ml-2 text-lg sm:text-xl md:text-2xl font-extrabold text-slate-800 tracking-tight min-w-0 leading-tight"
            aria-live="polite"
          >
            {rangeLabel}
          </h2>
          {subView === 'people' && showWeather && (
            <div className="ml-3">
              <DayWeather forecast={forecast?.get(toDateStr(anchorDate))} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 max-w-full overflow-x-auto">
          <div className="bg-stone-200/75 p-1 rounded-2xl flex items-center gap-1 shrink-0">
            {(
              [
                ['schedule', '5-Day'],
                ['people', 'People'],
                ['week', 'Week'],
                ['month', 'Month'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSubView(key)}
                className={`h-10 min-h-[40px] px-3.5 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition flex items-center justify-center ${
                  subView === key
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-stone-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowOptions(true)}
            title="Choose what shows on the calendar"
            className="h-11 min-w-[44px] px-3 rounded-2xl bg-white border border-stone-200 text-slate-700 font-bold text-sm flex items-center gap-2 shadow-2xs active:scale-95 shrink-0"
          >
            <SlidersHorizontal className="w-5 h-5" />
            <span className="hidden xl:inline">Filter</span>
          </button>
          <button
            type="button"
            onClick={() => setCountdownSheet({})}
            title="Countdowns"
            aria-label="Countdowns"
            className="h-11 min-w-[44px] px-3 rounded-2xl bg-white border border-stone-200 text-amber-600 font-bold text-sm flex items-center gap-2 shadow-2xs active:scale-95 shrink-0"
          >
            <Hourglass className="w-5 h-5" />
            <span className="hidden 2xl:inline text-slate-700">Countdowns</span>
          </button>
          <button
            type="button"
            onClick={() => setShowMagic(true)}
            title="Magic Import: add events from a photo or email"
            aria-label="Magic Import"
            className="h-11 min-w-[44px] px-3 rounded-2xl bg-violet-50 border border-violet-200 text-violet-700 font-bold text-sm flex items-center gap-2 shadow-2xs active:scale-95 shrink-0"
          >
            <Wand2 className="w-5 h-5" />
            <span className="hidden xl:inline">Magic Import</span>
          </button>
          <button
            type="button"
            onClick={() => openNewEventForDay(anchorDate)}
            className="h-11 px-4 rounded-2xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-bold text-sm flex items-center gap-2 shadow-sm shrink-0"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Add Event</span>
          </button>
        </div>
      </div>
      )}

      <CountdownStrip members={members} onOpen={() => setCountdownSheet({})} />

      {/* Main Calendar Grid Area: swipe left/right to page */}
      <div ref={swipeRef} className="flex-1 min-h-0 relative touch-pan-y">
        <div
          key={page.key}
          className={`h-full ${page.direction === 'left' ? 'animate-page-left' : page.direction === 'right' ? 'animate-page-right' : ''}`}
        >
        {subView === 'agenda' && renderAgenda()}

        {subView === 'schedule' && renderColumns([0, 1, 2, 3, 4].map((o) => addDays(anchorDate, o)), true)}

        {subView === 'week' && renderColumns([0, 1, 2, 3, 4, 5, 6].map((o) => addDays(startOfWeek(anchorDate, 0), o)), false)}

        {subView === 'people' && (
          <div
            className="h-full grid gap-3.5 overflow-x-auto"
            style={{
              gridTemplateColumns: `repeat(${Math.max(members.length, 1)}, minmax(240px, 1fr))`,
            }}
          >
            {members.map((member) => {
              const memberDayEvents = filteredEvents.filter(
                (ev) =>
                  eventOccursOnDay(ev.startIso, ev.endIso, ev.allDay, anchorDate) &&
                  (ev.memberIds.includes(member.id) ||
                    (member.role === 'family' && ev.memberIds.length === 0))
              );

              return (
                <div
                  key={member.id}
                  onClick={() => openNewEventForDay(anchorDate, member.id)}
                  className="flex flex-col h-full rounded-2xl bg-white border border-stone-200/90 shadow-2xs overflow-hidden cursor-pointer"
                >
                  <div
                    style={{ background: member.role === 'family' ? eventLook({ memberIds: [member.id], category: null }, members).background : member.colorBg, color: member.colorText }}
                    className="px-4 py-3.5 border-b border-stone-100 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        style={{ background: memberSwatch(member, members) }}
                        className="w-9 h-9 rounded-full text-white font-bold flex items-center justify-center text-base shadow-2xs"
                      >
                        {member.emoji || member.initial}
                      </span>
                      <span className="font-extrabold text-lg">{member.name}</span>
                    </div>
                    <Plus className="w-5 h-5 opacity-70" />
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                    {memberDayEvents.map((ev) => renderEventCard(ev))}
                    {memberDayEvents.length === 0 && (
                      <div className="h-28 flex items-center justify-center text-sm text-stone-300 font-medium">
                        Free day
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {subView === 'month' && (isPhone ? renderPhoneMonth() : renderWallMonth())}
        </div>
      </div>

      {/* Phones: add button in the corner, and a way back to today */}
      {isPhone && (
        <>
          {!showingToday && (
            <button
              type="button"
              onClick={goToday}
              className="fixed left-4 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-30 h-11 px-4 rounded-full bg-white border border-stone-200 shadow-md font-bold text-sm text-sky-700 active:scale-95"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => openNewEventForDay(subView === 'month' ? selectedDay : anchorDate)}
            aria-label="Add event"
            className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-30 w-14 h-14 rounded-full bg-sky-600 text-white shadow-lg flex items-center justify-center active:scale-95"
          >
            <Plus className="w-7 h-7" />
          </button>
        </>
      )}

      {/* Everything on one day (month "+N more") */}
      {dayPopover && (
        <Sheet
          title={dayPopover.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          onClose={() => setDayPopover(null)}
          maxWidth="max-w-md"
        >
          <div className="space-y-2.5">
            {eventsOn(dayPopover).map((ev) => renderEventCard(ev))}
            {eventsOn(dayPopover).length === 0 && <div className="text-sm text-stone-400 py-4 text-center">Nothing planned</div>}
            <button
              type="button"
              onClick={() => {
                const d = dayPopover;
                setDayPopover(null);
                openNewEventForDay(d);
              }}
              className="w-full h-11 rounded-2xl bg-sky-600 text-white font-bold text-sm flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" /> Add event
            </button>
          </div>
        </Sheet>
      )}

      {/* What shows on the calendar (and, on phones, the extra tools) */}
      {showOptions && (
        <Sheet title="Show on calendar" onClose={() => setShowOptions(false)} maxWidth="max-w-sm">
          <div className="space-y-2">
            {(
              [
                ['showBirthdays', `${CATEGORY_STYLES.birthday.icon} Birthdays`, settings.showBirthdays],
                ['showHolidays', `${CATEGORY_STYLES.holiday.icon} Holidays`, settings.showHolidays],
                ['showDinnerOnCalendar', '🍽️ Dinner plans', settings.showDinnerOnCalendar],
                ['showWeatherOnCalendar', '🌤️ Weather', showWeather],
              ] as const
            ).map(([key, label, on]) => (
              <button
                key={key}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggleCategoryMutation.mutate({ [key]: !on })}
                className="w-full h-12 px-4 rounded-2xl bg-stone-50 hover:bg-stone-100 flex items-center justify-between font-bold text-slate-700"
              >
                <span>{label}</span>
                <span className={`w-11 h-6 rounded-full p-0.5 transition ${on ? 'bg-sky-600' : 'bg-stone-300'}`}>
                  <span className={`block w-5 h-5 rounded-full bg-white shadow transition ${on ? 'translate-x-5' : ''}`} />
                </span>
              </button>
            ))}
            {isPhone && (
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowOptions(false);
                    setCountdownSheet({});
                  }}
                  className="h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-800 font-bold text-sm flex items-center justify-center gap-2"
                >
                  <Hourglass className="w-5 h-5" /> Countdowns
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowOptions(false);
                    setShowMagic(true);
                  }}
                  className="h-12 rounded-2xl bg-violet-50 border border-violet-200 text-violet-700 font-bold text-sm flex items-center justify-center gap-2"
                >
                  <Wand2 className="w-5 h-5" /> Magic Import
                </button>
              </div>
            )}
          </div>
        </Sheet>
      )}

      {/* Touch Event Create / Edit Modal */}
      {editingEvent && (
        <EventModal
          draft={editingEvent}
          members={members}
          mapsEnabled={Boolean(settings.mapsApiKeyConfigured)}
          homeAddress={settings.homeAddress}
          onClose={() => setEditingEvent(null)}
          onSave={(updated) => saveMutation.mutate(updated)}
          onDelete={
            editingEvent.id ? () => deleteMutation.mutate(editingEvent.id!) : undefined
          }
          saving={saveMutation.isPending}
          onCountdown={(ev) => {
            setEditingEvent(null);
            setCountdownSheet({
              initial: {
                title: ev.title || '',
                dateStr: ev.allDay ? ev.startIso!.slice(0, 10) : toDateStr(new Date(ev.startIso!)),
                emoji: ev.category === 'birthday' ? '🎂' : '🎉',
                memberId: ev.memberIds?.[0] ?? null,
              },
            });
          }}
        />
      )}

      {showMagic && (
        <MagicImportSheet
          members={members}
          defaultMemberIds={selectedMemberIds}
          geminiConfigured={settings.geminiApiKeyConfigured}
          onClose={() => setShowMagic(false)}
        />
      )}

      {countdownSheet && (
        <CountdownsSheet members={members} initial={countdownSheet.initial} onClose={() => setCountdownSheet(null)} />
      )}
    </div>
  );
};

interface EventModalProps {
  draft: Partial<CalendarEvent>;
  members: FamilyMember[];
  onClose: () => void;
  onSave: (draft: Partial<CalendarEvent>) => void;
  onDelete?: () => void;
  saving: boolean;
  onCountdown: (ev: Partial<CalendarEvent>) => void;
  /** Google Maps key set: place search + automatic drive time */
  mapsEnabled: boolean;
  /** For the automatic "away from home" check */
  homeAddress?: string;
}

/** Local date + "HH:mm" to an ISO string (midnight when the time is missing). */
function localIso(dateStr: string, time: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = (time || '0:0').split(':').map(Number);
  const dt = new Date(y || 2000, (m || 1) - 1, d || 1, h || 0, mi || 0);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}

const TRAVEL_CHOICES = [0, 10, 15, 20, 30, 45, 60];

/** "45 min", "2 h", "6 h 30 min" */
export function formatDrive(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const EventModal: React.FC<EventModalProps> = ({
  draft,
  members,
  onClose,
  onSave,
  onDelete,
  saving,
  onCountdown,
  mapsEnabled,
  homeAddress,
}) => {
  const readOnly = Boolean(draft.icsFeedId);
  const [awayMode, setAwayMode] = useState<AwayMode>(draft.awayMode ?? null);
  // The manual override: null = automatic (Google Maps), 0 = no drive, n = n minutes.
  const [travelMinutes, setTravelMinutes] = useState<number | null>(
    draft.travelManualMinutes !== undefined ? draft.travelManualMinutes : draft.id ? draft.travelMinutes ?? null : null
  );
  const isCustomTravel = travelMinutes != null && travelMinutes > 0 && !TRAVEL_CHOICES.includes(travelMinutes);
  const [customOpen, setCustomOpen] = useState(false);
  const [customH, setCustomH] = useState(isCustomTravel ? Math.floor(travelMinutes! / 60) : 1);
  const [customM, setCustomM] = useState(isCustomTravel ? travelMinutes! % 60 : 30);
  const setCustom = (h: number, m: number) => {
    const hh = Math.min(24, Math.max(0, Math.floor(h || 0)));
    const mm = Math.min(59, Math.max(0, Math.floor(m || 0)));
    setCustomH(hh);
    setCustomM(mm);
    setTravelMinutes(Math.min(1440, hh * 60 + mm) || 0);
  };
  const [autoDrive, setAutoDrive] = useState<{ minutes: number | null; error: string | null; loading: boolean }>({
    minutes: draft.travelAutoMinutes ?? null,
    error: null,
    loading: false,
  });
  const [driverMemberId, setDriverMemberId] = useState<string | null>(draft.driverMemberId ?? null);
  const initialStart = draft.startIso ? new Date(draft.startIso) : new Date();
  const initialEnd = draft.endIso ? new Date(draft.endIso) : new Date(initialStart.getTime() + 3600_000);

  const [title, setTitle] = useState(draft.title || '');
  const [location, setLocation] = useState(draft.location || '');
  const [description, setDescription] = useState(draft.description || '');
  const [allDay, setAllDay] = useState(Boolean(draft.allDay));
  const [dateStr, setDateStr] = useState(toDateStr(initialStart));
  const [endDateStr, setEndDateStr] = useState(
    draft.endIso ? toDateStr(new Date(draft.endIso)) : toDateStr(initialStart)
  );
  const [startTime, setStartTime] = useState(
    `${String(initialStart.getHours()).padStart(2, '0')}:${String(
      initialStart.getMinutes()
    ).padStart(2, '0')}`
  );
  const [endTime, setEndTime] = useState(
    `${String(initialEnd.getHours()).padStart(2, '0')}:${String(
      initialEnd.getMinutes()
    ).padStart(2, '0')}`
  );
  const [recurrenceRule, setRecurrenceRule] = useState<string>(
    draft.recurrenceRule || 'none'
  );
  const [memberIds, setMemberIds] = useState<string[]>(draft.memberIds || []);

  const toggleMember = (id: string) => {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const applyQuickHour = (h: number, m: number) => {
    setAllDay(false);
    setStartTime(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    const endH = (h + 1) % 24;
    setEndTime(`${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const effectiveEndDate = endDateStr >= dateStr ? endDateStr : dateStr;
    let startIso: string;
    let endIso: string;
    if (allDay) {
      startIso = `${dateStr}T00:00:00.000Z`;
      endIso = `${effectiveEndDate}T23:59:59.000Z`;
    } else {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      const [sy, smo, sd] = dateStr.split('-').map(Number);
      const [ey, emo, ed] = effectiveEndDate.split('-').map(Number);
      startIso = new Date(sy, smo - 1, sd, sh || 0, sm || 0).toISOString();
      endIso = new Date(ey, emo - 1, ed, eh || 0, em || 0).toISOString();
    }

    onSave({
      ...draft,
      title: title.trim(),
      location: location.trim(),
      description: description.trim(),
      allDay,
      startIso,
      endIso,
      recurrenceRule: recurrenceRule === 'none' ? null : (recurrenceRule as any),
      memberIds,
      travelMinutes: allDay ? null : travelMinutes,
      driverMemberId,
      awayMode,
    });
  };

  // Live Google Maps drive-time estimate for the address being typed (cached on the server per address).
  useEffect(() => {
    if (!mapsEnabled || allDay || !isFullAddress(location)) return;
    let cancelled = false;
    setAutoDrive((p) => ({ ...p, loading: true }));
    const t = setTimeout(async () => {
      const [y, mo, d] = dateStr.split('-').map(Number);
      const [h, mi] = startTime.split(':').map(Number);
      const startIso = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0).toISOString();
      try {
        const r = await apiFetch<{ minutes: number | null; error: string | null }>('/api/maps/drive', {
          method: 'POST',
          body: JSON.stringify({ location: location.trim(), startIso }),
        });
        if (!cancelled) setAutoDrive({ minutes: r.minutes, error: r.error, loading: false });
      } catch (err) {
        if (!cancelled) setAutoDrive({ minutes: null, error: (err as Error).message, loading: false });
      }
    }, 1500); // wait for typing to pause, so partial addresses aren't looked up
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [mapsEnabled, allDay, location, dateStr, startTime]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-start md:items-center justify-center p-4 overflow-y-auto">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-3xl shadow-2xl border border-stone-200 w-full max-w-xl p-6 space-y-4 my-6"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-extrabold text-slate-800">
              {draft.id ? 'Edit Event' : 'New Event'}
            </h3>
            <span className="text-xs text-stone-500 font-medium">
              {draft.id ? 'Edit Family Event' : 'Add Family Event'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center text-stone-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {readOnly && (
          <div className="p-3 rounded-2xl bg-stone-100 border border-stone-200 text-sm text-stone-600 font-semibold flex items-start gap-2">
            <Lock className="w-4 h-4 mt-0.5 shrink-0" />
            This event comes from a subscribed calendar link, so it can't be changed here. Edit it at the source (school, team app, iCloud…).
          </div>
        )}

        <fieldset disabled={readOnly} className="space-y-4 min-w-0">
        <div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title..."
            autoFocus
            className="w-full h-13 px-4 rounded-2xl bg-stone-50 border border-stone-200 text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        {/* Who is this for? */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">
            Who is this for?
          </label>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const selected = memberIds.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMember(m.id)}
                  style={
                    selected
                      ? {
                          backgroundColor: m.colorBg,
                          color: m.colorText,
                          borderColor: m.colorAccent,
                        }
                      : undefined
                  }
                  className={`px-3.5 py-2 rounded-2xl border-2 font-bold text-sm flex items-center gap-2 transition active:scale-95 ${
                    selected
                      ? 'shadow-2xs'
                      : 'bg-stone-50 border-stone-200 text-stone-500'
                  }`}
                >
                  <span>{m.emoji}</span>
                  <span>{m.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => {
                setDateStr(e.target.value);
                if (endDateStr < e.target.value) {
                  setEndDateStr(e.target.value);
                }
              }}
              className="w-full h-12 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDateStr}
              min={dateStr}
              onChange={(e) => setEndDateStr(e.target.value)}
              className="w-full h-12 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold"
            />
          </div>
        </div>

        {!allDay && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                Starts
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full h-12 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
                Ends
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full h-12 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold"
              />
            </div>
          </div>
        )}

        {/* Quick Time Chips & All-Day Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAllDay((a) => !a)}
            className={`h-10 min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold border transition flex items-center justify-center ${
              allDay
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-stone-100 text-slate-700 border-stone-200'
            }`}
          >
            All Day
          </button>
          {QUICK_HOURS.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => applyQuickHour(q.h, q.m)}
              className="h-10 min-h-[40px] px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-semibold text-slate-700 flex items-center gap-1"
            >
              <Clock className="w-3 h-3" />
              {q.label}
            </button>
          ))}
        </div>

        {/* Recurrence Selector */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
            Repeats
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'none', label: 'Does not repeat' },
              { id: 'daily', label: 'Daily' },
              { id: 'weekly', label: 'Weekly' },
              { id: 'biweekly', label: 'Every 2 Weeks' },
              { id: 'monthly', label: 'Monthly' },
            ].map((r) => {
              const active = recurrenceRule === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRecurrenceRule(r.id)}
                  className={`h-10 min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                    active
                      ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                      : 'bg-stone-50 hover:bg-stone-100 text-slate-700 border-stone-200'
                  }`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>


        {/* Away from home: chores for these people go up for grabs while it lasts */}
        {(() => {
          const effectiveEnd = endDateStr >= dateStr ? endDateStr : dateStr;
          const autoAway = looksLikeTrip(
            {
              id: draft.id || 'draft',
              title,
              description,
              location,
              allDay,
              memberIds,
              category: draft.category ?? null,
              startIso: allDay ? `${dateStr}T00:00:00.000Z` : localIso(dateStr, startTime),
              endIso: allDay ? `${effectiveEnd}T23:59:59.000Z` : localIso(effectiveEnd, endTime),
            },
            members,
            homeAddress
          );
          const options: Array<[AwayMode, string]> = [
            [null, autoAway ? 'Auto (away ✓)' : 'Auto'],
            ['away', 'Away'],
            ['home', 'Not away'],
          ];
          return (
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
                Away from home
              </label>
              <div className="flex flex-wrap items-center gap-2">
                {options.map(([mode, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setAwayMode(mode)}
                    aria-pressed={awayMode === mode}
                    className={`h-10 min-h-[40px] px-3.5 rounded-xl text-xs font-bold border transition ${
                      awayMode === mode
                        ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                        : 'bg-stone-50 hover:bg-stone-100 text-slate-700 border-stone-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="text-xs text-stone-400 font-medium">
                  {awayMode === 'away' || (awayMode === null && autoAway)
                    ? "Their chores go up for grabs while they're gone."
                    : 'Auto: a vacation or trip that is not at home.'}
                </span>
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <PlaceInput
            value={location}
            onChange={setLocation}
            enabled={mapsEnabled && !readOnly}
            placeholder={mapsEnabled ? 'Location (search a place)' : 'Location (optional)'}
            className="w-full h-12 px-4 rounded-xl bg-stone-50 border border-stone-200 text-sm font-medium"
            testId="event-location"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full h-12 px-4 rounded-xl bg-stone-50 border border-stone-200 text-sm font-medium"
          />
        </div>

        {/* Getting there: travel time drives the "leave in 10 min" banner; driver shows on the card */}
        {!allDay && (
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400">
              Getting there <span className="normal-case font-semibold">(only on Lucarne)</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {mapsEnabled && (
                <button
                  type="button"
                  onClick={() => {
                    setTravelMinutes(null);
                    setCustomOpen(false);
                  }}
                  data-testid="travel-auto"
                  title="Drive time from home from Google Maps, with predicted traffic"
                  className={`h-10 min-h-[40px] px-3 rounded-xl text-xs font-bold border transition flex items-center gap-1 ${
                    travelMinutes === null ? 'bg-sky-600 text-white border-sky-600' : 'bg-stone-50 text-slate-700 border-stone-200'
                  }`}
                >
                  <Car className="w-3.5 h-3.5" />
                  {!isFullAddress(location)
                    ? 'Auto (needs a full address)'
                    : autoDrive.loading
                    ? 'Auto · checking…'
                    : autoDrive.minutes
                    ? `Auto · ${formatDrive(autoDrive.minutes)}`
                    : 'Auto (no estimate)'}
                </button>
              )}
              {TRAVEL_CHOICES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setTravelMinutes(m);
                    setCustomOpen(false);
                  }}
                  className={`h-10 min-h-[40px] px-3 rounded-xl text-xs font-bold border transition ${
                    travelMinutes === m || (!mapsEnabled && m === 0 && travelMinutes === null)
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'bg-stone-50 text-slate-700 border-stone-200'
                  }`}
                >
                  {m === 0 ? 'No drive' : `${m} min drive`}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCustomOpen(true);
                  if (!isCustomTravel) setTravelMinutes(Math.max(1, customH * 60 + customM) || 90);
                }}
                data-testid="travel-custom"
                className={`h-10 min-h-[40px] px-3 rounded-xl text-xs font-bold border transition ${
                  isCustomTravel || customOpen ? 'bg-sky-600 text-white border-sky-600' : 'bg-stone-50 text-slate-700 border-stone-200'
                }`}
              >
                {isCustomTravel ? `${formatDrive(travelMinutes!)} drive` : 'Custom…'}
              </button>
            </div>
            {(customOpen || isCustomTravel) && (
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-700">
                <span className="text-xs text-stone-500">Custom drive:</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={24}
                  value={customH}
                  onChange={(e) => setCustom(Number(e.target.value), customM)}
                  className="w-16 h-10 px-2 rounded-xl bg-stone-50 border border-stone-200 text-center"
                  aria-label="Hours"
                  data-testid="travel-custom-hours"
                />
                <span>h</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  step={5}
                  value={customM}
                  onChange={(e) => setCustom(customH, Number(e.target.value))}
                  className="w-16 h-10 px-2 rounded-xl bg-stone-50 border border-stone-200 text-center"
                  aria-label="Minutes"
                  data-testid="travel-custom-minutes"
                />
                <span>min</span>
              </div>
            )}
            {mapsEnabled && travelMinutes === null && autoDrive.error && isFullAddress(location) && (
              <div className="text-xs font-semibold text-amber-700">{autoDrive.error}</div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-stone-500 flex items-center gap-1">
                <Car className="w-3.5 h-3.5" /> Driver:
              </span>
              {[{ id: '', name: 'Nobody set', emoji: '' }, ...members.filter((m) => m.role === 'parent')].map((m) => {
                const on = (driverMemberId ?? '') === m.id;
                return (
                  <button
                    key={m.id || 'none'}
                    type="button"
                    onClick={() => setDriverMemberId(m.id || null)}
                    className={`h-10 min-h-[40px] px-3 rounded-xl text-xs font-bold border transition ${
                      on ? 'bg-slate-800 text-white border-slate-800' : 'bg-stone-50 text-slate-700 border-stone-200'
                    }`}
                  >
                    {m.emoji} {m.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </fieldset>

        <div className="flex items-center justify-between pt-2">
          {onDelete && !readOnly ? (
            <button
              type="button"
              onClick={onDelete}
              className="px-4 h-12 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold text-sm flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2.5">
            {draft.id && (
              <button
                type="button"
                onClick={() => onCountdown(draft)}
                title="Count down to this"
                aria-label="Count down to this"
                className="w-12 h-12 rounded-2xl bg-amber-50 hover:bg-amber-100 text-amber-600 flex items-center justify-center"
              >
                <Hourglass className="w-5 h-5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-5 h-12 rounded-2xl bg-stone-100 hover:bg-stone-200 font-bold text-slate-700"
            >
              {readOnly ? 'Close' : 'Cancel'}
            </button>
            {!readOnly && (
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="px-6 h-12 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold shadow-sm"
            >
              {saving ? 'Saving...' : 'Save Event'}
            </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
