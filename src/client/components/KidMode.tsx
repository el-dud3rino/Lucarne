import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Star, X } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { toDateStr } from '../lib/dates.js';
import { useToday, useNow } from './TodayBar.js';
import { HabitCard, RoutineCard, sortRoutinesForNow, useHabitLog, useStepToggle } from './Routines.js';
import { useRewards } from './Rewards.js';
import { daysLeftLabel } from './Countdowns.js';
import type { FamilyMember, TodaySummary } from '../../shared/types.js';

/**
 * Kid mode: one child's day on the whole screen with big icons — what's happening today, their
 * routine for right now, chores and habits. Made for kids who can't read yet (emoji everywhere).
 */
export const KidModeOverlay: React.FC<{ member: FamilyMember; onExit: () => void }> = ({ member, onExit }) => {
  const queryClient = useQueryClient();
  const dateStr = toDateStr(new Date());
  const { data } = useToday(member.id);
  const { data: rewards } = useRewards();
  const toggleStep = useStepToggle(dateStr);
  const logHabit = useHabitLog(dateStr);
  useNow(60_000);
  const balance = rewards?.balances.find((b) => b.memberId === member.id)?.balance ?? 0;

  const toggleChore = useMutation({
    mutationFn: (choreId: string) =>
      apiFetch(`/api/chores/${choreId}/toggle`, { method: 'POST', body: JSON.stringify({ dateStr, completedByMemberId: member.id }) }),
    onMutate: (choreId) => {
      queryClient.setQueriesData<TodaySummary>({ queryKey: ['today', dateStr, member.id] }, (prev) =>
        prev ? { ...prev, chores: prev.chores.map((c) => (c.id === choreId ? { ...c, done: !c.done } : c)) } : prev
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['today'] });
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      queryClient.invalidateQueries({ queryKey: ['rewards'] });
    },
  });

  const now = Date.now();
  const events = (data?.events ?? []).filter((e) => e.allDay || Date.parse(e.endIso) >= now);
  const routines = sortRoutinesForNow(data?.routines ?? []);
  const chores = data?.chores ?? [];
  const choresLeft = chores.filter((c) => !c.done).length;

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto" style={{ backgroundColor: member.colorBg }} data-testid="kid-mode">
      <div className="max-w-[1800px] mx-auto p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-4">
          <span style={{ backgroundColor: member.colorAccent }} className="w-20 h-20 rounded-full text-5xl flex items-center justify-center shadow-md shrink-0">
            {member.emoji}
          </span>
          <div className="flex-1 min-w-0" style={{ color: member.colorText }}>
            <div className="text-3xl md:text-5xl font-black truncate">Hi {member.name}!</div>
            <div className="text-lg md:text-2xl font-bold opacity-80">
              {new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <div className="h-16 px-5 rounded-3xl bg-white/85 flex items-center gap-2 text-3xl font-black text-amber-600 shadow-sm shrink-0">
            <Star className="w-8 h-8 fill-amber-400 text-amber-500" /> {balance}
          </div>
          <button
            type="button"
            onClick={onExit}
            aria-label="Exit kid mode"
            className="w-16 h-16 rounded-3xl bg-white/85 hover:bg-white flex items-center justify-center text-slate-600 shadow-sm shrink-0"
          >
            <X className="w-8 h-8" />
          </button>
        </div>

        {/* Countdowns */}
        {(data?.countdowns ?? []).filter((c) => !c.memberId || c.memberId === member.id).length > 0 && (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {(data?.countdowns ?? [])
              .filter((c) => !c.memberId || c.memberId === member.id)
              .map((c) => (
                <div key={c.id} className="shrink-0 rounded-3xl bg-white/85 px-5 py-3 flex items-center gap-3 shadow-2xs">
                  <span className="text-4xl">{c.emoji}</span>
                  <div>
                    <div className="text-lg font-extrabold text-slate-800">{c.title}</div>
                    <div className="text-2xl font-black text-amber-600">{daysLeftLabel(c.daysLeft)}</div>
                  </div>
                </div>
              ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Today */}
          <section className="rounded-3xl bg-white/90 p-4 space-y-3 shadow-2xs">
            <h3 className="text-2xl font-black text-slate-800">📅 Today</h3>
            {events.map((e) => (
              <div key={e.id} className="rounded-2xl border-l-8 bg-stone-50 px-4 py-3" style={{ borderLeftColor: member.colorAccent }}>
                <div className="text-sm font-extrabold text-stone-500">
                  {e.allDay ? 'All day' : new Date(e.startIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
                <div className="text-xl font-extrabold text-slate-800">{e.title}</div>
                {e.location && <div className="text-sm text-stone-500">📍 {e.location}</div>}
              </div>
            ))}
            {events.length === 0 && <div className="text-lg text-stone-400 font-bold py-6 text-center">Nothing else today 🎈</div>}
            {data?.dinner && (
              <div className="rounded-2xl bg-amber-50 px-4 py-3 text-amber-950">
                <div className="text-sm font-extrabold text-amber-700">🍽️ Dinner</div>
                <div className="text-xl font-extrabold">{data.dinner.title}</div>
              </div>
            )}
          </section>

          {/* Routines */}
          <section className="space-y-3 lg:col-span-2">
            {routines.map((r) => (
              <RoutineCard key={r.id} routine={r} accent={member.colorAccent} onToggle={(id) => toggleStep.mutate(id)} big />
            ))}

            {chores.length > 0 && (
              <div className="rounded-3xl bg-white/90 p-4 space-y-3 shadow-2xs">
                <h3 className="text-2xl font-black text-slate-800">
                  ✨ Jobs {choresLeft === 0 ? '— all done! 🎉' : `— ${choresLeft} to go`}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                  {chores.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChore.mutate(c.id)}
                      className={`min-h-[120px] rounded-2xl border-2 p-3 flex flex-col items-center justify-center gap-1.5 transition active:scale-95 ${
                        c.done ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-stone-200'
                      }`}
                    >
                      <span className="text-5xl relative">
                        {c.emoji}
                        {c.done && (
                          <span className="absolute -right-3 -bottom-1 w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center">
                            <Check className="w-5 h-5 stroke-[3]" />
                          </span>
                        )}
                      </span>
                      <span className={`text-base font-extrabold text-center leading-tight ${c.done ? 'line-through text-stone-400' : 'text-slate-800'}`}>{c.title}</span>
                      <span className="text-sm font-bold text-amber-600">{'⭐'.repeat(Math.min(c.stars, 5))}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {(data?.habits ?? []).length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(data?.habits ?? []).map((h) => (
                  <HabitCard key={h.id} habit={h} accent={member.colorAccent} onLog={(delta) => logHabit.mutate({ id: h.id, delta })} big />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
