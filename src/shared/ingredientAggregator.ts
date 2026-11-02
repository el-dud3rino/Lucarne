import { classifyGroceryItem } from './groceryClassifier.js';
import type {
  AggregatedIngredient,
  GroceryCategory,
  ParsedItemInput,
  RawIngredientInput,
} from './types.js';

export type { AggregatedIngredient, ParsedItemInput, RawIngredientInput };

// Canonical unit definitions
interface UnitMeta {
  canonical: string;
  pluralDisplay: string;
  invariant?: boolean;
}

const CANONICAL_UNITS: Record<string, UnitMeta> = {
  cup: { canonical: 'cup', pluralDisplay: 'cups' },
  tbsp: { canonical: 'tbsp', pluralDisplay: 'tbsp', invariant: true },
  tsp: { canonical: 'tsp', pluralDisplay: 'tsp', invariant: true },
  'fl oz': { canonical: 'fl oz', pluralDisplay: 'fl oz', invariant: true },
  gallon: { canonical: 'gallon', pluralDisplay: 'gallons' },
  quart: { canonical: 'quart', pluralDisplay: 'quarts' },
  pint: { canonical: 'pint', pluralDisplay: 'pints' },
  ml: { canonical: 'ml', pluralDisplay: 'ml', invariant: true },
  L: { canonical: 'L', pluralDisplay: 'L', invariant: true },
  lb: { canonical: 'lb', pluralDisplay: 'lbs' },
  oz: { canonical: 'oz', pluralDisplay: 'oz', invariant: true },
  g: { canonical: 'g', pluralDisplay: 'g', invariant: true },
  kg: { canonical: 'kg', pluralDisplay: 'kg', invariant: true },
  can: { canonical: 'can', pluralDisplay: 'cans' },
  clove: { canonical: 'clove', pluralDisplay: 'cloves' },
  bunch: { canonical: 'bunch', pluralDisplay: 'bunches' },
  head: { canonical: 'head', pluralDisplay: 'heads' },
  stalk: { canonical: 'stalk', pluralDisplay: 'stalks' },
  sprig: { canonical: 'sprig', pluralDisplay: 'sprigs' },
  slice: { canonical: 'slice', pluralDisplay: 'slices' },
  pkg: { canonical: 'pkg', pluralDisplay: 'pkgs' },
  pinch: { canonical: 'pinch', pluralDisplay: 'pinches' },
  dash: { canonical: 'dash', pluralDisplay: 'dashes' },
  piece: { canonical: 'piece', pluralDisplay: 'pieces' },
  bottle: { canonical: 'bottle', pluralDisplay: 'bottles' },
  jar: { canonical: 'jar', pluralDisplay: 'jars' },
  box: { canonical: 'box', pluralDisplay: 'boxes' },
  bag: { canonical: 'bag', pluralDisplay: 'bags' },
  container: { canonical: 'container', pluralDisplay: 'containers' },
  carton: { canonical: 'carton', pluralDisplay: 'cartons' },
  pack: { canonical: 'pack', pluralDisplay: 'packs' },
  packet: { canonical: 'packet', pluralDisplay: 'packets' },
  stick: { canonical: 'stick', pluralDisplay: 'sticks' },
  dozen: { canonical: 'dozen', pluralDisplay: 'dozen', invariant: true },
};

