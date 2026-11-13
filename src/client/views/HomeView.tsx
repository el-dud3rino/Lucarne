import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, ChevronRight, ListChecks, MapPin, Plus, Sparkles, Star, UtensilsCrossed } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { toDateStr, formatTimeShort } from '../lib/dates.js';
import { DayWeather, useDailyForecast } from '../lib/weather.js';
import { eventLook, memberSwatch } from '../lib/eventColors.js';
import { useNow, useToday } from '../components/TodayBar.js';
import { CATEGORY_STYLES } from '../../shared/eventCategories.js';
import { choreAppliesToDate } from '../../shared/chores.js';
import { effectiveChores, type AwayEntry } from '../../shared/away.js';
import type {
  AppSettings,
  CalendarEvent,
  Chore,
  ChoreCompletion,
  ChoreTimeOfDay,
  FamilyMember,
  ListItem,
  MemberStarStats,
  TaskList,
} from '../../shared/types.js';

type OpenTab = (tab: 'calendar' | 'chores' | 'lists' | 'meals') => void;

interface HomeViewProps {
  members: FamilyMember[];
  settings: AppSettings;
  onOpenTab: OpenTab;
}

/**
 * "Today at a glance": today's calendar on the left; on the right, chores per person
 * (columns scroll left/right) above the family's lists. Everything is tappable in place.
 */
