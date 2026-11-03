/**
 * Builds a fictional demo household for screenshots and trying Lucarne out.
 *
 *   npm run demo:seed            # writes ./demo-data (git-ignored)
 *   npm run demo:seed -- --fresh # wipe and rebuild it
 *
 * Never touches your real data: it refuses to run against ./data. Dates are relative to today.
 * Photos are free-to-use Unsplash images (already used by Lucarne's starter seed).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEMO_DIR = path.resolve(process.env.DEMO_DATA_DIR || './demo-data');
if (DEMO_DIR === path.resolve('./data')) {
  console.error('Refusing to write demo data into ./data (your real household data).');
  process.exit(1);
}
if (process.argv.includes('--fresh')) fs.rmSync(DEMO_DIR, { recursive: true, force: true });
process.env.DATA_DIR = DEMO_DIR;

const { db, runTransaction } = await import('../src/server/db/connection.js');
const { initSchema } = await import('../src/server/db/schema.js');
const { seedIfNeeded } = await import('../src/server/db/seed.js');
const { classifyGroceryItem } = await import('../src/shared/groceryClassifier.js');
const { normalizeIngredientName } = await import('../src/shared/ingredientAggregator.js');

initSchema();
const already = (db.prepare("SELECT value FROM app_settings WHERE key = 'demoSeeded'").get() as { value: string } | undefined);
if (already) {
  console.log(`Demo data already exists in ${DEMO_DIR}. Use --fresh to rebuild it.`);
  process.exit(0);
}
seedIfNeeded(); // fictional starter family (Dad, Mom, Leo, Maya), recipes, chores, lists, photos

// ---------- helpers (local time) ----------
const day = (offset: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
};
const dateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = (offset: number, h: number, m = 0) => {
  const d = day(offset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const allDay = (startOffset: number, endOffset = startOffset) => ({
  start: `${dateStr(day(startOffset))}T00:00:00.000Z`,
  end: `${dateStr(day(endOffset))}T23:59:59.000Z`,
});
/** Next date (offset from today) falling on a weekday (0=Sun). */
const nextWeekday = (dow: number, from = 0) => {
  for (let i = from; i < from + 7; i++) if (day(i).getDay() === dow) return i;
  return from;
};
const offsetOf = (d: Date) => Math.round((d.getTime() - day(0).getTime()) / 86_400_000);
const nthWeekday = (year: number, month: number, dow: number, n: number) => {
  const d = new Date(year, month, 1, 12);
  while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 7 * (n - 1));
  return d;
};
const lastWeekday = (year: number, month: number, dow: number) => {
  const d = new Date(year, month + 1, 0, 12);
  while (d.getDay() !== dow) d.setDate(d.getDate() - 1);
  return d;
};

const nowIso = new Date().toISOString();
const DAD = 'mem-dad', MOM = 'mem-mom', LEO = 'mem-kid1', MAYA = 'mem-kid2', FAMILY = 'mem-family';

