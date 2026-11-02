import { GROCERY_CATEGORIES, type GroceryCategory } from './types.js';

/**
 * Keyword -> aisle map. Multi-word phrases are fine (and win over single words they contain).
 * Users can override any item's aisle in the app; those choices are remembered server-side.
 */
const CATEGORY_KEYWORDS: Record<Exclude<GroceryCategory, 'Other'>, string[]> = {
  Produce: [
    'apple', 'banana', 'orange', 'lemon', 'lime', 'avocado', 'berry', 'berries',
    'strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'grape',
    'melon', 'watermelon', 'peach', 'pear', 'plum', 'mango', 'pineapple', 'kiwi',
    'lettuce', 'spinach', 'kale', 'arugula', 'salad', 'salad mix', 'greens', 'cabbage', 'broccoli',
    'cauliflower', 'carrot', 'celery', 'cucumber', 'tomato', 'tomatoes', 'onion',
    'garlic', 'shallot', 'potato', 'potatoes', 'sweet potato', 'pepper', 'bell pepper', 'jalapeno',
    'zucchini', 'squash', 'mushroom', 'corn', 'asparagus', 'green bean', 'cilantro',
    'parsley', 'basil', 'mint', 'rosemary', 'thyme', 'ginger', 'scallion', 'chive', 'green onion',
    'radish', 'beet', 'leek', 'herb', 'fresh herb',
  ],
  'Dairy & Eggs': [
    'milk', 'whole milk', 'chocolate milk', 'egg', 'eggs', 'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan',
    'feta', 'swiss', 'provolone', 'cream cheese', 'yogurt', 'greek yogurt', 'cream',
    'heavy cream', 'whipping cream', 'half and half', 'sour cream', 'cottage cheese', 'ricotta', 'creamer',
    'oat milk', 'almond milk', 'string cheese', 'shredded cheese',
  ],
  'Meat & Seafood': [
    'chicken', 'chicken breast', 'chicken thigh', 'beef', 'steak', 'ground beef', 'ground turkey', 'pork', 'pork chop',
    'bacon', 'sausage', 'ham', 'turkey', 'lamb', 'salmon', 'shrimp', 'cod', 'tilapia', 'fish', 'crab',
    'scallop', 'meatball', 'brisket', 'ribs', 'roast', 'chuck roast', 'chorizo', 'prosciutto', 'deli', 'deli meat',
    'hot dog', 'pepperoni', 'salami',
  ],
  Bakery: [
    'bread', 'bagel', 'bun', 'roll', 'tortilla', 'pita', 'naan', 'croissant',
    'muffin', 'english muffin', 'baguette', 'sourdough', 'brioche', 'wrap', 'cake',
    'donut', 'hamburger bun', 'hot dog bun',
  ],
  Frozen: [
    'frozen', 'ice cream', 'popsicle', 'waffle', 'frozen waffle', 'pizza', 'tater tot', 'fries',
    'edamame', 'sorbet', 'gelato', 'ice',
  ],
  Pantry: [
    'rice', 'pasta', 'spaghetti', 'penne', 'macaroni', 'noodle', 'egg noodle', 'flour', 'sugar', 'brown sugar',
    'powdered sugar', 'honey', 'maple syrup', 'syrup', 'oil', 'olive oil', 'vegetable oil', 'canola oil', 'avocado oil',
    'coconut oil', 'sesame oil', 'cooking spray', 'vinegar', 'soy sauce', 'hot sauce', 'bbq sauce', 'sauce', 'ketchup',
    'mustard', 'mayo', 'mayonnaise', 'salsa', 'dressing', 'salad dressing', 'ranch',
    'broth', 'stock', 'chicken broth', 'beef broth', 'vegetable broth', 'chicken stock', 'bouillon',
    'soup', 'cream of mushroom soup', 'cream of chicken soup',
    'beans', 'black beans', 'kidney beans', 'pinto beans', 'refried beans', 'chickpea', 'lentil', 'oat', 'oatmeal',
    'cereal', 'granola', 'peanut butter', 'almond butter', 'jam', 'jelly', 'salt', 'kosher salt',
    'pepper flakes', 'black pepper', 'ground pepper', 'cumin', 'paprika', 'cinnamon', 'oregano', 'chili powder',
    'garlic powder', 'onion powder', 'powder', 'spice', 'seasoning', 'taco seasoning', 'italian seasoning',
    'dried', 'baking powder', 'baking soda', 'vanilla', 'vanilla extract', 'extract', 'tomato paste', 'tomato sauce',
    'diced tomatoes', 'crushed tomatoes', 'canned', 'can', 'marinara', 'pasta sauce', 'yeast', 'coconut milk',
    'breadcrumbs', 'panko', 'quinoa', 'taco shell', 'cornstarch', 'chocolate chip', 'tuna', 'canned tuna',
  ],
  'Snacks & Drinks': [
    'chips', 'tortilla chips', 'potato chips', 'crackers', 'pretzel', 'popcorn', 'nuts', 'almonds', 'cashews',
    'cookie', 'chocolate', 'candy', 'granola bar', 'snack', 'coffee', 'tea', 'juice', 'soda', 'seltzer',
    'sparkling water', 'la croix', 'water', 'wine', 'beer', 'kombucha', 'fruit snack', 'goldfish',
  ],
  Household: [
    'paper towel', 'toilet paper', 'tissue', 'napkin', 'paper plate', 'plate', 'paper cup', 'plastic cup',
    'dish soap', 'dishwasher pod', 'detergent', 'laundry', 'laundry detergent', 'sponge', 'trash bag', 'foil',
    'aluminum foil', 'plastic wrap', 'ziploc', 'zip bag', 'parchment', 'parchment paper', 'bleach', 'cleaner',
    'wipes', 'soap', 'hand soap', 'shampoo', 'conditioner', 'toothpaste', 'toothbrush', 'deodorant', 'diaper',
    'batteries', 'light bulb', 'dog food', 'cat food', 'dog treat', 'cat treat', 'pet food', 'cat litter', 'litter',
  ],
};

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

