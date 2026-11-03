import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { broadcastInvalidate } from '../sse.js';
import { normalizeNutrition } from '../../shared/nutrition.js';
import { classifyQuotaError, GeminiUsage, nextPacificMidnight, type UsageSnapshot } from './geminiQuota.js';
import { GoogleGenAI, Type, type GenerateContentParameters } from '@google/genai';
import { db, MEDIA_RECIPES_DIR, runTransaction } from '../db/connection.js';
import { classifyGroceryItem } from '../../shared/groceryClassifier.js';
import { parseFractionNumber } from '../../shared/ingredientAggregator.js';
import {
  GROCERY_CATEGORIES,
  type GroceryCategory,
  type Recipe,
  type RecipeIngredient,
} from '../../shared/types.js';

// ---- Gemini model selection ----
// Google retires model versions regularly (gemini-2.5-flash was retired for new users in 2026), so
// instead of hard-coding one, use GEMINI_MODEL if set, else the newest stable "gemini-<ver>-flash".
const FALLBACK_GEMINI_MODEL = 'gemini-flash-latest';
const FALLBACK_LITE_MODEL = 'gemini-flash-lite-latest';
const MAX_MODELS_TO_TRY = 5;
const BUSY_COOLDOWN_MS = 10 * 60_000; // overloaded / timed out: try it last for a while
const MINUTE_QUOTA_BACKOFF_MS = 65_000;

/**
 * light = short, simple jobs (suggesting recipe links, tidying ingredient lists): Flash-Lite first
 *         (free tier: 15/min, 500/day).
 * heavy = reading a whole recipe page: full Flash first (free tier: only 5/min, 20/day).
 */
export type GeminiTask = 'light' | 'heavy';

let cachedModelNames: string[] | null = null;
const retiredGeminiModels = new Set<string>();
const busyUntil = new Map<string, number>(); // 503 / timeouts: deprioritised
const quotaBlockedUntil = new Map<string, number>(); // Google said 429: skipped entirely until then
const lastGoodModel: Record<GeminiTask, string | null> = { light: null, heavy: null };

let usage: GeminiUsage | null = null;
function geminiUsage(): GeminiUsage {
  if (!usage) {
    usage = new GeminiUsage({
      load: () => {
        try {
          const row = db.prepare("SELECT value FROM app_settings WHERE key = 'geminiUsage'").get() as
            | { value: string }
            | undefined;
          return row ? (JSON.parse(row.value) as UsageSnapshot) : null;
        } catch {
          return null;
        }
      },
      save: (snap) => {
        try {
          db.prepare(
            "INSERT INTO app_settings (key, value) VALUES ('geminiUsage', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
          ).run(JSON.stringify(snap));
        } catch {
          // usage tracking is best effort
        }
      },
    });
  }
  return usage;
}

/** Thrown when every candidate model is out of quota; message says when it resets. */
export class GeminiQuotaError extends Error {}

function formatResetTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * Order to try models in: the model that last worked for this kind of task, then healthy models in
 * preference order, then models still cooling down after being busy. Retired models and models that
 * are out of quota (blockedUntil in the future) are left out entirely.
 */
export function orderGeminiModels(
  ranked: string[],
  opts: {
    lastGood?: string | null;
    busyUntil?: Map<string, number>;
    blockedUntil?: (model: string) => number;
    retired?: Set<string>;
    now?: number;
    max?: number;
  }
): string[] {
  const now = opts.now ?? Date.now();
  const retired = opts.retired ?? new Set<string>();
  const busy = opts.busyUntil ?? new Map<string, number>();
  const blocked = opts.blockedUntil ?? (() => 0);
  const usable = [...new Set(ranked)].filter((m) => !retired.has(m) && blocked(m) <= now);
  const isBusy = (m: string) => (busy.get(m) ?? 0) > now;
  const ordered = [...usable.filter((m) => !isBusy(m)), ...usable.filter(isBusy)];
  if (opts.lastGood && ordered.includes(opts.lastGood) && !isBusy(opts.lastGood)) {
    ordered.splice(ordered.indexOf(opts.lastGood), 1);
    ordered.unshift(opts.lastGood);
  }
  return ordered.slice(0, opts.max ?? MAX_MODELS_TO_TRY);
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function rankByVersion(names: string[], pattern: RegExp, exclude: Set<string>): string[] {
  const found = new Map<string, number[]>();
  for (const raw of names) {
    const name = raw.replace(/^models\//, '');
    const m = name.match(pattern);
    if (!m || exclude.has(name)) continue;
    found.set(name, m[1].split('.').map(Number));
  }
  return [...found.entries()].sort((x, y) => compareVersions(y[1], x[1])).map(([name]) => name);
}

/** Stable "gemini-<version>-flash" models, newest first (no -lite/-preview/-exp variants). */
export function rankFlashModels(names: string[], exclude: Set<string> = new Set()): string[] {
  return rankByVersion(names, /^gemini-(\d+(?:\.\d+)*)-flash$/, exclude);
}

/** Stable "gemini-<version>-flash-lite" models, newest first. */
export function rankLiteModels(names: string[], exclude: Set<string> = new Set()): string[] {
  return rankByVersion(names, /^gemini-(\d+(?:\.\d+)*)-flash-lite$/, exclude);
}

export function pickNewestFlashModel(names: string[], exclude: Set<string> = new Set()): string | null {
  return rankFlashModels(names, exclude)[0] ?? null;
}

function modelBlockedUntil(model: string, now = Date.now()): number {
  return Math.max(quotaBlockedUntil.get(model) ?? 0, geminiUsage().blockedUntil(model, now));
}

/** Models to try for a task, in order. Throws GeminiQuotaError if all are out of quota right now. */
async function resolveGeminiModels(ai: GoogleGenAI, task: GeminiTask = 'heavy'): Promise<string[]> {
  const pinned = (process.env.GEMINI_MODEL || '').trim();
  if (pinned) return [pinned];
  if (!cachedModelNames) {
    try {
      const names: string[] = [];
      const pager = await ai.models.list();
      for await (const model of pager) {
        if (model.name && (!model.supportedActions || model.supportedActions.includes('generateContent'))) {
          names.push(model.name);
        }
      }
      cachedModelNames = names;
    } catch {
      cachedModelNames = [];
    }
  }
  const flash = rankFlashModels(cachedModelNames);
  const lite = rankLiteModels(cachedModelNames);
  const flashList = flash.length > 0 ? flash : [FALLBACK_GEMINI_MODEL];
  const liteList = lite.length > 0 ? lite : [FALLBACK_LITE_MODEL];
  // Only MAX_MODELS_TO_TRY get a turn, so make sure the other tier's best model is among them:
  // when every recent Flash model is overloaded, Lite is often still answering (and vice versa).
  const withFallback = (primary: string[], fallback: string[]) => [
    ...primary.slice(0, MAX_MODELS_TO_TRY - 1),
    ...fallback.slice(0, 1),
    ...primary.slice(MAX_MODELS_TO_TRY - 1),
    ...fallback.slice(1),
  ];
  const ranked = task === 'light' ? withFallback(liteList, flashList) : withFallback(flashList, liteList);

  const now = Date.now();
  const list = orderGeminiModels(ranked, {
    lastGood: lastGoodModel[task],
    busyUntil,
    blockedUntil: (m) => modelBlockedUntil(m, now),
    retired: retiredGeminiModels,
    now,
  });
  if (list.length === 0) {
    const soonest = Math.min(...ranked.filter((m) => !retiredGeminiModels.has(m)).map((m) => modelBlockedUntil(m, now)));
    const daily = soonest >= nextPacificMidnight(now) - 60_000;
    throw new GeminiQuotaError(
      daily
        ? `Gemini's free daily limit is used up for today. It resets at ${formatResetTime(soonest)} (midnight Pacific).`
        : `Gemini's free per-minute limit is reached. Try again at ${formatResetTime(soonest)}.`
    );
  }
  return list;
}

function isModelUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no longer available|is not found|not supported for generateContent|"code":\s*404/i.test(msg);
}


function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /"code":\s*(429|500|503|504)|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|high demand|overloaded|timed? ?out|aborted/i.test(msg);
}

