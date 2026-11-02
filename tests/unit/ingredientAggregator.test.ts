import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFractionNumber,
  formatQuantityNumber,
  formatQuantityWithUnit,
  normalizeIngredientName,
  normalizeUnit,
  parseQuantityAndUnit,
  mergeQuantities,
  parseItemInput,
  aggregateIngredients,
} from '../../src/shared/ingredientAggregator.js';

test('parseFractionNumber parses integers, decimals, simple, mixed and vulgar fractions', () => {
  assert.equal(parseFractionNumber('2'), 2);
  assert.equal(parseFractionNumber('0'), 0);
  assert.equal(parseFractionNumber('12'), 12);
  assert.equal(parseFractionNumber('1.5'), 1.5);
  assert.equal(parseFractionNumber('0.25'), 0.25);
  assert.equal(parseFractionNumber('2.75'), 2.75);

  // Simple fractions
  assert.equal(parseFractionNumber('1/2'), 0.5);
  assert.equal(parseFractionNumber('3/4'), 0.75);
  assert.equal(parseFractionNumber('1/8'), 0.125);
  assert.equal(Math.round((parseFractionNumber('1/3') || 0) * 100) / 100, 0.33);

  // Mixed fractions
  assert.equal(parseFractionNumber('1 1/2'), 1.5);
  assert.equal(parseFractionNumber('2 3/4'), 2.75);
  assert.equal(parseFractionNumber('1-1/2'), 1.5);

  // Vulgar unicode fractions
  assert.equal(parseFractionNumber('½'), 0.5);
  assert.equal(parseFractionNumber('¼'), 0.25);
  assert.equal(parseFractionNumber('¾'), 0.75);
  assert.equal(parseFractionNumber('⅛'), 0.125);
  assert.equal(parseFractionNumber('⅜'), 0.375);
  assert.equal(parseFractionNumber('⅝'), 0.625);
  assert.equal(parseFractionNumber('⅞'), 0.875);

  // Vulgar attached to integer
  assert.equal(parseFractionNumber('1½'), 1.5);
  assert.equal(parseFractionNumber('2¾'), 2.75);

  // Edge cases
  assert.equal(parseFractionNumber(''), null);
  assert.equal(parseFractionNumber('   '), null);
  assert.equal(parseFractionNumber('not a number'), null);
});

test('formatQuantityNumber converts numbers into culinary fraction representations', () => {
  assert.equal(formatQuantityNumber(1), '1');
  assert.equal(formatQuantityNumber(2), '2');
  assert.equal(formatQuantityNumber(0.5), '1/2');
  assert.equal(formatQuantityNumber(1.5), '1 1/2');
  assert.equal(formatQuantityNumber(0.25), '1/4');
  assert.equal(formatQuantityNumber(2.75), '2 3/4');
  assert.equal(formatQuantityNumber(0.333), '1/3');
  assert.equal(formatQuantityNumber(0.125), '1/8');
  assert.equal(formatQuantityNumber(2.5), '2 1/2');
});

test('formatQuantityWithUnit handles singular and plural display rules', () => {
  assert.equal(formatQuantityWithUnit(1, 'cup'), '1 cup');
  assert.equal(formatQuantityWithUnit(2, 'cup'), '2 cups');
  assert.equal(formatQuantityWithUnit(1, 'lb'), '1 lb');
  assert.equal(formatQuantityWithUnit(3, 'lb'), '3 lbs');
  assert.equal(formatQuantityWithUnit(1, 'tbsp'), '1 tbsp');
  assert.equal(formatQuantityWithUnit(2, 'tbsp'), '2 tbsp');
  assert.equal(formatQuantityWithUnit(1, 'tsp'), '1 tsp');
  assert.equal(formatQuantityWithUnit(2, 'tsp'), '2 tsp');
  assert.equal(formatQuantityWithUnit(1, 'clove'), '1 clove');
  assert.equal(formatQuantityWithUnit(4, 'clove'), '4 cloves');
  assert.equal(formatQuantityWithUnit(1, 'can'), '1 can');
  assert.equal(formatQuantityWithUnit(2, 'can'), '2 cans');
});