// Map of all recognized aliases and abbreviations to their canonical key
const UNIT_ALIASES: Record<string, string> = {
  // Volume
  cup: 'cup',
  cups: 'cup',
  c: 'cup',
  'c.': 'cup',
  tbsp: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbs: 'tbsp',
  tb: 'tbsp',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  ts: 'tsp',
  'fl oz': 'fl oz',
  'fl. oz.': 'fl oz',
  'fl. oz': 'fl oz',
  'fl oz.': 'fl oz',
  floz: 'fl oz',
  'fl.oz': 'fl oz',
  'fl.oz.': 'fl oz',
  'fluid ounce': 'fl oz',
  'fluid ounces': 'fl oz',
  gallon: 'gallon',
  gallons: 'gallon',
  gal: 'gallon',
  'gal.': 'gallon',
  quart: 'quart',
  quarts: 'quart',
  qt: 'quart',
  'qt.': 'quart',
  pint: 'pint',
  pints: 'pint',
  pt: 'pint',
  'pt.': 'pint',
  ml: 'ml',
  'ml.': 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  l: 'L',
  liter: 'L',
  liters: 'L',
  litre: 'L',
  litres: 'L',

  // Weight
  lb: 'lb',
  lbs: 'lb',
  'lb.': 'lb',
  pound: 'lb',
  pounds: 'lb',
  oz: 'oz',
  'oz.': 'oz',
  ounce: 'oz',
  ounces: 'oz',
  g: 'g',
  'g.': 'g',
  gram: 'g',
  grams: 'g',
  kg: 'kg',
  'kg.': 'kg',
  kilogram: 'kg',
  kilograms: 'kg',

  // Containers / Counts
  can: 'can',
  cans: 'can',
  clove: 'clove',
  cloves: 'clove',
  bunch: 'bunch',
  bunches: 'bunch',
  head: 'head',
  heads: 'head',
  stalk: 'stalk',
  stalks: 'stalk',
  sprig: 'sprig',
  sprigs: 'sprig',
  slice: 'slice',
  slices: 'slice',
  pkg: 'pkg',
  pkgs: 'pkg',
  package: 'pkg',
  packages: 'pkg',
  pack: 'pack',
  packs: 'pack',
  packet: 'packet',
  packets: 'packet',
  pinch: 'pinch',
  pinches: 'pinch',
  dash: 'dash',
  dashes: 'dash',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  bottle: 'bottle',
  bottles: 'bottle',
  jar: 'jar',
  jars: 'jar',
  box: 'box',
  boxes: 'box',
  bag: 'bag',
  bags: 'bag',
  container: 'container',
  containers: 'container',
  carton: 'carton',
  cartons: 'carton',
  stick: 'stick',
  sticks: 'stick',
  tub: 'container',
  tubs: 'container',
  dozen: 'dozen',
  dozens: 'dozen',
};

const VULGAR_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

/**
 * Parses numeric strings containing integers, decimals, vulgar fractions,
 * simple fractions, or mixed numbers (e.g. "1 1/2", "3/4", "½", "2.5").
 */
export function parseFractionNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  // Check single vulgar fraction
  if (VULGAR_FRACTIONS[s] !== undefined) {
    return VULGAR_FRACTIONS[s];
  }

  // Check vulgar fraction attached to integer (e.g. "1½" or "1 ½")
  for (const [vf, val] of Object.entries(VULGAR_FRACTIONS)) {
    if (s.endsWith(vf)) {
      const prefix = s.slice(0, -vf.length).trim();
      const intVal = prefix ? Number(prefix) : 0;
      if (!Number.isNaN(intVal)) {
        return intVal + val;
      }
    }
  }

  // Mixed fraction: "1 1/2" or "1-1/2"
  const mixedMatch = s.match(/^(\d+)[-\s]+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const num = parseInt(mixedMatch[2], 10);
    const den = parseInt(mixedMatch[3], 10);
    if (den !== 0) return whole + num / den;
  }

  // Simple fraction: "1/2"
  const fracMatch = s.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1], 10);
    const den = parseInt(fracMatch[2], 10);
    if (den !== 0) return num / den;
  }

  // Decimal or integer
  const num = Number(s);
  if (!Number.isNaN(num)) {
    return num;
  }

  return null;
}

/**
 * Formats a numeric quantity into clean culinary representation (fractions when close, or clean decimal/integer).
 */
export function formatQuantityNumber(val: number): string {
  if (val <= 0) return '';

  const whole = Math.floor(val);
  const frac = val - whole;

  const fractions: Array<[number, string]> = [
    [0.125, '1/8'],
    [0.25, '1/4'],
    [0.333, '1/3'],
    [0.375, '3/8'],
    [0.5, '1/2'],
    [0.625, '5/8'],
    [0.667, '2/3'],
    [0.75, '3/4'],
    [0.875, '7/8'],
  ];

  for (const [target, str] of fractions) {
    if (Math.abs(frac - target) < 0.025) {
      return whole > 0 ? `${whole} ${str}` : str;
    }
  }

  // Check if almost a whole number
  if (Math.abs(frac - 1) < 0.025) {
    return String(whole + 1);
  }
  if (frac < 0.025) {
    return String(whole);
  }

  // Otherwise clean decimal rounded to 2 places
  return parseFloat(val.toFixed(2)).toString();
}

