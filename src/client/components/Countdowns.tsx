import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass, Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { toDateStr } from '../lib/dates.js';
import { EmojiPickerButton } from './EmojiPicker.js';
import { NoticeBanner } from './NoticeBanner.js';
import { MemberChips, Sheet, fieldLabel, inputClass, primaryBtn, secondaryBtn } from './Sheet.js';
import type { Countdown, FamilyMember } from '../../shared/types.js';

export function useCountdowns() {
  return useQuery({
    queryKey: ['countdowns', toDateStr(new Date())],
    queryFn: () => apiFetch<Countdown[]>(`/api/countdowns?today=${toDateStr(new Date())}`),
    staleTime: 60_000,
  });
}

export function daysLeftLabel(days: number): string {
  if (days <= 0) return 'Today!';
  if (days === 1) return 'Tomorrow';
  return `${days} days`;
}

/** Row of "🏖️ Beach trip · 12 days" chips above the calendar. Tapping opens the manager. */
export const CountdownStrip: React.FC<{ members: FamilyMember[]; onOpen: () => void }> = ({ members, onOpen }) => {
  const { data: countdowns = [] } = useCountdowns();
  if (countdowns.length === 0) return null;
  const byId = new Map(members.map((m) => [m.id, m]));
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mt-0.5" data-testid="countdown-strip">
      {countdowns.slice(0, 6).map((c) => {
        const m = c.memberId ? byId.get(c.memberId) : undefined;
        return (
          <button
            key={c.id}
            type="button"
            onClick={onOpen}
            style={m ? { backgroundColor: m.colorBg, color: m.colorText } : undefined}
            className={`h-10 min-h-[40px] shrink-0 px-3.5 rounded-2xl border flex items-center gap-2 text-sm font-bold active:scale-95 transition ${
              m ? 'border-black/5' : 'bg-white border-stone-200 text-slate-700'
            } ${c.daysLeft <= 0 ? 'ring-2 ring-amber-400' : ''}`}
          >
            <span className="text-base">{c.emoji}</span>
            <span className="truncate max-w-[180px]">{c.title}</span>
            <span className="px-2 py-0.5 rounded-lg bg-white/80 text-xs font-extrabold text-amber-700">{daysLeftLabel(c.daysLeft)}</span>
          </button>
        );
      })}
    </div>
  );
};

interface Draft {
  id?: string;
  title: string;
  emoji: string;
  dateStr: string;
  memberId: string | null;
}

export const CountdownsSheet: React.FC<{
  members: FamilyMember[];
  onClose: () => void;
  /** Pre-filled new countdown (e.g. from an event) */
  initial?: Partial<Draft>;
}> = ({ members, onClose, initial }) => {
  const queryClient = useQueryClient();
  const { data: countdowns = [] } = useCountdowns();
  const [draft, setDraft] = useState<Draft | null>(
    initial ? { title: '', emoji: '🎉', dateStr: toDateStr(new Date()), memberId: null, ...initial } : null
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (d: Draft) =>
      apiFetch(d.id ? `/api/countdowns/${d.id}` : '/api/countdowns', { method: d.id ? 'PUT' : 'POST', body: JSON.stringify(d) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['countdowns'] });
      setDraft(null);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/countdowns/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['countdowns'] });
      setDraft(null);
    },
  });

  return (
    <Sheet
      title={
        <>
          <Hourglass className="w-5 h-5 text-amber-500" /> Countdowns
        </>
      }
      subtitle="Days until trips, birthdays and big days — shown on the calendar and the photo frame."
      onClose={onClose}
      testId="countdowns-sheet"
    >
      {error && <NoticeBanner tone="error" text={error} onDismiss={() => setError(null)} />}
      {draft ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="flex gap-2">
            <EmojiPickerButton value={draft.emoji} onChange={(emoji) => setDraft({ ...draft, emoji })} label="Countdown emoji" />
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="e.g. Disney trip"
              className={inputClass}
              aria-label="Countdown name"
            />
          </div>
          <div>
            <label className={fieldLabel}>Date</label>
            <input type="date" value={draft.dateStr} onChange={(e) => setDraft({ ...draft, dateStr: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={fieldLabel}>For</label>
            <MemberChips
              members={members}
              value={draft.memberId ? [draft.memberId] : []}
              onChange={(ids) => setDraft({ ...draft, memberId: ids[0] ?? null })}
              single
              allowNone
              noneLabel="Whole family"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            {draft.id ? (
              <button type="button" onClick={() => remove.mutate(draft.id!)} className="h-12 px-4 rounded-2xl bg-rose-50 text-rose-600 font-bold text-sm flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setDraft(null)} className={secondaryBtn}>
                Back
              </button>
              <button type="submit" disabled={!draft.title.trim() || save.isPending} className={primaryBtn}>
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      ) : (
        <>
          <div className="space-y-2">
            {countdowns.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setDraft({ id: c.id, title: c.title, emoji: c.emoji, dateStr: c.dateStr, memberId: c.memberId })}
                className="w-full min-h-[56px] px-4 py-2.5 rounded-2xl bg-stone-50 hover:bg-stone-100 border border-stone-200 flex items-center gap-3 text-left active:scale-[0.99]"
              >
                <span className="text-2xl">{c.emoji}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-slate-800 truncate">{c.title}</span>
                  <span className="block text-xs text-stone-500">
                    {new Date(`${c.dateStr}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </span>
                <span className="text-lg font-extrabold text-amber-600">{daysLeftLabel(c.daysLeft)}</span>
              </button>
            ))}
            {countdowns.length === 0 && <p className="text-sm text-stone-400 text-center py-6">No countdowns yet.</p>}
          </div>
          <button
            type="button"
            onClick={() => setDraft({ title: '', emoji: '🎉', dateStr: toDateStr(new Date(Date.now() + 7 * 86_400_000)), memberId: null })}
            className={`${primaryBtn} w-full flex items-center justify-center gap-2`}
          >
            <Plus className="w-5 h-5" /> New countdown
          </button>
        </>
      )}
    </Sheet>
  );
};
