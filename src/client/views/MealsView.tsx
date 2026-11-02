import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  Heart,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { addDays, startOfWeek, toDateStr } from '../lib/dates.js';
import { aggregateIngredients } from '../../shared/ingredientAggregator.js';
import { CookModeView } from './CookModeView.js';
import { RecipePreviewModal } from '../components/RecipePreviewModal.js';
import { formatMinutes } from '../lib/time.js';
import type {
  AppSettings,
  MealPlanEntry,
  MealSlot,
  Recipe,
  RecipeIngredient,
} from '../../shared/types.js';

interface MealsViewProps {
  settings: AppSettings;
}

const SLOTS: Array<{ key: MealSlot; label: string; emoji: string }> = [
  { key: 'breakfast', label: 'Breakfast', emoji: '🥞' },
  { key: 'lunch', label: 'Lunch', emoji: '🥪' },
  { key: 'dinner', label: 'Dinner', emoji: '🍽️' },
];

const TAG_FILTERS = [
  { id: 'All', label: 'All' },
  { id: 'Favorites', label: '⭐ Favorites' },
  { id: 'Quick', label: '⚡ Quick' },
  { id: 'Weeknight', label: '🌙 Weeknight' },
  { id: 'Kid-Friendly', label: '👶 Kid-Friendly' },
];

