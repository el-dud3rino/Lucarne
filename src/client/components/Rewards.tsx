import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Gift, Pencil, Plus, Star, Trash2, Undo2 } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { EmojiPickerButton } from './EmojiPicker.js';
import { NoticeBanner } from './NoticeBanner.js';
import { MemberChips, Sheet, fieldLabel, inputClass, primaryBtn, secondaryBtn } from './Sheet.js';
import type { FamilyMember, MemberStarBalance, MemberStarStats, Reward, RewardRedemption } from '../../shared/types.js';

interface RewardsResponse {
  rewards: Reward[];
  balances: MemberStarBalance[];
  history: RewardRedemption[];
}

export function useRewards() {
  return useQuery({ queryKey: ['rewards'], queryFn: () => apiFetch<RewardsResponse>('/api/rewards') });
}

type Mode = { kind: 'browse' } | { kind: 'edit'; draft: Partial<Reward> } | { kind: 'redeem'; reward: Reward };

/** Star Tracker: balances, rewards the family set up, redeeming (spending stars) and recent history with undo. */
export const RewardsSheet: React.FC<{
  members: FamilyMember[];
  stats: MemberStarStats[];
  onClose: () => void;
}> = ({ members, stats, onClose }) => {
  const queryClient = useQueryClient();
  const { data } = useRewards();
  const [mode, setMode] = useState<Mode>({ kind: 'browse' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const people = members.filter((m) => m.role !== 'family');
  const byId = new Map(people.map((m) => [m.id, m]));
  const balanceOf = (id: string) => data?.balances.find((b) => b.memberId === id)?.balance ?? 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['rewards'] });
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const saveReward = useMutation({
    mutationFn: (d: Partial<Reward>) => apiFetch(d.id ? `/api/rewards/${d.id}` : '/api/rewards', { method: d.id ? 'PUT' : 'POST', body: JSON.stringify(d) }),
    onSuccess: () => {
      refresh();
      setMode({ kind: 'browse' });
    },
    onError: fail,
  });
  const deleteReward = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/rewards/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      refresh();
      setMode({ kind: 'browse' });
    },
    onError: fail,
  });
  const redeem = useMutation({
    mutationFn: (v: { reward: Reward; memberId: string }) =>
      apiFetch<RewardRedemption>(`/api/rewards/${v.reward.id}/redeem`, { method: 'POST', body: JSON.stringify({ memberId: v.memberId }) }),
    onSuccess: (r) => {
      refresh();
      setMode({ kind: 'browse' });
      setNotice(`🎉 ${byId.get(r.memberId)?.name ?? 'Someone'} got "${r.title}" for ${r.cost} ⭐`);
    },
    onError: fail,
  });
  const undo = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/rewards/redemptions/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
    onError: fail,
  });

  return (
    <Sheet
      title={
        <>
          <Award className="w-6 h-6 text-amber-500" /> Household Star Tracker
        </>
      }
      subtitle="Stars come from chores and finished routines. Spend them on rewards you set up together."
      onClose={onClose}
      maxWidth="max-w-3xl"
      testId="rewards-sheet"
    >
      {error && <NoticeBanner tone="error" text={error} onDismiss={() => setError(null)} />}
      {notice && <NoticeBanner tone="success" text={notice} onDismiss={() => setNotice(null)} />}

      {mode.kind === 'browse' && (
        <>
          {/* Balances */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {people.map((m) => {
              const st = stats.find((s) => s.memberId === m.id);
              return (
                <div key={m.id} style={{ backgroundColor: m.colorBg, color: m.colorText }} className="rounded-2xl p-3 border border-black/5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{m.emoji}</span>
                    <span className="font-extrabold truncate">{m.name}</span>
                  </div>
                  <div className="mt-1.5 text-2xl font-black flex items-center gap-1" data-testid={`balance-${m.id}`}>
                    <Star className="w-5 h-5 fill-amber-400 text-amber-500" />
                    {balanceOf(m.id)}
                  </div>
                  <div className="text-[11px] font-bold opacity-75">
                    {st?.todayStars ?? 0} today · {st?.weekStars ?? 0} this week
                  </div>
                </div>
              );
            })}
          </div>

          {/* Rewards */}
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-extrabold uppercase tracking-wider text-stone-500 flex items-center gap-1.5">
              <Gift className="w-4 h-4 text-rose-500" /> Rewards
            </h4>
            <button
              type="button"
              onClick={() => setMode({ kind: 'edit', draft: { title: '', emoji: '🎁', cost: 10, memberId: null } })}
              className="h-10 min-h-[40px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-sm font-bold text-slate-700 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> Add reward
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {(data?.rewards ?? []).map((r) => {
              const owner = r.memberId ? byId.get(r.memberId) : undefined;
              const canAfford = (owner ? [owner] : people).some((m) => balanceOf(m.id) >= r.cost);
              return (
                <div key={r.id} className="rounded-2xl border border-stone-200 bg-white p-3 flex items-center gap-3">
                  <span className="text-3xl">{r.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-800 truncate">{r.title}</div>
                    <div className="text-xs font-bold text-amber-700">
                      {r.cost} ⭐{owner ? ` · for ${owner.name}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Edit ${r.title}`}
                    onClick={() => setMode({ kind: 'edit', draft: r })}
                    className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl text-stone-400 hover:bg-stone-100 flex items-center justify-center"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode({ kind: 'redeem', reward: r })}
                    className={`h-10 min-h-[40px] px-3.5 rounded-xl text-sm font-extrabold ${
                      canAfford ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-stone-100 text-stone-400'
                    }`}
                  >
                    Redeem
                  </button>
                </div>
              );
            })}
            {(data?.rewards ?? []).length === 0 && (
              <p className="text-sm text-stone-400 sm:col-span-2 text-center py-4">
                No rewards yet. Add a few the kids can work toward, like “Pick the movie” or “Stay up 30 min”.
              </p>
            )}
          </div>

          {/* History */}
          {(data?.history ?? []).length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-sm font-extrabold uppercase tracking-wider text-stone-500">Recently redeemed</h4>
              {(data?.history ?? []).slice(0, 8).map((h) => (
                <div key={h.id} className="flex items-center gap-2.5 text-sm px-3 py-1.5 rounded-xl bg-stone-50">
                  <span>{h.emoji}</span>
                  <span className="font-semibold text-slate-700 flex-1 min-w-0 truncate">
                    {byId.get(h.memberId)?.name ?? 'Someone'} · {h.title}
                  </span>
                  <span className="text-xs text-stone-400">{new Date(h.redeemedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  <span className="text-xs font-bold text-amber-700">−{h.cost}⭐</span>
                  <button
                    type="button"
                    aria-label={`Undo ${h.title}`}
                    title="Undo (refund the stars)"
                    onClick={() => undo.mutate(h.id)}
                    className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl text-stone-400 hover:bg-stone-200 flex items-center justify-center"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {mode.kind === 'redeem' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
            <span className="text-4xl">{mode.reward.emoji}</span>
            <div>
              <div className="text-lg font-extrabold text-slate-800">{mode.reward.title}</div>
              <div className="text-sm font-bold text-amber-700">{mode.reward.cost} stars</div>
            </div>
          </div>
          <div className="text-sm font-bold text-stone-500">Who is getting it?</div>
          <div className="grid grid-cols-2 gap-2.5">
            {(mode.reward.memberId ? people.filter((m) => m.id === mode.reward.memberId) : people).map((m) => {
              const bal = balanceOf(m.id);
              const ok = bal >= mode.reward.cost;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!ok || redeem.isPending}
                  onClick={() => redeem.mutate({ reward: mode.reward, memberId: m.id })}
                  style={ok ? { backgroundColor: m.colorBg, color: m.colorText } : undefined}
                  className={`p-4 rounded-2xl font-extrabold text-left flex items-center gap-3 transition active:scale-95 ${ok ? 'shadow-2xs' : 'bg-stone-50 text-stone-400'}`}
                >
                  <span className="text-2xl">{m.emoji}</span>
                  <span className="flex-1">
                    <span className="block">{m.name}</span>
                    <span className="block text-xs font-bold opacity-80">
                      {ok ? `${bal} ⭐ → ${bal - mode.reward.cost} ⭐` : `${bal} ⭐ · needs ${mode.reward.cost - bal} more`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setMode({ kind: 'browse' })} className={secondaryBtn}>
            Back
          </button>
        </div>
      )}

      {mode.kind === 'edit' && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveReward.mutate(mode.draft);
          }}
        >
          <div className="flex gap-2">
            <EmojiPickerButton value={mode.draft.emoji || '🎁'} onChange={(emoji) => setMode({ kind: 'edit', draft: { ...mode.draft, emoji } })} label="Reward emoji" />
            <input
              value={mode.draft.title ?? ''}
              onChange={(e) => setMode({ kind: 'edit', draft: { ...mode.draft, title: e.target.value } })}
              placeholder="e.g. Pick dinner on Friday"
              aria-label="Reward name"
              className={inputClass}
            />
          </div>
          <div>
            <label className={fieldLabel}>Cost in stars</label>
            <div className="flex flex-wrap gap-2">
              {[5, 10, 20, 30, 50, 100].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMode({ kind: 'edit', draft: { ...mode.draft, cost: n } })}
                  className={`h-10 min-h-[40px] min-w-[52px] px-3 rounded-xl text-sm font-bold border ${
                    mode.draft.cost === n ? 'bg-amber-500 text-white border-amber-500' : 'bg-stone-50 border-stone-200 text-slate-700'
                  }`}
                >
                  {n} ⭐
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={10000}
                value={mode.draft.cost ?? ''}
                onChange={(e) => setMode({ kind: 'edit', draft: { ...mode.draft, cost: Number(e.target.value) } })}
                aria-label="Custom cost"
                className="h-10 w-24 px-3 rounded-xl bg-stone-50 border border-stone-200 text-sm font-bold"
              />
            </div>
          </div>
          <div>
            <label className={fieldLabel}>Who can redeem it</label>
            <MemberChips
              members={people}
              value={mode.draft.memberId ? [mode.draft.memberId] : []}
              onChange={(ids) => setMode({ kind: 'edit', draft: { ...mode.draft, memberId: ids[0] ?? null } })}
              single
              allowNone
              noneLabel="Anyone"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            {mode.draft.id ? (
              <button
                type="button"
                onClick={() => deleteReward.mutate(mode.draft.id!)}
                className="h-12 px-4 rounded-2xl bg-rose-50 text-rose-600 font-bold text-sm flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setMode({ kind: 'browse' })} className={secondaryBtn}>
                Back
              </button>
              <button type="submit" disabled={!mode.draft.title?.trim() || saveReward.isPending} className={primaryBtn}>
                Save
              </button>
            </div>
          </div>
        </form>
      )}
    </Sheet>
  );
};