/** Short, human message for Gemini failures (instead of Google's raw JSON). */
export function describeGeminiError(err: unknown): string {
  if (err instanceof GeminiQuotaError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  const quota = classifyQuotaError(err);
  if (quota === 'day') {
    return `Gemini's free daily limit is used up. It resets at ${formatResetTime(nextPacificMidnight(Date.now()))} (midnight Pacific).`;
  }
  if (quota === 'minute') return "Gemini's free per-minute limit was reached. Try again in a minute.";
  if (/high demand|overloaded|UNAVAILABLE|DEADLINE_EXCEEDED|timed? ?out|aborted|"code":\s*(503|504)/i.test(msg)) {
    return 'Gemini is busy right now (Google reports high demand). Try again in a minute.';
  }
  if (/RESOURCE_EXHAUSTED|"code":\s*429|quota/i.test(msg)) {
    return 'Gemini rate limit or free-tier quota reached. Wait a bit and try again.';
  }
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|"code":\s*(401|403)/i.test(msg)) {
    return 'Gemini rejected the API key. Check the Gemini key in Settings or GEMINI_API_KEY in .env.';
  }
  if (isModelUnavailable(err)) {
    return 'The Gemini model is no longer available. Remove GEMINI_MODEL from .env to let Lucarne pick the current one.';
  }
  const inner = msg.match(/"message":\s*"([^"]+)"/)?.[1];
  return `Gemini error: ${(inner || msg).slice(0, 200)}`;
}

const GEMINI_TOTAL_BUDGET_MS = 90_000; // whole request, across retries and model fallbacks

function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /DEADLINE_EXCEEDED|timed? ?out|aborted|AbortError|"code":\s*504/i.test(msg);
}

const HEDGE_AFTER_MS = 8_000; // no response yet -> also start the next model
// A model that hasn't started answering by now is treated as stuck, but only while another model is
// left to try: under heavy load a working model can take 15-30 s to start, and waiting beats failing.
const FIRST_CHUNK_TIMEOUT_MS = 30_000;
const MAX_IN_FLIGHT = 2;

export interface RaceOptions {
  hedgeAfterMs?: number;
  firstChunkTimeoutMs?: number;
  deadline?: number;
  maxInFlight?: number;
  onSuccess?: (model: string) => void;
  onBusy?: (model: string, err: unknown) => void;
  onRetired?: (model: string) => void;
  isRetired?: (err: unknown) => boolean;
  isTransient?: (err: unknown) => boolean;
}

/**
 * Tries models in order, "hedging" slow starts: if the running model hasn't started answering
 * (no first streamed chunk) within hedgeAfterMs, the next model starts too, and the first one to
 * finish wins; the others are cancelled. Healthy models start streaming in ~1-2 s, so normally
 * only one request is made. A failed model is replaced by the next one immediately.
 *
 * `attempt(model, signal, onFirstChunk)` must honour `signal` and call onFirstChunk when output starts.
 */