runTransaction(() => {
  // ---------- settings ----------
  const set = db.prepare(
    'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  set.run('familyName', JSON.stringify('Parker Household'));
  set.run('weatherLat', JSON.stringify(39.7392));
  set.run('weatherLon', JSON.stringify(-104.9903));
  set.run('weatherLocationName', JSON.stringify('Denver'));
  set.run('demoSeeded', JSON.stringify(true));

  // ---------- events ----------
  const insertEvent = db.prepare(
    `INSERT INTO events (id, title, description, location, start_iso, end_iso, all_day, member_ids_json, recurrence_rule, category, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ev = (
    title: string,
    start: string,
    end: string,
    members: string[],
    opts: { allDay?: boolean; loc?: string; desc?: string; repeat?: string; category?: 'birthday' | 'holiday' } = {}
  ) =>
    insertEvent.run(
      crypto.randomUUID(),
      title,
      opts.desc ?? '',
      opts.loc ?? '',
      start,
      end,
      opts.allDay ? 1 : 0,
      JSON.stringify(members),
      opts.repeat ?? null,
      opts.category ?? null,
      nowIso
    );

  // This week: a believable, busy family schedule
  ev('Morning Run', at(1, 6, 30), at(1, 7, 15), [DAD], { loc: 'Wash Park loop' });
  ev('Book Club', at(1, 19, 30), at(1, 21, 0), [MOM], { loc: "Jen's house" });
  ev('Leo: Science Museum Field Trip', allDay(2).start, allDay(2).end, [LEO], { allDay: true, desc: 'Packed lunch, no peanuts' });
  ev('Team Standup (WFH)', at(2, 9, 0), at(2, 9, 30), [MOM]);
  ev('Haircuts', at(2, 15, 45), at(2, 16, 30), [LEO, MAYA], { loc: 'Snip-its' });
  ev('Grandma visiting', allDay(3).start, allDay(5).end, [FAMILY], { allDay: true });
  ev('Parent–Teacher Conference', at(3, 16, 0), at(3, 16, 30), [MOM, DAD, MAYA], { loc: 'Oak Elementary, Room 12' });
  ev('Pizza & Game Night', at(4, 18, 0), at(4, 20, 0), [FAMILY]);
  ev('Vet: Biscuit annual checkup', at(5, 10, 0), at(5, 10, 45), [DAD], { loc: 'Cherry Creek Animal Clinic' });
  ev("Maya's Birthday", allDay(6).start, allDay(6).end, [MAYA], { allDay: true, category: 'birthday' });
  ev("Maya's Birthday Party", at(6, 13, 0), at(6, 15, 0), [FAMILY], { loc: 'Bounce Zone' });
  ev("Grandpa Joe's Birthday", allDay(9).start, allDay(9).end, [FAMILY], { allDay: true, category: 'birthday' });
  ev('Lake House Weekend', allDay(15).start, allDay(17).end, [FAMILY], { allDay: true, loc: 'Grand Lake' });
  ev('Leo: Dentist', at(20, 8, 30), at(20, 9, 15), [LEO, MOM], { loc: 'Bright Smiles Dental' });
  ev("Aunt Rosa's Birthday", allDay(23).start, allDay(23).end, [FAMILY], { allDay: true, category: 'birthday' });
  ev('School Concert', at(12, 18, 30), at(12, 19, 30), [MAYA, LEO, MOM, DAD], { loc: 'Oak Elementary Gym' });

  // Recurring routines
  const tue = nextWeekday(2, -6);
  ev('Maya: Piano Lesson', at(tue, 16, 0), at(tue, 16, 45), [MAYA], { repeat: 'weekly', loc: 'Ms. Lee’s studio' });
  const sat = nextWeekday(6, -6);
  ev('Leo: Soccer Game', at(sat, 9, 0), at(sat, 10, 0), [LEO, DAD], { repeat: 'weekly', loc: 'Westside Park Field 3' });
  const thu = nextWeekday(4, -6);
  ev('Trash & Recycling Night', at(thu, 19, 0), at(thu, 19, 15), [DAD], { repeat: 'weekly' });

  // US holidays this year and next, on their real dates
  for (const y of [day(0).getFullYear(), day(0).getFullYear() + 1]) {
    const holidays: Array<[string, Date]> = [
      ["New Year's Day", new Date(y, 0, 1, 12)],
      ['Memorial Day', lastWeekday(y, 4, 1)],
      ['Independence Day', new Date(y, 6, 4, 12)],
      ['Labor Day', nthWeekday(y, 8, 1, 1)],
      ['Halloween', new Date(y, 9, 31, 12)],
      ['Veterans Day', new Date(y, 10, 11, 12)],
      ['Thanksgiving', nthWeekday(y, 10, 4, 4)],
      ['Christmas Day', new Date(y, 11, 25, 12)],
    ];
    for (const [name, d] of holidays) {
      const o = offsetOf(d);
      if (o >= -45 && o <= 90) ev(name, allDay(o).start, allDay(o).end, [], { allDay: true, category: 'holiday' });
    }
  }

  // ---------- chores: some stars already earned today ----------
  const today = dateStr(day(0));
  const chores = db.prepare('SELECT id, assigned_member_id, stars FROM chores WHERE assigned_member_id IS NOT NULL').all() as Array<{
    id: string;
    assigned_member_id: string;
    stars: number;
  }>;
  const done = db.prepare(
    `INSERT OR IGNORE INTO chore_completions (id, chore_id, date_str, completed_by_member_id, stars_earned, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  chores.filter((_, i) => i % 2 === 0).forEach((c) =>
    done.run(crypto.randomUUID(), c.id, today, c.assigned_member_id, c.stars, nowIso)
  );
  // A little history so the weekly star totals look lived-in
  for (let back = 1; back <= 5; back++) {
    chores.forEach((c, i) => {
      if ((i + back) % 3 !== 0) done.run(crypto.randomUUID(), c.id, dateStr(day(-back)), c.assigned_member_id, c.stars, nowIso);
    });
  }

  // ---------- groceries across aisles ----------
  const item = db.prepare(
    `INSERT INTO list_items (id, list_id, text, quantity, category, checked, added_by_member_id, updated_at)
     VALUES (?, 'list-groceries', ?, ?, ?, ?, ?, ?)`
  );
  // (The starter seed already has apples, avocados, spinach, milk, eggs, cheddar, bread, bananas,
  // paper towels and sparkling water, so these avoid duplicates.)
  const groceries: Array<[string, string, number?]> = [
    ['Baby carrots', '1 bag'], ['Strawberries', '2 lbs'], ['Cilantro', '1 bunch'], ['Greek yogurt', '32 oz'],
    ['Salmon fillets', '1.5 lbs'], ['Ground turkey', '1 lb'], ['Hamburger buns', '8'], ['Chicken broth', '2 cartons'],
    ['Black beans', '2 cans'], ['Peanut butter', '1 jar'], ['Tortilla chips', '1 bag'], ['Frozen peas', '1 bag'],
    ['Dog treats', '1 bag'], ['Birthday candles', ''], ['Lemons', '3', 1], ['Coffee', '1 bag', 1],
  ];
  groceries.forEach(([text, qty, checked], i) =>
    item.run(crypto.randomUUID(), text, qty, classifyGroceryItem(text), checked ? 1 : 0, i % 3 === 0 ? MOM : DAD, new Date(Date.now() - i * 60_000).toISOString())
  );

  // ---------- this week's meal plan ----------
  const recipes = db.prepare('SELECT id, title FROM recipes ORDER BY title').all() as Array<{ id: string; title: string }>;
  const plan = db.prepare(
    `INSERT OR REPLACE INTO meal_plans (id, date_str, slot, recipe_id, custom_title, notes) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const dinners: Array<string | null> = [recipes[0]?.id ?? null, null, recipes[1]?.id ?? null, null, null, recipes[2]?.id ?? null, null];
  const customs = ['', 'Taco Tuesday', '', 'Leftovers', 'Pizza night', '', 'Grilled cheese & tomato soup'];
  for (let i = 0; i < 7; i++) {
    const d = dateStr(day(i));
    plan.run(crypto.randomUUID(), d, 'dinner', dinners[i], dinners[i] ? '' : customs[i], '');
    if (i % 2 === 0) plan.run(crypto.randomUUID(), d, 'breakfast', null, i === 0 ? 'Pancakes & berries' : 'Oatmeal bar', '');
    if (i < 5) plan.run(crypto.randomUUID(), d, 'lunch', null, i % 2 ? 'Turkey wraps' : 'Leftovers', '');
  }

  // ---------- getting there: drive times and drivers ----------
  // A swim lesson starting ~40 min from now with a 20 min drive, so the "Leave in …" banner shows.
  const soon = new Date(Date.now() + 40 * 60_000);
  soon.setMinutes(Math.ceil(soon.getMinutes() / 5) * 5, 0, 0);
  db.prepare(
    `INSERT INTO events (id, title, description, location, start_iso, end_iso, all_day, member_ids_json, updated_at, travel_minutes, driver_member_id)
     VALUES (?, 'Leo: Swim Lesson', 'Goggles + towel', 'Rec Center Pool', ?, ?, 0, ?, ?, 20, ?)`
  ).run(crypto.randomUUID(), soon.toISOString(), new Date(soon.getTime() + 45 * 60_000).toISOString(), JSON.stringify([LEO]), nowIso, MOM);
  db.prepare("UPDATE events SET travel_minutes = 15, driver_member_id = ? WHERE title = 'Leo: Soccer Game'").run(DAD);
  db.prepare("UPDATE events SET travel_minutes = 10, driver_member_id = ? WHERE title = 'Maya: Piano Lesson'").run(MOM);

  // ---------- countdowns ----------
  const cd = db.prepare('INSERT INTO countdowns (id, title, emoji, date_str, member_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  cd.run(crypto.randomUUID(), "Maya's Birthday", '🎂', dateStr(day(6)), MAYA, nowIso);
  cd.run(crypto.randomUUID(), 'Lake House Weekend', '🏞️', dateStr(day(15)), null, nowIso);
  cd.run(crypto.randomUUID(), 'Disney Trip', '🏰', dateStr(day(48)), null, nowIso);

  // ---------- rewards ----------
  const rw = db.prepare('INSERT INTO rewards (id, title, emoji, cost, member_id, active, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)');
  const rewards: Array<[string, string, number]> = [
    ['Pick the family movie', '🎬', 15],
    ['Stay up 30 min late', '🌙', 20],
    ['Ice cream trip', '🍦', 30],
    ['New book or small toy', '🧸', 50],
  ];
  const rewardIds = rewards.map(([title, emoji, cost], i) => {
    const id = crypto.randomUUID();
    rw.run(id, title, emoji, cost, null, i);
    return id;
  });
  db.prepare(
    'INSERT INTO reward_redemptions (id, reward_id, member_id, title, emoji, cost, redeemed_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), rewardIds[0], MAYA, rewards[0][0], rewards[0][1], rewards[0][2], new Date(Date.now() - 86_400_000).toISOString());

  // ---------- routines (some steps already done this morning) ----------
  const addRoutine = (memberId: string, title: string, emoji: string, time: string, stars: number, steps: Array<[string, string]>, doneCount: number) => {
    const rid = crypto.randomUUID();
    db.prepare(
      'INSERT INTO routines (id, title, emoji, member_id, time_of_day, days_of_week_json, stars, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
    ).run(rid, title, emoji, memberId, time, '[]', stars);
    steps.forEach(([e, t], i) => {
      const sid = crypto.randomUUID();
      db.prepare('INSERT INTO routine_steps (id, routine_id, title, emoji, sort_order) VALUES (?, ?, ?, ?, ?)').run(sid, rid, t, e, i);
      if (i < doneCount) db.prepare('INSERT INTO routine_step_checks (step_id, date_str, checked_at) VALUES (?, ?, ?)').run(sid, today, nowIso);
    });
  };
  const morning: Array<[string, string]> = [['🛏️', 'Make bed'], ['👕', 'Get dressed'], ['🥣', 'Eat breakfast'], ['🪥', 'Brush teeth'], ['🎒', 'Pack backpack'], ['👟', 'Shoes on']];
  const bedtime: Array<[string, string]> = [['🧸', 'Tidy toys'], ['🛁', 'Bath'], ['👕', 'Pajamas on'], ['🪥', 'Brush teeth'], ['📚', 'Story time']];
  addRoutine(LEO, 'School morning', '🌅', 'morning', 2, morning, 4);
  addRoutine(MAYA, 'School morning', '🌅', 'morning', 2, morning, 6);
  addRoutine(LEO, 'Bedtime', '🌙', 'evening', 1, bedtime, 0);
  addRoutine(MAYA, 'Bedtime', '🌙', 'evening', 1, bedtime, 0);
  addRoutine(MAYA, 'After school', '🎒', 'afternoon', 0, [['🎒', 'Unpack backpack'], ['🍎', 'Snack'], ['📝', 'Homework'], ['🎹', 'Piano practice']], 0);

  // ---------- habits with a little history ----------
  const addHabit = (memberId: string, title: string, emoji: string, target: number, unit: string, history: number[]) => {
    const hid = crypto.randomUUID();
    db.prepare('INSERT INTO habits (id, title, emoji, member_id, target_per_day, unit, sort_order) VALUES (?, ?, ?, ?, ?, ?, 0)').run(hid, title, emoji, memberId, target, unit);
    history.forEach((n, i) => {
      if (n > 0) db.prepare('INSERT INTO habit_logs (habit_id, date_str, count) VALUES (?, ?, ?)').run(hid, dateStr(day(i - history.length + 1)), n);
    });
  };
  addHabit(MAYA, 'Piano practice', '🎹', 1, '', [1, 1, 0, 1, 1, 1, 1]);
  addHabit(LEO, 'Reading', '📚', 20, 'min', [20, 25, 20, 10, 20, 30, 10]);
  addHabit(MOM, 'Drink water', '💧', 6, 'glasses', [6, 7, 5, 6, 6, 8, 3]);
  addHabit(DAD, 'Move', '🏃', 30, 'min', [30, 0, 45, 30, 30, 0, 0]);

  // ---------- grocery history (powers the "Usual" quick-add tiles) ----------
  const hist = db.prepare('INSERT OR REPLACE INTO grocery_history (name_key, text, category, add_count, last_added_at, hidden) VALUES (?, ?, ?, ?, ?, 0)');
  const usual: Array<[string, number]> = [
    ['Milk', 14], ['Bananas', 12], ['Eggs', 11], ['Bread', 9], ['Strawberries', 8], ['Greek yogurt', 7], ['Shredded cheese', 7],
    ['Chicken breasts', 6], ['Apples', 6], ['Tortillas', 5], ['Butter', 5], ['Goldfish crackers', 4], ['Paper towels', 4],
  ];
  usual.forEach(([text, n], i) => hist.run(normalizeIngredientName(text), text, classifyGroceryItem(text), n, new Date(Date.now() - i * 86_400_000).toISOString()));
});

console.log(`Demo household ready in ${DEMO_DIR}`);
console.log('Run it with:  DATA_DIR=./demo-data PORT=3002 npm start   (or npm run demo:screenshots)');