/**
 * Formats an amount with its canonical unit, respecting singular/plural grammar.
 */
export function formatQuantityWithUnit(amount: number, canonicalUnit?: string): string {
  const numStr = formatQuantityNumber(amount);
  if (!canonicalUnit) return numStr;

  const meta = CANONICAL_UNITS[canonicalUnit];
  if (!meta) return `${numStr} ${canonicalUnit}`;

  const isPlural = amount > 1.05;
  const unitStr = meta.invariant ? meta.canonical : isPlural ? meta.pluralDisplay : meta.canonical;
  return `${numStr} ${unitStr}`;
}

// Invariant culinary nouns that must NOT have trailing 's' removed
const INVARIANT_NOUNS = new Set([
  'asparagus',
  'couscous',
  'hummus',
  'molasses',
  'citrus',
  'swiss chard',
  'watercress',
  'oats',
  'grits',
  'greens',
  'lentils',
  'brussels sprouts',
]);

/**
 * Normalizes an ingredient name for deduplication and matching:
 * - Trims whitespace and converts to lowercase.
 * - Protects invariant culinary nouns (asparagus, hummus, couscous, etc.).
 * - Singularizes common plural suffixes (-ies -> -y, -oes -> -o, -ves -> -f, -ches/-shes/-xes -> drop es, -s -> drop s).
 */
export function normalizeIngredientName(rawName: string): string {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  if (INVARIANT_NOUNS.has(cleaned)) {
    return cleaned;
  }

  // Singularize the final word in a compound name (e.g. "honeycrisp apples" -> "honeycrisp apple")
  const parts = cleaned.split(' ');
  const last = parts[parts.length - 1];

  if (INVARIANT_NOUNS.has(last) || last.endsWith('ss')) {
    return cleaned;
  }

  let singularLast = last;
  if (last.length > 4 && last.endsWith('ies')) {
    singularLast = `${last.slice(0, -3)}y`;
  } else if (last.length > 4 && last.endsWith('oes')) {
    singularLast = last.slice(0, -2);
  } else if (last.length > 4 && last.endsWith('ves')) {
    singularLast = `${last.slice(0, -3)}f`;
  } else if (
    last.length > 4 &&
    (last.endsWith('ches') || last.endsWith('shes') || last.endsWith('xes'))
  ) {
    singularLast = last.slice(0, -2);
  } else if (last.length > 2 && last.endsWith('s') && !last.endsWith('ss')) {
    singularLast = last.slice(0, -1);
  }

  parts[parts.length - 1] = singularLast;
  return parts.join(' ');
}

/**
 * Normalizes an arbitrary unit string to its canonical key if recognized.
 */
export function normalizeUnit(rawUnit?: string | null): string | null {
  if (!rawUnit) return null;
  const cleaned = rawUnit.toLowerCase().trim();
  return UNIT_ALIASES[cleaned] || null;
}

export type UnitDimension =
  | 'weight_imperial'
  | 'weight_metric'
  | 'volume_us'
  | 'volume_metric';

export interface UnitConversionInfo {
  dimension: UnitDimension;
  baseFactor: number;
  rank: number;
}

export const UNIT_CONVERSIONS: Record<string, UnitConversionInfo> = {
  // Dimension: weight_imperial (base unit: oz)
  oz: { dimension: 'weight_imperial', baseFactor: 1, rank: 1 },
  lb: { dimension: 'weight_imperial', baseFactor: 16, rank: 2 },

  // Dimension: weight_metric (base unit: g)
  g: { dimension: 'weight_metric', baseFactor: 1, rank: 1 },
  kg: { dimension: 'weight_metric', baseFactor: 1000, rank: 2 },

  // Dimension: volume_us (base unit: tsp)
  tsp: { dimension: 'volume_us', baseFactor: 1, rank: 1 },
  tbsp: { dimension: 'volume_us', baseFactor: 3, rank: 2 },
  'fl oz': { dimension: 'volume_us', baseFactor: 6, rank: 3 },
  cup: { dimension: 'volume_us', baseFactor: 48, rank: 4 },
  pint: { dimension: 'volume_us', baseFactor: 96, rank: 5 },
  quart: { dimension: 'volume_us', baseFactor: 192, rank: 6 },
  gallon: { dimension: 'volume_us', baseFactor: 768, rank: 7 },

  // Dimension: volume_metric (base unit: ml)
  ml: { dimension: 'volume_metric', baseFactor: 1, rank: 1 },
  L: { dimension: 'volume_metric', baseFactor: 1000, rank: 2 },
};