export function raceGeminiModels<T>(
  models: string[],
  attempt: (model: string, signal: AbortSignal, onFirstChunk: () => void) => Promise<T>,
  opts: RaceOptions = {}
): Promise<T> {
  const hedgeAfterMs = opts.hedgeAfterMs ?? HEDGE_AFTER_MS;
  const firstChunkTimeoutMs = opts.firstChunkTimeoutMs ?? FIRST_CHUNK_TIMEOUT_MS;
  const deadline = opts.deadline ?? Date.now() + GEMINI_TOTAL_BUDGET_MS;
  const maxInFlight = opts.maxInFlight ?? MAX_IN_FLIGHT;
  const isRetired = opts.isRetired ?? isModelUnavailable;
  const isTransient = opts.isTransient ?? isTransientGeminiError;

  return new Promise<T>((resolve, reject) => {
    let next = 0;
    let settled = false;
    let lastErr: unknown = new Error('No Gemini model available');
    const running = new Map<string, { ctrl: AbortController; started: boolean; timers: NodeJS.Timeout[] }>();
    const overall = setTimeout(() => finishFail(new Error('Gemini request timed out')), Math.max(0, deadline - Date.now()));

    const cleanup = () => {
      clearTimeout(overall);
      for (const r of running.values()) {
        r.timers.forEach(clearTimeout);
        r.ctrl.abort();
      }
      running.clear();
    };
    const finishFail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const maybeAllFailed = () => {
      if (!settled && running.size === 0 && next >= models.length) finishFail(lastErr);
    };

    const launch = () => {
      if (settled || next >= models.length || running.size >= maxInFlight) return maybeAllFailed();
      if (deadline - Date.now() < 3000) return maybeAllFailed();
      const model = models[next++];
      const ctrl = new AbortController();
      const entry = { ctrl, started: false, timers: [] as NodeJS.Timeout[] };
      running.set(model, entry);

      // Hedge: still silent after hedgeAfterMs -> start the next model alongside.
      entry.timers.push(setTimeout(() => !entry.started && launch(), hedgeAfterMs));
      // Stuck: still silent after firstChunkTimeoutMs -> give up on it, if another model is left to try.
      // If it's the last hope it keeps going until the overall deadline.
      entry.timers.push(
        setTimeout(() => {
          if (!entry.started && next < models.length) ctrl.abort(new Error('Gemini model timed out (no response)'));
        }, firstChunkTimeoutMs)
      );

      attempt(model, ctrl.signal, () => {
        entry.started = true;
      }).then(
        (result) => {
          entry.timers.forEach(clearTimeout);
          running.delete(model);
          if (settled) return;
          settled = true;
          opts.onSuccess?.(model);
          cleanup(); // cancel the slower attempt(s)
          resolve(result);
        },
        (err) => {
          entry.timers.forEach(clearTimeout);
          running.delete(model);
          if (settled) return; // cancelled because another model already won
          lastErr = err;
          if (isRetired(err)) opts.onRetired?.(model);
          else if (isTransient(err) || ctrl.signal.aborted) opts.onBusy?.(model, err);
          else return finishFail(err); // e.g. bad key / bad request: another model won't help
          launch();
          maybeAllFailed();
        }
      );
    };

    launch();
  });
}

/**
 * Gemini generateContent with automatic model selection and hedged fallback (see raceGeminiModels),
 * within a ~90 s total budget. Retired models are remembered; busy ones rest for 10 minutes; the model
 * that last worked is tried first. Uses streaming so a healthy model is recognised within seconds.
 * Errors come back human-readable.
 */
export async function generateWithCurrentModel(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, 'model'>,
  task: GeminiTask = 'heavy'
): Promise<{ text: string; model: string }> {
  const models = await resolveGeminiModels(ai, task); // may throw GeminiQuotaError (already human-readable)
  try {
    return await raceGeminiModels(
      models,
      async (model, signal, onFirstChunk) => {
        geminiUsage().record(model);
        const stream = await ai.models.generateContentStream({
          ...params,
          model,
          config: { ...params.config, abortSignal: signal },
        });
        let text = '';
        for await (const chunk of stream) {
          if (signal.aborted) throw signal.reason ?? new Error('aborted');
          const piece = chunk.text ?? '';
          if (piece) onFirstChunk();
          text += piece;
        }
        if (!text.trim()) throw new Error('Gemini returned an empty response (high demand?)');
        return { text, model };
      },
      {
        onSuccess: (model) => {
          lastGoodModel[task] = model;
          busyUntil.delete(model);
        },
        onBusy: (model, err) => {
          const now = Date.now();
          const quota = classifyQuotaError(err);
          if (quota === 'day') {
            quotaBlockedUntil.set(model, nextPacificMidnight(now));
            geminiUsage().markDayExhausted(model, now);
          } else if (quota === 'minute') {
            quotaBlockedUntil.set(model, now + MINUTE_QUOTA_BACKOFF_MS);
          } else {
            busyUntil.set(model, now + BUSY_COOLDOWN_MS);
          }
          if (lastGoodModel[task] === model) lastGoodModel[task] = null;
        },
        onRetired: (model) => {
          retiredGeminiModels.add(model);
        },
      }
    );
  } catch (err) {
    throw new Error(describeGeminiError(err));
  }
}

export function getGeminiApiKey(): string {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = 'geminiApiKey'")
    .get() as { value: string } | undefined;
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    } catch {
      // ignore
    }
  }
  return (process.env.GEMINI_API_KEY || '').trim();
}

const UNITS = new Set([
  'cup', 'cups', 'c', 'tbsp', 'tbs', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams',
  'kg', 'ml', 'l', 'liter', 'can', 'cans', 'jar', 'jars', 'clove', 'cloves',
  'slice', 'slices', 'bunch', 'bunches', 'head', 'heads', 'pinch', 'package', 'pkg',
  'stick', 'sticks', 'quart', 'qt', 'pint', 'pt', 'gallon', 'gal',
]);

