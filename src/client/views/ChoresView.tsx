import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Award,
  Check,
  ChevronLeft,
  ChevronRight,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { addDays, toDateStr } from '../lib/dates.js';
import { choreAppliesToDate } from '../../shared/chores.js';

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
}

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

  const handleTapChore = (chore: Chore) => {
    const existing = completionByChore.get(chore.id);
    if (existing) {
      toggleMutation.mutate({ choreId: chore.id });
      return;
    }
    if (!chore.assignedMemberId) {
      setClaimingChore(chore);
      return;
    }
    toggleMutation.mutate({
      choreId: chore.id,
      completedByMemberId: chore.assignedMemberId,
    });
  };

  const renderChoreCard = (chore: Chore, accentColor: string) => {
    const comp = completionByChore.get(chore.id);
    const done = Boolean(comp);
    const completedMember = comp
      ? individualMembers.find((m) => m.id === comp.completedByMemberId)
      : undefined;

    return (
      <div
        key={chore.id}
        onClick={() => handleTapChore(chore)}
        className={`group rounded-2xl border p-3.5 flex items-center gap-3 cursor-pointer transition select-none active:scale-[0.98] ${
          done
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
              done ? 'line-through text-stone-400' : 'text-slate-800'
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
            {completedMember && !chore.assignedMemberId && (
              <span className="px-1.5 py-0.5 rounded-md bg-stone-200/70 text-slate-700 font-bold text-[11px]">
                Done by {completedMember.name}
              </span>
            )}
          </div>
        </div>

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

  const sharedChores = useMemo(
    () =>
      chores
        .filter((c) => !c.assignedMemberId)
        .sort(
          (a, b) =>
            (TIME_OF_DAY_ORDER[a.timeOfDay] ?? 3) - (TIME_OF_DAY_ORDER[b.timeOfDay] ?? 3) ||
            a.sortOrder - b.sortOrder
        ),
    [chores]
  );

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveDate((d) => addDays(d, -1))}
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
            onClick={() => setActiveDate((d) => addDays(d, 1))}
            className="w-11 h-11 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
          <h2 className="ml-2 text-xl md:text-2xl font-extrabold text-slate-800">
            {activeDate.toLocaleDateString([], {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </h2>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowStarsDrawer(true)}
            className="h-11 px-4 rounded-2xl bg-amber-100/90 hover:bg-amber-200/80 border border-amber-300/80 text-amber-950 font-bold text-sm flex items-center gap-2 active:scale-95"
          >
            <Award className="w-5 h-5 text-amber-600" />
            <span>Star Tracker</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setEditingChore({
                title: '',
                emoji: '✨',
                assignedMemberId: visibleMembers[0]?.id ?? null,
                timeOfDay: 'morning',
                frequency: 'daily',
                daysOfWeek: [],
                stars: 1,
              })
            }
            className="h-11 px-4 rounded-2xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-sm flex items-center gap-2 shadow-sm active:scale-95"
          >
            <Plus className="w-5 h-5" />
            <span>New Chore</span>
          </button>
        </div>
      </div>

      {/* Person Columns + Shared Household Column */}
      <div
        className="flex-1 min-h-0 grid gap-3.5 overflow-x-auto pb-1"
        style={{
          gridTemplateColumns: `repeat(${visibleMembers.length + 1}, minmax(265px, 1fr))`,
        }}
      >
        {visibleMembers.map((member) => {
          const mChores = chores
            .filter((c) => c.assignedMemberId === member.id)
            .sort(
              (a, b) =>
                (TIME_OF_DAY_ORDER[a.timeOfDay] ?? 3) - (TIME_OF_DAY_ORDER[b.timeOfDay] ?? 3) ||
                a.sortOrder - b.sortOrder
            );
          const doneCount = mChores.filter((c) => completionByChore.has(c.id)).length;
          const mStat = stats.find((s) => s.memberId === member.id);
          const pct = mChores.length > 0 ? Math.round((doneCount / mChores.length) * 100) : 100;

          return (
            <div
              key={member.id}
              className="flex flex-col h-full rounded-2xl bg-white border border-stone-200/90 shadow-2xs overflow-hidden"
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
                        {doneCount}/{mChores.length} done · ⭐ {mStat?.weekStars ?? 0} this wk
                      </div>
                    </div>
                  </div>
                  <span className="text-sm font-extrabold">{pct}%</span>
                </div>
                <div className="mt-2.5 h-2 rounded-full bg-white/70 overflow-hidden">
                  <div
                    style={{ width: `${pct}%`, backgroundColor: member.colorAccent }}
                    className="h-full rounded-full transition-all duration-300"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {mChores.map((c) => renderChoreCard(c, member.colorAccent))}
                {mChores.length === 0 && (
                  <div className="h-28 flex items-center justify-center text-sm text-stone-300 font-medium">
                    All clear!
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Shared / Up-for-Grabs Household Column */}
        <div className="flex flex-col h-full rounded-2xl bg-white border border-stone-200/90 shadow-2xs overflow-hidden">
          <div className="px-4 py-3.5 bg-purple-50 text-purple-950 border-b border-purple-100">
            <div className="flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-full bg-purple-600 text-white text-lg flex items-center justify-center shadow-2xs">
                <Sparkles className="w-5 h-5" />
              </span>
              <div>
                <div className="font-extrabold text-lg leading-tight">Shared / Anyone</div>
                <div className="text-xs font-bold opacity-75">
                  Tap to claim stars when completed
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {sharedChores.map((c) => renderChoreCard(c, '#9333EA'))}
            {sharedChores.length === 0 && (
              <div className="h-28 flex items-center justify-center text-sm text-stone-300 font-medium">
                No shared chores
              </div>
            )}
          </div>
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
              {individualMembers.map((m) => (
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

      {/* Internal Star & Household Contribution Ledger Modal (Kids + Parents) */}
      {showStarsDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-2xl w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
                  <Award className="w-6 h-6 text-amber-500" />
                  Household Star Tracker · Star Ledger & Rewards
                </h3>
                <p className="text-sm text-stone-500">
                  Internal tally across kids & parents to pair with your physical star chart.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStarsDrawer(false)}
                className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 hover:bg-stone-200 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Visual Reward Goal Milestones */}
            <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-amber-800 flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-amber-600" />
                  Family Reward Milestones
                </span>
                <span className="text-xs font-bold text-amber-700">
                  Total Stars: {stats.reduce((acc, s) => acc + (s.allTimeStars || 0), 0)} ⭐
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { stars: 10, label: 'Bronze', reward: 'Extra Screen Time', emoji: '🥉' },
                  { stars: 25, label: 'Silver', reward: 'Ice Cream Treat', emoji: '🥈' },
                  { stars: 50, label: 'Gold', reward: 'Choose Family Movie', emoji: '🥇' },
                  { stars: 100, label: 'Champion', reward: 'Family Pizza Night', emoji: '🍕' },
                ].map((milestone) => {
                  const familyTotal = stats.reduce((acc, s) => acc + (s.allTimeStars || 0), 0);
                  const reached = familyTotal >= milestone.stars;
                  return (
                    <div
                      key={milestone.stars}
                      className={`rounded-xl p-2.5 text-center border transition ${
                        reached
                          ? 'bg-white border-amber-400 shadow-2xs ring-1 ring-amber-300'
                          : 'bg-white/60 border-stone-200 opacity-60'
                      }`}
                    >
                      <div className="text-lg">{milestone.emoji}</div>
                      <div className="font-extrabold text-xs text-slate-800">{milestone.stars} ⭐</div>
                      <div className="text-[10px] font-bold text-amber-800 truncate" title={milestone.reward}>
                        {milestone.reward}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {individualMembers.map((m) => {
                const st = stats.find((s) => s.memberId === m.id);
                return (
                  <div
                    key={m.id}
                    style={{ backgroundColor: m.colorBg, color: m.colorText }}
                    className="rounded-2xl p-4 border border-black/5 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{m.emoji}</span>
                        <div>
                          <div className="font-extrabold text-lg">{m.name}</div>
                          <div className="text-xs uppercase font-bold opacity-70">{m.role}</div>
                        </div>
                      </div>
                      <div className="px-3 py-1 rounded-full bg-white/80 font-extrabold text-sm text-amber-700 flex items-center gap-1">
                        <Star className="w-4 h-4 fill-amber-400 text-amber-500" />
                        {st?.allTimeStars ?? 0} total
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center bg-white/75 rounded-xl p-2.5 text-slate-800">
                      <div>
                        <div className="text-lg font-extrabold">{st?.todayStars ?? 0} ⭐</div>
                        <div className="text-[11px] font-bold text-stone-500">Today</div>
                      </div>
                      <div>
                        <div className="text-lg font-extrabold">{st?.weekStars ?? 0} ⭐</div>
                        <div className="text-[11px] font-bold text-stone-500">This Week</div>
                      </div>
                      <div>
                        <div className="text-lg font-extrabold">{st?.monthStars ?? 0} ⭐</div>
                        <div className="text-[11px] font-bold text-stone-500">This Month</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

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
  const [timeOfDay, setTimeOfDay] = useState<ChoreTimeOfDay>(draft.timeOfDay || 'morning');
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