/**
 * Combines two single parsed quantities, supporting intra-dimension unit conversions.
 * Returns null if units are incompatible across dimensions.
 */
export function combineTwoQuantities(
  parsed1: { amount: number; canonicalUnit: string | null },
  parsed2: { amount: number; canonicalUnit: string | null }
): string | null {
  const u1 = parsed1.canonicalUnit;
  const u2 = parsed2.canonicalUnit;

  // 1. Identical units (including both null)
  if (u1 === u2) {
    const total = parsed1.amount + parsed2.amount;
    return formatQuantityWithUnit(total, u1 || undefined);
  }

  // 2. Intra-dimension conversions
  if (u1 && u2 && UNIT_CONVERSIONS[u1] && UNIT_CONVERSIONS[u2]) {
    const info1 = UNIT_CONVERSIONS[u1];
    const info2 = UNIT_CONVERSIONS[u2];

    if (info1.dimension === info2.dimension) {
      const dim = info1.dimension;

      // Weight Imperial: 1 lb = 16 oz
      if (dim === 'weight_imperial') {
        const totalOz = parsed1.amount * info1.baseFactor + parsed2.amount * info2.baseFactor;
        if (u1 === 'lb' || u2 === 'lb' || totalOz >= 16) {
          return formatQuantityWithUnit(totalOz / 16, 'lb');
        }
        return formatQuantityWithUnit(totalOz, 'oz');
      }

      // Weight Metric: 1 kg = 1000 g
      if (dim === 'weight_metric') {
        const totalG = parsed1.amount * info1.baseFactor + parsed2.amount * info2.baseFactor;
        if (u1 === 'kg' || u2 === 'kg' || totalG >= 1000) {
          return formatQuantityWithUnit(totalG / 1000, 'kg');
        }
        return formatQuantityWithUnit(totalG, 'g');
      }

      // Volume Metric: 1 L = 1000 ml
      if (dim === 'volume_metric') {
        const totalMl = parsed1.amount * info1.baseFactor + parsed2.amount * info2.baseFactor;
        if (u1 === 'L' || u2 === 'L' || totalMl >= 1000) {
          return formatQuantityWithUnit(totalMl / 1000, 'L');
        }
        return formatQuantityWithUnit(totalMl, 'ml');
      }

      // Volume US: 1 cup = 16 tbsp = 8 fl oz; 1 tbsp = 3 tsp; etc.
      if (dim === 'volume_us') {
        const totalTsp = parsed1.amount * info1.baseFactor + parsed2.amount * info2.baseFactor;
        const targetInfo = info1.rank >= info2.rank ? info1 : info2;
        const targetUnit = info1.rank >= info2.rank ? u1 : u2;
        return formatQuantityWithUnit(totalTsp / targetInfo.baseFactor, targetUnit);
      }
    }
  }

  // 3. Incompatible cross-dimension units (e.g. '1 can' + '2 cups')
  return null;
}

/**
 * Parses a quantity string (e.g. "2 cups", "1.5 lbs", "3", "½ tsp", "100g") into a numeric amount and canonical unit.
 */
export function parseQuantityAndUnit(
  rawQty: string
): { amount: number; canonicalUnit: string | null } | null {
  const trimmed = rawQty.trim();
  if (!trimmed) return null;

  // 1. Multi-word unit: "fl oz", "floz", "fluid ounces"
  const multiMatch = trimmed.match(
    /^([\d\s/.,½⅓⅔¼¾⅛⅜⅝⅞-]+?)\s*(fl\.?\s*oz\.?|floz|fluid\s*ounces?)$/i
  );
  if (multiMatch) {
    const amt = parseFractionNumber(multiMatch[1]);
    if (amt !== null) return { amount: amt, canonicalUnit: 'fl oz' };
  }

  // 2. Spaced unit or pure number: "2 cups", "1 lb", "3", "1 1/2"
  const spacedMatch = trimmed.match(
    /^([\d\s/.,½⅓⅔¼¾⅛⅜⅝⅞-]+)(?:\s+([a-zA-Z.]+))?$/
  );
  if (spacedMatch) {
    const amt = parseFractionNumber(spacedMatch[1]);
    if (amt !== null) {
      if (spacedMatch[2]) {
        const u = normalizeUnit(spacedMatch[2]);
        if (u) return { amount: amt, canonicalUnit: u };
        return null;
      }
      return { amount: amt, canonicalUnit: null };
    }
  }

  // 3. Unspaced number adjacent to unit letters: "100g", "500ml", "1lb", "8oz", "2tbsp", "1tsp", "1/2cup"
  const unspacedMatch = trimmed.match(
    /^([\d\s/.,½⅓⅔¼¾⅛⅜⅝⅞-]+?)([a-zA-Z.]+)$/
  );
  if (unspacedMatch) {
    const u = normalizeUnit(unspacedMatch[2]);
    if (u) {
      const amt = parseFractionNumber(unspacedMatch[1]);
      if (amt !== null) {
        return { amount: amt, canonicalUnit: u };
      }
    }
  }

  return null;
}