export const MealsView: React.FC<MealsViewProps> = ({ settings }) => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'planner' | 'recipes'>('planner');
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), 0));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');

  // Modals
  const [assignTarget, setAssignTarget] = useState<{ dateStr: string; slot: MealSlot } | null>(
    null
  );
  const [cookRecipe, setCookRecipe] = useState<Recipe | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGroceryModal, setShowGroceryModal] = useState(false);

  const weekEndStr = toDateStr(addDays(weekStart, 6));
  const weekStartStr = toDateStr(weekStart);

  const { data: recipes = [] } = useQuery({
    queryKey: ['recipes'],
    queryFn: () => apiFetch<Recipe[]>('/api/meals/recipes'),
  });

  const { data: plan = [] } = useQuery({
    queryKey: ['meals', weekStartStr, weekEndStr],
    queryFn: () =>
      apiFetch<MealPlanEntry[]>(
        `/api/meals/plan?start=${weekStartStr}&end=${weekEndStr}`
      ),
  });

  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return recipes.filter((r) => {
      // 1. Tag filter
      if (selectedTag === 'Favorites') {
        if (!r.favorite) return false;
      } else if (selectedTag !== 'All') {
        const tLower = selectedTag.toLowerCase();
        const hasTag = r.tags.some((t) => t.toLowerCase().includes(tLower));
        if (!hasTag) return false;
      }

      // 2. Search query filter
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.ingredients.some((i) => i.name.toLowerCase().includes(q))
      );
    });
  }, [recipes, searchQuery, selectedTag]);

  const planMap = useMemo(() => {
    const m = new Map<string, MealPlanEntry>();
    for (const entry of plan) {
      m.set(`${entry.dateStr}:${entry.slot}`, entry);
    }
    return m;
  }, [plan]);

  const assignMutation = useMutation({
    mutationFn: async (vars: {
      dateStr: string;
      slot: MealSlot;
      recipeId?: string | null;
      customTitle?: string;
    }) =>
      apiFetch('/api/meals/plan', {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] });
      setAssignTarget(null);
    },
  });

  const removePlanMutation = useMutation({
    mutationFn: async (id: string) => apiFetch(`/api/meals/plan/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meals'] });
    },
  });

  const toggleFavMutation = useMutation({
    mutationFn: async (recipe: Recipe) =>
      apiFetch(`/api/meals/recipes/${recipe.id}`, {
        method: 'PUT',
        body: JSON.stringify({ favorite: !recipe.favorite }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
  });

  const deleteRecipeMutation = useMutation({
    mutationFn: async (id: string) => apiFetch(`/api/meals/recipes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['meals'] });
      setCookRecipe(null);
    },
  });

  // Aggregate week's planned recipe ingredients for Grocery List push
  const weekIngredients = useMemo(() => {
    const list: Array<RecipeIngredient & { recipeTitle: string; key: string }> = [];
    for (const entry of plan) {
      if (!entry.recipe) continue;
      entry.recipe.ingredients.forEach((ing, idx) => {
        list.push({
          ...ing,
          recipeTitle: entry.recipe!.title,
          key: `${entry.id}-${idx}`,
        });
      });
    }
    return list;
  }, [plan]);

  return (
    <div className="h-full flex flex-col gap-3">
      {/* Top Sub-Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="bg-stone-200/75 p-1 rounded-2xl flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab('planner')}
              className={`h-10 min-h-[40px] px-4 py-2 rounded-xl text-sm font-bold transition flex items-center justify-center ${
                tab === 'planner'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-stone-600 hover:text-slate-900'
              }`}
            >
              Weekly Plan
            </button>
            <button
              type="button"
              onClick={() => setTab('recipes')}
              className={`h-10 min-h-[40px] px-4 py-2 rounded-xl text-sm font-bold transition flex items-center justify-center ${
                tab === 'recipes'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-stone-600 hover:text-slate-900'
              }`}
            >
              Recipe Box ({recipes.length})
            </button>
          </div>

          {tab === 'planner' && (
            <div className="flex items-center gap-1.5 ml-2">
              <button
                type="button"
                onClick={() => setWeekStart((d) => addDays(d, -7))}
                className="w-10 h-10 rounded-xl bg-white border border-stone-200 flex items-center justify-center"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setWeekStart(startOfWeek(new Date(), 0))}
                className="px-3.5 h-10 rounded-xl bg-white border border-stone-200 text-xs font-bold"
              >
                This Week
              </button>
              <button
                type="button"
                onClick={() => setWeekStart((d) => addDays(d, 7))}
                className="w-10 h-10 rounded-xl bg-white border border-stone-200 flex items-center justify-center"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {weekIngredients.length > 0 && (
            <button
              type="button"
              onClick={() => setShowGroceryModal(true)}
              className="h-11 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-sm flex items-center gap-2 shadow-sm"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>Send Week to Groceries ({weekIngredients.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            className="h-11 px-4 rounded-2xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-bold text-sm flex items-center gap-2 shadow-sm"
          >
            <Sparkles className="w-4 h-4" />
            <span>Import / Discover Meals</span>
          </button>
        </div>
      </div>

      {/* TAB 1: Weekly Meal Planner Grid */}
      {tab === 'planner' && (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-7 gap-2.5 overflow-y-auto md:overflow-hidden">
          {Array.from({ length: 7 }).map((_, idx) => {
            const day = addDays(weekStart, idx);
            const dStr = toDateStr(day);
            const isToday = dStr === toDateStr(new Date());

            return (
              <div
                key={dStr}
                className={`flex flex-col rounded-2xl border overflow-hidden ${
                  isToday
                    ? 'bg-white border-amber-300 ring-2 ring-amber-100'
                    : 'bg-white border-stone-200/90'
                }`}
              >
                <div
                  className={`px-3.5 py-2.5 border-b ${
                    isToday ? 'bg-amber-50/80 border-amber-200/70' : 'border-stone-100'
                  }`}
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-stone-400">
                    {day.toLocaleDateString([], { weekday: 'short' })}
                  </div>
                  <div className="text-lg font-extrabold text-slate-800">
                    {day.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </div>
                </div>

                <div className="flex-1 p-2.5 flex flex-col gap-2.5">
                  {SLOTS.map((slot) => {
                    const entry = planMap.get(`${dStr}:${slot.key}`);
                    const title = entry?.recipe?.title || entry?.customTitle || '';

                    return (
                      <div
                        key={slot.key}
                        onClick={() => {
                          if (entry?.recipe) {
                            setCookRecipe(entry.recipe);
                          } else {
                            setAssignTarget({ dateStr: dStr, slot: slot.key });
                          }
                        }}
                        className={`flex-1 rounded-xl border p-2.5 flex flex-col justify-between cursor-pointer transition active:scale-[0.98] ${
                          title
                            ? 'bg-amber-50/55 border-amber-200/80 hover:bg-amber-50'
                            : 'bg-stone-50/60 border-dashed border-stone-200 hover:border-stone-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-stone-400">
                          <span>
                            {slot.emoji} {slot.label}
                          </span>
                          {entry && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removePlanMutation.mutate(entry.id);
                              }}
                              className="-mr-2 -mt-2 w-10 h-10 min-w-[40px] min-h-[40px] flex items-center justify-center text-stone-400 hover:text-rose-500 rounded-full"
                              title="Clear slot"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        {title ? (
                          <div className="mt-1">
                            {entry?.recipe?.imageUrl && (
                              <img
                                src={entry.recipe.imageUrl}
                                alt={title}
                                className="w-full h-20 object-cover rounded-lg mb-1.5"
                              />
                            )}
                            <div className="font-bold text-slate-800 text-xs md:text-sm leading-snug line-clamp-2">
                              {title}
                            </div>
                            {entry?.recipe && (
                              <div className="text-[11px] font-semibold text-amber-700 mt-1 flex items-center gap-1">
                                <ChefHat className="w-3 h-3" />
                                Tap for Cook Mode
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs font-semibold text-stone-300 flex items-center gap-1 mt-2">
                            <Plus className="w-3.5 h-3.5" />
                            Plan
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: Recipe Box */}
      {tab === 'recipes' && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-md flex-1 min-w-[240px]">
              <Search className="w-5 h-5 text-stone-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search saved meals by dish, tag, or ingredient..."
                className="w-full h-12 pl-11 pr-4 rounded-2xl bg-white border border-stone-200 font-semibold text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>

            {/* 1-Tap Tag Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {TAG_FILTERS.map((tag) => {
                const active = selectedTag === tag.id;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setSelectedTag(tag.id)}
                    className={`h-10 min-h-[40px] px-3.5 rounded-xl text-xs font-bold border transition flex items-center justify-center shrink-0 active:scale-95 ${
                      active
                        ? 'bg-amber-500 text-white border-amber-500 shadow-2xs'
                        : 'bg-white hover:bg-stone-50 text-slate-700 border-stone-200'
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-2">
            {filteredRecipes.map((rec) => (
              <div
                key={rec.id}
                className="relative bg-white rounded-3xl border border-stone-200/90 shadow-2xs overflow-hidden flex flex-col hover:shadow-md transition group"
              >
                <button
                  type="button"
                  onClick={() => setCookRecipe(rec)}
                  className="w-full text-left flex flex-col flex-1 focus:outline-none focus:ring-2 focus:ring-amber-500 rounded-3xl"
                >
                  <div className="h-40 bg-stone-100 relative w-full">
                    {rec.imageUrl ? (
                      <img
                        src={rec.imageUrl}
                        alt={rec.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-stone-300">
                        <ChefHat className="w-12 h-12" />
                      </div>
                    )}
                  </div>

                  <div className="p-4 flex-1 flex flex-col justify-between gap-2 w-full">
                    <div>
                      <h3 className="font-extrabold text-base text-slate-800 leading-snug">
                        {rec.title}
                      </h3>
                      <p className="text-xs text-stone-500 line-clamp-2 mt-1">
                        {rec.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-xs font-bold text-stone-400 pt-2 border-t border-stone-100">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {(rec.prepMinutes || 0) + (rec.cookMinutes || 0) || 25} min
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        Serves {rec.servings || 4}
                      </span>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFavMutation.mutate(rec);
                  }}
                  className="absolute top-3 right-3 w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-white/90 backdrop-blur-xs flex items-center justify-center shadow-xs z-10 hover:bg-white active:scale-95 transition"
                  title={rec.favorite ? 'Remove favorite' : 'Mark favorite'}
                >
                  <Heart
                    className={`w-4 h-4 ${
                      rec.favorite ? 'fill-rose-500 text-rose-500' : 'text-stone-500'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign Meal Slot Modal */}
      {assignTarget && (
        <AssignMealModal
          dateStr={assignTarget.dateStr}
          slot={assignTarget.slot}
          recipes={recipes}
          onClose={() => setAssignTarget(null)}
          onSelectRecipe={(recipeId) =>
            assignMutation.mutate({
              dateStr: assignTarget.dateStr,
              slot: assignTarget.slot,
              recipeId,
            })
          }
          onCustomTitle={(customTitle) =>
            assignMutation.mutate({
              dateStr: assignTarget.dateStr,
              slot: assignTarget.slot,
              recipeId: null,
              customTitle,
            })
          }
        />
      )}

      {/* 1080p Distraction-Free Cook Mode View */}
      {cookRecipe && (
        <CookModeView
          recipe={cookRecipe}
          defaultListId={settings.defaultGroceryListId}
          onClose={() => setCookRecipe(null)}
          onDelete={() => deleteRecipeMutation.mutate(cookRecipe.id)}
        />
      )}

      {/* Import from URL / Gemini AI Search / JSON Seed Upload Modal */}
      {showImportModal && (
        <ImportRecipeModal
          geminiReady={settings.geminiApiKeyConfigured}
          onClose={() => setShowImportModal(false)}
          onImported={(rec) => {
            queryClient.invalidateQueries({ queryKey: ['recipes'] });
            setShowImportModal(false);
            if (rec) setCookRecipe(rec);
          }}
        />
      )}

      {/* Send Week's Planned Meals to Grocery List Modal */}
      {showGroceryModal && (
        <SendMealsToGroceriesModal
          ingredients={weekIngredients}
          listId={settings.defaultGroceryListId}
          onClose={() => setShowGroceryModal(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            setShowGroceryModal(false);
          }}
        />
      )}
    </div>
  );
};

const AssignMealModal: React.FC<{
  dateStr: string;
  slot: MealSlot;
  recipes: Recipe[];
  onClose: () => void;
  onSelectRecipe: (id: string) => void;
  onCustomTitle: (txt: string) => void;
}> = ({ dateStr, slot, recipes, onClose, onSelectRecipe, onCustomTitle }) => {
  const [custom, setCustom] = useState('');
  const [filter, setFilter] = useState('');

  const shown = recipes.filter((r) =>
    r.title.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-start md:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-xl w-full p-6 space-y-4 my-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-extrabold text-slate-800 capitalize">
            Plan {slot} · {dateStr}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (custom.trim()) onCustomTitle(custom.trim());
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Quick note (e.g. Leftovers, Takeout Thai, Tacos)..."
            className="flex-1 h-11 px-4 rounded-xl bg-stone-50 border border-stone-200 text-sm font-semibold"
          />
          <button
            type="submit"
            className="px-4 h-11 rounded-xl bg-amber-600 text-white font-bold text-sm"
          >
            Use Note
          </button>
        </form>

        <div className="border-t border-stone-100 pt-3 space-y-2.5">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Or pick from Recipe Box..."
            className="w-full h-10 px-3.5 rounded-xl bg-stone-50 border border-stone-200 text-sm font-semibold"
          />
          <div className="max-h-64 overflow-y-auto space-y-2">
            {shown.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelectRecipe(r.id)}
                className="w-full p-2.5 rounded-2xl border border-stone-200 hover:bg-amber-50 flex items-center gap-3 text-left transition"
              >
                {r.imageUrl ? (
                  <img
                    src={r.imageUrl}
                    alt={r.title}
                    className="w-12 h-12 rounded-xl object-cover shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-stone-100 flex items-center justify-center shrink-0">
                    <ChefHat className="w-5 h-5 text-stone-400" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-slate-800 truncate">{r.title}</div>
                  <div className="text-xs text-stone-400">
                    {r.ingredients.length} ingredients
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};


const ImportRecipeModal: React.FC<{
  geminiReady: boolean;
  onClose: () => void;
  onImported: (recipe?: Recipe) => void;
}> = ({ geminiReady, onClose, onImported }) => {
  const [mode, setMode] = useState<'url' | 'ai' | 'json'>('url');
  const [url, setUrl] = useState('');
  const [aiQuery, setAiQuery] = useState('');
  const [aiResults, setAiResults] = useState<
    Array<Omit<Recipe, 'id' | 'createdAt'> & { site?: string; alreadySaved?: boolean }>
  >([]);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [savingPreview, setSavingPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleUrlExtract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError('');
    try {
      const rec = await apiFetch<Recipe>('/api/meals/recipes/import-url', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim() }),
      });
      onImported(rec);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setBusy(false);
    }
  };

  const handleAiSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuery.trim()) return;
    setBusy(true);
    setError('');
    try {
      const found = await apiFetch<Array<Omit<Recipe, 'id' | 'createdAt'>>>(
        '/api/meals/recipes/search-ai',
        {
          method: 'POST',
          body: JSON.stringify({ query: aiQuery.trim() }),
        }
      );
      setAiResults(found);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI search failed');
    } finally {
      setBusy(false);
    }
  };

  const saveAiResult = async (item: Omit<Recipe, 'id' | 'createdAt'>) => {
    const saved = await apiFetch<Recipe>('/api/meals/recipes', {
      method: 'POST',
      body: JSON.stringify(item),
    });
    onImported(saved);
  };

  const handleJsonFile = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const txt = await file.text();
      await apiFetch('/api/meals/recipes/import-json', {
        method: 'POST',
        body: txt,
      });
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON file');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-start md:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-2xl w-full p-6 space-y-4 my-6">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-extrabold text-slate-800">
            Import & Discover Clean Recipes
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2 bg-stone-100 p-1 rounded-2xl">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`flex-1 h-10 min-h-[40px] py-2 rounded-xl text-sm font-bold flex items-center justify-center ${
              mode === 'url' ? 'bg-white shadow-xs text-slate-900' : 'text-stone-600'
            }`}
          >
            🌐 Strip Recipe Website URL
          </button>
          <button
            type="button"
            onClick={() => setMode('ai')}
            className={`flex-1 h-10 min-h-[40px] py-2 rounded-xl text-sm font-bold flex items-center justify-center ${
              mode === 'ai' ? 'bg-white shadow-xs text-slate-900' : 'text-stone-600'
            }`}
          >
            ✨ Gemini Meal Search
          </button>
          <button
            type="button"
            onClick={() => setMode('json')}
            className={`flex-1 h-10 min-h-[40px] py-2 rounded-xl text-sm font-bold flex items-center justify-center ${
              mode === 'json' ? 'bg-white shadow-xs text-slate-900' : 'text-stone-600'
            }`}
          >
            📦 JSON Meals Seed
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-semibold">
            {error}
          </div>
        )}

        {mode === 'url' && (
          <form onSubmit={handleUrlExtract} className="space-y-3">
            <p className="text-sm text-stone-500">
              Paste any recipe blog URL. Lucarne strips out all ads and life stories, caches the
              dish photo locally, and parses ingredients for your grocery list.
            </p>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.seriouseats.com/..."
                className="flex-1 h-12 px-4 rounded-2xl bg-stone-50 border border-stone-200 font-semibold text-sm"
              />
              <button
                type="submit"
                disabled={busy || !url.trim()}
                className="px-5 h-12 rounded-2xl bg-sky-600 text-white font-bold text-sm disabled:opacity-50 flex items-center gap-2"
              >
                <Globe className="w-4 h-4" />
                {busy ? 'Extracting...' : 'Extract Clean Recipe'}
              </button>
            </div>
          </form>
        )}

        {mode === 'ai' && (
          <div className="space-y-3">
            {!geminiReady && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
                Tip: Add your Gemini API Key in Settings first to enable AI Meal Discovery.
              </div>
            )}
            <p className="text-sm text-stone-500">
              Gemini finds real recipe pages; Lucarne opens each one and only shows recipes it can
              actually read, with the site's own photo, ingredients and nutrition. Nothing is made up.
            </p>
            <form onSubmit={handleAiSearch} className="flex gap-2">
              <input
                type="text"
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                placeholder="e.g. 30-minute kid-friendly sheet pan dinners..."
                className="flex-1 h-12 px-4 rounded-2xl bg-stone-50 border border-stone-200 font-semibold text-sm"
              />
              <button
                type="submit"
                disabled={busy || !aiQuery.trim()}
                className="px-5 h-12 rounded-2xl bg-sky-600 text-white font-bold text-sm disabled:opacity-50"
              >
                {busy ? 'Searching...' : 'Find Meals'}
              </button>
            </form>

            <div className="space-y-2.5 max-h-64 overflow-y-auto">
              {aiResults.map((r, i) => (
                <div
                  key={i}
                  className="p-3 rounded-2xl border border-stone-200 bg-stone-50 flex items-center justify-between gap-3"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewIdx(i)}
                    className="flex items-center gap-3 text-left min-w-0 flex-1 min-h-[40px] rounded-xl hover:bg-white/70 transition -m-1 p-1"
                    aria-label={`Preview ${r.title}`}
                  >
                    <span className="w-14 h-14 shrink-0 rounded-xl overflow-hidden bg-gradient-to-br from-amber-100 to-rose-100 flex items-center justify-center text-2xl" aria-hidden>
                      {r.imageUrl ? (
                        <img src={r.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        r.emoji || '🍽️'
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-extrabold text-slate-800 truncate">{r.title}</span>
                      <span className="block text-xs text-stone-500 truncate">{r.description}</span>
                      <span className="flex flex-wrap gap-x-3 text-[11px] font-bold text-stone-500 mt-0.5">
                        {r.nutrition?.calories != null && <span>🔥 {r.nutrition.calories} kcal</span>}
                        {(r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) > 0 && (
                          <span>⏱ {formatMinutes((r.prepMinutes ?? 0) + (r.cookMinutes ?? 0))}</span>
                        )}
                        {r.servings ? <span>👥 serves {r.servings}</span> : null}
                        {r.site && <span className="text-stone-400 font-semibold">{r.site}</span>}
                        {r.alreadySaved && <span className="text-emerald-600">✓ saved</span>}
                        <span className="text-sky-600">Tap for details</span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => saveAiResult(r)}
                    disabled={r.alreadySaved}
                    className="h-10 min-h-[40px] px-4 py-2 rounded-xl bg-emerald-600 disabled:bg-stone-300 text-white font-bold text-xs shrink-0 flex items-center justify-center"
                  >
                    {r.alreadySaved ? 'Saved' : 'Save Recipe'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {previewIdx !== null && aiResults[previewIdx] && (
          <RecipePreviewModal
            recipe={aiResults[previewIdx]}
            saving={savingPreview}
            onClose={() => setPreviewIdx(null)}
            onSave={async () => {
              setSavingPreview(true);
              try {
                await saveAiResult(aiResults[previewIdx]);
                setPreviewIdx(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not save recipe');
              } finally {
                setSavingPreview(false);
              }
            }}
          />
        )}

        {mode === 'json' && (
          <div className="space-y-3">
            <p className="text-sm text-stone-500">
              Upload your JSON meals seed file. Supports arrays or objects (`meals` / `recipes`)
              and automatically normalizes ingredients into grocery aisles. Recipes already in your
              library are skipped.
            </p>
            <p className="text-xs text-stone-400">
              Format and example:{' '}
              <a
                href="https://github.com/el-dud3rino/Lucarne/blob/main/examples/meals.sample.json"
                target="_blank"
                rel="noreferrer"
                className="underline font-semibold text-sky-600"
              >
                examples/meals.sample.json
              </a>{' '}
              (field reference in the README).
            </p>
            <label className="block border-2 border-dashed border-stone-300 hover:border-sky-500 rounded-2xl p-8 text-center cursor-pointer bg-stone-50 transition">
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleJsonFile(f);
                }}
                className="hidden"
              />
              <span className="font-extrabold text-sky-600">
                {busy ? 'Importing...' : 'Tap to choose meals .json file'}
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};

const SendMealsToGroceriesModal: React.FC<{
  ingredients: Array<RecipeIngredient & { recipeTitle: string; key: string }>;
  listId: string;
  onClose: () => void;
  onDone: () => void;
}> = ({ ingredients, listId, onClose, onDone }) => {
  const aggregated = useMemo(() => {
    return aggregateIngredients(ingredients);
  }, [ingredients]);

  const [selectedNames, setSelectedNames] = useState<Set<string>>(
    () => new Set(aggregated.map((i) => i.name))
  );
  const [sending, setSending] = useState(false);

  const handleConfirm = async () => {
    setSending(true);
    const chosen = aggregated.filter((i) => selectedNames.has(i.name));
    await apiFetch('/api/meals/send-to-groceries', {
      method: 'POST',
      body: JSON.stringify({
        listId,
        items: chosen.map((a) => ({
          name: a.name,
          quantity: a.quantity,
          category: a.category,
          recipeTitle: a.sourceMeals.join(', '),
        })),
      }),
    });
    setSending(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-stone-200 max-w-xl w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-extrabold text-slate-800">
              Send Planned Meals to Groceries
            </h3>
            <p className="text-xs text-stone-500">
              Pre-aggregated quantities across planned meals. Uncheck any staples you already have.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-stone-100 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
          {aggregated.map((agg) => {
            const checked = selectedNames.has(agg.name);
            return (
              <label
                key={agg.name}
                className="p-3 rounded-2xl border border-stone-200 flex items-center gap-3 cursor-pointer hover:bg-stone-50 transition"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selectedNames);
                    if (checked) next.delete(agg.name);
                    else next.add(agg.name);
                    setSelectedNames(next);
                  }}
                  className="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 text-[15px]">{agg.name}</span>
                    <span className="text-[11px] font-semibold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-md">
                      {agg.category}
                    </span>
                  </div>
                  {agg.sourceMeals.length > 0 && (
                    <div className="text-xs text-stone-400 truncate">
                      From: {agg.sourceMeals.join(', ')}
                    </div>
                  )}
                </div>
                {agg.quantity && (
                  <span className="text-xs font-extrabold text-slate-700 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-xl shrink-0">
                    {agg.quantity}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-5 h-11 min-h-[40px] rounded-2xl bg-stone-100 font-bold text-slate-700 hover:bg-stone-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={sending || selectedNames.size === 0}
            onClick={handleConfirm}
            className="px-6 h-11 min-h-[40px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm disabled:opacity-50"
          >
            {sending ? 'Adding...' : `Add ${selectedNames.size} Items to Groceries`}
          </button>
        </div>
      </div>
    </div>
  );
};