export const HomeView: React.FC<HomeViewProps> = ({ members, settings, onOpenTab }) => {
  // Re-render each minute so "now" and the date roll over at midnight on a wall that never reloads.
  const now = useNow(60_000);
  const dateStr = toDateStr(new Date(now));

  return (
    <div className="h-full overflow-y-auto md:overflow-hidden flex flex-col md:grid md:grid-cols-2 gap-3.5 md:gap-5" data-testid="home-view">
      <TodayColumn members={members} settings={settings} now={now} dateStr={dateStr} onOpenTab={onOpenTab} />
      <div className="flex flex-col gap-3.5 md:gap-5 max-md:shrink-0 md:min-h-0 md:grid md:grid-rows-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ChoresStrip members={members} dateStr={dateStr} onOpenTab={onOpenTab} />
        <ListsStrip onOpenTab={onOpenTab} />
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ helpers */

const panel = 'rounded-3xl bg-white border border-stone-200/90 shadow-2xs flex flex-col max-md:shrink-0 md:min-h-0 overflow-hidden';
const openBtn =
  'h-10 min-h-[40px] min-w-[40px] px-3 rounded-xl bg-stone-100 hover:bg-stone-200 text-slate-700 text-xs font-bold flex items-center gap-1 shrink-0 active:scale-95 transition';

const PanelHeader: React.FC<{ icon: React.ReactNode; title: string; sub?: React.ReactNode; action?: React.ReactNode }> = ({
  icon,
  title,
  sub,
  action,
}) => (
  <div className="px-4 md:px-5 pt-3.5 pb-3 flex items-center gap-3 border-b border-stone-100 shrink-0">
    <span className="text-stone-400">{icon}</span>
    <div className="flex-1 min-w-0">
      <h2 className="font-extrabold text-lg text-slate-800 leading-tight">{title}</h2>
      {sub && <div className="text-xs font-semibold text-stone-400">{sub}</div>}
    </div>
    {action}
  </div>
);

const Avatar: React.FC<{ member: FamilyMember; members: FamilyMember[]; size?: string }> = ({ member, members, size = 'w-5 h-5 text-[10px]' }) => (
  <span
    style={{ background: memberSwatch(member, members) }}
    className={`${size} rounded-full font-bold text-white flex items-center justify-center ring-2 ring-white shrink-0 [text-shadow:0_0_2px_rgba(0,0,0,0.45)]`}
    title={member.name}
  >
    {member.initial}
  </span>
);

/* ------------------------------------------------------------- today column */

const TodayColumn: React.FC<{
  members: FamilyMember[];
  settings: AppSettings;
  now: number;
  dateStr: string;
  onOpenTab: OpenTab;
}> = ({ members, settings, now, dateStr, onOpenTab }) => {
  const { data: today } = useToday();
  const { data: forecast } = useDailyForecast(settings.weatherLat, settings.weatherLon, settings.weatherUnit);
  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const events = useMemo(() => {
    const list = (today?.events || []).filter(
      (ev) =>
        (ev.category !== 'birthday' || settings.showBirthdays) && (ev.category !== 'holiday' || settings.showHolidays)
    );
    return [...list].sort((a, b) => a.startIso.localeCompare(b.startIso) || a.title.localeCompare(b.title));
  }, [today?.events, settings.showBirthdays, settings.showHolidays]);

  const allDay = events.filter((e) => e.allDay);
  const timed = events.filter((e) => !e.allDay);
  const nowIdx = timed.findIndex((e) => new Date(e.endIso).getTime() > now);
  const dayLabel = new Date(now).toLocaleDateString([], { weekday: 'long' });
  const dateLabel = new Date(now).toLocaleDateString([], { month: 'long', day: 'numeric' });

  const avatarsFor = (ev: CalendarEvent) => {
    if (ev.category) return [];
    const assigned = ev.memberIds.map((id) => memberMap.get(id)).filter((m): m is FamilyMember => Boolean(m));
    return assigned.some((m) => m.role === 'family') ? assigned.filter((m) => m.role === 'family') : assigned;
  };

  const nowLine = (
    <div key="now-line" className="flex items-center gap-2 py-0.5" aria-label="Now">
      <span className="w-[76px] shrink-0 text-right text-[11px] font-extrabold text-rose-500">
        {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
      </span>
      <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
      <span className="flex-1 h-0.5 bg-rose-400 rounded-full" />
    </div>
  );

  return (
    <section className={`${panel} md:h-full`} data-testid="home-today">
      <div className="px-4 md:px-5 pt-3.5 pb-3 flex items-center gap-3 border-b border-stone-100 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-sky-600">Today</div>
          <h2 className="font-extrabold text-2xl text-slate-800 leading-tight">
            {dayLabel}, <span className="text-stone-500 font-bold">{dateLabel}</span>
          </h2>
        </div>
        <DayWeather forecast={forecast?.get(dateStr)} />
        <button type="button" onClick={() => onOpenTab('calendar')} className={openBtn}>
          <CalendarDays className="w-4 h-4" /> <span className="hidden lg:inline">Calendar</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 md:min-h-0 overflow-y-auto px-4 md:px-5 py-3.5 space-y-2.5">
        {allDay.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-1">
            {allDay.map((ev) => {
              const look = eventLook(ev, members);
              return (
                <button
                  key={ev.id}
                  type="button"
                  onClick={() => onOpenTab('calendar')}
                  style={{ background: look.background, color: look.text }}
                  className="h-10 min-h-[40px] px-3.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-2xs max-w-full"
                >
                  {ev.category && <span aria-hidden>{CATEGORY_STYLES[ev.category].icon}</span>}
                  <span className="truncate">{ev.title}</span>
                  <span className="text-[10px] font-extrabold uppercase opacity-60 shrink-0">All day</span>
                </button>
              );
            })}
          </div>
        )}

        {timed.map((ev, i) => {
          const look = eventLook(ev, members);
          const past = new Date(ev.endIso).getTime() <= now;
          const happening = !past && new Date(ev.startIso).getTime() <= now;
          const avatars = avatarsFor(ev);
          return (
            <React.Fragment key={ev.id}>
              {i === nowIdx && !happening && nowLine}
              <div className={`flex items-stretch gap-2 ${past ? 'opacity-45' : ''}`}>
                <div className="w-[76px] shrink-0 text-right pt-2.5">
                  <div className="text-sm font-extrabold text-slate-700">{formatTimeShort(ev.startIso)}</div>
                  <div className="text-[11px] font-semibold text-stone-400">{formatTimeShort(ev.endIso)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenTab('calendar')}
                  style={{ background: look.background, color: look.text }}
                  data-striped={look.striped || undefined}
                  className={`relative overflow-hidden flex-1 min-w-0 min-h-[52px] text-left rounded-2xl shadow-2xs pl-[18px] pr-3.5 py-2.5 active:scale-[0.99] transition ${
                    happening ? 'ring-2 ring-rose-400 ring-offset-1' : ''
                  }`}
                >
                  <span aria-hidden className="absolute left-0 inset-y-0 w-1.5" style={{ background: look.bar }} />
                  <div className="flex items-start gap-2">
                    <span className="flex-1 min-w-0 font-bold text-[15px] leading-snug">
                      {ev.category && <span aria-hidden className="mr-1">{CATEGORY_STYLES[ev.category].icon}</span>}
                      {ev.title}
                    </span>
                    {happening && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold uppercase shrink-0">Now</span>
                    )}
                    {avatars.length > 0 && (
                      <span className="flex -space-x-1 shrink-0">
                        {avatars.slice(0, 4).map((m) => (
                          <Avatar key={m.id} member={m} members={members} />
                        ))}
                      </span>
                    )}
                  </div>
                  {ev.location && (
                    <div className="text-xs opacity-75 mt-0.5 flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{ev.location}</span>
                    </div>
                  )}
                </button>
              </div>
            </React.Fragment>
          );
        })}
        {timed.length > 0 && nowIdx === -1 && nowLine}

        {events.length === 0 && (
          <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-center text-stone-400">
            <Sparkles className="w-8 h-8 mb-2 text-amber-300" />
            <div className="font-bold text-slate-600">Nothing on the calendar today</div>
            <div className="text-sm">Enjoy the free day!</div>
          </div>
        )}
      </div>

      {settings.showDinnerOnCalendar && (
        <button
          type="button"
          onClick={() => onOpenTab('meals')}
          className="shrink-0 border-t border-stone-100 bg-amber-50/60 px-4 md:px-5 py-2.5 min-h-[52px] flex items-center gap-3 text-left hover:bg-amber-50"
        >
          {today?.dinner?.imageUrl ? (
            <img src={today.dinner.imageUrl} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
          ) : (
            <span className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-5 h-5" />
            </span>
          )}
          <span className="flex-1 min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-wider text-amber-600">Dinner tonight</span>
            <span className="block font-bold text-slate-800 truncate">{today?.dinner?.title || 'Not planned yet. Tap to plan'}</span>
          </span>
          <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
        </button>
      )}
    </section>
  );
};

/* ------------------------------------------------------------------ chores */

interface ChoresResponse {
  chores: Chore[];
  completions: ChoreCompletion[];
  stats: MemberStarStats[];
  away?: AwayEntry[];
  skippedChoreIds?: string[];
}

const TIME_ORDER: Record<ChoreTimeOfDay, number> = { morning: 0, afternoon: 1, evening: 2, anytime: 3 };

const ChoresStrip: React.FC<{ members: FamilyMember[]; dateStr: string; onOpenTab: OpenTab }> = ({ members, dateStr, onOpenTab }) => {
  const queryClient = useQueryClient();
  const queryKey = ['chores', dateStr];
  const { data } = useQuery({ queryKey, queryFn: () => apiFetch<ChoresResponse>(`/api/chores?date=${dateStr}`) });
  const [claiming, setClaiming] = useState<string | null>(null);

  const people = useMemo(() => members.filter((m) => m.role !== 'family'), [members]);
  const day = useMemo(() => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }, [dateStr]);
  const chores = useMemo(
    () =>
      // Away people's chores show as up for grabs; skipped chores are hidden for the day.
      effectiveChores(
        (data?.chores || []).filter((c) => c.active !== false && choreAppliesToDate(c, day, dateStr)),
        data?.away || [],
        data?.skippedChoreIds || []
      )
        .filter((e) => !e.skipped)
        .map((e) => ({ ...e.chore, assignedMemberId: e.ownerId }))
        .sort((a, b) => TIME_ORDER[a.timeOfDay] - TIME_ORDER[b.timeOfDay] || a.sortOrder - b.sortOrder),
    [data?.chores, data?.away, data?.skippedChoreIds, day, dateStr]
  );
  const doneBy = useMemo(() => new Map((data?.completions || []).map((c) => [c.choreId, c])), [data?.completions]);
  const starsToday = useMemo(() => new Map((data?.stats || []).map((s) => [s.memberId, s.todayStars])), [data?.stats]);

  const toggle = useMutation({
    mutationFn: (vars: { choreId: string; completedByMemberId?: string }) =>
      apiFetch(`/api/chores/${vars.choreId}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ dateStr, completedByMemberId: vars.completedByMemberId }),
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<ChoresResponse>(queryKey);
      if (prev) {
        const chore = prev.chores.find((c) => c.id === vars.choreId);
        const already = prev.completions.some((c) => c.choreId === vars.choreId);
        queryClient.setQueryData<ChoresResponse>(queryKey, {
          ...prev,
          completions: already
            ? prev.completions.filter((c) => c.choreId !== vars.choreId)
            : [
                ...prev.completions,
                {
                  id: `temp-${Date.now()}`,
                  choreId: vars.choreId,
                  dateStr,
                  completedByMemberId: vars.completedByMemberId || chore?.assignedMemberId || '',
                  starsEarned: chore?.stars || 1,
                  completedAt: new Date().toISOString(),
                },
              ],
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['chores'] }),
  });

  const tap = (chore: Chore) => {
    if (doneBy.has(chore.id)) return toggle.mutate({ choreId: chore.id });
    if (!chore.assignedMemberId) return setClaiming((c) => (c === chore.id ? null : chore.id));
    toggle.mutate({ choreId: chore.id, completedByMemberId: chore.assignedMemberId });
  };

  const shared = chores.filter((c) => !c.assignedMemberId);
  const total = chores.length;
  const done = chores.filter((c) => doneBy.has(c.id)).length;

  const choreRow = (chore: Chore, accent: string) => {
    const comp = doneBy.get(chore.id);
    const by = comp && !chore.assignedMemberId ? people.find((p) => p.id === comp.completedByMemberId) : undefined;
    return (
      <div key={chore.id}>
        <button
          type="button"
          onClick={() => tap(chore)}
          aria-pressed={Boolean(comp)}
          className={`w-full min-h-[48px] rounded-xl px-3 py-2 flex items-center gap-2.5 text-left border transition active:scale-[0.98] ${
            comp ? 'bg-stone-50 border-stone-100' : 'bg-white border-stone-200 hover:border-stone-300'
          }`}
        >
          <span className="text-xl shrink-0" aria-hidden>
            {chore.emoji || '✅'}
          </span>
          <span className={`flex-1 min-w-0 text-sm font-bold leading-snug ${comp ? 'line-through text-stone-400' : 'text-slate-800'}`}>
            {chore.title}
            {by && <span className="block text-[11px] font-semibold no-underline text-stone-400">by {by.name}</span>}
          </span>
          <span
            className="w-7 h-7 rounded-full border-2 flex items-center justify-center shrink-0"
            style={comp ? { backgroundColor: accent, borderColor: accent } : { borderColor: '#D6D3D1' }}
          >
            {comp && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
          </span>
        </button>
        {claiming === chore.id && !comp && (
          <div className="flex flex-wrap gap-1.5 pt-1.5 pl-1" role="group" aria-label={`Who did ${chore.title}?`}>
            {people.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setClaiming(null);
                  toggle.mutate({ choreId: chore.id, completedByMemberId: p.id });
                }}
                style={{ backgroundColor: p.colorBg, color: p.colorText }}
                className="h-10 min-h-[40px] min-w-[40px] px-3 rounded-full text-xs font-extrabold flex items-center gap-1"
              >
                <span aria-hidden>{p.emoji}</span> {p.name}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const column = (key: string, header: React.ReactNode, list: Chore[], accent: string, tint: string) => {
    const left = list.filter((c) => !doneBy.has(c.id)).length;
    const pct = list.length ? Math.round(((list.length - left) / list.length) * 100) : 0;
    return (
      <div key={key} className="w-[250px] md:w-[264px] shrink-0 snap-start rounded-2xl flex flex-col md:min-h-0 overflow-hidden" style={{ backgroundColor: tint }}>
        <div className="px-3 pt-3 pb-2 shrink-0">
          {header}
          <div className="mt-2 h-1.5 rounded-full bg-white/80 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: accent }} />
          </div>
        </div>
        <div className="flex-1 md:min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-1.5">
          {list.map((c) => choreRow(c, accent))}
          {list.length === 0 && <div className="text-xs font-semibold text-stone-500/80 px-1 py-3 text-center">No chores today</div>}
          {list.length > 0 && left === 0 && <div className="text-xs font-extrabold text-emerald-700 px-1 pt-1 text-center">All done! 🎉</div>}
        </div>
      </div>
    );
  };

  return (
    <section className={panel} data-testid="home-chores">
      <PanelHeader
        icon={<Check className="w-5 h-5" />}
        title="Chores"
        sub={total ? `${done} of ${total} done today` : 'Nothing due today'}
        action={
          <button type="button" onClick={() => onOpenTab('chores')} className={openBtn}>
            <span className="hidden lg:inline">All chores</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        }
      />
      <div className="flex-1 md:min-h-0 flex gap-3 overflow-x-auto snap-x px-4 md:px-5 py-3.5 max-md:h-[380px]">
        {people.map((p) => {
          const mine = chores.filter((c) => c.assignedMemberId === p.id);
          const left = mine.filter((c) => !doneBy.has(c.id)).length;
          return column(
            p.id,
            <div className="flex items-center gap-2" style={{ color: p.colorText }}>
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: p.colorAccent }}>
                {p.emoji || p.initial}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold truncate">{p.name}</span>
                <span className="block text-[11px] font-bold opacity-70">{mine.length ? (left ? `${left} left` : 'Done for today') : 'Free day'}</span>
              </span>
              <span className="flex items-center gap-0.5 text-xs font-extrabold bg-white/80 rounded-full px-2 py-1 shrink-0" title="Stars earned today">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {starsToday.get(p.id) ?? 0}
              </span>
            </div>,
            mine,
            p.colorAccent,
            p.colorBg
          );
        })}
        {shared.length > 0 &&
          column(
            'shared',
            <div className="flex items-center gap-2 text-slate-700">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0 bg-white">🙋</span>
              <span className="flex-1 min-w-0">
                <span className="block font-extrabold">Up for grabs</span>
                <span className="block text-[11px] font-bold opacity-70">Anyone can earn these</span>
              </span>
            </div>,
            shared,
            '#64748B',
            '#F1F5F9'
          )}
      </div>
    </section>
  );
};

/* ------------------------------------------------------------------- lists */

const ListsStrip: React.FC<{ onOpenTab: OpenTab }> = ({ onOpenTab }) => {
  const { data: lists = [] } = useQuery({ queryKey: ['lists'], queryFn: () => apiFetch<TaskList[]>('/api/lists') });
  const sorted = useMemo(() => [...lists].sort((a, b) => a.sortOrder - b.sortOrder), [lists]);
  return (
    <section className={panel} data-testid="home-lists">
      <PanelHeader
        icon={<ListChecks className="w-5 h-5" />}
        title="Lists"
        sub={`${sorted.reduce((n, l) => n + (l.uncheckedCount ?? 0), 0)} items to do`}
        action={
          <button type="button" onClick={() => onOpenTab('lists')} className={openBtn}>
            <span className="hidden lg:inline">All lists</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        }
      />
      <div className="flex-1 md:min-h-0 flex gap-3 overflow-x-auto snap-x px-4 md:px-5 py-3.5 max-md:h-[360px]">
        {sorted.map((l) => (
          <ListColumn key={l.id} list={l} />
        ))}
        {sorted.length === 0 && <div className="text-sm text-stone-400 m-auto">No lists yet</div>}
      </div>
    </section>
  );
};

const ListColumn: React.FC<{ list: TaskList }> = ({ list }) => {
  const queryClient = useQueryClient();
  const itemsKey = ['lists', list.id, 'items'];
  const { data: items = [] } = useQuery({ queryKey: itemsKey, queryFn: () => apiFetch<ListItem[]>(`/api/lists/${list.id}/items`) });
  const [text, setText] = useState('');
  // Items checked here stay visible (struck through) so a mis-tap can be undone with another tap.
  const [recent, setRecent] = useState<Set<string>>(() => new Set());

  const open = items.filter((i) => !i.checked);
  const shown = items.filter((i) => !i.checked || recent.has(i.id));
  const doneCount = items.length - shown.length;

  const toggle = useMutation({
    mutationFn: (item: ListItem) =>
      apiFetch<ListItem>(`/api/lists/items/${item.id}`, { method: 'PUT', body: JSON.stringify({ checked: !item.checked }) }),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: itemsKey });
      const prev = queryClient.getQueryData<ListItem[]>(itemsKey) || [];
      queryClient.setQueryData<ListItem[]>(itemsKey, prev.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(itemsKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });

  const add = useMutation({
    mutationFn: (t: string) => apiFetch<ListItem>(`/api/lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ text: t }) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    add.mutate(t);
  };

  return (
    <div className="w-[250px] md:w-[264px] shrink-0 snap-start rounded-2xl bg-stone-50 border border-stone-100 flex flex-col md:min-h-0 overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex items-center gap-2 shrink-0">
        <span className="text-xl" aria-hidden>
          {list.emoji || '📝'}
        </span>
        <span className="flex-1 min-w-0 font-extrabold text-slate-800 truncate">{list.name}</span>
        <span className="text-xs font-extrabold rounded-full px-2 py-0.5 text-white shrink-0" style={{ backgroundColor: list.colorAccent || '#64748B' }}>
          {open.length}
        </span>
      </div>
      <form onSubmit={submit} className="px-2.5 pb-2 flex gap-1.5 shrink-0">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={list.isGrocery ? 'Add an item…' : 'Add a to-do…'}
          aria-label={`Add to ${list.name}`}
          enterKeyHint="done"
          className="flex-1 min-w-0 h-10 px-3 rounded-xl bg-white border border-stone-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <button
          type="submit"
          aria-label={`Add to ${list.name}`}
          disabled={!text.trim()}
          className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-sky-600 disabled:bg-stone-200 text-white flex items-center justify-center shrink-0"
        >
          <Plus className="w-5 h-5" />
        </button>
      </form>
      <div className="flex-1 md:min-h-0 overflow-y-auto px-2.5 pb-2.5 space-y-1">
        {shown.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.checked}
            onClick={() => {
              if (!item.checked) setRecent((r) => new Set(r).add(item.id));
              toggle.mutate(item);
            }}
            className={`w-full min-h-[40px] rounded-xl border px-3 py-1.5 flex items-center gap-2.5 text-left active:scale-[0.98] transition ${
              item.checked ? 'bg-stone-50 border-stone-100' : 'bg-white border-stone-200'
            }`}
          >
            <span
              className={`w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center ${
                item.checked ? 'bg-emerald-500 border-emerald-500' : 'border-stone-300'
              }`}
            >
              {item.checked && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </span>
            <span className={`flex-1 min-w-0 text-sm font-semibold truncate ${item.checked ? 'line-through text-stone-400' : 'text-slate-800'}`}>
              {item.text}
            </span>
            {item.quantity && <span className="text-[11px] font-bold text-stone-400 shrink-0">{item.quantity}</span>}
          </button>
        ))}
        {open.length === 0 && <div className="text-xs font-semibold text-stone-400 px-1 py-3 text-center">All clear ✨</div>}
        {doneCount > 0 && <div className="text-[11px] font-semibold text-stone-400 px-1 pt-1">{doneCount} checked off</div>}
      </div>
    </div>
  );
};
