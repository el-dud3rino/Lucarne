import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { EmojiPickerButton } from './EmojiPicker.js';
import { NoticeBanner } from './NoticeBanner.js';
import { MemberChips, Sheet, fieldLabel, inputClass, primaryBtn, secondaryBtn } from './Sheet.js';
import type { ChoreTimeOfDay, FamilyMember, Habit, Routine } from '../../shared/types.js';

const TIME_LABEL: Record<ChoreTimeOfDay, string> = {
  morning: '🌅 Morning',
  afternoon: '☀️ After school',
  evening: '🌙 Bedtime',
  anytime: '✨ Anytime',
};
const TIME_ORDER: ChoreTimeOfDay[] = ['morning', 'afternoon', 'evening', 'anytime'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Which part of the day it is now (routines for "now" are shown first). */
export function currentTimeOfDay(d = new Date()): ChoreTimeOfDay {
  const h = d.getHours();
  if (h < 11) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export function appliesToday(r: Routine, dateStr: string): boolean {
  return r.daysOfWeek.length === 0 || r.daysOfWeek.includes(new Date(`${dateStr}T12:00:00`).getDay());
}

export function sortRoutinesForNow(list: Routine[], now = new Date()): Routine[] {
  const cur = TIME_ORDER.indexOf(currentTimeOfDay(now));
  return [...list].sort((a, b) => {
    const da = (TIME_ORDER.indexOf(a.timeOfDay) - cur + 4) % 4;
    const db = (TIME_ORDER.indexOf(b.timeOfDay) - cur + 4) % 4;
    return da - db || a.sortOrder - b.sortOrder;
  });
}

export function useRoutines(dateStr: string) {
  return useQuery({ queryKey: ['routines', dateStr], queryFn: () => apiFetch<Routine[]>(`/api/routines?date=${dateStr}`) });
}
export function useHabits(dateStr: string) {
  return useQuery({ queryKey: ['habits', dateStr], queryFn: () => apiFetch<Habit[]>(`/api/routines/habits?date=${dateStr}`) });
}

/** Optimistic step toggle shared by the board and kid mode. */
export function useStepToggle(dateStr: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stepId: string) => apiFetch(`/api/routines/steps/${stepId}/toggle`, { method: 'POST', body: JSON.stringify({ dateStr }) }),
    onMutate: async (stepId) => {
      const flip = (list?: Routine[]) =>
        list?.map((r) => ({ ...r, steps: r.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)) }));
      queryClient.setQueriesData<Routine[]>({ queryKey: ['routines', dateStr] }, flip);
      queryClient.setQueriesData<{ routines: Routine[] }>({ queryKey: ['today'] }, (prev) =>
        prev && Array.isArray(prev.routines) ? { ...prev, routines: flip(prev.routines)! } : prev
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['routines'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
      queryClient.invalidateQueries({ queryKey: ['rewards'] });
    },
  });
}

export function useHabitLog(dateStr: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; delta: number }) =>
      apiFetch(`/api/routines/habits/${v.id}/log`, { method: 'POST', body: JSON.stringify({ dateStr, delta: v.delta }) }),
    onMutate: async (v) => {
      const bump = (list?: Habit[]) => list?.map((h) => (h.id === v.id ? { ...h, today: Math.max(0, h.today + v.delta) } : h));
      queryClient.setQueriesData<Habit[]>({ queryKey: ['habits', dateStr] }, bump);
      queryClient.setQueriesData<{ habits: Habit[] }>({ queryKey: ['today'] }, (prev) =>
        prev && Array.isArray(prev.habits) ? { ...prev, habits: bump(prev.habits)! } : prev
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });
}

