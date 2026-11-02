import type { Recipe, RecipeIngredient } from '../../src/shared/types.js';

export interface MockGeminiMealItem {
  title: string;
  description: string;
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  tags: string[];
  ingredients: RecipeIngredient[];
  instructions: string[];
}

export class MockGemini {
  public static mockNormalizedIngredients(rawStrings: string[]): RecipeIngredient[] {
    return rawStrings.map((raw) => {
      const lower = raw.toLowerCase();
      if (lower.includes('chicken')) {
        return {
          name: 'Chicken Breasts',
          quantity: 2,
          unit: 'lbs',
          notes: 'boneless, skinless',
          category: 'Meat & Seafood',
        };
      }
      if (lower.includes('onion')) {
        return {
          name: 'Yellow Onion',
          quantity: 1,
          unit: 'large',
          notes: 'diced',
          category: 'Produce',
        };
      }
      if (lower.includes('garlic')) {
        return {
          name: 'Garlic',
          quantity: 3,
          unit: 'cloves',
          notes: 'minced',
          category: 'Produce',
        };
      }
      if (lower.includes('olive oil')) {
        return {
          name: 'Olive Oil',
          quantity: 2,
          unit: 'tbsp',
          notes: 'extra virgin',
          category: 'Pantry',
        };
      }
      return {
        name: raw.replace(/^\d+[\s\w]*\s+/, '').trim() || raw,
        quantity: 1,
        unit: 'item',
        notes: '',
        category: 'Produce',
      };
    });
  }

  public static mockExtractedRecipeFromText(text: string): MockGeminiMealItem {
    return {
      title: 'Classic Homemade Lasagna',
      description: 'Rich, layered beef and ricotta lasagna with homemade marinara sauce.',
      prepMinutes: 25,
      cookMinutes: 50,
      servings: 8,
      tags: ['Italian', 'Pasta', 'Comfort Food', 'Family Dinner'],
      ingredients: [
        {
          name: 'Ground Beef',
          quantity: 1.5,
          unit: 'lbs',
          notes: 'lean 85/15',
          category: 'Meat & Seafood',
        },
        {
          name: 'Lasagna Noodles',
          quantity: 1,
          unit: 'lb',
          notes: 'boiled al dente',
          category: 'Pantry',
        },
        {
          name: 'Ricotta Cheese',
          quantity: 16,
          unit: 'oz',
          notes: 'whole milk',
          category: 'Dairy & Eggs',
        },
        {
          name: 'Mozzarella Cheese',
          quantity: 16,
          unit: 'oz',
          notes: 'shredded',
          category: 'Dairy & Eggs',
        },
        {
          name: 'Tomato Sauce',
          quantity: 28,
          unit: 'oz',
          notes: 'crushed canned',
          category: 'Pantry',
        },
      ],
      instructions: [
        'Brown ground beef in a skillet and simmer with tomato sauce, garlic, and herbs for 15 minutes.',
        'In a bowl, mix ricotta cheese, egg, and parmesan cheese.',
        'Layer sauce, noodles, ricotta mixture, and mozzarella in a 9x13-inch baking dish.',
        'Bake at 375°F (190°C) covered with foil for 30 minutes, then uncover for 15 minutes until bubbly and golden.',
        'Let rest 10 minutes before slicing and serving.',
      ],
    };
  }

  public static mockMealsDiscovery(query: string): MockGeminiMealItem[] {
    return [
      {
        title: `Quick ${query || 'Family'} Skillet Tacos`,
        description: 'Crispy ground beef tacos with homemade seasoning and fresh toppings.',
        prepMinutes: 10,
        cookMinutes: 15,
        servings: 4,
        tags: ['Quick', 'Mexican', 'Kid-Friendly'],
        ingredients: [
          { name: 'Ground Beef', quantity: 1, unit: 'lb', notes: '', category: 'Meat & Seafood' },
          { name: 'Taco Shells', quantity: 8, unit: 'count', notes: 'crispy', category: 'Pantry' },
          { name: 'Cheddar Cheese', quantity: 1, unit: 'cup', notes: 'shredded', category: 'Dairy & Eggs' },
          { name: 'Romaine Lettuce', quantity: 1, unit: 'head', notes: 'shredded', category: 'Produce' },
        ],
        instructions: [
          'Brown ground beef in skillet with taco seasoning and 1/4 cup water.',
          'Warm taco shells in oven for 5 minutes.',
          'Assemble tacos with meat, cheese, lettuce, and salsa.',
        ],
      },
      {
        title: `Creamy ${query || 'Garlic'} Parmesan Pasta`,
        description: 'Velvety garlic butter parmesan sauce with fettuccine.',
        prepMinutes: 5,
        cookMinutes: 15,
        servings: 4,
        tags: ['Pasta', 'Quick', 'Vegetarian'],
        ingredients: [
          { name: 'Fettuccine', quantity: 1, unit: 'lb', notes: '', category: 'Pantry' },
          { name: 'Heavy Cream', quantity: 1, unit: 'cup', notes: '', category: 'Dairy & Eggs' },
          { name: 'Butter', quantity: 4, unit: 'tbsp', notes: 'unsalted', category: 'Dairy & Eggs' },
          { name: 'Parmesan Cheese', quantity: 1, unit: 'cup', notes: 'grated', category: 'Dairy & Eggs' },
        ],
        instructions: [
          'Boil fettuccine until al dente.',
          'Melt butter with heavy cream and garlic in skillet; simmer 2 minutes.',
          'Whisk in parmesan cheese and toss with pasta.',
        ],
      },
      {
        title: `Pan-Seared ${query || 'Lemon'} Herb Chicken`,
        description: 'Juicy golden chicken breasts with lemon butter and fresh herbs.',
        prepMinutes: 10,
        cookMinutes: 15,
        servings: 4,
        tags: ['Chicken', 'Keto', 'Quick'],
        ingredients: [
          { name: 'Chicken Breasts', quantity: 1.5, unit: 'lbs', notes: 'halved horizontally', category: 'Meat & Seafood' },
          { name: 'Lemon', quantity: 1, unit: 'whole', notes: 'juiced and zested', category: 'Produce' },
          { name: 'Olive Oil', quantity: 2, unit: 'tbsp', notes: '', category: 'Pantry' },
          { name: 'Fresh Rosemary', quantity: 2, unit: 'sprigs', notes: 'minced', category: 'Produce' },
        ],
        instructions: [
          'Season chicken breasts with salt, pepper, and rosemary.',
          'Sear in hot olive oil for 5-6 minutes per side until 165°F.',
          'Finish with fresh lemon juice and butter pan sauce.',
        ],
      },
    ];
  }
}
