import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  ShoppingCart,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import type { Recipe } from '../../shared/types.js';

export interface CookModeViewProps {
  recipe: Recipe;
  defaultListId: string;
  onClose: () => void;
  onDelete?: () => void;
}

interface ActiveTimer {
  id: string;
  label: string;
  totalSec: number;
  remainingSec: number;
  isRunning: boolean;
}

// Play pleasant 4-tone kitchen chime using Web Audio API (C5 -> E5 -> G5 -> C6)
function playKitchenChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const runChime = () => {
      try {
        const now = ctx.currentTime;
        const freqs = [523.25, 659.25, 783.99, 1046.5];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.16);
          gain.gain.setValueAtTime(0.3, now + idx * 0.16);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.16 + 0.35);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.16);
          osc.stop(now + idx * 0.16 + 0.35);
        });
        // Schedule audio context closure after all 4 tones finish (total duration ~0.83s)
        setTimeout(() => {
          ctx.close().catch(() => {});
        }, 1200);
      } catch {
        ctx.close().catch(() => {});
      }
    };

    if (ctx.state === 'suspended') {
      ctx.resume().then(runChime).catch(() => {
        ctx.close().catch(() => {});
      });
    } else {
      runChime();
    }
  } catch {
    // Web Audio blocked or unsupported
  }
}

// Detect duration in instruction string
function detectStepTimer(text: string): { label: string; seconds: number } | null {
  // Check compound duration first: e.g. "1 hour and 30 minutes" or "1 hr 15 mins"
  const compoundMatch = text.match(
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:and\s+)?(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)/i
  );
  if (compoundMatch) {
    const hrs = Number(compoundMatch[1]);
    const mins = Number(compoundMatch[2]);
    if (!Number.isNaN(hrs) && !Number.isNaN(mins)) {
      const seconds = Math.round(hrs * 3600 + mins * 60);
      const displayTime = mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
      return {
        label: `${displayTime} Timer`,
        seconds,
      };
    }
  }

  // Single duration pattern: e.g. "for 25 minutes", "simmer 45 seconds", "bake for 1-2 hours"
  const match = text.match(
    /(?:bake|cook|simmer|boil|roast|fry|rest|chill|marinate|heat|wait|let\s+stand)?\s*(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(\d+(?:\.\d+)?)?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)/i
  );
  if (!match) return null;

  const rawNum = match[2] ? Number(match[2]) : Number(match[1]);
  if (!rawNum || Number.isNaN(rawNum)) return null;

  const unit = match[3].toLowerCase();
  let seconds = Math.round(rawNum * 60);
  if (unit.startsWith('h')) seconds = Math.round(rawNum * 3600);
  else if (unit.startsWith('s')) seconds = Math.round(rawNum);

  let displayTime = '';
  if (seconds < 60) {
    displayTime = `${seconds} sec`;
  } else if (seconds >= 3600) {
    const hrs = Math.floor(seconds / 3600);
    const remMins = Math.round((seconds % 3600) / 60);
    displayTime = remMins > 0 ? `${hrs} hr ${remMins} min` : `${hrs} hr`;
  } else {
    displayTime = `${Math.round(seconds / 60)} min`;
  }

  return {
    label: `${displayTime} Timer`,
    seconds,
  };
}

