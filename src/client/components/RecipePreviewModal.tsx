import React, { useEffect } from 'react';
import { ChefHat, Clock, ExternalLink, Flame, Users, X } from 'lucide-react';
import type { Recipe } from '../../shared/types.js';
import { macroShares } from '../../shared/nutrition.js';
import { formatQuantityNumber } from '../../shared/ingredientAggregator.js';
import { formatMinutes } from '../lib/time.js';

type PreviewRecipe = Omit<Recipe, 'id' | 'createdAt'> & { site?: string; alreadySaved?: boolean };

const MACROS = [
  { key: 'proteinG', share: 'protein', label: 'Protein', color: '#0EA5E9' },
  { key: 'carbsG', share: 'carbs', label: 'Carbs', color: '#F59E0B' },
  { key: 'fatG', share: 'fat', label: 'Fat', color: '#F43F5E' },
] as const;

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => (
  <div className="rounded-2xl bg-stone-50 border border-stone-200 px-3 py-2.5 flex items-center gap-2.5 min-w-0">
    <div className="text-stone-400 shrink-0">{icon}</div>
    <div className="min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{label}</div>
      <div className="font-extrabold text-slate-800 truncate">{value}</div>
    </div>
  </div>
);

/** Quick overview of a recipe (used for Gemini meal search results before saving). */
export const RecipePreviewModal: React.FC<{
  recipe: PreviewRecipe;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
  /** Label for the estimate source shown under the nutrition panel */
  nutritionNote?: string;
}> = ({ recipe, onClose, onSave, saving, nutritionNote }) => {
  const source = recipe.site || (recipe.sourceUrl ? new URL(recipe.sourceUrl).hostname.replace(/^www\./, '') : '');
  const note = nutritionNote ?? (source ? `Per serving, as published by ${source}` : 'Per serving');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const n = recipe.nutrition ?? null;
  const shares = n ? macroShares(n) : null;
  const totalMinutes = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/50 flex items-end md:items-center justify-center p-0 md:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={recipe.title}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full md:max-w-3xl rounded-t-3xl md:rounded-3xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Hero: photo if there is one, otherwise the dish emoji */}
        <div className="relative h-36 md:h-44 shrink-0 bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 flex items-center justify-center">
          {recipe.imageUrl ? (
            <img src={recipe.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : (
            <span className="text-7xl md:text-8xl drop-shadow-sm" aria-hidden>
              {recipe.emoji || '🍽️'}
            </span>
          )}
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="absolute top-3 right-3 w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-white/90 hover:bg-white shadow flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 md:p-6 space-y-5">
          <div>
            <h3 className="text-2xl font-extrabold text-slate-800 leading-tight">{recipe.title}</h3>
            {recipe.description && <p className="text-sm text-stone-500 mt-1">{recipe.description}</p>}
            {recipe.sourceUrl && (
              <a
                href={recipe.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-xs font-bold text-sky-600 hover:underline"
              >
                Original recipe on {source} <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {recipe.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {recipe.tags.slice(0, 6).map((t) => (
                  <span key={t} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Stat icon={<Users className="w-5 h-5" />} label="Serves" value={recipe.servings ? String(recipe.servings) : '—'} />
            <Stat icon={<Clock className="w-5 h-5" />} label="Prep" value={formatMinutes(recipe.prepMinutes)} />
            <Stat
              icon={<ChefHat className="w-5 h-5" />}
              label="Cook"
              value={formatMinutes(recipe.cookMinutes)}
            />
            <Stat
              icon={<Flame className="w-5 h-5" />}
              label="Calories"
              value={n?.calories != null ? `${n.calories} kcal` : '—'}
            />
          </div>

          {n && (
            <div className="rounded-2xl border border-stone-200 p-4 space-y-3">
              {shares && (
                <div className="h-3 rounded-full overflow-hidden flex bg-stone-100" aria-hidden>
                  {MACROS.map((m) => (
                    <div key={m.key} style={{ width: `${shares[m.share]}%`, background: m.color }} />
                  ))}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2">
                {MACROS.map((m) => (
                  <div key={m.key} className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: m.color }} aria-hidden />
                    <div>
                      <div className="font-extrabold text-slate-800">{n[m.key] != null ? `${n[m.key]} g` : '—'}</div>
                      <div className="text-[11px] font-semibold text-stone-500">
                        {m.label}
                        {shares ? ` · ${shares[m.share]}%` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-stone-400">
                {note}
                {totalMinutes > 0 ? ` · ready in about ${formatMinutes(totalMinutes)}` : ''}
              </div>
            </div>
          )}

          {!n && (
            <div className="text-xs text-stone-400 -mt-2">
              {source ? `${source} doesn't publish nutrition for this recipe.` : 'No nutrition information for this recipe.'}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">
                Ingredients ({recipe.ingredients.length})
              </div>
              <ul className="space-y-1.5 text-sm">
                {recipe.ingredients.map((ing, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-bold text-slate-700 shrink-0 min-w-[3.5rem]">
                      {ing.quantity != null ? formatQuantityNumber(ing.quantity) : ''} {ing.unit}
                    </span>
                    <span className="text-slate-700">
                      {ing.name}
                      {ing.notes && <span className="text-stone-400">, {ing.notes}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-2">
                Steps ({recipe.instructions.length})
              </div>
              <ol className="space-y-2 text-sm list-decimal pl-5 text-slate-700">
                {recipe.instructions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-stone-200 p-4 flex justify-end gap-2 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="h-11 min-h-[40px] px-5 rounded-xl bg-stone-100 hover:bg-stone-200 font-bold text-sm"
          >
            Back to results
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || recipe.alreadySaved}
            className="h-11 min-h-[40px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm"
          >
            {recipe.alreadySaved ? 'Already saved' : saving ? 'Saving…' : 'Save Recipe'}
          </button>
        </div>
      </div>
    </div>
  );
};
