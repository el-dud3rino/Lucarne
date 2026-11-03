import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Loader2, Sparkles } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { NoticeBanner } from './NoticeBanner.js';
import { Sheet, primaryBtn, secondaryBtn } from './Sheet.js';
import type { Recipe } from '../../shared/types.js';

interface Planned {
  dateStr: string;
  recipeId: string;
  title: string;
  reason: string;
}

/** "Plan my week": fills empty dinner nights from the family's own saved recipes only. */
export const PlanWeekSheet: React.FC<{
  startDate: string;
  recipes: Recipe[];
  geminiConfigured: boolean;
  onClose: () => void;
}> = ({ startDate, recipes, geminiConfigured, onClose }) => {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');
  const [plan, setPlan] = useState<Array<Planned & { include: boolean }> | null>(null);
  const [usedAi, setUsedAi] = useState(false);
  const [busy, setBusy] = useState<'plan' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const byId = new Map(recipes.map((r) => [r.id, r]));

  const run = async () => {
    setBusy('plan');
    setError(null);
    setInfo(null);
    try {
      const res = await apiFetch<{ dinners: Planned[]; usedAi: boolean; aiError?: string }>('/api/meals/plan-week', {
        method: 'POST',
        body: JSON.stringify({ startDate, days: 7, notes }),
      });
      if (res.dinners.length === 0) {
        setInfo('Every night this week already has a dinner planned.');
        setPlan(null);
      } else {
        setPlan(res.dinners.map((d) => ({ ...d, include: true })));
      }
      setUsedAi(res.usedAi);
      if (res.aiError) setInfo(`Gemini wasn't available (${res.aiError}), so this is a simple rotation of your recipes instead.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const swap = (idx: number, recipeId: string) =>
    setPlan((p) => p?.map((x, i) => (i === idx ? { ...x, recipeId, title: byId.get(recipeId)?.title ?? x.title, reason: 'Picked by you' } : x)) ?? null);

  const save = async () => {
    if (!plan) return;
    setBusy('save');
    try {
      const res = await apiFetch<{ saved: number }>('/api/meals/plan-week/apply', {
        method: 'POST',
        body: JSON.stringify({ dinners: plan.filter((p) => p.include).map(({ dateStr, recipeId }) => ({ dateStr, recipeId })) }),
      });
      queryClient.invalidateQueries({ queryKey: ['meals'] });
      setInfo(`Planned ${res.saved} dinner${res.saved === 1 ? '' : 's'}. Use “Send Week to Groceries” for the shopping list.`);
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet
      title={
        <>
          <CalendarCheck className="w-5 h-5 text-emerald-600" /> Plan my week
        </>
      }
      subtitle="Fills the empty dinner nights with recipes from your Recipe Box — never made-up ones. Nights you already planned stay as they are."
      onClose={onClose}
      maxWidth="max-w-2xl"
      testId="plan-week"
      footer={
        plan ? (
          <div className="flex justify-between gap-2">
            <button type="button" onClick={run} disabled={busy !== null} className={secondaryBtn}>
              Try again
            </button>
            <button type="button" onClick={save} disabled={busy !== null || !plan.some((p) => p.include)} className={`${primaryBtn} flex items-center gap-2`}>
              {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />}
              Save {plan.filter((p) => p.include).length} dinners
            </button>
          </div>
        ) : undefined
      }
    >
      {error && <NoticeBanner tone="error" text={error} onDismiss={() => setError(null)} />}
      {info && <NoticeBanner tone="info" text={info} onDismiss={() => setInfo(null)} />}
      {!plan && (
        <>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={geminiConfigured ? 'Anything to keep in mind? e.g. “quick on Tuesday (soccer), no fish, one vegetarian night”' : 'Notes need a Gemini key; without one, Lucarne rotates your recipes (favorites and least-recent first).'}
            disabled={!geminiConfigured}
            aria-label="Planning notes"
            className="w-full min-h-[96px] p-3 rounded-2xl bg-stone-50 border border-stone-200 text-sm disabled:opacity-60"
          />
          <button
            type="button"
            onClick={run}
            disabled={busy !== null || recipes.length === 0}
            className="w-full min-h-[52px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-extrabold flex items-center justify-center gap-2"
          >
            {busy === 'plan' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            {busy === 'plan' ? 'Planning…' : 'Suggest dinners'}
          </button>
          {recipes.length === 0 && <p className="text-sm text-stone-500 text-center">Save a few recipes first.</p>}
        </>
      )}
      {plan && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-stone-400">{usedAi ? 'Picked by Gemini from your recipes' : 'Rotation of your recipes'} · change any night below</div>
          {plan.map((p, i) => {
            const r = byId.get(p.recipeId);
            return (
              <div key={p.dateStr} className={`rounded-2xl border p-2.5 flex items-center gap-3 ${p.include ? 'border-emerald-200 bg-white' : 'border-stone-200 bg-stone-50 opacity-60'}`}>
                <input
                  type="checkbox"
                  checked={p.include}
                  onChange={(e) => setPlan((prev) => prev?.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)) ?? null)}
                  aria-label={`Include ${p.dateStr}`}
                  className="w-6 h-6 accent-emerald-600 shrink-0"
                />
                <div className="w-20 shrink-0">
                  <div className="text-xs font-extrabold uppercase text-stone-400">{new Date(`${p.dateStr}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}</div>
                  <div className="text-sm font-bold text-slate-700">{new Date(`${p.dateStr}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                </div>
                {r?.imageUrl ? (
                  <img src={r.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                ) : (
                  <span className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center text-xl shrink-0">🍽️</span>
                )}
                <div className="flex-1 min-w-0">
                  <select
                    value={p.recipeId}
                    onChange={(e) => swap(i, e.target.value)}
                    aria-label={`Dinner for ${p.dateStr}`}
                    className="w-full h-10 min-h-[40px] px-2 rounded-xl bg-stone-50 border border-stone-200 text-sm font-bold text-slate-800"
                  >
                    {recipes.map((rr) => (
                      <option key={rr.id} value={rr.id}>
                        {rr.title}
                      </option>
                    ))}
                  </select>
                  {p.reason && <div className="text-xs text-stone-500 mt-0.5 truncate">{p.reason}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
};