/** One routine as a checklist of big tappable steps. */
export const RoutineCard: React.FC<{
  routine: Routine;
  accent: string;
  onToggle: (stepId: string) => void;
  onEdit?: () => void;
  big?: boolean;
}> = ({ routine, accent, onToggle, onEdit, big }) => {
  const done = routine.steps.filter((s) => s.done).length;
  const total = routine.steps.length;
  const complete = total > 0 && done === total;
  return (
    <div className={`rounded-2xl border bg-white overflow-hidden ${complete ? 'border-emerald-300' : 'border-stone-200'}`}>
      <div className="px-3.5 py-2.5 flex items-center gap-2.5 border-b border-stone-100">
        <span className={big ? 'text-3xl' : 'text-xl'}>{routine.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className={`font-extrabold text-slate-800 truncate ${big ? 'text-xl' : ''}`}>{routine.title}</div>
          <div className="text-[11px] font-bold text-stone-400">
            {TIME_LABEL[routine.timeOfDay]} · {done}/{total}
            {routine.stars > 0 ? ` · +${routine.stars}⭐ when done` : ''}
          </div>
        </div>
        {complete && <span className="text-xs font-extrabold text-emerald-600">All done! 🎉</span>}
        {onEdit && (
          <button
            type="button"
            aria-label={`Edit ${routine.title}`}
            onClick={onEdit}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl text-stone-400 hover:bg-stone-100 flex items-center justify-center"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className={`p-2.5 grid gap-2 ${big ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
        {routine.steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            className={`w-full rounded-xl border-2 flex items-center gap-3 text-left transition active:scale-[0.97] ${
              big ? 'min-h-[84px] px-4' : 'min-h-[48px] px-3'
            } ${s.done ? 'bg-stone-50 border-transparent' : 'bg-white border-stone-200'}`}
            style={s.done ? { backgroundColor: `${accent}1A` } : undefined}
          >
            <span
              className={`rounded-full flex items-center justify-center shrink-0 font-black text-white ${big ? 'w-12 h-12 text-2xl' : 'w-8 h-8 text-base'}`}
              style={{ backgroundColor: s.done ? accent : '#E7E5E4' }}
            >
              {s.done ? <Check className={big ? 'w-7 h-7 stroke-[3]' : 'w-5 h-5 stroke-[3]'} /> : <span className="text-stone-500">{i + 1}</span>}
            </span>
            <span className={big ? 'text-3xl' : 'text-lg'}>{s.emoji}</span>
            <span className={`font-bold ${big ? 'text-xl' : 'text-sm'} ${s.done ? 'line-through text-stone-400' : 'text-slate-800'}`}>{s.title}</span>
          </button>
        ))}
        {total === 0 && <div className="text-sm text-stone-400 p-2">No steps yet</div>}
      </div>
    </div>
  );
};

/** A habit with -/+ buttons, today's progress, the last 7 days and the streak. */
export const HabitCard: React.FC<{ habit: Habit; accent: string; onLog: (delta: number) => void; onEdit?: () => void; big?: boolean }> = ({
  habit,
  accent,
  onLog,
  onEdit,
  big,
}) => {
  const met = habit.today >= habit.targetPerDay;
  // Big goals (e.g. 30 min) count in fives so it's not 30 taps.
  const step = habit.targetPerDay >= 10 ? 5 : 1;
  const pct = Math.min(100, Math.round((habit.today / habit.targetPerDay) * 100));
  return (
    <div className={`rounded-2xl border bg-white p-3 space-y-2 ${met ? 'border-emerald-300' : 'border-stone-200'}`}>
      <div className="flex items-center gap-2.5">
        <span className={big ? 'text-4xl' : 'text-2xl'}>{habit.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className={`font-extrabold text-slate-800 truncate ${big ? 'text-xl' : ''}`}>{habit.title}</div>
          <div className="text-xs font-bold text-stone-500">
            {habit.today}/{habit.targetPerDay} {habit.unit}
            {habit.streak > 1 ? ` · 🔥 ${habit.streak}-day streak` : ''}
          </div>
        </div>
        {onEdit && (
          <button
            type="button"
            aria-label={`Edit ${habit.title}`}
            onClick={onEdit}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl text-stone-400 hover:bg-stone-100 flex items-center justify-center"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          aria-label={`Remove ${step} ${habit.title}`}
          disabled={habit.today === 0}
          onClick={() => onLog(-Math.min(step, habit.today))}
          className="w-11 h-11 min-w-[44px] rounded-xl bg-stone-100 text-stone-600 disabled:opacity-40 flex items-center justify-center active:scale-95"
        >
          <Minus className="w-5 h-5" />
        </button>
        <button
          type="button"
          aria-label={`Add ${step} ${habit.title}`}
          onClick={() => onLog(step)}
          style={{ backgroundColor: accent }}
          className={`${big ? 'w-16 h-16' : 'w-11 h-11'} min-w-[44px] rounded-xl text-white flex items-center justify-center active:scale-95 shadow-sm`}
        >
          {step > 1 ? <span className={`font-black ${big ? 'text-2xl' : 'text-sm'}`}>+{step}</span> : <Plus className={big ? 'w-8 h-8' : 'w-5 h-5'} />}
        </button>
      </div>
      <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: met ? '#10B981' : accent }} />
      </div>
      <div className="flex items-center gap-1" aria-label="Last 7 days">
        {habit.week.map((n, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (6 - i));
          const ok = n >= habit.targetPerDay;
          return (
            <span
              key={i}
              title={`${d.toLocaleDateString([], { weekday: 'short' })}: ${n}`}
              className={`flex-1 h-6 rounded-md text-[10px] font-bold flex items-center justify-center ${ok ? 'text-white' : n > 0 ? 'text-slate-600' : 'text-stone-300'}`}
              style={{ backgroundColor: ok ? '#10B981' : n > 0 ? `${accent}33` : '#F5F5F4' }}
            >
              {DAY_LETTERS[d.getDay()]}
            </span>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------- editors

interface RoutineDraft {
  id?: string;
  title: string;
  emoji: string;
  memberId: string;
  timeOfDay: ChoreTimeOfDay;
  daysOfWeek: number[];
  stars: number;
  steps: Array<{ id?: string; title: string; emoji: string }>;
}

const TEMPLATES: Record<string, Array<[string, string]>> = {
  '🌅 Morning': [
    ['🛏️', 'Make bed'],
    ['👕', 'Get dressed'],
    ['🥣', 'Eat breakfast'],
    ['🪥', 'Brush teeth'],
    ['🎒', 'Pack backpack'],
    ['👟', 'Shoes on'],
  ],
  '🌙 Bedtime': [
    ['🧸', 'Tidy toys'],
    ['🛁', 'Bath or shower'],
    ['👕', 'Pajamas on'],
    ['🪥', 'Brush teeth'],
    ['📚', 'Read a story'],
    ['💡', 'Lights out'],
  ],
  '🎒 After school': [
    ['🎒', 'Unpack backpack'],
    ['🍎', 'Snack'],
    ['📝', 'Homework'],
    ['🎹', 'Practice'],
  ],
};

export const RoutineEditor: React.FC<{ members: FamilyMember[]; draft: RoutineDraft; onClose: () => void }> = ({ members, draft: initial, onClose }) => {
  const queryClient = useQueryClient();
  const [d, setD] = useState<RoutineDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => apiFetch(d.id ? `/api/routines/${d.id}` : '/api/routines', { method: d.id ? 'PUT' : 'POST', body: JSON.stringify(d) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routines'] });
      queryClient.invalidateQueries({ queryKey: ['today'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/routines/${d.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['routines'] });
      onClose();
    },
  });
  const setStep = (i: number, patch: Partial<RoutineDraft['steps'][number]>) =>
    setD({ ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.steps.length) return;
    const steps = [...d.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setD({ ...d, steps });
  };

  return (
    <Sheet title={d.id ? 'Edit routine' : 'New routine'} subtitle="A checklist of steps, in order — great for mornings and bedtime." onClose={onClose} maxWidth="max-w-2xl">
      {error && <NoticeBanner tone="error" text={error} onDismiss={() => setError(null)} />}
      <div className="flex gap-2">
        <EmojiPickerButton value={d.emoji} onChange={(emoji) => setD({ ...d, emoji })} label="Routine emoji" />
        <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. School morning" aria-label="Routine name" className={inputClass} />
      </div>
      <div>
        <label className={fieldLabel}>For</label>
        <MemberChips members={members} value={[d.memberId]} onChange={(ids) => ids[0] && setD({ ...d, memberId: ids[0] })} single />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>When</label>
          <div className="flex flex-wrap gap-2">
            {TIME_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setD({ ...d, timeOfDay: t })}
                className={`h-10 min-h-[40px] px-3 rounded-xl text-xs font-bold border ${d.timeOfDay === t ? 'bg-sky-600 text-white border-sky-600' : 'bg-stone-50 border-stone-200 text-slate-700'}`}
              >
                {TIME_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={fieldLabel}>Days (none = every day)</label>
          <div className="flex gap-1">
            {DAY_LETTERS.map((l, i) => {
              const on = d.daysOfWeek.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  aria-label={['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]}
                  onClick={() => setD({ ...d, daysOfWeek: on ? d.daysOfWeek.filter((x) => x !== i) : [...d.daysOfWeek, i] })}
                  className={`w-10 h-10 min-w-[40px] rounded-xl text-sm font-bold border ${on ? 'bg-sky-600 text-white border-sky-600' : 'bg-stone-50 border-stone-200 text-slate-600'}`}
                >
                  {l}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div>
        <label className={fieldLabel}>Bonus stars for finishing every step</label>
        <div className="flex gap-2">
          {[0, 1, 2, 3, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setD({ ...d, stars: n })}
              className={`h-10 min-h-[40px] min-w-[48px] px-3 rounded-xl text-sm font-bold border ${d.stars === n ? 'bg-amber-500 text-white border-amber-500' : 'bg-stone-50 border-stone-200 text-slate-700'}`}
            >
              {n === 0 ? 'None' : `${n} ⭐`}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className={fieldLabel}>Steps</label>
          {d.steps.length === 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {Object.entries(TEMPLATES).map(([name, steps]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setD({ ...d, steps: steps.map(([emoji, title]) => ({ emoji, title })) })}
                  className="h-10 min-h-[40px] px-3 rounded-xl bg-violet-50 text-violet-700 text-xs font-bold"
                >
                  Use {name}
                </button>
              ))}
            </div>
          )}
        </div>
        {d.steps.map((s, i) => (
          <div key={s.id ?? `new-${i}`} className="flex items-center gap-1.5">
            <EmojiPickerButton value={s.emoji} onChange={(emoji) => setStep(i, { emoji })} label={`Emoji for step ${i + 1}`} />
            <input value={s.title} onChange={(e) => setStep(i, { title: e.target.value })} aria-label={`Step ${i + 1}`} className={`${inputClass} h-11`} />
            <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="w-10 h-10 min-w-[40px] rounded-xl bg-stone-100 flex items-center justify-center">
              <ArrowUp className="w-4 h-4" />
            </button>
            <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="w-10 h-10 min-w-[40px] rounded-xl bg-stone-100 flex items-center justify-center">
              <ArrowDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Remove step"
              onClick={() => setD({ ...d, steps: d.steps.filter((_, j) => j !== i) })}
              className="w-10 h-10 min-w-[40px] rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setD({ ...d, steps: [...d.steps, { title: '', emoji: '✅' }] })}
          className="h-10 min-h-[40px] px-3.5 rounded-xl bg-stone-100 text-sm font-bold text-slate-700 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Add step
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2">
        {d.id ? (
          <button type="button" onClick={() => remove.mutate()} className="h-12 px-4 rounded-2xl bg-rose-50 text-rose-600 font-bold text-sm flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => save.mutate()} disabled={!d.title.trim() || save.isPending} className={primaryBtn}>
            Save
          </button>
        </div>
      </div>
    </Sheet>
  );
};

interface HabitDraft {
  id?: string;
  title: string;
  emoji: string;
  memberId: string;
  targetPerDay: number;
  unit: string;
}

const HABIT_IDEAS: Array<[string, string, number, string]> = [
  ['💧', 'Drink water', 6, 'glasses'],
  ['📚', 'Read', 20, 'min'],
  ['🎹', 'Practice piano', 1, ''],
  ['🏃', 'Move', 30, 'min'],
  ['🦷', 'Floss', 1, ''],
];

export const HabitEditor: React.FC<{ members: FamilyMember[]; draft: HabitDraft; onClose: () => void }> = ({ members, draft: initial, onClose }) => {
  const queryClient = useQueryClient();
  const [d, setD] = useState<HabitDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      apiFetch(d.id ? `/api/routines/habits/${d.id}` : '/api/routines/habits', { method: d.id ? 'PUT' : 'POST', body: JSON.stringify(d) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/routines/habits/${d.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['habits'] });
      onClose();
    },
  });
  return (
    <Sheet title={d.id ? 'Edit habit' : 'New habit'} subtitle="Something to do a little of every day. Tap + each time." onClose={onClose}>
      {error && <NoticeBanner tone="error" text={error} onDismiss={() => setError(null)} />}
      {!d.id && (
        <div className="flex flex-wrap gap-1.5">
          {HABIT_IDEAS.map(([emoji, title, target, unit]) => (
            <button
              key={title}
              type="button"
              onClick={() => setD({ ...d, emoji, title, targetPerDay: target, unit })}
              className="h-10 min-h-[40px] px-3 rounded-xl bg-violet-50 text-violet-700 text-xs font-bold"
            >
              {emoji} {title}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <EmojiPickerButton value={d.emoji} onChange={(emoji) => setD({ ...d, emoji })} label="Habit emoji" />
        <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Read" aria-label="Habit name" className={inputClass} />
      </div>
      <div>
        <label className={fieldLabel}>For</label>
        <MemberChips members={members} value={[d.memberId]} onChange={(ids) => ids[0] && setD({ ...d, memberId: ids[0] })} single />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={fieldLabel}>Daily goal</label>
          <input
            type="number"
            min={1}
            max={100}
            value={d.targetPerDay}
            onChange={(e) => setD({ ...d, targetPerDay: Number(e.target.value) })}
            aria-label="Daily goal"
            className={inputClass}
          />
        </div>
        <div>
          <label className={fieldLabel}>Unit (optional)</label>
          <input value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} placeholder="glasses, min…" aria-label="Unit" className={inputClass} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-2">
        {d.id ? (
          <button type="button" onClick={() => remove.mutate()} className="h-12 px-4 rounded-2xl bg-rose-50 text-rose-600 font-bold text-sm flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>
            Cancel
          </button>
          <button type="button" onClick={() => save.mutate()} disabled={!d.title.trim() || save.isPending} className={primaryBtn}>
            Save
          </button>
        </div>
      </div>
    </Sheet>
  );
};

/** Routines + habits board: one column per person (used by the Chores tab). */
export const RoutinesBoard: React.FC<{
  mode: 'routines' | 'habits';
  members: FamilyMember[];
  allMembers: FamilyMember[];
  dateStr: string;
}> = ({ mode, members, allMembers, dateStr }) => {
  const { data: routines = [] } = useRoutines(dateStr);
  const { data: habits = [] } = useHabits(dateStr);
  const toggle = useStepToggle(dateStr);
  const log = useHabitLog(dateStr);
  const [routineDraft, setRoutineDraft] = useState<RoutineDraft | null>(null);
  const [habitDraft, setHabitDraft] = useState<HabitDraft | null>(null);
  const people = allMembers.filter((m) => m.role !== 'family');

  return (
    <>
      <div className="flex-1 min-h-0 grid gap-3.5 overflow-x-auto pb-1" style={{ gridTemplateColumns: `repeat(${Math.max(members.length, 1)}, minmax(265px, 1fr))` }}>
        {members.map((m) => {
          const mine =
            mode === 'routines'
              ? sortRoutinesForNow(routines.filter((r) => r.memberId === m.id && appliesToday(r, dateStr)))
              : habits.filter((h) => h.memberId === m.id);
          return (
            <div key={m.id} className="flex flex-col h-full rounded-2xl bg-white border border-stone-200/90 shadow-2xs overflow-hidden">
              <div style={{ backgroundColor: m.colorBg, color: m.colorText }} className="px-4 py-3 border-b border-stone-100 flex items-center gap-2.5">
                <span style={{ backgroundColor: m.colorAccent }} className="w-10 h-10 rounded-full text-white text-lg flex items-center justify-center">
                  {m.emoji}
                </span>
                <span className="font-extrabold text-lg flex-1 truncate">{m.name}</span>
                <button
                  type="button"
                  aria-label={mode === 'routines' ? `New routine for ${m.name}` : `New habit for ${m.name}`}
                  onClick={() =>
                    mode === 'routines'
                      ? setRoutineDraft({ title: '', emoji: '🌅', memberId: m.id, timeOfDay: 'morning', daysOfWeek: [], stars: 0, steps: [] })
                      : setHabitDraft({ title: '', emoji: '💧', memberId: m.id, targetPerDay: 1, unit: '' })
                  }
                  className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-white/70 hover:bg-white flex items-center justify-center"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                {mode === 'routines'
                  ? (mine as Routine[]).map((r) => (
                      <RoutineCard
                        key={r.id}
                        routine={r}
                        accent={m.colorAccent}
                        onToggle={(id) => toggle.mutate(id)}
                        onEdit={() => setRoutineDraft({ ...r, steps: r.steps.map((s) => ({ id: s.id, title: s.title, emoji: s.emoji })) })}
                      />
                    ))
                  : (mine as Habit[]).map((h) => (
                      <HabitCard key={h.id} habit={h} accent={m.colorAccent} onLog={(delta) => log.mutate({ id: h.id, delta })} onEdit={() => setHabitDraft(h)} />
                    ))}
                {mine.length === 0 && (
                  <div className="h-28 flex items-center justify-center text-sm text-stone-300 font-medium text-center px-4">
                    {mode === 'routines' ? 'No routine today — tap + to make one' : 'No habits yet — tap + to add one'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {routineDraft && <RoutineEditor members={people} draft={routineDraft} onClose={() => setRoutineDraft(null)} />}
      {habitDraft && <HabitEditor members={people} draft={habitDraft} onClose={() => setHabitDraft(null)} />}
    </>
  );
};
