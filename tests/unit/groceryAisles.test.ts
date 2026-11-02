import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGroceryItem, orderAisles } from '../../src/shared/groceryClassifier.js';
import { GROCERY_CATEGORIES } from '../../src/shared/types.js';

const CASES: Record<string, string> = {
  'peanut butter': 'Pantry', 'coconut milk': 'Pantry', 'chicken broth': 'Pantry', 'tomato sauce': 'Pantry',
  'black pepper': 'Pantry', 'garlic powder': 'Pantry', 'chocolate milk': 'Dairy & Eggs', 'cream of mushroom soup': 'Pantry',
  'frozen pizza': 'Frozen', 'bananas': 'Produce', 'whole milk': 'Dairy & Eggs', 'ground turkey': 'Meat & Seafood',
  'hamburger buns': 'Bakery', 'avocado oil': 'Pantry', 'Greek yogurt': 'Dairy & Eggs', 'tortilla chips': 'Snacks & Drinks',
  'paper plates': 'Household', 'dog treats': 'Household', 'chicken breasts': 'Meat & Seafood', 'egg noodles': 'Pantry',
  'cream cheese': 'Dairy & Eggs', 'heavy cream': 'Dairy & Eggs', 'bell peppers': 'Produce', 'green onions': 'Produce',
  'frozen broccoli': 'Frozen', 'ranch dressing': 'Pantry', 'shredded cheddar': 'Dairy & Eggs', 'sweet potatoes': 'Produce',
  'salmon fillets': 'Meat & Seafood', 'Honeycrisp Apples': 'Produce', 'sparkling water': 'Snacks & Drinks',
  'trash bags': 'Household', 'black beans': 'Pantry', 'butter': 'Dairy & Eggs', 'eggs': 'Dairy & Eggs',
  'hot dog buns': 'Bakery', 'hot dogs': 'Meat & Seafood', 'something unusual': 'Other',
};

test('common items land in the right aisle (most specific phrase / last word wins)', () => {
  const wrong = Object.entries(CASES)
    .map(([item, want]) => [item, want, classifyGroceryItem(item)])
    .filter(([, want, got]) => want !== got);
  assert.deepEqual(wrong, []);
});

test('store order: custom order kept, invalid/duplicate entries dropped, missing aisles appended', () => {
  assert.deepEqual(orderAisles(null), GROCERY_CATEGORIES);
  const custom = orderAisles(['Bakery', 'Produce', 'Bogus', 'Bakery']);
  assert.deepEqual(custom.slice(0, 2), ['Bakery', 'Produce']);
  assert.equal(custom.length, GROCERY_CATEGORIES.length);
  assert.deepEqual([...custom].sort(), [...GROCERY_CATEGORIES].sort());
});