test('normalizeIngredientName handles plurals, compounds, and invariant culinary nouns', () => {
  // Simple plurals
  assert.equal(normalizeIngredientName('Apples'), 'apple');
  assert.equal(normalizeIngredientName('Carrots'), 'carrot');
  assert.equal(normalizeIngredientName('Yellow Onions'), 'yellow onion');
  assert.equal(normalizeIngredientName('Bell Peppers'), 'bell pepper');
  assert.equal(normalizeIngredientName('Strawberries'), 'strawberry');
  assert.equal(normalizeIngredientName('Potatoes'), 'potato');
  assert.equal(normalizeIngredientName('Tomatoes'), 'tomato');

  // Invariant nouns must NOT drop 's'
  assert.equal(normalizeIngredientName('Asparagus'), 'asparagus');
  assert.equal(normalizeIngredientName('Hummus'), 'hummus');
  assert.equal(normalizeIngredientName('Couscous'), 'couscous');
  assert.equal(normalizeIngredientName('Molasses'), 'molasses');
  assert.equal(normalizeIngredientName('Citrus'), 'citrus');
  assert.equal(normalizeIngredientName('Oats'), 'oats');

  // Words ending in double s
  assert.equal(normalizeIngredientName('Swiss Cheese'), 'swiss cheese');
});

test('normalizeUnit canonicalizes volume, weight, and count aliases', () => {
  assert.equal(normalizeUnit('cup'), 'cup');
  assert.equal(normalizeUnit('cups'), 'cup');
  assert.equal(normalizeUnit('c'), 'cup');
  assert.equal(normalizeUnit('c.'), 'cup');

  assert.equal(normalizeUnit('tbsp'), 'tbsp');
  assert.equal(normalizeUnit('tablespoon'), 'tbsp');
  assert.equal(normalizeUnit('tablespoons'), 'tbsp');

  assert.equal(normalizeUnit('tsp'), 'tsp');
  assert.equal(normalizeUnit('teaspoon'), 'tsp');
  assert.equal(normalizeUnit('teaspoons'), 'tsp');

  assert.equal(normalizeUnit('lb'), 'lb');
  assert.equal(normalizeUnit('lbs'), 'lb');
  assert.equal(normalizeUnit('pound'), 'lb');
  assert.equal(normalizeUnit('pounds'), 'lb');

  assert.equal(normalizeUnit('oz'), 'oz');
  assert.equal(normalizeUnit('ounce'), 'oz');
  assert.equal(normalizeUnit('fl oz'), 'fl oz');
  assert.equal(normalizeUnit('fluid ounces'), 'fl oz');

  assert.equal(normalizeUnit('gal'), 'gallon');
  assert.equal(normalizeUnit('gallon'), 'gallon');
  assert.equal(normalizeUnit('gallons'), 'gallon');

  assert.equal(normalizeUnit('can'), 'can');
  assert.equal(normalizeUnit('cans'), 'can');
  assert.equal(normalizeUnit('cloves'), 'clove');
  assert.equal(normalizeUnit('bunches'), 'bunch');

  assert.equal(normalizeUnit('unknown_unit'), null);
  assert.equal(normalizeUnit(null), null);
});

test('parseItemInput extracts quantities, canonical units, names and aisle categories', () => {
  // Quantity with unit
  const milk = parseItemInput('2 gallons Whole Milk');
  assert.equal(milk.text, 'Whole Milk');
  assert.equal(milk.quantity, '2 gallons');
  assert.equal(milk.category, 'Dairy & Eggs');

  // Freeform weight
  const chicken = parseItemInput('1.5 lbs chicken breasts');
  assert.equal(chicken.text, 'chicken breasts');
  assert.equal(chicken.quantity, '1 1/2 lbs');
  assert.equal(chicken.category, 'Meat & Seafood');

  // Pure count
  const avocados = parseItemInput('3 avocados');
  assert.equal(avocados.text, 'avocados');
  assert.equal(avocados.quantity, '3');
  assert.equal(avocados.category, 'Produce');

  // Fractions
  const cream = parseItemInput('1/2 cup heavy cream');
  assert.equal(cream.text, 'heavy cream');
  assert.equal(cream.quantity, '1/2 cup');
  assert.equal(cream.category, 'Dairy & Eggs');

  // Multi-word unit
  const oil = parseItemInput('2 fl oz olive oil');
  assert.equal(oil.text, 'olive oil');
  assert.equal(oil.quantity, '2 fl oz');
  assert.equal(oil.category, 'Pantry');

  // Container prefix
  const beans = parseItemInput('can of black beans');
  assert.equal(beans.text, 'black beans');
  assert.equal(beans.quantity, '1 can');
  assert.equal(beans.category, 'Pantry');

  // Bare name without quantity
  const bread = parseItemInput('sourdough bread');
  assert.equal(bread.text, 'sourdough bread');
  assert.equal(bread.quantity, '');
  assert.equal(bread.category, 'Bakery');
});