interface Match {
  category: Exclude<GroceryCategory, 'Other'>;
  score: number;
  end: number;
}

/**
 * Picks an aisle by keyword. All matching keywords are scored and the best wins:
 *  - longer (more specific) phrases beat shorter ones ("peanut butter" > "butter");
 *  - a keyword at the END of the name gets a bonus, because English puts the thing itself last
 *    ("chicken broth" is broth, "avocado oil" is oil, "tortilla chips" are chips);
 *  - an exact whole-name match always wins.
 * Anything containing "frozen" or "ice cream" goes to Frozen.
 */
export function classifyGroceryItem(rawText: string): GroceryCategory {
  const lower = rawText.toLowerCase().replace(/[^\w\s&'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!lower) return 'Other';
  if (/\bfrozen\b/.test(lower) || lower.includes('ice cream')) return 'Frozen';

  let best: Match | null = null;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [
    Exclude<GroceryCategory, 'Other'>,
    string[],
  ][]) {
    for (const kw of keywords) {
      const re = new RegExp(`(?:^|\\s)${kw.replace(ESCAPE, '\\$&')}(?:s|es)?(?=\\s|$)`, 'g');
      for (const m of lower.matchAll(re)) {
        const end = (m.index ?? 0) + m[0].length;
        const atEnd = end === lower.length;
        const exact = atEnd && m[0].trim().length === lower.length;
        const score = kw.length + (atEnd ? 5 : 0) + (exact ? 100 : 0);
        if (!best || score > best.score || (score === best.score && end > best.end)) {
          best = { category, score, end };
        }
      }
    }
  }
  return best ? best.category : 'Other';
}

/** Aisle display order: the household's custom store order (if valid), with any missing aisles appended. */
export function orderAisles(custom?: readonly string[] | null): GroceryCategory[] {
  const valid = (custom ?? []).filter((c): c is GroceryCategory =>
    (GROCERY_CATEGORIES as readonly string[]).includes(c)
  );
  const unique = [...new Set(valid)];
  return [...unique, ...GROCERY_CATEGORIES.filter((c) => !unique.includes(c))];
}