export const CookModeView: React.FC<CookModeViewProps> = ({
  recipe,
  defaultListId,
  onClose,
  onDelete,
}) => {
  const queryClient = useQueryClient();
  const [checkedIngs, setCheckedIngs] = useState<Set<number>>(new Set());
  const [doneSteps, setDoneSteps] = useState<Set<number>>(new Set());
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [viewMode, setViewMode] = useState<'focused' | 'overview'>('focused');
  const [pushedToast, setPushedToast] = useState(false);
  const [activeTimers, setActiveTimers] = useState<ActiveTimer[]>([]);

  // Keep screen awake during Cook Mode with automatic re-acquisition on visibilitychange
  useEffect(() => {
    let isMounted = true;
    let lock: {
      release: () => Promise<void>;
      addEventListener?: (ev: string, cb: () => void) => void;
    } | null = null;

    const requestLock = async () => {
      if (
        typeof document === 'undefined' ||
        document.visibilityState !== 'visible' ||
        typeof navigator === 'undefined' ||
        !('wakeLock' in navigator)
      ) {
        return;
      }
      try {
        const sentinel = await (
          navigator as unknown as {
            wakeLock: {
              request: (t: string) => Promise<{
                release: () => Promise<void>;
                addEventListener?: (ev: string, cb: () => void) => void;
              }>;
            };
          }
        ).wakeLock.request('screen');

        if (!isMounted) {
          sentinel.release().catch(() => {});
          return;
        }

        lock = sentinel;
        sentinel.addEventListener?.('release', () => {
          if (lock === sentinel) {
            lock = null;
          }
        });
      } catch {
        // Wake lock request rejected or unsupported
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !lock) {
        requestLock();
      }
    };

    requestLock();

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      isMounted = false;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (lock) {
        lock.release().catch(() => {});
        lock = null;
      }
    };
  }, []);

  // Interval timer engine
  useEffect(() => {
    const hasRunning = activeTimers.some((t) => t.isRunning && t.remainingSec > 0);
    if (!hasRunning) return;

    const interval = setInterval(() => {
      setActiveTimers((prev) =>
        prev.map((t) => {
          if (!t.isRunning || t.remainingSec <= 0) return t;
          const nextSec = t.remainingSec - 1;
          if (nextSec === 0) {
            playKitchenChime();
          }
          return {
            ...t,
            remainingSec: nextSec,
            isRunning: nextSec > 0,
          };
        })
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTimers]);

  const pushToGroceries = async () => {
    await apiFetch('/api/meals/send-to-groceries', {
      method: 'POST',
      body: JSON.stringify({
        listId: defaultListId,
        items: recipe.ingredients.map((i) => ({ ...i, recipeTitle: recipe.title })),
      }),
    });
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    setPushedToast(true);
    setTimeout(() => setPushedToast(false), 2500);
  };

  const steps = recipe.instructions || [];
  const currentStep = steps[currentStepIdx] || '';
  const detectedTimer = useMemo(() => detectStepTimer(currentStep), [currentStep]);

  const startTimer = (label: string, seconds: number) => {
    const id = `timer-${Date.now()}`;
    setActiveTimers((prev) => [
      ...prev,
      {
        id,
        label,
        totalSec: seconds,
        remainingSec: seconds,
        isRunning: true,
      },
    ]);
  };

  const toggleTimer = (id: string) => {
    setActiveTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isRunning: !t.isRunning } : t))
    );
  };

  const resetTimer = (id: string) => {
    setActiveTimers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, remainingSec: t.totalSec, isRunning: false } : t))
    );
  };

  const removeTimer = (id: string) => {
    setActiveTimers((prev) => prev.filter((t) => t.id !== id));
  };

  const formatTimerDisplay = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#FAF8F5] flex flex-col overflow-x-hidden select-none">
      {/* 1. Kiosk Appliance Top Bar */}
      <header className="px-6 py-3.5 bg-white border-b border-stone-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="px-3.5 py-1.5 rounded-full bg-amber-100 text-amber-950 font-extrabold text-xs uppercase tracking-wider flex items-center gap-1.5 shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Cook Mode · Screen Awake
          </span>
          <h2 className="text-xl md:text-2xl font-extrabold text-slate-900 truncate">
            {recipe.title}
          </h2>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Mode Switcher: Focused Step vs Overview */}
          <div className="bg-stone-100 p-1 rounded-2xl flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewMode('focused')}
              className={`h-10 min-h-[40px] px-3.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === 'focused'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-stone-600 hover:text-slate-900'
              }`}
            >
              <Maximize2 className="w-4 h-4" />
              <span>Focused Step</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('overview')}
              className={`h-10 min-h-[40px] px-3.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                viewMode === 'overview'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-stone-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>Overview ({steps.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={pushToGroceries}
            className="h-11 min-h-[40px] px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center gap-2 shadow-sm transition active:scale-95"
          >
            <ShoppingCart className="w-4 h-4" />
            <span>{pushedToast ? 'Added to Groceries!' : 'Add Ingredients to Groceries'}</span>
          </button>

          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="w-11 h-11 min-w-[40px] min-h-[40px] rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 font-bold flex items-center justify-center transition"
              title="Delete recipe"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="h-11 min-h-[40px] px-5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm flex items-center gap-2 shadow-sm transition active:scale-95"
          >
            <X className="w-4 h-4" />
            <span>Exit</span>
          </button>
        </div>
      </header>

      {/* 2. Main 1080p Landscape Grid Workspace */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Left Column: Persistent Ingredients Checklist */}
        <aside className="md:col-span-4 bg-white rounded-3xl border border-stone-200/90 shadow-2xs p-5 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-stone-100 shrink-0">
            <div>
              <h3 className="text-xl font-extrabold text-slate-900">
                Ingredients ({recipe.ingredients.length})
              </h3>
              <p className="text-xs font-bold text-stone-400">
                {checkedIngs.size} of {recipe.ingredients.length} ready
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (checkedIngs.size === recipe.ingredients.length) {
                  setCheckedIngs(new Set());
                } else {
                  setCheckedIngs(new Set(recipe.ingredients.map((_, i) => i)));
                }
              }}
              className="h-10 min-h-[40px] px-3.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-xs font-bold text-slate-700 active:scale-95 transition"
            >
              {checkedIngs.size === recipe.ingredients.length ? 'Uncheck All' : 'Check All'}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto pt-3 space-y-2 pr-1">
            {recipe.ingredients.map((ing, idx) => {
              const checked = checkedIngs.has(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    const next = new Set(checkedIngs);
                    if (checked) next.delete(idx);
                    else next.add(idx);
                    setCheckedIngs(next);
                  }}
                  className={`w-full text-left p-3.5 rounded-2xl border flex items-center gap-3 transition active:scale-[0.99] ${
                    checked
                      ? 'bg-stone-50 border-stone-200 line-through text-stone-400 opacity-70'
                      : 'bg-[#FAF8F5] border-stone-200/80 hover:border-amber-300 text-slate-800'
                  }`}
                >
                  <span
                    className={`w-8 h-8 min-w-[32px] min-h-[32px] rounded-xl border-2 flex items-center justify-center shrink-0 transition ${
                      checked
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-stone-300 bg-white'
                    }`}
                  >
                    {checked && <Check className="w-5 h-5" />}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-[15px] leading-snug">{ing.name}</div>
                    {ing.notes && (
                      <div className="text-xs text-stone-500 font-normal truncate">
                        {ing.notes}
                      </div>
                    )}
                  </div>

                  {(ing.quantity || ing.unit) && (
                    <span className="text-xs font-extrabold bg-white px-2.5 py-1 rounded-xl border border-stone-200 text-slate-700 shrink-0">
                      {ing.quantity ?? ''} {ing.unit}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Right Column: Step-by-Step Cooking Workspace */}
        <main className="md:col-span-8 bg-white rounded-3xl border border-stone-200/90 shadow-2xs p-6 flex flex-col min-h-0 overflow-hidden">
          {/* Active Floating Kitchen Timers Bar */}
          {activeTimers.length > 0 && (
            <div className="mb-4 pb-4 border-b border-stone-100 flex flex-wrap gap-2.5 shrink-0">
              {activeTimers.map((t) => {
                const finished = t.remainingSec === 0;
                return (
                  <div
                    key={t.id}
                    className={`px-4 py-2 rounded-2xl border flex items-center gap-3 transition shadow-xs ${
                      finished
                        ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-400 animate-bounce'
                        : 'bg-amber-50/80 border-amber-200'
                    }`}
                  >
                    <Clock
                      className={`w-5 h-5 ${
                        finished ? 'text-rose-600 animate-spin' : 'text-amber-600'
                      }`}
                    />
                    <div>
                      <div className="text-xs font-bold text-stone-500">{t.label}</div>
                      <div
                        className={`text-xl font-extrabold tabular-nums leading-none ${
                          finished ? 'text-rose-600' : 'text-slate-900'
                        }`}
                      >
                        {finished ? 'Timer Done! 🔔' : formatTimerDisplay(t.remainingSec)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-1">
                      {!finished && (
                        <button
                          type="button"
                          onClick={() => toggleTimer(t.id)}
                          className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-white hover:bg-stone-50 border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95 transition"
                          title={t.isRunning ? 'Pause' : 'Start'}
                        >
                          {t.isRunning ? (
                            <Pause className="w-4 h-4" />
                          ) : (
                            <Play className="w-4 h-4 ml-0.5" />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => resetTimer(t.id)}
                        className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-white hover:bg-stone-50 border border-stone-200 flex items-center justify-center text-slate-700 active:scale-95 transition"
                        title="Reset"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTimer(t.id)}
                        className="w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl bg-white hover:bg-rose-50 border border-stone-200 flex items-center justify-center text-stone-400 hover:text-rose-600 active:scale-95 transition"
                        title="Dismiss"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* VIEW MODE 1: Focused Step (6-Foot High-Contrast Appliance Typography) */}
          {viewMode === 'focused' && (
            <div className="flex-1 flex flex-col justify-between min-h-0">
              {/* Step Counter & Progress Track */}
              <div className="space-y-3 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-10 h-10 rounded-2xl bg-amber-500 text-white font-extrabold text-lg flex items-center justify-center shadow-xs">
                      {currentStepIdx + 1}
                    </span>
                    <span className="text-lg font-extrabold text-slate-700">
                      Step {currentStepIdx + 1} of {steps.length}
                    </span>
                  </div>

                  {/* Auto-detected timer prompt chip */}
                  {detectedTimer && (
                    <button
                      type="button"
                      onClick={() => startTimer(detectedTimer.label, detectedTimer.seconds)}
                      className="h-10 min-h-[40px] px-4 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-900 font-bold text-xs flex items-center gap-2 shadow-2xs active:scale-95 transition"
                    >
                      <Clock className="w-4 h-4 text-amber-600" />
                      <span>Start Step Timer ({detectedTimer.label})</span>
                    </button>
                  )}
                </div>

                <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
                  <div
                    style={{
                      width: `${Math.round(((currentStepIdx + 1) / (steps.length || 1)) * 100)}%`,
                    }}
                    className="h-full bg-amber-500 rounded-full transition-all duration-300"
                  />
                </div>
              </div>

              {/* 6-Foot Readable Instruction Display */}
              <div className="flex-1 flex items-center justify-center p-6 my-4 overflow-y-auto bg-stone-50/60 rounded-3xl border border-stone-200/70">
                <p className="text-2xl md:text-3xl lg:text-4xl font-semibold leading-relaxed text-slate-800 text-center max-w-3xl">
                  {currentStep}
                </p>
              </div>

              {/* Navigation Controls (>=48px touch targets) */}
              <div className="flex items-center justify-between gap-4 pt-2 shrink-0">
                <button
                  type="button"
                  disabled={currentStepIdx === 0}
                  onClick={() => setCurrentStepIdx((i) => Math.max(0, i - 1))}
                  className="h-14 min-h-[48px] px-6 rounded-2xl bg-stone-100 hover:bg-stone-200 text-slate-700 font-extrabold text-base flex items-center gap-2 disabled:opacity-30 disabled:pointer-events-none transition active:scale-95"
                >
                  <ChevronLeft className="w-6 h-6" />
                  <span>Previous</span>
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Set(doneSteps);
                      if (next.has(currentStepIdx)) next.delete(currentStepIdx);
                      else next.add(currentStepIdx);
                      setDoneSteps(next);
                    }}
                    className={`h-14 min-h-[48px] px-6 rounded-2xl font-extrabold text-base flex items-center gap-2.5 transition active:scale-95 border ${
                      doneSteps.has(currentStepIdx)
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-white border-stone-200 text-slate-700 hover:bg-stone-50'
                    }`}
                  >
                    <Check
                      className={`w-6 h-6 ${
                        doneSteps.has(currentStepIdx) ? 'text-emerald-600' : 'text-stone-400'
                      }`}
                    />
                    <span>{doneSteps.has(currentStepIdx) ? 'Completed!' : 'Mark Done'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={currentStepIdx === steps.length - 1}
                    onClick={() => {
                      const nextDone = new Set(doneSteps);
                      nextDone.add(currentStepIdx);
                      setDoneSteps(nextDone);
                      setCurrentStepIdx((i) => Math.min(steps.length - 1, i + 1));
                    }}
                    className="h-14 min-h-[48px] px-8 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-extrabold text-base flex items-center gap-2 shadow-md disabled:opacity-30 disabled:pointer-events-none transition active:scale-95"
                  >
                    <span>Next Step</span>
                    <ChevronRight className="w-6 h-6" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* VIEW MODE 2: Overview of All Steps */}
          {viewMode === 'overview' && (
            <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
              {steps.map((step, idx) => {
                const done = doneSteps.has(idx);
                const stepTimer = detectStepTimer(step);

                return (
                  <div
                    key={idx}
                    onClick={() => {
                      setCurrentStepIdx(idx);
                      setViewMode('focused');
                    }}
                    className={`p-5 rounded-2xl border flex gap-4 cursor-pointer transition ${
                      done
                        ? 'bg-stone-50 border-stone-200 opacity-60'
                        : 'bg-[#FAF8F5] border-stone-200/90 hover:border-amber-400 hover:bg-amber-50/30'
                    }`}
                  >
                    <span
                      className={`w-10 h-10 rounded-2xl font-extrabold text-base flex items-center justify-center shrink-0 ${
                        done ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-white shadow-xs'
                      }`}
                    >
                      {done ? <Check className="w-5 h-5" /> : idx + 1}
                    </span>

                    <div className="flex-1 min-w-0 space-y-2">
                      <p className="text-lg leading-relaxed font-medium text-slate-800">{step}</p>
                      {stepTimer && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            startTimer(stepTimer.label, stepTimer.seconds);
                          }}
                          className="h-10 min-h-[40px] px-3.5 rounded-xl bg-white border border-stone-200 hover:border-amber-400 text-xs font-bold text-slate-700 flex items-center gap-1.5 shadow-2xs active:scale-95 transition"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>Start {stepTimer.label}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