/**
 * Merges two quantity strings cleanly:
 * - Empty + Empty -> "2" (rapid staple tap increments)
 * - Empty + New -> New
 * - Existing + Empty -> Existing (or +1 if pure number)
 * - Pure numbers -> Summed
 * - Compatible canonical units & intra-dimension conversions (e.g. "2 cups" + "1 cup" -> "3 cups", "1 lb" + "8 oz" -> "1 1/2 lbs")
 * - Incompatible units (e.g. "1 can" + "2 cups") -> Joined with " + "
 */
export function mergeQuantities(existingQty: string, newQty: string): string {
  const e = (existingQty || '').trim();
  const n = (newQty || '').trim();

  if (!e && !n) return '2';
  if (!e) return n;
  if (!n) {
    const pureNum = parseFractionNumber(e);
    if (pureNum !== null && !/[a-zA-Z]/.test(e)) {
      return formatQuantityNumber(pureNum + 1);
    }
    return e;
  }

  // Check if both are pure numbers
  const numE = parseFractionNumber(e);
  const numN = parseFractionNumber(n);
  if (numE !== null && numN !== null && !/[a-zA-Z]/.test(e) && !/[a-zA-Z]/.test(n)) {
    return formatQuantityNumber(numE + numN);
  }

  // If neither has '+', try direct pairwise combination
  if (!e.includes('+') && !n.includes('+')) {
    const parsedE = parseQuantityAndUnit(e);
    const parsedN = parseQuantityAndUnit(n);
    if (parsedE && parsedN) {
      const combined = combineTwoQuantities(parsedE, parsedN);
      if (combined !== null) {
        return combined;
      }
    }
    return `${e} + ${n}`;
  }

  // Compound strings containing '+':
  // Split terms while preserving order, and combine compatible terms
  const terms = [...e.split('+'), ...n.split('+')].map((t) => t.trim()).filter(Boolean);
  const mergedTerms: Array<{ raw: string; parsed: { amount: number; canonicalUnit: string | null } | null }> = [];

  for (const term of terms) {
    const parsed = parseQuantityAndUnit(term);
    let matched = false;
    if (parsed) {
      for (let i = 0; i < mergedTerms.length; i++) {
        const prev = mergedTerms[i];
        if (prev.parsed) {
          const combined = combineTwoQuantities(prev.parsed, parsed);
          if (combined !== null) {
            mergedTerms[i] = {
              raw: combined,
              parsed: parseQuantityAndUnit(combined),
            };
            matched = true;
            break;
          }
        }
      }
    }
    if (!matched) {
      mergedTerms.push({ raw: term, parsed });
    }
  }

  return mergedTerms.map((t) => t.raw).join(' + ');
}

/**
 * Parses freeform user text (e.g. "2 lbs Honeycrisp Apples", "1 gallon milk", "3 avocados", "bananas")
 * into structured text, quantity, and grocery category.
 */