export function parseIngredientLine(raw: string): RecipeIngredient {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { name: 'Item', quantity: null, unit: '', notes: '', category: 'Other' };
  }

  // Split comma notes e.g. "2 lbs chicken breast, diced"
  const [mainPart, ...noteParts] = cleaned.split(',');
  const notes = noteParts.join(',').trim();

  // Match leading fraction, decimal, or vulgar fraction e.g. "1 1/2", "1/2", "2.5", "½", "1 ½"
  const qtyMatch = mainPart.trim().match(
    /^(\d+[-\s]+(?:\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞])|\d+[½⅓⅔¼¾⅛⅜⅝⅞]|\d+\/\d+|[½⅓⅔¼¾⅛⅜⅝⅞]|\d+(?:\.\d+)?)(?:\s+(.*))?$/
  );
  let quantity: number | null = null;
  let rest = mainPart.trim();

  if (qtyMatch) {
    const qVal = parseFractionNumber(qtyMatch[1]);
    if (qVal !== null) {
      quantity = qVal;
      rest = (qtyMatch[2] || '').trim();
    }
  } else {
    // Check if entire mainPart is a single vulgar fraction or number e.g. "½"
    const soloVal = parseFractionNumber(mainPart.trim());
    if (soloVal !== null) {
      quantity = soloVal;
      rest = '';
    }
  }

  const words = rest.split(' ').filter(Boolean);
  let unit = '';
  let name = rest;
  if (words.length > 1 && UNITS.has(words[0].toLowerCase().replace(/\.$/, ''))) {
    unit = words[0].replace(/\.$/, '');
    name = words.slice(1).join(' ').replace(/^of\s+/i, '').trim();
  }

  return {
    name: name || cleaned,
    quantity: quantity !== null ? Math.round(quantity * 100) / 100 : null,
    unit,
    notes,
    category: classifyGroceryItem(name || cleaned),
  };
}

function parseIsoDurationMinutes(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val);
  if (typeof val !== 'string') return null;
  const iso = val.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (iso && (iso[1] || iso[2])) {
    return (Number(iso[1] || 0) * 60) + Number(iso[2] || 0);
  }
  const num = val.match(/(\d+)/);
  return num ? Number(num[1]) : null;
}

export async function cacheRemoteImageLocally(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl || typeof imageUrl !== 'string' || !imageUrl.startsWith('http')) {
    return imageUrl || null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return imageUrl;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return imageUrl;

    let ext = '.jpg';
    if (contentType.includes('png')) ext = '.png';
    else if (contentType.includes('webp')) ext = '.webp';

    const filename = `${crypto.randomUUID()}${ext}`;
    const dest = path.join(MEDIA_RECIPES_DIR, filename);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 500 || buf.byteLength > 15 * 1024 * 1024) return imageUrl;
    fs.writeFileSync(dest, buf);
    return `/media/recipes/${filename}`;
  } catch {
    return imageUrl;
  }
}

function findJsonLdRecipe(node: unknown): Record<string, unknown> | null {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJsonLdRecipe(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const typeVal = obj['@type'];
    const isRecipe =
      typeVal === 'Recipe' ||
      (Array.isArray(typeVal) && typeVal.includes('Recipe'));
    if (isRecipe) return obj;
    if (obj['@graph']) {
      return findJsonLdRecipe(obj['@graph']);
    }
  }
  return null;
}

export interface ExtractOptions {
  /**
   * Preview (used to verify meal-search results): only real schema.org recipe data, no Gemini calls,
   * nothing saved to disk (image stays a remote link until the recipe is saved).
   */
  preview?: boolean;
}

