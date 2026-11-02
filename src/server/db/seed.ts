import crypto from 'node:crypto';
import { db, runTransaction } from './connection.js';
import type { AppSettings, Recipe } from '../../shared/types.js';

function localDateStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function localDateTimeIso(offsetDays: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const DEFAULT_SETTINGS: AppSettings = {
  familyName: 'Our Family',
  kioskKeyboardEnabled: true,
  screensaverIdleMinutes: 10,
  nightModeEnabled: true,
  nightModeStart: '22:00',
  nightModeEnd: '06:30',
  nightModeBehavior: 'dim',
  weatherLat: 39.8283,
  weatherLon: -98.5795,
  weatherLocationName: 'Local Weather',
  weatherUnit: 'F',
  showDinnerOnCalendar: true,
  defaultGroceryListId: 'list-groceries',
  googleClientId: '',
  googleClientSecretConfigured: false,
  geminiApiKeyConfigured: false,
  lastBackupAt: null,
};

export function seedIfNeeded(): void {
  const existing = db.prepare('SELECT COUNT(*) as count FROM family_members').get() as {
    count: number;
  };
  if (existing.count > 0) return;

  const nowIso = new Date().toISOString();
  const todayStr = localDateStr(0);

  runTransaction(() => {
    // 1. Default Settings
    const upsertSetting = db.prepare(
      'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
    );
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
      if (key === 'googleClientSecretConfigured' || key === 'geminiApiKeyConfigured') continue;
      upsertSetting.run(key, JSON.stringify(val));
    }

    // 2. Family Members (Skylight-style pastel + accent palettes)
    const insertMember = db.prepare(`
      INSERT INTO family_members (id, name, initial, emoji, role, color_bg, color_text, color_accent, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertMember.run('mem-dad', 'Dad', 'D', '🧔', 'parent', '#E0F2FE', '#0C4A6E', '#0284C7', 1);
    insertMember.run('mem-mom', 'Mom', 'M', '👩', 'parent', '#FFE4E6', '#881337', '#E11D48', 2);
    insertMember.run('mem-kid1', 'Leo', 'L', '🦖', 'child', '#DCFCE7', '#14532D', '#16A34A', 3);
    insertMember.run('mem-kid2', 'Maya', 'M', '🦄', 'child', '#FEF3C7', '#78350F', '#D97706', 4);
    insertMember.run('mem-family', 'Family', 'F', '🏡', 'family', '#F3E8FF', '#581C87', '#9333EA', 5);

    // 3. Starter Events around Today
    const insertEvent = db.prepare(`
      INSERT INTO events (id, title, description, location, start_iso, end_iso, all_day, member_ids_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const sampleEvents = [
      {
        title: 'School Drop-off',
        desc: 'Don’t forget signed permission slip',
        loc: 'Oak Elementary',
        start: localDateTimeIso(0, 8, 15),
        end: localDateTimeIso(0, 8, 45),
        allDay: 0,
        members: ['mem-dad', 'mem-kid1', 'mem-kid2'],
      },
      {
        title: 'Pediatric Dentist Checkup',
        desc: '6-month cleaning',
        loc: 'Bright Smiles Dental',
        start: localDateTimeIso(0, 14, 30),
        end: localDateTimeIso(0, 15, 30),
        allDay: 0,
        members: ['mem-mom', 'mem-kid2'],
      },
      {
        title: 'Soccer Practice',
        desc: 'Bring shin guards & water bottle',
        loc: 'Westside Park Field 3',
        start: localDateTimeIso(0, 17, 0),
        end: localDateTimeIso(0, 18, 15),
        allDay: 0,
        members: ['mem-kid1', 'mem-dad'],
      },
      {
        title: 'Spirit Wear Day',
        desc: 'Wear school colors!',
        loc: '',
        start: `${localDateStr(1)}T00:00:00.000Z`,
        end: `${localDateStr(1)}T23:59:59.000Z`,
        allDay: 1,
        members: ['mem-kid1', 'mem-kid2'],
      },
      {
        title: 'Grocery Pickup',
        desc: 'Curbside bay 4',
        loc: 'Local Market',
        start: localDateTimeIso(1, 16, 30),
        end: localDateTimeIso(1, 17, 15),
        allDay: 0,
        members: ['mem-mom'],
      },
      {
        title: 'Swim Lessons',
        desc: 'Towel + goggles packed',
        loc: 'Aquatic Center',
        start: localDateTimeIso(2, 10, 0),
        end: localDateTimeIso(2, 11, 0),
        allDay: 0,
        members: ['mem-kid1', 'mem-kid2', 'mem-family'],
      },
      {
        title: 'Family Movie & Pizza Night',
        desc: 'Kids pick the movie',
        loc: 'Home',
        start: localDateTimeIso(2, 18, 30),
        end: localDateTimeIso(2, 20, 30),
        allDay: 0,
        members: ['mem-family'],
      },
      {
        title: 'Date Night Dinner',
        desc: 'Babysitter arrives at 6:00 PM',
        loc: 'Downtown Bistro',
        start: localDateTimeIso(3, 18, 30),
        end: localDateTimeIso(3, 21, 0),
        allDay: 0,
        members: ['mem-dad', 'mem-mom'],
      },
    ];
    for (const ev of sampleEvents) {
      insertEvent.run(
        crypto.randomUUID(),
        ev.title,
        ev.desc,
        ev.loc,
        ev.start,
        ev.end,
        ev.allDay,
        JSON.stringify(ev.members),
        nowIso
      );
    }

    // 4. Chores (Kids + Parents + Shared "Up for grabs")
    const insertChore = db.prepare(`
      INSERT INTO chores (id, title, emoji, assigned_member_id, time_of_day, frequency, days_of_week_json, stars, active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    const sampleChores = [
      ['chore-1', 'Make Bed', '🛏️', 'mem-kid1', 'morning', 'daily', '[]', 1, 1],
      ['chore-2', 'Brush Teeth & Get Dressed', '🪥', 'mem-kid1', 'morning', 'daily', '[]', 1, 2],
      ['chore-3', 'Pack School Backpack', '🎒', 'mem-kid1', 'evening', 'weekdays', '[]', 1, 3],
      ['chore-4', 'Make Bed', '🛏️', 'mem-kid2', 'morning', 'daily', '[]', 1, 4],
      ['chore-5', 'Brush Teeth & Hair', '🪥', 'mem-kid2', 'morning', 'daily', '[]', 1, 5],
      ['chore-6', 'Tidy Playroom Toys', '🧸', 'mem-kid2', 'evening', 'daily', '[]', 2, 6],
      ['chore-7', 'Start Morning Coffee & Lunches', '☕', 'mem-dad', 'morning', 'weekdays', '[]', 2, 7],
      ['chore-8', 'Take Out Kitchen Trash', '🗑️', 'mem-dad', 'evening', 'daily', '[]', 2, 8],
      ['chore-9', 'Review School Folders', '📂', 'mem-mom', 'afternoon', 'weekdays', '[]', 2, 9],
      ['chore-10', 'Wipe Kitchen Counters', '🧽', 'mem-mom', 'evening', 'daily', '[]', 2, 10],
      ['chore-11', 'Unload Dishwasher', '🍽️', null, 'morning', 'daily', '[]', 2, 11],
      ['chore-12', 'Feed the Dog', '🐕', null, 'evening', 'daily', '[]', 1, 12],
      ['chore-13', 'Fold Laundry Basket', '🧺', null, 'anytime', 'daily', '[]', 3, 13],
    ] as const;

    for (const c of sampleChores) {
      insertChore.run(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8]);
    }

    // Seed a couple completions for today so progress rings & star stats look alive
    const insertComp = db.prepare(`
      INSERT INTO chore_completions (id, chore_id, date_str, completed_by_member_id, stars_earned, completed_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertComp.run(crypto.randomUUID(), 'chore-1', todayStr, 'mem-kid1', 1, nowIso);
    insertComp.run(crypto.randomUUID(), 'chore-4', todayStr, 'mem-kid2', 1, nowIso);
    insertComp.run(crypto.randomUUID(), 'chore-7', todayStr, 'mem-dad', 2, nowIso);
    insertComp.run(crypto.randomUUID(), 'chore-11', todayStr, 'mem-mom', 2, nowIso);

    // 5. Lists & Smart Groceries
    const insertList = db.prepare(`
      INSERT INTO lists (id, name, emoji, color_accent, is_grocery, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertList.run('list-groceries', 'Groceries', '🛒', '#16A34A', 1, 1);
    insertList.run('list-costco', 'Costco Run', '📦', '#0284C7', 1, 2);
    insertList.run('list-todos', 'House Projects', '🔨', '#D97706', 0, 3);

    const insertItem = db.prepare(`
      INSERT INTO list_items (id, list_id, text, quantity, category, checked, added_by_member_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const sampleItems = [
      ['list-groceries', 'Honeycrisp Apples', '6', 'Produce', 0, 'mem-mom'],
      ['list-groceries', 'Avocados', '3', 'Produce', 0, 'mem-dad'],
      ['list-groceries', 'Baby Spinach', '1 tub', 'Produce', 0, 'mem-mom'],
      ['list-groceries', 'Whole Milk', '1 gal', 'Dairy & Eggs', 0, 'mem-dad'],
      ['list-groceries', 'Pasture-Raised Eggs', '2 doz', 'Dairy & Eggs', 0, 'mem-mom'],
      ['list-groceries', 'Shredded Sharp Cheddar', '8 oz', 'Dairy & Eggs', 0, 'mem-dad'],
      ['list-groceries', 'Sourdough Bread', '1 loaf', 'Bakery', 0, 'mem-mom'],
      ['list-groceries', 'Bananas', '1 bunch', 'Produce', 1, 'mem-dad'],
      ['list-costco', 'Paper Towels', '1 pack', 'Household', 0, 'mem-dad'],
      ['list-costco', 'Sparkling Water', '2 cases', 'Snacks & Drinks', 0, 'mem-mom'],
      ['list-todos', 'Replace HVAC Air Filter (20x25x1)', '', 'Other', 0, 'mem-dad'],
      ['list-todos', 'Hang Kids Art Frames in Hallway', '', 'Other', 0, 'mem-mom'],
    ] as const;

    for (const it of sampleItems) {
      insertItem.run(crypto.randomUUID(), it[0], it[1], it[2], it[3], it[4], it[5], nowIso);
    }

    // 6. Starter Recipes & Meal Plan
    const sampleRecipes: Recipe[] = [
      {
        id: 'rec-fajitas',
        title: 'Sheet Pan Chicken Fajitas',
        description: 'Quick 25-minute weeknight sheet pan fajitas with caramelized bell peppers and warm tortillas.',
        imageUrl: 'https://images.unsplash.com/photo-1534352956036-cd81e27dd615?auto=format&fit=crop&w=900&q=80',
        sourceUrl: null,
        prepMinutes: 10,
        cookMinutes: 18,
        servings: 4,
        tags: ['Quick', 'Weeknight', 'Mexican', 'Kid-Friendly'],
        ingredients: [
          { name: 'Chicken Breasts', quantity: 1.5, unit: 'lbs', notes: 'sliced into strips', category: 'Meat & Seafood' },
          { name: 'Bell Peppers', quantity: 3, unit: 'whole', notes: 'thinly sliced', category: 'Produce' },
          { name: 'Yellow Onion', quantity: 1, unit: 'large', notes: 'sliced', category: 'Produce' },
          { name: 'Lime', quantity: 2, unit: 'whole', notes: 'juiced', category: 'Produce' },
          { name: 'Flour Tortillas', quantity: 8, unit: 'count', notes: 'warmed', category: 'Bakery' },
          { name: 'Sour Cream', quantity: 0.5, unit: 'cup', notes: 'for serving', category: 'Dairy & Eggs' },
          { name: 'Olive Oil', quantity: 2, unit: 'tbsp', notes: '', category: 'Pantry' },
        ],
        instructions: [
          'Preheat oven to 425°F (220°C) and line a large rimmed baking sheet with parchment.',
          'Toss sliced chicken, bell peppers, and onion on the sheet pan with olive oil, chili powder, cumin, garlic powder, salt, and pepper.',
          'Spread in an even layer and roast for 16–18 minutes until chicken reaches 165°F and peppers are tender-crisp.',
          'Squeeze fresh lime juice over the hot pan, toss once, and serve immediately in warm tortillas with sour cream and avocado.',
        ],
        favorite: true,
        createdAt: nowIso,
      },
      {
        id: 'rec-salmon',
        title: 'Honey Garlic Glazed Salmon Bowls',
        description: 'Crispy-edged salmon bites glazed with honey, soy sauce, and garlic over steamed jasmine rice and broccoli.',
        imageUrl: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?auto=format&fit=crop&w=900&q=80',
        sourceUrl: null,
        prepMinutes: 10,
        cookMinutes: 15,
        servings: 4,
        tags: ['Healthy', '30-Min', 'Seafood'],
        ingredients: [
          { name: 'Salmon Fillets', quantity: 1.5, unit: 'lbs', notes: 'cubed into bite-size pieces', category: 'Meat & Seafood' },
          { name: 'Broccoli Crowns', quantity: 2, unit: 'heads', notes: 'cut into florets', category: 'Produce' },
          { name: 'Garlic', quantity: 4, unit: 'cloves', notes: 'minced', category: 'Produce' },
          { name: 'Jasmine Rice', quantity: 2, unit: 'cups', notes: 'uncooked', category: 'Pantry' },
          { name: 'Honey', quantity: 3, unit: 'tbsp', notes: '', category: 'Pantry' },
          { name: 'Soy Sauce', quantity: 0.25, unit: 'cup', notes: 'low sodium', category: 'Pantry' },
        ],
        instructions: [
          'Rinse jasmine rice and cook according to package or rice cooker instructions.',
          'Steam or roast broccoli florets with a drizzle of oil and pinch of salt until bright green and tender.',
          'Sear seasoned salmon cubes in a hot skillet for 2–3 minutes per side until golden.',
          'Whisk honey, soy sauce, and minced garlic together; pour into pan and simmer 1 minute until glossy. Spoon over rice and broccoli.',
        ],
        favorite: true,
        createdAt: nowIso,
      },
      {
        id: 'rec-tuscan-pasta',
        title: 'Creamy Sun-Dried Tomato & Spinach Pasta',
        description: 'One-skilletrigatoni with garlic parmesan cream sauce, baby spinach, and tender chicken.',
        imageUrl: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?auto=format&fit=crop&w=900&q=80',
        sourceUrl: null,
        prepMinutes: 10,
        cookMinutes: 20,
        servings: 5,
        tags: ['Pasta', 'Comfort Food', 'One-Pot'],
        ingredients: [
          { name: 'Rigatoni Pasta', quantity: 1, unit: 'lb', notes: '', category: 'Pantry' },
          { name: 'Heavy Cream', quantity: 1, unit: 'cup', notes: '', category: 'Dairy & Eggs' },
          { name: 'Parmesan Cheese', quantity: 0.75, unit: 'cup', notes: 'freshly grated', category: 'Dairy & Eggs' },
          { name: 'Baby Spinach', quantity: 4, unit: 'oz', notes: '', category: 'Produce' },
          { name: 'Chicken Broth', quantity: 1, unit: 'cup', notes: '', category: 'Pantry' },
        ],
        instructions: [
          'Boil rigatoni in salted water until al dente; reserve 1/2 cup pasta water before draining.',
          'Simmer chicken broth and heavy cream in a deep skillet for 3 minutes, then whisk in grated parmesan until smooth.',
          'Fold in baby spinach until wilted, then toss in warm rigatoni and splash of pasta water until glossy.',
        ],
        favorite: false,
        createdAt: nowIso,
      },
    ];

    const insertRecipe = db.prepare(`
      INSERT INTO recipes (
        id, title, description, image_url, source_url, prep_minutes, cook_minutes, servings,
        tags_json, ingredients_json, instructions_json, favorite, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of sampleRecipes) {
      insertRecipe.run(
        r.id,
        r.title,
        r.description,
        r.imageUrl,
        r.sourceUrl,
        r.prepMinutes,
        r.cookMinutes,
        r.servings,
        JSON.stringify(r.tags),
        JSON.stringify(r.ingredients),
        JSON.stringify(r.instructions),
        r.favorite ? 1 : 0,
        r.createdAt
      );
    }

    const insertMeal = db.prepare(`
      INSERT INTO meal_plans (id, date_str, slot, recipe_id, custom_title, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insertMeal.run(crypto.randomUUID(), localDateStr(0), 'dinner', 'rec-fajitas', '', 'Use leftover salsa');
    insertMeal.run(crypto.randomUUID(), localDateStr(1), 'dinner', 'rec-salmon', '', '');
    insertMeal.run(crypto.randomUUID(), localDateStr(2), 'dinner', null, 'Homemade Pizza Night', 'Kids pick toppings');
    insertMeal.run(crypto.randomUUID(), localDateStr(3), 'dinner', 'rec-tuscan-pasta', '', 'Garlic bread on the side');

    // 7. Starter Screensaver Photos
    const insertPhoto = db.prepare(`
      INSERT INTO photos (id, url, orientation, caption, source, created_at)
      VALUES (?, ?, ?, ?, 'starter', ?)
    `);
    const starterPhotos = [
      ['https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1920&q=85', 'landscape', 'Yosemite Valley'],
      ['https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=1920&q=85', 'landscape', 'Morning Mist'],
      ['https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1920&q=85', 'landscape', 'Alpine Lake'],
    ] as const;
    for (const p of starterPhotos) {
      insertPhoto.run(crypto.randomUUID(), p[0], p[1], p[2], nowIso);
    }
  });
}