export function parseItemInput(rawText: string): ParsedItemInput {
  let trimmed = (rawText || '').trim();
  if (!trimmed) {
    return { text: '', quantity: '', category: 'Other' };
  }

  const getCategory = (t: string): GroceryCategory => {
    const direct = classifyGroceryItem(t);
    if (direct !== 'Other') return direct;
    const normalized = normalizeIngredientName(t);
    if (normalized && normalized !== t.toLowerCase()) {
      const fromNorm = classifyGroceryItem(normalized);
      if (fromNorm !== 'Other') return fromNorm;
    }
    return 'Other';
  };

  // Pre-normalize leading multi-word unspaced units (e.g. "2fl oz olive oil" or "2floz olive oil")
  trimmed = trimmed.replace(
    /^([\d\s/.,½⅓⅔¼¾⅛⅜⅝⅞-]+?)\s*(fl\.?\s*oz\.?|floz|fluid\s*ounces?)\b/i,
    '$1 fl oz '
  ).trim();

  const rawTokens = trimmed.split(/\s+/);
  const tokens: string[] = [];

  for (const token of rawTokens) {
    const m = token.match(/^([\d/.,½⅓⅔¼¾⅛⅜⅝⅞-]+)([a-zA-Z.]+)([,;])?$/);
    if (m) {
      const amt = parseFractionNumber(m[1]);
      const unit = normalizeUnit(m[2]);
      if (amt !== null && unit !== null) {
        tokens.push(m[1], m[2]);
        if (m[3]) {
          tokens.push(m[3]);
        }
        continue;
      }
    }
    tokens.push(token);
  }

  // 1. Check if token 0 or tokens 0+1 form a number / fraction
  let numAmt: number | null = null;
  let tokenIdx = 0;

  if (tokens.length >= 2) {
    const combinedNum = parseFractionNumber(`${tokens[0]} ${tokens[1]}`);
    if (combinedNum !== null) {
      numAmt = combinedNum;
      tokenIdx = 2;
    }
  }

  if (numAmt === null && tokens.length >= 1) {
    const singleNum = parseFractionNumber(tokens[0]);
    if (singleNum !== null) {
      numAmt = singleNum;
      tokenIdx = 1;
    }
  }

  if (numAmt !== null) {
    // Check if next token(s) form a unit
    if (tokenIdx < tokens.length) {
      // Check multi-word unit: tokens[tokenIdx] + tokens[tokenIdx+1] (e.g. "fl oz", "fluid ounce")
      if (tokenIdx + 1 < tokens.length) {
        const twoWord = `${tokens[tokenIdx]} ${tokens[tokenIdx + 1]}`.toLowerCase();
        const multiCanonical = normalizeUnit(twoWord);
        if (multiCanonical) {
          tokenIdx += 2;
          if (tokenIdx < tokens.length && tokens[tokenIdx].toLowerCase() === 'of') {
            tokenIdx++;
          }
          const itemText = tokens.slice(tokenIdx).join(' ').trim();
          const qtyStr = formatQuantityWithUnit(numAmt, multiCanonical);
          return {
            text: itemText || twoWord,
            quantity: qtyStr,
            category: getCategory(itemText || twoWord),
          };
        }
      }

      // Check single-word unit: tokens[tokenIdx] (e.g. "lbs", "cup", "cans")
      const singleCanonical = normalizeUnit(tokens[tokenIdx]);
      if (singleCanonical) {
        tokenIdx++;
        if (tokenIdx < tokens.length && tokens[tokenIdx].toLowerCase() === 'of') {
          tokenIdx++;
        }
        const itemText = tokens.slice(tokenIdx).join(' ').trim();
        const qtyStr = formatQuantityWithUnit(numAmt, singleCanonical);
        return {
          text: itemText || singleCanonical,
          quantity: qtyStr,
          category: getCategory(itemText || singleCanonical),
        };
      }
    }

    // Number was present, but next token was NOT a unit (e.g. "3 avocados", "2 apples")
    const itemText = tokens.slice(tokenIdx).join(' ').trim();
    const qtyStr = formatQuantityNumber(numAmt);
    return {
      text: itemText,
      quantity: qtyStr,
      category: getCategory(itemText),
    };
  }

  // 2. Check container prefix without explicit number: "bunch of cilantro", "can of tomatoes", "dozen eggs", "box of pasta"
  const containerMatch = trimmed.match(
    /^(bunch|can|head|stalk|sprig|pkg|package|packet|pack|dozen|box|bag|jar|bottle|slice|container|carton)(?:\s+of)?\s+(.+)$/i
  );
  if (containerMatch) {
    const canonical = normalizeUnit(containerMatch[1]);
    const rest = containerMatch[2].trim();
    if (canonical) {
      const qtyStr = formatQuantityWithUnit(1, canonical);
      return {
        text: rest,
        quantity: qtyStr,
        category: getCategory(rest),
      };
    }
  }

  // 3. Default: pure ingredient name with no quantity
  return {
    text: trimmed,
    quantity: '',
    category: getCategory(trimmed),
  };
}