test('mergeQuantities accurately combines matching units, numbers, and handles incompatible combinations', () => {
  // Pure numbers
  assert.equal(mergeQuantities('2', '3'), '5');
  assert.equal(mergeQuantities('1', '1'), '2');

  // Matching units
  assert.equal(mergeQuantities('1 cup', '2 cups'), '3 cups');
  assert.equal(mergeQuantities('1/2 cup', '1/2 cup'), '1 cup');
  assert.equal(mergeQuantities('1.5 lbs', '1.5 lbs'), '3 lbs');
  assert.equal(mergeQuantities('2 tbsp', '1 tbsp'), '3 tbsp');
  assert.equal(mergeQuantities('1 can', '2 cans'), '3 cans');

  // Empty values
  assert.equal(mergeQuantities('', ''), '2');
  assert.equal(mergeQuantities('', '1 gal'), '1 gal');
  assert.equal(mergeQuantities('2 lbs', ''), '2 lbs');

  // Incompatible units
  assert.equal(mergeQuantities('1 can', '2 cups'), '1 can + 2 cups');
});

test('aggregateIngredients merges duplicate ingredients across meals into single grocery items', () => {
  const rawItems = [
    // 2 Yellow Onions from Fajitas
    {
      name: 'Yellow Onion',
      quantity: 2,
      unit: 'whole',
      recipeTitle: 'Sheet Pan Fajitas',
      notes: 'sliced',
      category: 'Produce',
    },
    // 1 Yellow Onion from Salmon Bowl
    {
      name: 'Yellow Onions',
      quantity: 1,
      unit: 'whole',
      recipeTitle: 'Salmon Bowls',
      notes: 'diced',
      category: 'Produce',
    },
    // 1.5 lbs chicken from Fajitas
    {
      name: 'Chicken Breasts',
      quantity: 1.5,
      unit: 'lbs',
      recipeTitle: 'Sheet Pan Fajitas',
      notes: '',
      category: 'Meat & Seafood',
    },
    // 1 lb chicken from Tuscan Pasta
    {
      name: 'Chicken Breast',
      quantity: 1,
      unit: 'lbs',
      recipeTitle: 'Tuscan Pasta',
      notes: 'cubed',
      category: 'Meat & Seafood',
    },
    // 0.5 cup sour cream from Fajitas
    {
      text: '1/2 cup sour cream',
      recipeTitle: 'Sheet Pan Fajitas',
    },
    // 0.5 cup sour cream from Tacos
    {
      text: '1/2 cup sour cream',
      recipeTitle: 'Tacos',
    },
  ];

  const aggregated = aggregateIngredients(rawItems);

  // Verify Yellow Onion merged
  const onion = aggregated.find((i) => i.name.toLowerCase().includes('onion'));
  assert.ok(onion, 'Onion must be present');
  assert.equal(onion.quantity, '3');
  assert.ok(onion.sourceMeals.includes('Sheet Pan Fajitas'));
  assert.ok(onion.sourceMeals.includes('Salmon Bowls'));
  assert.equal(onion.category, 'Produce');

  // Verify Chicken Breast merged
  const chicken = aggregated.find((i) => i.name.toLowerCase().includes('chicken'));
  assert.ok(chicken, 'Chicken must be present');
  assert.equal(chicken.quantity, '2 1/2 lbs');
  assert.ok(chicken.sourceMeals.includes('Sheet Pan Fajitas'));
  assert.ok(chicken.sourceMeals.includes('Tuscan Pasta'));
  assert.equal(chicken.category, 'Meat & Seafood');

  // Verify Sour Cream merged
  const sourCream = aggregated.find((i) => i.name.toLowerCase().includes('sour cream'));
  assert.ok(sourCream, 'Sour cream must be present');
  assert.equal(sourCream.quantity, '1 cup');
  assert.equal(sourCream.category, 'Dairy & Eggs');
});