export async function extractRecipeFromUrl(
  url: string,
  opts: ExtractOptions = {}
): Promise<Omit<Recipe, 'id' | 'createdAt'>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  clearTimeout(timer);
  if (!res.ok) {
    throw new Error(`Failed to fetch URL (${res.status})`);
  }
  const finalUrl = (res.url || url).split('#')[0];

  const html = await res.text();
  const $ = cheerio.load(html);

  // 1. Try schema.org/Recipe JSON-LD first (fast, deterministic, skips all life-story prose)
  let ldRecipe = null as Record<string, unknown> | null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (ldRecipe) return;
    try {
      const parsed = JSON.parse($(el).contents().text());
      ldRecipe = findJsonLdRecipe(parsed);
    } catch {
      // ignore malformed ld+json block
    }
  });

  const ogImage =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    null;

  if (ldRecipe) {
    const rawTitle = String(ldRecipe.name || $('title').text() || 'Imported Recipe').trim();
    const rawDesc = String(ldRecipe.description || '').replace(/<[^>]+>/g, '').trim();

    let heroImg: string | null = ogImage;
    const imgField = ldRecipe.image;
    if (typeof imgField === 'string') heroImg = imgField;
    else if (Array.isArray(imgField) && imgField.length > 0) {
      heroImg = typeof imgField[0] === 'string' ? imgField[0] : (imgField[0]?.url ?? ogImage);
    } else if (imgField && typeof imgField === 'object' && 'url' in imgField) {
      heroImg = String((imgField as { url: unknown }).url);
    }

    const rawIngs = Array.isArray(ldRecipe.recipeIngredient)
      ? ldRecipe.recipeIngredient.map((x) => String(x))
      : [];

    const rawSteps: string[] = [];
    const inst = ldRecipe.recipeInstructions;
    const processStepObj = (step: unknown) => {
      if (typeof step === 'string') {
        const s = step.replace(/<[^>]+>/g, '').trim();
        if (s) rawSteps.push(s);
      } else if (step && typeof step === 'object') {
        const sObj = step as Record<string, unknown>;
        if (typeof sObj.text === 'string') {
          const s = sObj.text.replace(/<[^>]+>/g, '').trim();
          if (s) rawSteps.push(s);
        } else if (typeof sObj.name === 'string' && sObj['@type'] === 'HowToStep') {
          const s = sObj.name.replace(/<[^>]+>/g, '').trim();
          if (s) rawSteps.push(s);
        }
        if (Array.isArray(sObj.itemListElement)) {
          for (const sub of sObj.itemListElement) {
            processStepObj(sub);
          }
        }
      }
    };

    if (typeof inst === 'string') {
      rawSteps.push(...inst.split(/\n+/).map((s) => s.trim()).filter(Boolean));
    } else if (Array.isArray(inst)) {
      for (const step of inst) {
        processStepObj(step);
      }
    } else if (inst && typeof inst === 'object') {
      processStepObj(inst);
    }

    const yieldVal = Array.isArray(ldRecipe.recipeYield)
      ? ldRecipe.recipeYield[0]
      : ldRecipe.recipeYield;
    const servingsMatch = String(yieldVal || '').match(/(\d+)/);

    const tags: string[] = [];
    for (const field of [ldRecipe.recipeCategory, ldRecipe.recipeCuisine]) {
      if (typeof field === 'string') tags.push(...field.split(',').map((t) => t.trim()));
      else if (Array.isArray(field)) tags.push(...field.map((t) => String(t).trim()));
    }

    // If Gemini is configured, optionally refine ingredient parsing; otherwise local parser handles it immediately
    let ingredients = rawIngs.map(parseIngredientLine);
    const apiKey = getGeminiApiKey();
    if (apiKey && rawIngs.length > 0 && !opts.preview) {
      try {
        ingredients = await normalizeIngredientsWithGemini(apiKey, rawIngs);
      } catch {
        // Fallback silently to deterministic parser
      }
    }

    const localImg = opts.preview ? heroImg || null : await cacheRemoteImageLocally(heroImg);
    return {
      title: rawTitle,
      description: rawDesc,
      imageUrl: localImg,
      sourceUrl: opts.preview ? finalUrl : url,
      prepMinutes: parseIsoDurationMinutes(ldRecipe.prepTime),
      cookMinutes: parseIsoDurationMinutes(ldRecipe.cookTime),
      servings: servingsMatch ? Number(servingsMatch[1]) : 4,
      tags: Array.from(new Set(tags.filter(Boolean))).slice(0, 6),
      ingredients,
      instructions: rawSteps.filter(Boolean),
      favorite: false,
      nutrition: normalizeNutrition(ldRecipe.nutrition),
    };
  }

  // 2. Fallback: Clean DOM text + Gemini structured extraction for non-JSON-LD sites
  if (opts.preview) throw new Error('No structured recipe data on this page');
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'This website does not embed structured Recipe metadata. Add a Gemini API Key in Settings to extract recipes from unstructured pages.'
    );
  }

  $('script, style, nav, footer, header, iframe, ads, .ad, .advertisement, .comments').remove();
  const pageText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 28_000);
  const extracted = await extractRecipeWithGeminiFromText(apiKey, pageText);
  const localImg = await cacheRemoteImageLocally(ogImage);

  return {
    ...extracted,
    imageUrl: localImg,
    sourceUrl: url,
    favorite: false,
  };
}

async function normalizeIngredientsWithGemini(
  apiKey: string,
  lines: string[]
): Promise<RecipeIngredient[]> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await generateWithCurrentModel(ai, {
    contents: `Parse these recipe ingredient strings into clean shopping list objects:\n${JSON.stringify(lines)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'Clean grocery item name, e.g. Chicken Breasts' },
            quantity: { type: Type.NUMBER, nullable: true },
            unit: { type: Type.STRING, description: 'Unit like lbs, cup, tbsp, or empty string' },
            notes: { type: Type.STRING, description: 'Prep notes like diced, softened, or empty string' },
            category: {
              type: Type.STRING,
              enum: GROCERY_CATEGORIES,
            },
          },
          required: ['name', 'unit', 'notes', 'category'],
        },
      },
    },
  }, 'light');

  const parsed = JSON.parse(response.text || '[]') as RecipeIngredient[];
  return parsed.map((ing) => ({
    name: ing.name || 'Ingredient',
    quantity: typeof ing.quantity === 'number' ? Math.round(ing.quantity * 100) / 100 : null,
    unit: ing.unit || '',
    notes: ing.notes || '',
    category: GROCERY_CATEGORIES.includes(ing.category)
      ? ing.category
      : classifyGroceryItem(ing.name || ''),
  }));
}

async function extractRecipeWithGeminiFromText(
  apiKey: string,
  text: string
): Promise<Omit<Recipe, 'id' | 'createdAt' | 'imageUrl' | 'sourceUrl' | 'favorite'>> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await generateWithCurrentModel(ai, {
    contents: `Extract ONLY the recipe from the webpage text below. Strip all blog stories, ads, and commentary.\n\n${text}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          prepMinutes: { type: Type.INTEGER, nullable: true },
          cookMinutes: { type: Type.INTEGER, nullable: true },
          servings: { type: Type.INTEGER, nullable: true },
          tags: { type: Type.ARRAY, items: { type: Type.STRING } },
          ingredients: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                quantity: { type: Type.NUMBER, nullable: true },
                unit: { type: Type.STRING },
                notes: { type: Type.STRING },
                category: { type: Type.STRING, enum: GROCERY_CATEGORIES },
              },
              required: ['name', 'unit', 'notes', 'category'],
            },
          },
          instructions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['title', 'description', 'tags', 'ingredients', 'instructions'],
      },
    },
  });

  return JSON.parse(response.text || '{}');
}

