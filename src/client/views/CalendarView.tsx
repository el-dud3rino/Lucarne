import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  Trash2,
  Utensils,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
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
  const [subView, setSubView] = useState<CalendarSubView>('schedule');
  const [anchorDate, setAnchorDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | null>(null);

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

  const filteredEvents = useMemo(() => {
    if (selectedMemberIds.length === 0) return events;
    return events.filter(
      (ev) =>
        ev.memberIds.length === 0 ||
        ev.memberIds.some((id) => selectedMemberIds.includes(id))
    );
  }, [events, selectedMemberIds]);

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

  const stepAnchor = (dir: -1 | 1) => {
    if (subView === 'schedule') setAnchorDate((d) => addDays(d, dir * 4));
    else if (subView === 'people') setAnchorDate((d) => addDays(d, dir * 1));
    else if (subView === 'week') setAnchorDate((d) => addDays(d, dir * 7));
    else {
      setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1));
    }
  };

  const getEventStyle = (ev: CalendarEvent) => {
    const primary = ev.memberIds[0] ? memberMap.get(ev.memberIds[0]) : undefined;
    return {
      bg: primary?.colorBg || '#F1F5F9',
      text: primary?.colorText || '#1E293B',
      accent: primary?.colorAccent || '#64748B',
    };
  };

  const today = new Date();

  const renderEventCard = (ev: CalendarEvent, compact = false) => {
    const style = getEventStyle(ev);
    const evMembers = ev.memberIds
      .map((id) => memberMap.get(id))
      .filter((x): x is FamilyMember => Boolean(x));

    if (compact) {
      return (
        <button
          key={ev.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditingEvent(ev);
          }}
          style={{
            backgroundColor: style.bg,
            color: style.text,
            borderLeftColor: style.accent,
          }}
          className="w-full text-left rounded-xl border-l-4 shadow-2xs transition active:scale-[0.98] hover:brightness-[0.98] h-10 min-h-[40px] max-h-[40px] px-2.5 py-1.5 flex items-center gap-2 overflow-hidden"
        >
          {!ev.allDay && (
            <span className="text-[11px] font-bold opacity-75 shrink-0">
              {formatTimeShort(ev.startIso)}
            </span>
          )}
          <span className="text-xs font-bold truncate flex-1">
            {ev.title}
          </span>
          {evMembers.length > 0 && (
            <div className="flex -space-x-1 shrink-0">
              {evMembers.slice(0, 2).map((m) => (
                <span
                  key={m.id}
                  style={{ backgroundColor: m.colorAccent }}
                  className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-white"
                  title={m.name}
                >
                  {m.initial}
                </span>
              ))}
            </div>
          )}
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
        style={{
          backgroundColor: style.bg,
          color: style.text,
          borderLeftColor: style.accent,
        }}
        className="w-full text-left rounded-xl border-l-4 shadow-2xs transition active:scale-[0.98] hover:brightness-[0.98] min-h-[40px] flex flex-col justify-center px-3.5 py-2.5"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="font-bold leading-snug text-sm md:text-[15px]">
            {ev.title}
          </span>
          {evMembers.length > 0 && (
            <div className="flex -space-x-1 shrink-0">
              {evMembers.slice(0, 3).map((m) => (
                <span
                  key={m.id}
                  style={{ backgroundColor: m.colorAccent }}
                  className="w-5 h-5 rounded-full text-[10px] font-bold text-white flex items-center justify-center ring-2 ring-white"
                  title={m.name}
                >
                  {m.initial}
                </span>
              ))}
            </div>
          )}
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
      </button>
    );
  };

  const renderDayColumn = (day: Date, showWeekdayBig = true) => {
    const dayStr = toDateStr(day);
    const isToday = isSameDay(day, today);
    const dayEvents = filteredEvents.filter((ev) =>
      eventOccursOnDay(ev.startIso, ev.endIso, ev.allDay, day)
    );
    const allDayEvents = dayEvents.filter((e) => e.allDay);
    const timedEvents = dayEvents.filter((e) => !e.allDay);
    const dinner = dinnerByDate.get(dayStr);

    return (
      <div
        key={dayStr}
        onClick={() => openNewEventForDay(day)}
        className={`flex flex-col h-auto min-h-[260px] md:h-full rounded-2xl border transition cursor-pointer overflow-hidden ${
          isToday
            ? 'bg-white border-sky-300 ring-2 ring-sky-100 shadow-sm'
            : 'bg-white/95 border-stone-200/90 shadow-2xs'
        }`}
      >
        {/* Day Header */}
        <div
          className={`px-4 py-3 border-b flex items-center justify-between ${
            isToday ? 'bg-sky-50/70 border-sky-200/70' : 'border-stone-100'
          }`}
        >
          <div>
            <div
              className={`text-xs font-bold uppercase tracking-wider ${
                isToday ? 'text-sky-600' : 'text-stone-400'
              }`}
            >
              {day.toLocaleDateString([], { weekday: showWeekdayBig ? 'long' : 'short' })}
            </div>
            <div className="text-xl font-extrabold text-slate-800 leading-tight">
              {day.toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </div>
          </div>

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
          {allDayEvents.map((ev) => renderEventCard(ev))}
          {timedEvents.map((ev) => renderEventCard(ev))}
          {dayEvents.length === 0 && (
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

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Calendar Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepAnchor(-1)}
            className="w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 hover:bg-stone-50 active:scale-95 shadow-2xs"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              now.setHours(0, 0, 0, 0);
              setAnchorDate(now);
            }}
            className="px-4 h-11 rounded-2xl bg-white border border-stone-200 font-bold text-sm text-slate-700 hover:bg-stone-50 active:scale-95 shadow-2xs"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => stepAnchor(1)}
            className="w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 hover:bg-stone-50 active:scale-95 shadow-2xs"
          >
            <ChevronRight className="w-6 h-6" />
          </button>

          <h2 className="ml-2 text-xl md:text-2xl font-extrabold text-slate-800 tracking-tight">
            {subView === 'people'
              ? anchorDate.toLocaleDateString([], {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                })
              : anchorDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <div className="bg-stone-200/75 p-1 rounded-2xl flex items-center gap-1">
            {(
              [
                ['schedule', '4-Day'],
                ['people', 'People'],
                ['week', 'Week'],
                ['month', 'Month'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSubView(key)}
                className={`h-10 min-h-[40px] px-3.5 py-2 rounded-xl text-sm font-bold transition flex items-center justify-center ${
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
            onClick={() => openNewEventForDay(anchorDate)}
            className="h-11 px-4 rounded-2xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-bold text-sm flex items-center gap-2 shadow-sm"
          >
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Add Event</span>
          </button>
        </div>
      </div>

      {/* Main Calendar Grid Area */}
      <div className="flex-1 min-h-0">
        {subView === 'schedule' && (
          <div className="h-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5 overflow-y-auto md:overflow-hidden">
            {[0, 1, 2, 3].map((offset) => renderDayColumn(addDays(anchorDate, offset), true))}
          </div>
        )}

        {subView === 'week' && (
          <div className="h-full grid grid-cols-1 md:grid-cols-7 gap-2.5 overflow-y-auto md:overflow-hidden">
            {[0, 1, 2, 3, 4, 5, 6].map((offset) =>
              renderDayColumn(addDays(startOfWeek(anchorDate, 0), offset), false)
            )}
          </div>
        )}

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
                    style={{ backgroundColor: member.colorBg, color: member.colorText }}
                    className="px-4 py-3.5 border-b border-stone-100 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        style={{ backgroundColor: member.colorAccent }}
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

        {subView === 'month' && (
          <div className="h-full flex flex-col bg-white rounded-2xl border border-stone-200 shadow-2xs overflow-hidden">
            <div className="grid grid-cols-7 border-b border-stone-200 bg-stone-50/70">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div
                  key={d}
                  className="py-2 text-center text-xs font-bold uppercase tracking-wider text-stone-500"
                >
                  {d}
                </div>
              ))}
            </div>
            <div
              className="flex-1 grid grid-cols-7 grid-rows-5 divide-x divide-y divide-stone-100 min-h-0"
              style={{ gridTemplateRows: `repeat(${monthGridInfo.numWeeks}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: monthGridInfo.totalCells }).map((_, idx) => {
                const cellDay = addDays(startOfMonthGrid(anchorDate), idx);
                const inMonth = cellDay.getMonth() === anchorDate.getMonth();
                const isToday = isSameDay(cellDay, today);
                const dayEvents = filteredEvents.filter((ev) =>
                  eventOccursOnDay(ev.startIso, ev.endIso, ev.allDay, cellDay)
                );

                return (
                  <div
                    key={idx}
                    onClick={() => openNewEventForDay(cellDay)}
                    className={`p-1.5 flex flex-col gap-1 overflow-hidden cursor-pointer hover:bg-stone-50/70 transition ${
                      !inMonth ? 'bg-stone-50/40 opacity-50' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center ${
                          isToday ? 'bg-sky-600 text-white' : 'text-slate-700'
                        }`}
                      >
                        {cellDay.getDate()}
                      </span>
                      {dayEvents.length > monthGridInfo.maxEvents && (
                        <span className="text-[11px] font-bold text-stone-400">
                          +{dayEvents.length - monthGridInfo.maxEvents}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 overflow-hidden">
                      {dayEvents.slice(0, monthGridInfo.maxEvents).map((ev) => renderEventCard(ev, true))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Touch Event Create / Edit Modal */}
      {editingEvent && (
        <EventModal
          draft={editingEvent}
          members={members}
          onClose={() => setEditingEvent(null)}
          onSave={(updated) => saveMutation.mutate(updated)}
          onDelete={
            editingEvent.id ? () => deleteMutation.mutate(editingEvent.id!) : undefined
          }
          saving={saveMutation.isPending}
        />
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
}

const EventModal: React.FC<EventModalProps> = ({
  draft,
  members,
  onClose,
  onSave,
  onDelete,
  saving,
}) => {
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
    });
  };

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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Location (optional)"
            className="w-full h-12 px-4 rounded-xl bg-stone-50 border border-stone-200 text-sm font-medium"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full h-12 px-4 rounded-xl bg-stone-50 border border-stone-200 text-sm font-medium"
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          {onDelete ? (
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
            <button
              type="button"
              onClick={onClose}
              className="px-5 h-12 rounded-2xl bg-stone-100 hover:bg-stone-200 font-bold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="px-6 h-12 rounded-2xl bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold shadow-sm"
            >
              {saving ? 'Saving...' : 'Save Event'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
