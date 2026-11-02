import type { GroceryCategory } from './types.js';

const CATEGORY_KEYWORDS: Record<Exclude<GroceryCategory, 'Other'>, string[]> = {
  Produce: [
    'apple', 'banana', 'orange', 'lemon', 'lime', 'avocado', 'berry', 'berries',
    'strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'grape',
    'melon', 'watermelon', 'peach', 'pear', 'plum', 'mango', 'pineapple', 'kiwi',
    'lettuce', 'spinach', 'kale', 'arugula', 'salad', 'greens', 'cabbage', 'broccoli',
    'cauliflower', 'carrot', 'celery', 'cucumber', 'tomato', 'tomatoes', 'onion',
    'garlic', 'shallot', 'potato', 'potatoes', 'sweet potato', 'pepper', 'jalapeno',
    'zucchini', 'squash', 'mushroom', 'corn', 'asparagus', 'green bean', 'cilantro',
    'parsley', 'basil', 'mint', 'rosemary', 'thyme', 'ginger', 'scallion', 'chive',
  ],
  'Dairy & Eggs': [
    'milk', 'egg', 'eggs', 'butter', 'cheese', 'cheddar', 'mozzarella', 'parmesan',
    'feta', 'swiss', 'provolone', 'cream cheese', 'yogurt', 'greek yogurt', 'cream',
    'heavy cream', 'half and half', 'sour cream', 'cottage cheese', 'ricotta', 'creamer',
    'oat milk', 'almond milk',
  ],
  'Meat & Seafood': [
    'chicken', 'beef', 'steak', 'ground beef', 'pork', 'bacon', 'sausage', 'ham',
    'turkey', 'lamb', 'salmon', 'shrimp', 'cod', 'tilapia', 'tuna', 'fish', 'crab',
    'scallop', 'meatball', 'brisket', 'ribs', 'chorizo', 'prosciutto', 'deli',
  ],
  Bakery: [
    'bread', 'bagel', 'bun', 'roll', 'tortilla', 'pita', 'naan', 'croissant',
    'muffin', 'english muffin', 'baguette', 'sourdough', 'brioche', 'wrap', 'cake',
    'donut',
  ],
  Frozen: [
    'frozen', 'ice cream', 'popsicle', 'waffle', 'pizza', 'tater tot', 'fries',
    'edamame', 'sorbet', 'gelato',
  ],
  Pantry: [
    'rice', 'pasta', 'spaghetti', 'penne', 'noodle', 'flour', 'sugar', 'brown sugar',
    'honey', 'maple syrup', 'olive oil', 'vegetable oil', 'sesame oil', 'vinegar',
    'soy sauce', 'hot sauce', 'ketchup', 'mustard', 'mayo', 'mayonnaise', 'salsa',
    'broth', 'stock', 'beans', 'black beans', 'chickpea', 'lentil', 'oat', 'oatmeal',
    'cereal', 'granola', 'peanut butter', 'almond butter', 'jam', 'jelly', 'salt',
    'black pepper', 'cumin', 'paprika', 'cinnamon', 'oregano', 'chili powder',
    'baking powder', 'baking soda', 'vanilla', 'tomato paste', 'tomato sauce',
    'diced tomatoes', 'marinara', 'pasta sauce', 'yeast', 'coconut milk', 'breadcrumbs', 'panko', 'quinoa', 'taco shell',
  ],
  'Snacks & Drinks': [
    'chips', 'crackers', 'pretzel', 'popcorn', 'nuts', 'almonds', 'cashews', 'cookie',
    'chocolate', 'candy', 'granola bar', 'coffee', 'tea', 'juice', 'soda', 'seltzer',
    'sparkling water', 'la croix', 'water', 'wine', 'beer', 'kombucha', 'fruit snack',
  ],
  Household: [
    'paper towel', 'toilet paper', 'tissue', 'napkin', 'dish soap', 'detergent',
    'laundry', 'sponge', 'trash bag', 'foil', 'plastic wrap', 'ziploc', 'parchment',
    'bleach', 'cleaner', 'wipes', 'soap', 'shampoo', 'conditioner', 'toothpaste',
    'deodorant', 'diaper', 'batteries', 'light bulb', 'dog food', 'cat food',
  ],
};

export function classifyGroceryItem(rawText: string): GroceryCategory {
  const lower = rawText.toLowerCase().trim();
  if (!lower) return 'Other';

  // Check Frozen explicitly first so "frozen broccoli" -> Frozen
  if (lower.includes('frozen') || lower.includes('ice cream')) {
    return 'Frozen';
  }

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as [
    Exclude<GroceryCategory, 'Other'>,
    string[],
  ][]) {
    for (const kw of keywords) {
      if (
        lower === kw ||
        lower === `${kw}s` ||
        lower === `${kw}es` ||
        lower.startsWith(`${kw} `) ||
        lower.startsWith(`${kw}s `) ||
        lower.startsWith(`${kw}es `) ||
        lower.endsWith(` ${kw}`) ||
        lower.endsWith(` ${kw}s`) ||
        lower.endsWith(` ${kw}es`) ||
        lower.includes(` ${kw} `) ||
        lower.includes(` ${kw}s `) ||
        lower.includes(` ${kw}es `)
      ) {
        return category;
      }
    }
  }

  return 'Other';
}