/**
 * Aggregates recipe ingredients across planned meals:
 * - Groups by normalized ingredient name.
 * - Sums quantities for matching units.
 * - Gathers notes and source recipe attribution.
 * - Assigns grocery aisle classification.
 */
export function aggregateIngredients(
  items: Array<RawIngredientInput>
): AggregatedIngredient[] {
  interface GroupAcc {
    primaryName: string;
    unitQuantities: Map<string | null, number>;
    rawQuantities: string[];
    notesSet: Set<string>;
    sourceMealsSet: Set<string>;
    category: GroceryCategory;
  }

  const groups = new Map<string, GroupAcc>();

  for (const item of items) {
    let rawName = (item.name || '').trim();
    let qtyStr = '';
    let canonicalUnit: string | null = null;
    let numericAmount: number | null = null;

    if (!rawName && item.text) {
      const parsed = parseItemInput(item.text);
      rawName = parsed.text;
      qtyStr = parsed.quantity;
    } else {
      if (item.quantity !== null && item.quantity !== undefined) {
        if (typeof item.quantity === 'number') {
          numericAmount = item.quantity;
        } else {
          numericAmount = parseFractionNumber(String(item.quantity));
        }
      }
      if (item.unit) {
        canonicalUnit = normalizeUnit(item.unit);
      }
      if (numericAmount !== null && canonicalUnit) {
        qtyStr = formatQuantityWithUnit(numericAmount, canonicalUnit);
      } else if (numericAmount !== null) {
        qtyStr = formatQuantityNumber(numericAmount);
      } else if (item.quantity) {
        qtyStr = String(item.quantity).trim();
      }
    }

    if (!rawName) continue;

    // Check for inline parenthetical or comma note (e.g. "yellow onions, diced")
    let note = (item.notes || '').trim();
    const commaSplit = rawName.split(',');
    if (commaSplit.length > 1) {
      rawName = commaSplit[0].trim();
      const extraNote = commaSplit.slice(1).join(',').trim();
      note = note ? `${note}, ${extraNote}` : extraNote;
    }

    const normKey = normalizeIngredientName(rawName);
    if (!normKey) continue;

    let acc = groups.get(normKey);
    if (!acc) {
      // Determine category: preserve explicit category or classify
      const category = (item.category as GroceryCategory) || classifyGroceryItem(rawName);
      acc = {
        primaryName: rawName.charAt(0).toUpperCase() + rawName.slice(1),
        unitQuantities: new Map(),
        rawQuantities: [],
        notesSet: new Set(),
        sourceMealsSet: new Set(),
        category,
      };
      groups.set(normKey, acc);
    }

    // Accumulate quantity
    if (qtyStr) {
      const parsed = parseQuantityAndUnit(qtyStr);
      if (parsed) {
        const u = parsed.canonicalUnit;
        const cur = acc.unitQuantities.get(u) || 0;
        acc.unitQuantities.set(u, cur + parsed.amount);
      } else {
        acc.rawQuantities.push(qtyStr);
      }
    }

    if (note) {
      acc.notesSet.add(note);
    }

    const source = (item.mealName || item.recipeTitle || '').trim();
    if (source) {
      acc.sourceMealsSet.add(source);
    }
  }

  const results: AggregatedIngredient[] = [];

  for (const acc of groups.values()) {
    let mergedQty = '';

    for (const [unit, total] of acc.unitQuantities.entries()) {
      if (total <= 0) continue;
      const str = formatQuantityWithUnit(total, unit || undefined);
      mergedQty = mergedQty ? mergeQuantities(mergedQty, str) : str;
    }

    for (const raw of acc.rawQuantities) {
      mergedQty = mergedQty ? mergeQuantities(mergedQty, raw) : raw;
    }

    const notesStr = Array.from(acc.notesSet).filter(Boolean).join(', ');

    results.push({
      name: acc.primaryName,
      quantity: mergedQty,
      category: acc.category,
      notes: notesStr || undefined,
      sourceMeals: Array.from(acc.sourceMealsSet),
    });
  }

  return results;
}