export interface FoundRecipe extends Omit<Recipe, 'id' | 'createdAt'> {
  /** Website the recipe came from, e.g. "budgetbytes.com" */
  site: string;
  /** True if this page is already in the recipe library */
  alreadySaved: boolean;
}

// Hosts that refused automated downloads recently; skipped for a while instead of retried.
const blockedRecipeHosts = new Map<string, number>();
const BLOCKED_HOST_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// Sites that refuse automated downloads (HTTP 403), seen while testing in Nov 2026.
const KNOWN_BLOCKING_HOSTS = [
  'allrecipes.com', 'eatingwell.com', 'thekitchn.com', 'damndelicious.net', 'therecipecritic.com',
  'themagicalslowcooker.com', 'cookieandkate.com', 'budgetbytes.com', 'simplyrecipes.com', 'seriouseats.com',
  'bonappetit.com', 'foodnetwork.com', 'delish.com', 'tasteofhome.com',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isLikelyBlocked(url: string): boolean {
  const host = hostOf(url);
  if (KNOWN_BLOCKING_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return true;
  return (blockedRecipeHosts.get(host) ?? 0) > Date.now();
}

/**
 * Food blogs that publish full recipes (with schema.org data) and run WordPress, whose public search
 * API (/wp-json/wp/v2/search) returns their real post links. This is the primary meal-search source:
 * fast, free, and every link exists, unlike URLs a model remembers (Flash-Lite invents most of them).
 */
export const RECIPE_BLOGS = [
  'www.recipetineats.com', 'pinchofyum.com', 'www.wellplated.com', 'natashaskitchen.com', 'www.gimmesomeoven.com',
  'www.twopeasandtheirpod.com', 'www.dinneratthezoo.com', 'carlsbadcravings.com', 'chefsavvy.com', 'cafedelites.com',
  'realfoodwholelife.com', 'www.loveandlemons.com', 'www.inspiredtaste.net', 'www.averiecooks.com', 'www.spendwithpennies.com',
];

/** Real recipe links for a query from the blogs' WordPress search, interleaved so results come from different sites. */
export async function wordpressRecipeLinks(
  query: string,
  opts: { fetchFn?: typeof fetch; perSite?: number; timeoutMs?: number; sites?: string[] } = {}
): Promise<Array<{ title: string; url: string }>> {
  const fetchFn = opts.fetchFn ?? fetch;
  const sites = (opts.sites ?? RECIPE_BLOGS).filter((h) => !isLikelyBlocked(`https://${h}/`));
  const perSite = await Promise.all(
    sites.map(async (host) => {
      try {
        const url =
          `https://${host}/wp-json/wp/v2/search?search=${encodeURIComponent(query)}` +
          `&per_page=${opts.perSite ?? 3}&type=post&_fields=title,url`;
        const res = await fetchFn(url, {
          headers: { Accept: 'application/json', 'User-Agent': 'Lucarne/0.1 (family meal planner)' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        });
        if (!res.ok) return [];
        const items = (await res.json()) as Array<{ title?: string; url?: string }>;
        return Array.isArray(items)
          ? items
              .filter((i) => typeof i.url === 'string' && /^https?:\/\//.test(i.url))
              .map((i) => ({ title: String(i.title || ''), url: i.url as string }))
          : [];
      } catch {
        return []; // site down / slow / not WordPress any more: just skip it
      }
    })
  );
  const out: Array<{ title: string; url: string }> = [];
  for (let i = 0; perSite.some((list) => i < list.length); i++) {
    for (const list of perSite) if (list[i]) out.push(list[i]);
  }
  return out;
}

const FILLER_WORDS = new Set([
  'easy', 'best', 'quick', 'simple', 'recipe', 'recipes', 'homemade', 'the', 'a', 'an', 'and', 'with', 'for', 'of', 'my', 'to', 'in',
]);
const normWord = (w: string) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '');
const wordsOf = (text: string) =>
  text
    .toLowerCase()
    .replace(/&#?\w+;/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !FILLER_WORDS.has(w))
    .map(normWord);

/**
 * Orders candidate links so recipes whose TITLE matches the search come first (blog search also
 * matches words buried in a post's text, e.g. "chicken tacos" finding a Cajun chicken recipe).
 * Ties keep their original order, so results still alternate between sites.
 */
export function rankByTitleMatch<T extends { title: string; url: string }>(query: string, links: T[]): T[] {
  const want = [...new Set(wordsOf(query))];
  if (want.length === 0) return links;
  const score = (l: T) => {
    const have = new Set(wordsOf(`${l.title} ${l.url.replace(/^https?:\/\/[^/]+/, '')}`));
    return want.filter((w) => have.has(w)).length / want.length;
  };
  return links
    .map((l, i) => ({ l, i, s: score(l) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.l);
}

/** Pulls {title,url} candidates out of a model reply (JSON array, possibly wrapped in prose/code fences). */
export function parseCandidateLinks(text: string): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const arr = text.match(/\[[\s\S]*\]/)?.[0];
  if (arr) {
    try {
      for (const item of JSON.parse(arr) as Array<Record<string, unknown>>) {
        if (item && typeof item.url === 'string') out.push({ title: String(item.title || ''), url: item.url.trim() });
      }
    } catch {
      // fall through to bare URL scan
    }
  }
  if (out.length === 0) {
    for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) out.push({ title: '', url: m[0] });
  }
  return out.filter((c) => /^https?:\/\//.test(c.url));
}

const CANDIDATE_PROMPT = (query: string) => `Find real, existing recipe pages on the web for: "${query}".
Prefer independent food blogs that publish full recipes, for example recipetineats.com, pinchofyum.com, loveandlemons.com, wellplated.com, inspiredtaste.net, averiecooks.com, carlsbadcravings.com, chefsavvy.com, realfoodwholelife.com.
Do not use allrecipes.com, eatingwell.com, thekitchn.com, budgetbytes.com, simplyrecipes.com, cookieandkate.com, seriouseats.com or bonappetit.com.
Reply ONLY with a JSON array of 8 objects: [{"title": "...", "url": "https://..."}], using exact page URLs you are confident exist. No commentary.`;

/** Asks Gemini for candidate recipe page links: with Google Search when the key allows it, else from its own knowledge. */
// Google Search grounding isn't always included in the free tier; after a refusal, don't spend requests on it.
let groundingBlockedUntil = 0;

async function geminiCandidateLinks(ai: GoogleGenAI, query: string): Promise<Array<{ title: string; url: string }>> {
  if (Date.now() >= groundingBlockedUntil) try {
    const model = (await resolveGeminiModels(ai, 'heavy'))[0];
    geminiUsage().record(model);
    const grounded = await ai.models.generateContent({
      model,
      contents: CANDIDATE_PROMPT(query),
      config: { tools: [{ googleSearch: {} }], httpOptions: { timeout: 30_000 } },
    });
    const fromText = parseCandidateLinks(grounded.text || '');
    const fromSources = (grounded.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web)
      .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
      .map((w) => ({ title: w.title || '', url: w.uri }));
    const merged = [...fromText, ...fromSources];
    if (merged.length > 0) return merged;
  } catch (err) {
    // Search grounding unavailable on this key/plan right now; fall back to plain suggestions.
    if (err instanceof GeminiQuotaError) throw new Error(err.message);
    groundingBlockedUntil = classifyQuotaError(err) ? nextPacificMidnight(Date.now()) : Date.now() + BUSY_COOLDOWN_MS;
  }
  // Full Flash first: Flash-Lite tends to invent recipe URLs that don't exist.
  const plain = await generateWithCurrentModel(ai, { contents: CANDIDATE_PROMPT(query) }, 'heavy');
  return parseCandidateLinks(plain.text);
}

/**
 * Meal search that only returns REAL recipes: candidate links come from food blogs' own search (and,
 * if that finds too few, from Gemini), then each page is opened with the URL importer and kept only if it really is a recipe page that can be read
 * (made-up links, non-recipe pages and sites that block downloads are dropped). Photo, ingredients,
 * steps and nutrition all come from the page itself.
 */
export async function searchOrGenerateMealsWithGemini(query: string, want = 3): Promise<FoundRecipe[]> {
  const found: FoundRecipe[] = [];
  const foundUrls = new Set<string>();
  const tried = new Set<string>();

  /** Opens each candidate page and keeps the ones that really are readable recipes. */
  const verify = async (candidates: Array<{ url: string }>) => {
    const queue = candidates
      .map((c) => c.url.split('#')[0])
      .filter((u) => {
        if (tried.has(u) || isLikelyBlocked(u)) return false;
        tried.add(u);
        return true;
      })
      .slice(0, 16);
    let next = 0;
    const worker = async () => {
      while (next < queue.length && found.length < want) {
        const url = queue[next++];
        try {
          const r = await extractRecipeFromUrl(url, { preview: true });
          if (!r.title || r.ingredients.length === 0 || r.instructions.length === 0) continue;
          if (foundUrls.has(r.sourceUrl || url)) continue;
          foundUrls.add(r.sourceUrl || url);
          const alreadySaved = Boolean(
            db.prepare('SELECT 1 FROM recipes WHERE source_url = ? OR source_url = ? LIMIT 1').get(url, r.sourceUrl || url)
          );
          if (found.length < want) found.push({ ...r, site: hostOf(r.sourceUrl || url), alreadySaved });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/\((401|403|429)\)/.test(msg)) blockedRecipeHosts.set(hostOf(url), Date.now() + BLOCKED_HOST_COOLDOWN_MS);
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
  };

  // 1. Real links from food blogs' own search (no Gemini needed, no quota used).
  // Blog search wants every word to appear, so leave out filler like "easy" or "best".
  const blogQuery = query.split(/\s+/).filter((w) => !FILLER_WORDS.has(w.toLowerCase())).join(' ') || query;
  await verify(rankByTitleMatch(query, await wordpressRecipeLinks(blogQuery)));

  // 2. Not enough? Ask Gemini for more links (also verified page by page).
  let geminiError: unknown = null;
  const apiKey = getGeminiApiKey();
  if (found.length < want && apiKey) {
    try {
      await verify(await geminiCandidateLinks(new GoogleGenAI({ apiKey }), query));
    } catch (err) {
      geminiError = err;
    }
  }

  if (found.length === 0) {
    if (geminiError) throw geminiError instanceof Error ? geminiError : new Error(String(geminiError));
    throw new Error(
      `Couldn't find recipe pages Lucarne can read for "${query}". Try different words, or paste a recipe link in the "Strip Recipe Website URL" tab.`
    );
  }
  return found;
}

/**
 * Flexible JSON Seed Importer for Phase 3:
 * Accepts `[...]`, `{ meals: [...] }`, or `{ recipes: [...] }` with flexible property names.
 */
export interface MealsImportResult {
  imported: number;
  skipped: number;
  /** Existing recipes that had no photo and got one from this file. */
  imagesAdded: number;
  ids: string[];
  /** Recipes whose image_url is a remote link that should be downloaded (see cacheRecipeImages). */
  imageIds: string[];
}

/** Downloads remote recipe images to local storage (like URL import does). Returns how many succeeded. */
export async function cacheRecipeImages(ids: string[]): Promise<number> {
  let cached = 0;
  for (const id of ids) {
    const row = db.prepare('SELECT image_url FROM recipes WHERE id = ?').get(id) as { image_url: string | null } | undefined;
    if (!row?.image_url || !row.image_url.startsWith('http')) continue;
    const local = await cacheRemoteImageLocally(row.image_url);
    if (local && local.startsWith('/media/')) {
      db.prepare('UPDATE recipes SET image_url = ? WHERE id = ?').run(local, id);
      cached++;
    }
  }
  if (cached > 0) broadcastInvalidate(['recipes']);
  return cached;
}

export function importMealsSeedJson(payload: unknown): MealsImportResult {
  let rawList: unknown[] = [];
  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.meals)) rawList = obj.meals;
    else if (Array.isArray(obj.recipes)) rawList = obj.recipes;
    else if (Array.isArray(obj.items)) rawList = obj.items;
    else rawList = [obj];
  }

  const nowIso = new Date().toISOString();
  const ids: string[] = [];
  let skipped = 0;
  let imagesAdded = 0;
  const imageIds: string[] = [];
  // Re-importing the same file must not create duplicates: match on source URL, else title.
  const existsBySource = db.prepare('SELECT id, image_url FROM recipes WHERE source_url = ? LIMIT 1');
  const existsByTitle = db.prepare('SELECT id, image_url FROM recipes WHERE lower(title) = lower(?) LIMIT 1');
  const setImage = db.prepare('UPDATE recipes SET image_url = ? WHERE id = ?');

  const insertStmt = db.prepare(`
    INSERT INTO recipes (
      id, title, description, image_url, source_url, prep_minutes, cook_minutes, servings,
      tags_json, ingredients_json, instructions_json, favorite, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  runTransaction(() => {
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const title = String(item.title || item.name || item.meal || '').trim();
      if (!title) continue;

      const description = String(item.description || item.summary || item.notes || '').trim();
      const imageUrl =
        typeof (item.imageUrl || item.image || item.photo || item.thumbnail) === 'string'
          ? String(item.imageUrl || item.image || item.photo || item.thumbnail)
          : null;
      const sourceUrl =
        typeof (item.sourceUrl || item.url || item.link) === 'string'
          ? String(item.sourceUrl || item.url || item.link)
          : null;

      const existing = (sourceUrl ? existsBySource.get(sourceUrl) : existsByTitle.get(title)) as
        | { id: string; image_url: string | null }
        | undefined;
      if (existing) {
        skipped++;
        // Fill in a missing photo on an existing recipe (never replace one it already has).
        if (!existing.image_url && imageUrl) {
          setImage.run(imageUrl, existing.id);
          imagesAdded++;
          if (imageUrl.startsWith('http')) imageIds.push(existing.id);
        }
        continue;
      }

      const prepMinutes = parseIsoDurationMinutes(item.prepMinutes ?? item.prepTime ?? item.prep_time);
      const cookMinutes = parseIsoDurationMinutes(item.cookMinutes ?? item.cookTime ?? item.cook_time);
      const servings = parseIsoDurationMinutes(item.servings ?? item.yield) ?? 4;

      let tags: string[] = [];
      if (Array.isArray(item.tags)) tags = item.tags.map((t) => String(t).trim()).filter(Boolean);
      else if (typeof item.category === 'string') tags = [item.category.trim()];

      let ingredients: RecipeIngredient[] = [];
      const rawIngs = item.ingredients ?? item.items;
      if (Array.isArray(rawIngs)) {
        ingredients = rawIngs.map((ing): RecipeIngredient => {
          if (typeof ing === 'string') return parseIngredientLine(ing);
          if (ing && typeof ing === 'object') {
            const io = ing as Record<string, unknown>;
            const name = String(io.name || io.item || io.ingredient || 'Item').trim();
            const qty =
              typeof io.quantity === 'number'
                ? io.quantity
                : typeof io.amount === 'number'
                ? io.amount
                : io.quantity
                ? Number(io.quantity) || null
                : null;
            const unit = String(io.unit || '').trim();
            const notes = String(io.notes || io.prep || '').trim();
            const cat =
              typeof io.category === 'string' &&
              GROCERY_CATEGORIES.includes(io.category as GroceryCategory)
                ? (io.category as GroceryCategory)
                : classifyGroceryItem(name);
            return { name, quantity: qty, unit, notes, category: cat };
          }
          return parseIngredientLine(String(ing));
        });
      }

      let instructions: string[] = [];
      const rawSteps = item.instructions ?? item.steps ?? item.directions;
      if (Array.isArray(rawSteps)) {
        instructions = rawSteps
          .map((s) =>
            typeof s === 'string'
              ? s.trim()
              : s && typeof s === 'object' && 'text' in s
              ? String((s as { text: unknown }).text).trim()
              : ''
          )
          .filter(Boolean);
      } else if (typeof rawSteps === 'string') {
        instructions = rawSteps
          .split(/\n+/)
          .map((s) => s.replace(/^\d+[.)]\s*/, '').trim())
          .filter(Boolean);
      }

      const id = crypto.randomUUID();
      insertStmt.run(
        id,
        title,
        description,
        imageUrl,
        sourceUrl,
        prepMinutes,
        cookMinutes,
        servings,
        JSON.stringify(tags),
        JSON.stringify(ingredients),
        JSON.stringify(instructions),
        item.favorite ? 1 : 0,
        nowIso
      );
      ids.push(id);
      const nutrition = normalizeNutrition(item.nutrition);
      if (nutrition) db.prepare('UPDATE recipes SET nutrition_json = ? WHERE id = ?').run(JSON.stringify(nutrition), id);
      if (imageUrl && imageUrl.startsWith('http')) imageIds.push(id);
    }
  });

  return { imported: ids.length, skipped, imagesAdded, ids, imageIds };
}
