import React, { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  Baby,
  Check,
  ChevronLeft,
  ChevronRight,
  Plane,
  Plus,
  SkipForward,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { RewardsSheet } from '../components/Rewards.js';
import { RoutinesBoard } from '../components/Routines.js';
import { KidModeOverlay } from '../components/KidMode.js';
import { Sheet } from '../components/Sheet.js';
import { addDays, toDateStr } from '../lib/dates.js';
import { choreAppliesToDate } from '../../shared/chores.js';
import { effectiveChores, type AwayEntry, type EffectiveChore } from '../../shared/away.js';
import { useIsPhone, useSwipePaging } from '../lib/gestures.js';

const TIME_OF_DAY_ORDER: Record<ChoreTimeOfDay, number> = {
  morning: 0,
  afternoon: 1,
  evening: 2,
  anytime: 3,
};
import type {
  Chore,
  ChoreCompletion,
  ChoreFrequency,
  ChoreTimeOfDay,
  FamilyMember,
  MemberStarStats,
} from '../../shared/types.js';

interface ChoresViewProps {
  members: FamilyMember[];
  selectedMemberIds: string[];
}

interface ChoresResponse {
  chores: Chore[];
  completions: ChoreCompletion[];
  stats: MemberStarStats[];
  /** People away from home today (their chores go up for grabs) */
  away?: AwayEntry[];
  skippedChoreIds?: string[];
}

type Eff = EffectiveChore<Chore>;

const TIME_LABELS: Record<ChoreTimeOfDay, string> = {
  morning: '🌅 Morning',
  afternoon: '☀️ Afternoon',
  evening: '🌙 Evening',
  anytime: '✨ Anytime',
};

export const ChoresView: React.FC<ChoresViewProps> = ({ members, selectedMemberIds }) => {
  const queryClient = useQueryClient();
  const [activeDate, setActiveDate] = useState<Date>(() => new Date());
  const dateStr = toDateStr(activeDate);

  const [showStarsDrawer, setShowStarsDrawer] = useState(false);
  const [editingChore, setEditingChore] = useState<Partial<Chore> | null>(null);
  const [claimingChore, setClaimingChore] = useState<Chore | null>(null);
  const [board, setBoard] = useState<'chores' | 'routines' | 'habits'>('chores');
  const [kidPicker, setKidPicker] = useState(false);
  const [kidMember, setKidMember] = useState<FamilyMember | null>(null);
  const isPhone = useIsPhone();
  /** Phones show one person at a time ('shared' = Up for grabs) */
  const [phoneMemberId, setPhoneMemberId] = useState<string | null>(null);
  const [page, setPage] = useState<{ direction: 'left' | 'right' | null; key: number }>({ direction: null, key: 0 });
  const stepDay = (dir: -1 | 1) => {
    setPage((p) => ({ direction: dir === 1 ? 'left' : 'right', key: p.key + 1 }));
    setActiveDate((d) => addDays(d, dir));
  };
  const swipeRef = useRef<HTMLDivElement>(null);
  useSwipePaging(swipeRef, { onPrev: () => stepDay(-1), onNext: () => stepDay(1) });

  const individualMembers = useMemo(
    () => members.filter((m) => m.role !== 'family'),
    [members]
  );

  const visibleMembers = useMemo(() => {
    if (selectedMemberIds.length === 0) return individualMembers;
    return individualMembers.filter((m) => selectedMemberIds.includes(m.id));
  }, [individualMembers, selectedMemberIds]);

  const queryKey = ['chores', dateStr];
  const { data } = useQuery({
    queryKey,
    queryFn: () => apiFetch<ChoresResponse>(`/api/chores?date=${dateStr}`),
  });

  const chores = useMemo(
    () => (data?.chores || []).filter((c) => choreAppliesToDate(c, activeDate, dateStr)),
    [data?.chores, activeDate, dateStr]
  );
  const completions = data?.completions || [];
  const stats = data?.stats || [];
  const away = data?.away || [];
  const awayById = useMemo(() => new Map(away.map((a) => [a.memberId, a])), [away]);
  // Away people's chores move to Up for grabs; skipped ones stay put but don't count.
  const effective = useMemo(
    () => effectiveChores(chores, away, data?.skippedChoreIds || []),
    [chores, away, data?.skippedChoreIds]
  );
  const sortEff = (list: Eff[]) =>
    [...list].sort(
      (a, b) =>
        Number(a.skipped) - Number(b.skipped) ||
        (TIME_OF_DAY_ORDER[a.chore.timeOfDay] ?? 3) - (TIME_OF_DAY_ORDER[b.chore.timeOfDay] ?? 3) ||
        a.chore.sortOrder - b.chore.sortOrder
    );

  const completionByChore = useMemo(() => {
    const map = new Map<string, ChoreCompletion>();
    for (const c of completions) map.set(c.choreId, c);
    return map;
  }, [completions]);

  // 0ms Optimistic Toggle Mutation!
  const toggleMutation = useMutation({
    mutationFn: async (vars: { choreId: string; completedByMemberId?: string }) =>
      apiFetch(`/api/chores/${vars.choreId}/toggle`, {
        method: 'POST',
        body: JSON.stringify({
          dateStr,
          completedByMemberId: vars.completedByMemberId,
        }),
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<ChoresResponse>(queryKey);
      if (prev) {
        const already = prev.completions.find((c) => c.choreId === vars.choreId);
        const chore = prev.chores.find((c) => c.id === vars.choreId);
        let nextCompletions: ChoreCompletion[];
        if (already) {
          nextCompletions = prev.completions.filter((c) => c.choreId !== vars.choreId);
        } else {
          nextCompletions = [
            ...prev.completions,
            {
              id: `temp-${Date.now()}`,
              choreId: vars.choreId,
              dateStr,
              completedByMemberId:
                vars.completedByMemberId || chore?.assignedMemberId || individualMembers[0]?.id || '',
              starsEarned: chore?.stars || 1,
              completedAt: new Date().toISOString(),
            },
          ];
        }
        queryClient.setQueryData<ChoresResponse>(queryKey, {
          ...prev,
          completions: nextCompletions,
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (draft: Partial<Chore>) => {
      if (draft.id) {
        return apiFetch(`/api/chores/${draft.id}`, {
          method: 'PUT',
          body: JSON.stringify(draft),
        });
      }
      return apiFetch('/api/chores', {
        method: 'POST',
        body: JSON.stringify(draft),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      setEditingChore(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiFetch(`/api/chores/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      setEditingChore(null);
    },
  });

  const skipMutation = useMutation({
    mutationFn: async (choreId: string) =>
      apiFetch(`/api/chores/${choreId}/skip`, { method: 'POST', body: JSON.stringify({ dateStr }) }),
    onMutate: async (choreId) => {
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<ChoresResponse>(queryKey);
      if (prev) {
        const skipped = new Set(prev.skippedChoreIds || []);
        if (skipped.has(choreId)) skipped.delete(choreId);
        else skipped.add(choreId);
        queryClient.setQueryData<ChoresResponse>(queryKey, {
          ...prev,
          skippedChoreIds: [...skipped],
          completions: prev.completions.filter((c) => c.choreId !== choreId),
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(queryKey, ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['chores'] }),
  });

  const handleTapChore = (e: Eff) => {
    const chore = e.chore;
    if (e.skipped) {
      skipMutation.mutate(chore.id);
      return;
    }
    const existing = completionByChore.get(chore.id);
    if (existing) {
      toggleMutation.mutate({ choreId: chore.id });
      return;
    }
    // Up for grabs (shared, or moved there because its owner is away): ask who did it.
    if (!e.ownerId) {
      setClaimingChore(chore);
      return;
    }
    toggleMutation.mutate({
      choreId: chore.id,
      completedByMemberId: e.ownerId,
    });
  };

  const renderChoreCard = (e: Eff, accentColor: string) => {
    const chore = e.chore;
    const comp = completionByChore.get(chore.id);
    const done = Boolean(comp);
    const fromMember = e.reassignedFrom ? individualMembers.find((m) => m.id === e.reassignedFrom) : undefined;
    const completedMember = comp
      ? individualMembers.find((m) => m.id === comp.completedByMemberId)
      : undefined;

    return (
      <div
        key={chore.id}
        onClick={() => handleTapChore(e)}
        data-skipped={e.skipped || undefined}
        className={`group rounded-2xl border p-3.5 flex items-center gap-3 cursor-pointer transition select-none active:scale-[0.98] ${
          e.skipped
            ? 'bg-stone-50/60 border-dashed border-stone-300 opacity-60'
            : done
            ? 'bg-stone-50/90 border-stone-200/80 opacity-65'
            : 'bg-white border-stone-200 shadow-2xs hover:border-stone-300'
        }`}
      >
        {/* Big Touch Check Circle */}
        <div
          style={done ? { backgroundColor: accentColor, borderColor: accentColor } : undefined}
          className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-full border-2 flex items-center justify-center shrink-0 transition ${
            done ? 'text-white animate-pop' : 'border-stone-300 bg-stone-50'
          }`}
        >
          {done ? <Check className="w-5 h-5 stroke-[3]" /> : <span className="text-lg">{chore.emoji}</span>}
        </div>

        <div className="flex-1 min-w-0">
          <div
            className={`font-bold text-sm md:text-[15px] leading-snug ${
              done || e.skipped ? 'line-through text-stone-400' : 'text-slate-800'
            }`}
          >
            {chore.title}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-stone-400 font-medium">
            <span>{TIME_LABELS[chore.timeOfDay]}</span>
            <span className="inline-flex items-center gap-0.5 text-amber-600 font-bold">
              <Star className="w-3 h-3 fill-amber-400 text-amber-500" />
              {chore.stars}
            </span>
            {completedMember && !e.ownerId && (
              <span className="px-1.5 py-0.5 rounded-md bg-stone-200/70 text-slate-700 font-bold text-[11px]">
                Done by {completedMember.name}
              </span>
            )}
            {fromMember && !done && (
              <span className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-800 font-bold text-[11px] whitespace-nowrap" title={`${fromMember.name} is away`}>
                ✈️ {fromMember.name}
              </span>
            )}
            {e.skipped && <span className="font-bold text-stone-500">Skipped · tap to undo</span>}
          </div>
        </div>

        {!done && !e.skipped && (
          <button
            type="button"
            onClick={(ev) => {
              ev.stopPropagation();
              skipMutation.mutate(chore.id);
            }}
            title="Skip today (no stars, not counted as missed)"
            aria-label={`Skip ${chore.title} today`}
            className="h-10 min-h-[40px] min-w-[40px] px-2 rounded-lg text-stone-400 hover:text-slate-700 hover:bg-stone-100 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition flex items-center justify-center"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        )}

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditingChore(chore);
          }}
          className="h-10 min-h-[40px] px-2.5 min-w-[40px] rounded-lg text-xs font-semibold text-stone-400 hover:text-slate-700 hover:bg-stone-100 opacity-70 md:opacity-0 md:group-hover:opacity-100 transition flex items-center justify-center"
        >
          Edit
        </button>
      </div>
    );
  };

  const sharedChores = useMemo(() => sortEff(effective.filter((e) => !e.ownerId)), [effective]);
  const counted = (list: Eff[]) => list.filter((e) => !e.skipped);
  const phoneSelected =
    phoneMemberId === 'shared' || visibleMembers.some((m) => m.id === phoneMemberId)
      ? phoneMemberId
      : visibleMembers[0]?.id ?? 'shared';

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepDay(-1)}
            aria-label="Previous day"
            className="w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={() => setActiveDate(new Date())}
            className="px-4 h-11 rounded-2xl bg-white border border-stone-200 font-bold text-sm text-slate-700 active:scale-95"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => stepDay(1)}
            aria-label="Next day"
            className="w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
          <h2 className="ml-1 md:ml-2 text-lg md:text-2xl font-extrabold text-slate-800 truncate">
            {activeDate.toLocaleDateString([], {
              weekday: isPhone ? 'short' : 'long',
              month: 'short',
              day: 'numeric',
            })}
          </h2>
        </div>

        <div className="flex items-center gap-2.5 max-w-full overflow-x-auto">
          <div className="bg-stone-200/75 p-1 rounded-2xl flex items-center gap-1 shrink-0" role="tablist" aria-label="Chores, routines or habits">
            {(
              [
                ['chores', 'Chores'],
                ['routines', 'Routines'],
                ['habits', 'Habits'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={board === key}
                onClick={() => setBoard(key)}
                className={`h-10 min-h-[40px] px-3.5 rounded-xl text-sm font-bold whitespace-nowrap transition ${
                  board === key ? 'bg-white text-slate-900 shadow-xs' : 'text-stone-600 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setKidPicker(true)}
            className="h-11 px-4 rounded-2xl bg-white border border-stone-200 text-slate-700 font-bold text-sm flex items-center gap-2 active:scale-95 shrink-0"
            title="Big, simple screen for one child"
          >
            <Baby className="w-5 h-5 text-pink-500" />
            <span className="hidden lg:inline">Kid Mode</span>
          </button>

          <button
            type="button"
            onClick={() => setShowStarsDrawer(true)}
            className="h-11 px-4 rounded-2xl bg-amber-100/90 hover:bg-amber-200/80 border border-amber-300/80 text-amber-950 font-bold text-sm flex items-center gap-2 active:scale-95 shrink-0"
          >
            <Award className="w-5 h-5 text-amber-600" />
            <span>Star Tracker</span>
          </button>

          {board === 'chores' && (
          <button
            type="button"
            onClick={() =>
              setEditingChore({
                title: '',
                emoji: '✨',
                assignedMemberId: visibleMembers[0]?.id ?? null,
                timeOfDay: 'anytime',
                frequency: 'daily',
                daysOfWeek: [],
                stars: 1,
              })
            }
            className="h-11 px-4 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm flex items-center gap-2 shadow-sm active:scale-95 shrink-0"
          >
            <Plus className="w-5 h-5" />
            <span>New Chore</span>
          </button>
          )}
        </div>
      </div>

      {/* Swipe left/right to change the day */}
      <div ref={swipeRef} className="flex-1 min-h-0 flex flex-col touch-pan-y">
      <div
        key={page.key}
        className={`flex-1 min-h-0 flex flex-col gap-3 ${page.direction === 'left' ? 'animate-page-left' : page.direction === 'right' ? 'animate-page-right' : ''}`}
      >
      {board !== 'chores' && (
        <RoutinesBoard mode={board} members={visibleMembers} allMembers={members} dateStr={dateStr} />
      )}

      {/* Phones: pick one person at a time */}
      {board === 'chores' && isPhone && (
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 shrink-0" data-no-swipe role="tablist" aria-label="Whose chores">
          {visibleMembers.map((m) => {
            const mine = counted(effective.filter((e) => e.ownerId === m.id));
            const doneN = mine.filter((e) => completionByChore.has(e.chore.id)).length;
            const sel = phoneSelected === m.id;
            const isAway = awayById.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={sel}
                onClick={() => setPhoneMemberId(m.id)}
                className={`shrink-0 min-w-[64px] min-h-[64px] px-2 py-1.5 rounded-2xl flex flex-col items-center gap-1 transition ${
                  sel ? 'bg-white shadow-xs ring-2' : 'opacity-80'
                }`}
                style={sel ? ({ ['--tw-ring-color' as string]: m.colorAccent } as React.CSSProperties) : undefined}
              >
                <span
                  style={{ backgroundColor: m.colorAccent }}
                  className="relative w-10 h-10 rounded-full text-white text-lg flex items-center justify-center"
                >
                  {m.emoji}
                  {isAway && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white text-sky-600 flex items-center justify-center shadow">
                      <Plane className="w-3 h-3" />
                    </span>
                  )}
                </span>
                <span className="text-[11px] font-bold text-slate-700 leading-none">
                  {isAway ? 'Away' : mine.length ? `${doneN}/${mine.length}` : '—'}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            role="tab"
            aria-selected={phoneSelected === 'shared'}
            onClick={() => setPhoneMemberId('shared')}
            className={`shrink-0 min-w-[64px] min-h-[64px] px-2 py-1.5 rounded-2xl flex flex-col items-center gap-1 transition ${
              phoneSelected === 'shared' ? 'bg-white shadow-xs ring-2 ring-purple-500' : 'opacity-80'
            }`}
          >
            <span className="w-10 h-10 rounded-full bg-purple-600 text-white flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-bold text-slate-700 leading-none">
              {counted(sharedChores).filter((e) => !completionByChore.has(e.chore.id)).length} open
            </span>
          </button>
        </div>
      )}

      {/* Person Columns + Up-for-grabs column */}
      {board === 'chores' && (
      <div
        className="flex-1 min-h-0 grid gap-3.5 overflow-x-auto pb-1"
        style={{
          gridTemplateColumns: isPhone ? 'minmax(0, 1fr)' : `repeat(${visibleMembers.length + 1}, minmax(265px, 1fr))`,
        }}
      >
        {visibleMembers
          .filter((m) => !isPhone || phoneSelected === m.id)
          .map((member) => {
          const mList = sortEff(effective.filter((e) => e.ownerId === member.id));
          const mCounted = counted(mList);
          const doneCount = mCounted.filter((e) => completionByChore.has(e.chore.id)).length;
          const mStat = stats.find((s) => s.memberId === member.id);
          const pct = mCounted.length > 0 ? Math.round((doneCount / mCounted.length) * 100) : 100;
          const awayInfo = awayById.get(member.id);
          const movedCount = effective.filter((e) => e.reassignedFrom === member.id).length;

          return (
            <div
              key={member.id}
              className="flex flex-col h-full min-h-0 rounded-2xl bg-white border border-stone-200/90 shadow-2xs overflow-hidden"
            >
              <div
                style={{ backgroundColor: member.colorBg, color: member.colorText }}
                className="px-4 py-3.5 border-b border-stone-100"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      style={{ backgroundColor: member.colorAccent }}
                      className="w-10 h-10 rounded-full text-white text-lg flex items-center justify-center shadow-2xs"
                    >
                      {member.emoji}
                    </span>
                    <div>
                      <div className="font-extrabold text-lg leading-tight">{member.name}</div>
                      <div className="text-xs font-bold opacity-80">
                        {awayInfo
                          ? `✈️ Away · ${awayInfo.eventTitle}`
                          : `${doneCount}/${mCounted.length} done · ⭐ ${mStat?.weekStars ?? 0} this wk`}
                      </div>
                    </div>
                  </div>
                  {!awayInfo && <span className="text-sm font-extrabold">{pct}%</span>}
                </div>
                {!awayInfo && (
                  <div className="mt-2.5 h-2 rounded-full bg-white/70 overflow-hidden">
                    <div
                      style={{ width: `${pct}%`, backgroundColor: member.colorAccent }}
                      className="h-full rounded-full transition-all duration-300"
                    />
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {mList.map((e) => renderChoreCard(e, member.colorAccent))}
                {awayInfo && (
                  <div className="py-8 px-3 flex flex-col items-center justify-center text-center gap-2 text-stone-400">
                    <Plane className="w-8 h-8 text-sky-400" />
                    <div className="text-sm font-bold text-slate-600">{member.name} is away today</div>
                    <div className="text-xs font-medium">
                      {movedCount > 0
                        ? `${movedCount} chore${movedCount === 1 ? '' : 's'} moved to Up for grabs — anyone can do them for the stars.`
                        : 'No chores to cover.'}
                    </div>
                  </div>
                )}
                {!awayInfo && mList.length === 0 && (
                  <div className="h-28 flex items-center justify-center text-sm text-stone-300 font-medium">
                    All clear!
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Up for grabs: shared chores plus chores of anyone away */}
        {(!isPhone || phoneSelected === 'shared') && (
        <div className="flex flex-col h-full min-h-0 rounded-2xl bg-white border border-stone-200/90 shadow-2xs overflow-hidden">
          <div className="px-4 py-3.5 bg-purple-50 text-purple-950 border-b border-purple-100">
            <div className="flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-full bg-purple-600 text-white text-lg flex items-center justify-center shadow-2xs">
                <Sparkles className="w-5 h-5" />
              </span>
              <div>
                <div className="font-extrabold text-lg leading-tight">Up for grabs</div>
                <div className="text-xs font-bold opacity-75">
                  {away.length > 0 ? 'Shared chores + chores of anyone away' : 'Tap to claim stars when completed'}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {sharedChores.map((e) => renderChoreCard(e, '#9333EA'))}
            {sharedChores.length === 0 && (
              <div className="h-28 flex items-center justify-center text-sm text-stone-300 font-medium">
                No shared chores
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      )}
      </div>
      </div>

      {/* "Who Did It?" Quick Picker for Shared Chores */}
      {claimingChore && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-extrabold text-slate-800">
                Who completed "{claimingChore.title}"?
              </h3>
              <button
                type="button"
                onClick={() => setClaimingChore(null)}
                className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {individualMembers.filter((m) => !awayById.has(m.id)).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    toggleMutation.mutate({
                      choreId: claimingChore.id,
                      completedByMemberId: m.id,
                    });
                    setClaimingChore(null);
                  }}
                  style={{ backgroundColor: m.colorBg, color: m.colorText }}
                  className="p-4 rounded-2xl font-extrabold text-lg flex items-center gap-3 active:scale-95 transition shadow-2xs"
                >
                  <span className="text-2xl">{m.emoji}</span>
                  <span>{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Star Tracker: balances, rewards and redeeming */}
      {showStarsDrawer && <RewardsSheet members={members} stats={stats} onClose={() => setShowStarsDrawer(false)} />}

      {kidPicker && (
        <Sheet title="Kid mode" subtitle="A big, simple screen with just one person's day. Tap ✕ to come back." onClose={() => setKidPicker(false)}>
          <div className="grid grid-cols-2 gap-3">
            {individualMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setKidPicker(false);
                  setKidMember(m);
                }}
                style={{ backgroundColor: m.colorBg, color: m.colorText }}
                className="p-5 rounded-2xl font-extrabold text-xl flex items-center gap-3 active:scale-95 transition shadow-2xs"
              >
                <span className="text-4xl">{m.emoji}</span>
                <span>{m.name}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {kidMember && <KidModeOverlay member={kidMember} onExit={() => setKidMember(null)} />}

      {/* Chore Create / Edit Modal */}
      {editingChore && (
        <ChoreModal
          draft={editingChore}
          members={individualMembers}
          onClose={() => setEditingChore(null)}
          onSave={(updated) => saveMutation.mutate(updated)}
          onDelete={editingChore.id ? () => deleteMutation.mutate(editingChore.id!) : undefined}
        />
      )}
    </div>
  );
};

interface ChoreModalProps {
  draft: Partial<Chore>;
  members: FamilyMember[];
  onClose: () => void;
  onSave: (draft: Partial<Chore>) => void;
  onDelete?: () => void;
}

const EMOJI_PRESETS = ['🛏️', '🪥', '🎒', '🧸', '🍽️', '🗑️', '🧺', '🐕', '🧽', '📚', '🌱', '✨'];

const ChoreModal: React.FC<ChoreModalProps> = ({
  draft,
  members,
  onClose,
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState(draft.title || '');
  const [emoji, setEmoji] = useState(draft.emoji || '✨');
  const [assignedMemberId, setAssignedMemberId] = useState<string | null>(
    draft.assignedMemberId ?? null
  );
  const [timeOfDay, setTimeOfDay] = useState<ChoreTimeOfDay>(draft.timeOfDay || 'anytime');
  const [frequency, setFrequency] = useState<ChoreFrequency>(draft.frequency || 'daily');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(draft.daysOfWeek || []);
  const [specificDate, setSpecificDate] = useState<string>(
    draft.specificDate || toDateStr(new Date())
  );
  const [stars, setStars] = useState<number>(draft.stars ?? 1);

  const toggleDayOfWeek = (day: number) => {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-start md:items-center justify-center p-4 overflow-y-auto">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          onSave({
            ...draft,
            title: title.trim(),
            emoji,
            assignedMemberId,
            timeOfDay,
            frequency,
            daysOfWeek: frequency === 'weekly' ? daysOfWeek : [],
            specificDate: frequency === 'once' ? specificDate : null,
            stars,
          });
        }}
        className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-lg w-full p-6 space-y-4 my-6"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-extrabold text-slate-800">
            {draft.id ? 'Edit Chore' : 'New Chore'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Chore name (e.g. Unload Dishwasher)"
          autoFocus
          className="w-full h-12 px-4 rounded-2xl bg-stone-50 border border-stone-200 text-base font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
        />

        <div className="flex flex-wrap gap-1.5">
          {EMOJI_PRESETS.map((em) => (
            <button
              key={em}
              type="button"
              onClick={() => setEmoji(em)}
              className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center border ${
                emoji === em
                  ? 'bg-sky-50 border-sky-500 ring-2 ring-sky-200'
                  : 'bg-stone-50 border-stone-200'
              }`}
            >
              {em}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1.5">
            Assigned To
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAssignedMemberId(null)}
              className={`h-10 min-h-[40px] px-3.5 py-2 rounded-xl text-sm font-bold border flex items-center justify-center ${
                assignedMemberId === null
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'bg-stone-50 text-slate-700 border-stone-200'
              }`}
            >
              ✨ Shared / Anyone
            </button>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setAssignedMemberId(m.id)}
                style={
                  assignedMemberId === m.id
                    ? { backgroundColor: m.colorAccent, color: '#fff', borderColor: m.colorAccent }
                    : undefined
                }
                className={`h-10 min-h-[40px] px-3.5 py-2 rounded-xl text-sm font-bold border flex items-center justify-center ${
                  assignedMemberId === m.id
                    ? ''
                    : 'bg-stone-50 text-slate-700 border-stone-200'
                }`}
              >
                {m.emoji} {m.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
              Time of Day
            </label>
            <select
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value as ChoreTimeOfDay)}
              className="w-full h-11 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-sm"
            >
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
              <option value="anytime">Anytime</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
              Schedule
            </label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ChoreFrequency)}
              className="w-full h-11 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-sm"
            >
              <option value="daily">Every Day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekends">Weekends</option>
              <option value="weekly">Weekly (Select Days)</option>
              <option value="once">One-Off</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400 mb-1">
              Star Value
            </label>
            <select
              value={stars}
              onChange={(e) => setStars(Number(e.target.value))}
              className="w-full h-11 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-sm"
            >
              <option value={1}>1 ⭐</option>
              <option value={2}>2 ⭐</option>
              <option value={3}>3 ⭐</option>
              <option value={5}>5 ⭐</option>
            </select>
          </div>
        </div>

        {frequency === 'weekly' && (
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400">
              Active Days of Week
            </label>
            <div className="flex flex-wrap gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayName, idx) => {
                const active = daysOfWeek.includes(idx);
                return (
                  <button
                    key={dayName}
                    type="button"
                    onClick={() => toggleDayOfWeek(idx)}
                    className={`w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl font-bold text-xs border transition flex items-center justify-center ${
                      active
                        ? 'bg-sky-600 text-white border-sky-600 shadow-2xs'
                        : 'bg-stone-50 hover:bg-stone-100 text-slate-700 border-stone-200'
                    }`}
                  >
                    {dayName}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {frequency === 'once' && (
          <div className="space-y-1.5">
            <label className="block text-xs font-bold uppercase tracking-wider text-stone-400">
              Chore Date
            </label>
            <input
              type="date"
              value={specificDate}
              onChange={(e) => setSpecificDate(e.target.value)}
              className="w-full h-11 px-3 rounded-xl bg-stone-50 border border-stone-200 font-semibold text-sm"
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="px-4 h-11 rounded-2xl bg-rose-50 text-rose-600 font-bold text-sm flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 h-11 rounded-2xl bg-stone-100 font-bold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 h-11 rounded-2xl bg-sky-600 text-white font-bold shadow-sm"
            >
              Save Chore
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
