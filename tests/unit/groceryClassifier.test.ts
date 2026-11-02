import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGroceryItem } from '../../src/shared/groceryClassifier.js';

test('classifyGroceryItem assigns correct aisle categories for all 9 grocery categories', () => {
  // 1. Produce
  assert.equal(classifyGroceryItem('Honeycrisp Apples'), 'Produce');
  assert.equal(classifyGroceryItem('Avocado'), 'Produce');
  assert.equal(classifyGroceryItem('Yellow Onion'), 'Produce');
  assert.equal(classifyGroceryItem('Garlic Cloves'), 'Produce');
  assert.equal(classifyGroceryItem('Baby Spinach'), 'Produce');
  assert.equal(classifyGroceryItem('Cilantro'), 'Produce');
  assert.equal(classifyGroceryItem('Fresh Basil'), 'Produce');
  assert.equal(classifyGroceryItem('Russet Potatoes'), 'Produce');
  assert.equal(classifyGroceryItem('Tomatoes on the vine'), 'Produce');

  // 2. Dairy & Eggs
  assert.equal(classifyGroceryItem('Whole Milk'), 'Dairy & Eggs');
  assert.equal(classifyGroceryItem('Pasture-Raised Eggs'), 'Dairy & Eggs');
  assert.equal(classifyGroceryItem('Sharp Cheddar Cheese'), 'Dairy & Eggs');
  assert.equal(classifyGroceryItem('Greek Yogurt'), 'Dairy & Eggs');
  assert.equal(classifyGroceryItem('Heavy Cream'), 'Dairy & Eggs');
  assert.equal(classifyGroceryItem('Unsalted Butter'), 'Dairy & Eggs');
  assert.equal(classifyGroceryItem('Oat Milk'), 'Dairy & Eggs');
  assert.equal(classifyGroceryItem('Sour Cream'), 'Dairy & Eggs');

  // 3. Meat & Seafood
  assert.equal(classifyGroceryItem('Boneless Chicken Breasts'), 'Meat & Seafood');
  assert.equal(classifyGroceryItem('Ground Beef 80/20'), 'Meat & Seafood');
  assert.equal(classifyGroceryItem('Wild Atlantic Salmon Fillets'), 'Meat & Seafood');
  assert.equal(classifyGroceryItem('Thick Cut Bacon'), 'Meat & Seafood');
  assert.equal(classifyGroceryItem('Jumbo Shrimp'), 'Meat & Seafood');
  assert.equal(classifyGroceryItem('Italian Sausage'), 'Meat & Seafood');
  assert.equal(classifyGroceryItem('Pork Chops'), 'Meat & Seafood');

  // 4. Bakery
  assert.equal(classifyGroceryItem('Sourdough Bread'), 'Bakery');
  assert.equal(classifyGroceryItem('Brioche Hamburger Buns'), 'Bakery');
  assert.equal(classifyGroceryItem('Flour Tortillas'), 'Bakery');
  assert.equal(classifyGroceryItem('Plain Bagels'), 'Bakery');
  assert.equal(classifyGroceryItem('Pita Bread'), 'Bakery');
  assert.equal(classifyGroceryItem('French Baguette'), 'Bakery');

  // 5. Frozen
  assert.equal(classifyGroceryItem('Frozen Peas'), 'Frozen');
  assert.equal(classifyGroceryItem('Frozen Strawberries'), 'Frozen');
  assert.equal(classifyGroceryItem('Vanilla Ice Cream'), 'Frozen');
  assert.equal(classifyGroceryItem('Frozen Waffles'), 'Frozen');
  assert.equal(classifyGroceryItem('Frozen Pizza'), 'Frozen');

  // 6. Pantry
  assert.equal(classifyGroceryItem('Jasmine Rice'), 'Pantry');
  assert.equal(classifyGroceryItem('Rigatoni Pasta'), 'Pantry');
  assert.equal(classifyGroceryItem('All-Purpose Flour'), 'Pantry');
  assert.equal(classifyGroceryItem('Extra Virgin Olive Oil'), 'Pantry');
  assert.equal(classifyGroceryItem('Black Beans'), 'Pantry');
  assert.equal(classifyGroceryItem('Vegetable Broth'), 'Pantry');
  assert.equal(classifyGroceryItem('Kosher Salt'), 'Pantry');
  assert.equal(classifyGroceryItem('Ground Cumin'), 'Pantry');
  assert.equal(classifyGroceryItem('Soy Sauce'), 'Pantry');

  // 7. Snacks & Drinks
  assert.equal(classifyGroceryItem('Crispy Chips'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Sparkling Water'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Dark Chocolate'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Whole Bean Coffee'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Green Tea'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Wheat Crackers'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Red Wine'), 'Snacks & Drinks');

  // 8. Household
  assert.equal(classifyGroceryItem('White Paper Towel'), 'Household');
  assert.equal(classifyGroceryItem('Toilet Paper'), 'Household');
  assert.equal(classifyGroceryItem('Liquid Dish Soap'), 'Household');
  assert.equal(classifyGroceryItem('Laundry Detergent'), 'Household');
  assert.equal(classifyGroceryItem('Trash Bags 13 Gallon'), 'Household');
  assert.equal(classifyGroceryItem('Aluminum Foil'), 'Household');

  // 9. Other / Fallbacks
  assert.equal(classifyGroceryItem('Screws 2-inch'), 'Other');
  assert.equal(classifyGroceryItem('Lawn mower blade'), 'Other');
  assert.equal(classifyGroceryItem(''), 'Other');
  assert.equal(classifyGroceryItem('   '), 'Other');
});

test('classifyGroceryItem prioritizes Frozen over base ingredient category', () => {
  // Frozen broccoli must be Frozen, not Produce
  assert.equal(classifyGroceryItem('Frozen Broccoli'), 'Frozen');
  // Frozen chicken nuggets / frozen chicken
  assert.equal(classifyGroceryItem('Frozen Chicken'), 'Frozen');
  // Frozen pizza
  assert.equal(classifyGroceryItem('Frozen Pizza'), 'Frozen');
  // Ice cream (even though cream is dairy)
  assert.equal(classifyGroceryItem('Mint Chocolate Chip Ice Cream'), 'Frozen');
});

test('classifyGroceryItem correctly classifies single-word and multi-word plurals (TEST_READY.md § 5)', () => {
  assert.equal(classifyGroceryItem('Avocados'), 'Produce');
  assert.equal(classifyGroceryItem('Pretzels'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Bagels'), 'Bakery');
  assert.equal(classifyGroceryItem('Apples'), 'Produce');
  assert.equal(classifyGroceryItem('Peaches'), 'Produce');
  assert.equal(classifyGroceryItem('Carrots'), 'Produce');
  assert.equal(classifyGroceryItem('Crackers'), 'Snacks & Drinks');
  assert.equal(classifyGroceryItem('Muffins'), 'Bakery');
  assert.equal(classifyGroceryItem('Cookies'), 'Snacks & Drinks');
});

