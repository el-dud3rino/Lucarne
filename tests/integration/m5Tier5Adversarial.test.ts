import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { MockGoogleServer } from '../mocks/googleMockServer.js';

test('Milestone 5 Phase 2 — Tier 5 Adversarial Audit Suite', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucarne-m5-adv-tier5-'));
  const mockServer = new MockGoogleServer();
  const mockUrl = await mockServer.start();

  process.env.DATA_DIR = tempDir;
  process.env.GOOGLE_OAUTH_BASE_URL = mockUrl;
  process.env.GOOGLE_API_BASE_URL = mockUrl;
  process.env.GOOGLE_PHOTOS_PICKER_BASE_URL = mockUrl;
  process.env.GOOGLE_AUTH_BASE_URL = `${mockUrl}/auth`;
  process.env.GOOGLE_CLIENT_ID = 'm5_adv_client_id';
  process.env.GOOGLE_CLIENT_SECRET = 'm5_adv_client_secret';

  try {
    const { initSchema } = await import('../../src/server/db/schema.js');
    const { seedIfNeeded } = await import('../../src/server/db/seed.js');
    const { db, runTransaction, performBackup, BACKUPS_DIR, MEDIA_PHOTOS_DIR } = await import(
      '../../src/server/db/connection.js'
    );
    const { eventsRouter } = await import('../../src/server/routes/events.js');
    const { choresRouter } = await import('../../src/server/routes/chores.js');
    const { listsRouter } = await import('../../src/server/routes/lists.js');
    const { mealsRouter } = await import('../../src/server/routes/meals.js');
    const { photosRouter, detectOrientationFromBuffer } = await import('../../src/server/routes/photos.js');
    const { settingsRouter } = await import('../../src/server/routes/settings.js');
    const { familyRouter } = await import('../../src/server/routes/family.js');
    const { registerSSEClient, broadcastInvalidate } = await import('../../src/server/sse.js');
    const { expandRecurringEvent } = await import('../../src/server/services/recurrence.js');
    const {
      parseFractionNumber,
      formatQuantityNumber,
      formatQuantityWithUnit,
      normalizeIngredientName,
      normalizeUnit,
      mergeQuantities,
      parseItemInput,
      aggregateIngredients,
    } = await import('../../src/shared/ingredientAggregator.js');
    const { classifyGroceryItem } = await import('../../src/shared/groceryClassifier.js');
    const {
      flushOutboxMutations,
      exchangeCodeAndSaveAccount,
      syncAllEnabledCalendars,
    } = await import('../../src/server/services/google.js');

    initSchema();
    seedIfNeeded();

    const app = new Hono();
    app.route('/api/events', eventsRouter);
    app.route('/api/chores', choresRouter);
    app.route('/api/lists', listsRouter);
    app.route('/api/meals', mealsRouter);
    app.route('/api/photos', photosRouter);
    app.route('/api/settings', settingsRouter);
    app.route('/api/family', familyRouter);

    // =========================================================================
    // SECTION 1: REST Endpoints Malformed & Adversarial Payloads
    // =========================================================================
    await t.test('Section 1.1: Calendar Events Malformed Payloads & Recurrence Exceptions', async () => {
      // 1. Inverted date range (start > end)
      const invRes = await app.request('/api/events?start=2026-12-31T00:00:00Z&end=2026-01-01T00:00:00Z');
      assert.equal(invRes.status, 200);
      const invList = (await invRes.json()) as unknown[];
      assert.equal(invList.length, 0, 'Inverted date window must return empty array without crashing');

      // 2. Malformed query parameters
      const badQueryRes = await app.request('/api/events?start=not-a-date&end=still-not-a-date');
      assert.equal(badQueryRes.status, 200);

      // 3. SQL injection attempt in query params
      const sqliRes = await app.request("/api/events?start=2026-01-01' OR '1'='1&end=2026-12-31");
      assert.equal(sqliRes.status, 200);

      // 4. Create event with empty body
      const createRes = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(createRes.status, 201);
      const createdEv = (await createRes.json()) as { id: string; title: string };
      assert.equal(createdEv.title, 'New Event', 'Empty body must default to New Event');

      // 5. Update non-existent event ID -> 404
      const update404 = await app.request('/api/events/non-existent-id-9999', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Title' }),
      });
      assert.equal(update404.status, 404);

      // 6. Delete non-existent event ID -> 404
      const del404 = await app.request('/api/events/non-existent-id-9999', { method: 'DELETE' });
      assert.equal(del404.status, 404);

      // 7. Recurring series creation and single-instance deletion via scope=this
      const recurCreate = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Daily Standup',
          startIso: '2026-11-01T09:00:00.000Z',
          endIso: '2026-11-01T09:30:00.000Z',
          recurrenceRule: 'daily',
        }),
      });
      assert.equal(recurCreate.status, 201);
      const recurEv = (await recurCreate.json()) as { id: string };

      // Query window 2026-11-01 to 2026-11-05 (5 instances)
      const recurQuery1 = await app.request(
        '/api/events?start=2026-11-01T00:00:00.000Z&end=2026-11-05T23:59:59.000Z'
      );
      assert.equal(recurQuery1.status, 200);
      const instances1 = (await recurQuery1.json()) as Array<{ id: string }>;
      const matching1 = instances1.filter((i) => i.id.startsWith(recurEv.id));
      assert.equal(matching1.length, 5, 'Must expand 5 daily instances');

      // Delete only the 2026-11-03 instance
      const delInstanceRes = await app.request(`/api/events/${recurEv.id}_2026-11-03?scope=this`, {
        method: 'DELETE',
      });
      assert.equal(delInstanceRes.status, 200);

      // Verify that 2026-11-03 instance is now omitted while 11-01, 11-02, 11-04, 11-05 remain
      const recurQuery2 = await app.request(
        '/api/events?start=2026-11-01T00:00:00.000Z&end=2026-11-05T23:59:59.000Z'
      );
      const instances2 = (await recurQuery2.json()) as Array<{ id: string }>;
      const matching2 = instances2.filter((i) => i.id.startsWith(recurEv.id));
      assert.equal(matching2.length, 4, 'Must have 4 instances remaining after single-instance delete');
      assert.ok(!matching2.some((i) => i.id.includes('2026-11-03')), 'Deleted instance must be absent');

      // Update series via virtual instance ID (${recurEv.id}_2026-11-02)
      const updateSeriesRes = await app.request(`/api/events/${recurEv.id}_2026-11-02`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Daily Household Sync' }),
      });
      assert.equal(updateSeriesRes.status, 200);
      const updatedSeries = (await updateSeriesRes.json()) as { title: string };
      assert.equal(updatedSeries.title, 'Daily Household Sync');

      // Clean up master series
      const delMaster = await app.request(`/api/events/${recurEv.id}`, { method: 'DELETE' });
      assert.equal(delMaster.status, 200);
    });

    await t.test('Section 1.2: Chores Endpoints & Attribution', async () => {
      // 1. Create a shared chore (no assigned member)
      const createChoreRes = await app.request('/api/chores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Sweep Front Porch', stars: 2 }),
      });
      assert.equal(createChoreRes.status, 201);
      const chore = (await createChoreRes.json()) as { id: string; assignedMemberId: string | null };
      assert.equal(chore.assignedMemberId, null);

      // 2. Toggle shared chore without completer -> 400
      const toggleNoMember = await app.request(`/api/chores/${chore.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStr: '2026-11-01' }),
      });
      assert.equal(toggleNoMember.status, 400);
      const errBody = await toggleNoMember.json();
      assert.ok(errBody.error.includes('Please select who completed this shared chore'));

      // 3. Toggle shared chore with valid member -> completed: true
      const toggleWithMember = await app.request(`/api/chores/${chore.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStr: '2026-11-01', completedByMemberId: 'mem-kid1' }),
      });
      assert.equal(toggleWithMember.status, 200);
      assert.deepEqual(await toggleWithMember.json(), { completed: true });

      // 4. Toggle same chore on same day -> completed: false (untoggle)
      const untoggle = await app.request(`/api/chores/${chore.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStr: '2026-11-01' }),
      });
      assert.equal(untoggle.status, 200);
      assert.deepEqual(await untoggle.json(), { completed: false });

      // 5. Toggle non-existent chore -> 404
      const toggle404 = await app.request('/api/chores/fake-chore-9999/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStr: '2026-11-01' }),
      });
      assert.equal(toggle404.status, 404);

      // Clean up chore
      const delChore = await app.request(`/api/chores/${chore.id}`, { method: 'DELETE' });
      assert.equal(delChore.status, 200);
    });

    await t.test('Section 1.3: Lists, Item Deduplication & Clear-Checked', async () => {
      // 1. Create a test list
      const createListRes = await app.request('/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Camping Trip', emoji: '🏕️' }),
      });
      assert.equal(createListRes.status, 201);
      const list = (await createListRes.json()) as { id: string };

      // 2. Add item with empty text -> 400
      const emptyTextRes = await app.request(`/api/lists/${list.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '   ' }),
      });
      assert.equal(emptyTextRes.status, 400);

      // 3. Add item: "2 gallons whole milk"
      const addItem1 = await app.request(`/api/lists/${list.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '2 gallons whole milk' }),
      });
      assert.equal(addItem1.status, 201);
      const item1 = (await addItem1.json()) as { id: string; quantity: string; text: string; category: string };
      assert.equal(item1.text, 'whole milk');
      assert.equal(item1.quantity, '2 gallons');
      assert.equal(item1.category, 'Dairy & Eggs');

      // 4. Add duplicate item: "1 gallon whole milk" -> must merge into existing row (status 200, 3 gallons)
      const addItem2 = await app.request(`/api/lists/${list.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '1 gallon whole milk' }),
      });
      assert.equal(addItem2.status, 200);
      const item2 = (await addItem2.json()) as { id: string; quantity: string };
      assert.equal(item2.id, item1.id, 'Item ID must be preserved upon merge');
      assert.equal(item2.quantity, '3 gallons', 'Quantities must sum to 3 gallons');

      // 5. Add second distinct item: "Marshmallows"
      const addItem3 = await app.request(`/api/lists/${list.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '1 bag Marshmallows' }),
      });
      assert.equal(addItem3.status, 201);
      const item3 = (await addItem3.json()) as { id: string };

      // Check item 1
      const checkRes = await app.request(`/api/lists/items/${item1.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checked: true }),
      });
      assert.equal(checkRes.status, 200);

      // 6. Clear checked items from list
      const clearRes = await app.request(`/api/lists/${list.id}/clear-checked`, { method: 'POST' });
      assert.equal(clearRes.status, 200);

      const itemsRes = await app.request(`/api/lists/${list.id}/items`);
      const remainingItems = (await itemsRes.json()) as Array<{ id: string }>;
      assert.equal(remainingItems.length, 1);
      assert.equal(remainingItems[0].id, item3.id, 'Only unchecked Marshmallows should remain');

      // Clean up list
      await app.request(`/api/lists/${list.id}`, { method: 'DELETE' });
    });

    await t.test('Section 1.4: Recipes, Seed Import & Send-to-Groceries', async () => {
      // 1. Search with special regex meta characters
      const regexSearch = await app.request('/api/meals/recipes?q=.*+?^$()[]{}|\\');
      assert.equal(regexSearch.status, 200);
      const emptyMatch = (await regexSearch.json()) as unknown[];
      assert.equal(emptyMatch.length, 0);

      // 2. Flexible JSON seed import: malformed objects, varied root keys
      const seedPayload = {
        meals: [
          {
            meal: 'Tacos Al Pastor',
            prep_time: 'PT15M',
            cook_time: 'PT20M',
            yield: 6,
            items: [
              { item: 'Pork Shoulder', quantity: 2, unit: 'lbs' },
              { item: 'Pineapple', quantity: 1, unit: 'whole' },
              { item: 'Corn Tortillas', quantity: 12, unit: 'count' },
            ],
            directions: ['Marinate pork with achiote', 'Sear on high heat with pineapple', 'Serve on warm tortillas'],
          },
          // Missing title should be safely skipped
          { description: 'No title recipe', ingredients: ['1 apple'] },
          // Malformed entry
          null,
        ],
      };

      const importRes = await app.request('/api/meals/recipes/import-json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(seedPayload),
      });
      assert.equal(importRes.status, 200);
      const importStats = (await importRes.json()) as { imported: number; ids: string[] };
      assert.equal(importStats.imported, 1, 'Only valid recipe should be imported');
      const importedId = importStats.ids[0];

      // 3. Update meal plan with upsert on conflict
      const planRes1 = await app.request('/api/meals/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateStr: '2026-11-10', slot: 'dinner', recipeId: importedId }),
      });
      assert.equal(planRes1.status, 200);

      const planRes2 = await app.request('/api/meals/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateStr: '2026-11-10',
          slot: 'dinner',
          customTitle: 'Tacos with extra salsa',
        }),
      });
      assert.equal(planRes2.status, 200);

      const planListRes = await app.request('/api/meals/plan?start=2026-11-10&end=2026-11-10');
      const planItems = (await planListRes.json()) as Array<{ customTitle: string }>;
      assert.equal(planItems.length, 1);
      assert.equal(planItems[0].customTitle, 'Tacos with extra salsa');

      // 4. Send aggregated ingredients to groceries
      const sendRes = await app.request('/api/meals/send-to-groceries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listId: 'list-groceries',
          items: [
            { name: 'Pork Shoulder', quantity: 2, unit: 'lbs', mealName: 'Tacos Al Pastor' },
            { name: 'Pork Shoulder', quantity: 1, unit: 'lb', mealName: 'Carnitas' },
            { name: 'Limes', quantity: 4, unit: '', mealName: 'Tacos' },
            { name: 'Lime', quantity: 2, unit: '', mealName: 'Cocktails' },
          ],
        }),
      });
      assert.equal(sendRes.status, 200);
      const sendStats = (await sendRes.json()) as { total: number };
      assert.ok(sendStats.total >= 2);

      // Verify Pork Shoulder was aggregated to 3 lbs
      const groceryRows = db
        .prepare("SELECT * FROM list_items WHERE list_id = 'list-groceries' AND text LIKE '%Pork%'")
        .all() as Array<{ quantity: string }>;
      assert.ok(groceryRows.length >= 1);
      assert.equal(groceryRows[0].quantity, '3 lbs');

      // Clean up recipe
      await app.request(`/api/meals/recipes/${importedId}`, { method: 'DELETE' });
    });

    // =========================================================================
    // SECTION 2: Recurrence Expansion Engine & Extreme Date Boundaries
    // =========================================================================
    await t.test('Section 2: Recurrence Engine Stress & Boundaries', () => {
      const baseDaily = {
        id: 'ev-recur-daily',
        title: 'Morning Alarm',
        description: '',
        location: '',
        startIso: '2026-12-30T07:00:00.000Z',
        endIso: '2026-12-30T07:15:00.000Z',
        allDay: false,
        memberIds: [],
        calendarSourceId: null,
        externalEventId: null,
        updatedAt: '2026-10-30T00:00:00Z',
        recurrenceRule: 'daily' as const,
        exceptionDates: ['2027-01-01'],
      };

      // 1. Daily across month & year boundary with an exception date
      const instances = expandRecurringEvent(
        baseDaily,
        '2026-12-30T00:00:00.000Z',
        '2027-01-03T23:59:59.000Z'
      );
      assert.equal(instances.length, 4, 'Dec 30, Dec 31, Jan 2, Jan 3 (Jan 1 skipped via exception)');
      assert.ok(!instances.some((i) => i.id.includes('2027-01-01')));

      // 2. Fast-forward past events (event starts 5 years ago)
      const oldWeekly = {
        ...baseDaily,
        id: 'ev-recur-old',
        startIso: '2020-01-05T10:00:00.000Z',
        endIso: '2020-01-05T11:00:00.000Z',
        recurrenceRule: 'weekly' as const,
        exceptionDates: [],
      };
      const ffInstances = expandRecurringEvent(
        oldWeekly,
        '2026-11-01T00:00:00.000Z',
        '2026-11-30T23:59:59.000Z'
      );
      assert.ok(ffInstances.length >= 4, 'Must fast-forward weekly recurrence accurately');
      for (const inst of ffInstances) {
        assert.equal(new Date(inst.startIso).getUTCDay(), 0, 'Every occurrence must be on Sunday');
      }

      // 3. Monthly Day-31 recurrence: Leap Year 2024 (Feb 29) vs Non-Leap Year 2025 (Feb 28) vs 30-day months
      const monthly31 = {
        ...baseDaily,
        id: 'ev-recur-31',
        startIso: '2024-01-31T12:00:00.000Z',
        endIso: '2024-01-31T13:00:00.000Z',
        recurrenceRule: 'monthly' as const,
        exceptionDates: [],
      };

      // Feb 2024 (leap year)
      const leapFeb = expandRecurringEvent(
        monthly31,
        '2024-02-01T00:00:00.000Z',
        '2024-02-29T23:59:59.000Z'
      );
      assert.equal(leapFeb.length, 1);
      assert.ok(leapFeb[0].startIso.startsWith('2024-02-29'), 'Must clamp to Feb 29 in leap year');

      // Feb 2025 (non-leap year)
      const nonLeapFeb = expandRecurringEvent(
        monthly31,
        '2025-02-01T00:00:00.000Z',
        '2025-02-28T23:59:59.000Z'
      );
      assert.equal(nonLeapFeb.length, 1);
      assert.ok(nonLeapFeb[0].startIso.startsWith('2025-02-28'), 'Must clamp to Feb 28 in non-leap year');

      // March 2025 (must restore to day 31, NOT stay at 28!)
      const march25 = expandRecurringEvent(
        monthly31,
        '2025-03-01T00:00:00.000Z',
        '2025-03-31T23:59:59.000Z'
      );
      assert.equal(march25.length, 1);
      assert.ok(march25[0].startIso.startsWith('2025-03-31'), 'Must restore back to Day 31');

      // 4. Extreme 100-year window must be safely capped at MAX_INSTANCES_PER_EVENT = 500
      const baseDailyNoExceptions = { ...baseDaily, exceptionDates: [] };
      const hugeWindow = expandRecurringEvent(
        baseDailyNoExceptions,
        '2026-01-01T00:00:00.000Z',
        '2126-01-01T00:00:00.000Z'
      );
      assert.equal(hugeWindow.length, 500, 'Must enforce 500 instance maximum safeguard without exceptions');

      // With 1 exception date inside window, 500 iterations minus 1 skipped occurrence = 499 instances
      const hugeWindowWithExc = expandRecurringEvent(
        baseDaily,
        '2026-01-01T00:00:00.000Z',
        '2126-01-01T00:00:00.000Z'
      );
      assert.equal(hugeWindowWithExc.length, 499, 'Must be 499 instances with 1 exception date');

      // 5. Invalid date strings
      assert.equal(expandRecurringEvent(baseDaily, 'invalid', 'also-invalid').length, 0);
    });

    // =========================================================================
    // SECTION 3: Culinary Math, Vulgar Fractions & Grocery Classifier
    // =========================================================================
    await t.test('Section 3: Culinary Aggregation & Grocery Classification Stress', () => {
      // 1. Vulgar Fractions
      assert.equal(parseFractionNumber('½'), 0.5);
      assert.equal(parseFractionNumber('⅓'), 1 / 3);
      assert.equal(parseFractionNumber('⅔'), 2 / 3);
      assert.equal(parseFractionNumber('¼'), 0.25);
      assert.equal(parseFractionNumber('¾'), 0.75);
      assert.equal(parseFractionNumber('⅛'), 0.125);
      assert.equal(parseFractionNumber('1 ½'), 1.5);
      assert.equal(parseFractionNumber('2¾'), 2.75);
      assert.equal(parseFractionNumber('3-1/2'), 3.5);

      // Division by zero protection
      assert.equal(parseFractionNumber('1/0'), null);
      assert.equal(parseFractionNumber('2 1/0'), null);

      // 2. Zero & negative handling
      assert.equal(formatQuantityNumber(0), '');
      assert.equal(formatQuantityNumber(-5), '');

      // 3. Invariant culinary nouns
      const invariants = ['asparagus', 'hummus', 'couscous', 'molasses', 'citrus', 'oats', 'lentils'];
      for (const word of invariants) {
        assert.equal(
          normalizeIngredientName(word),
          word,
          `Invariant noun "${word}" must not have trailing s removed`
        );
      }

      // 4. Plural stem singularization
      assert.equal(normalizeIngredientName('Strawberries'), 'strawberry');
      assert.equal(normalizeIngredientName('Tomatoes'), 'tomato');
      assert.equal(normalizeIngredientName('Loaves'), 'loaf');
      assert.equal(normalizeIngredientName('Radishes'), 'radish');
      assert.equal(normalizeIngredientName('Honeycrisp Apples'), 'honeycrisp apple');

      // 5. Unit conversions & Merging
      // Weight Imperial: 1 lb + 8 oz = 1 1/2 lbs
      assert.equal(mergeQuantities('1 lb', '8 oz'), '1 1/2 lbs');
      // Weight Metric: 500 g + 500 g = 1000 g (identical unit preserved)
      assert.equal(mergeQuantities('500 g', '500 g'), '1000 g');
      // Weight Metric cross-unit: 1 kg + 500 g = 1 1/2 kg
      assert.equal(mergeQuantities('1 kg', '500 g'), '1 1/2 kg');
      // Volume US: 1 cup + 16 tbsp = 2 cups
      assert.equal(mergeQuantities('1 cup', '16 tbsp'), '2 cups');
      // Incompatible units
      assert.equal(mergeQuantities('1 can', '2 cups'), '1 can + 2 cups');
      // Compound terms
      assert.equal(mergeQuantities('1 can + 1 cup', '2 cups'), '1 can + 3 cups');

      // 6. Rapid tap staple increment
      assert.equal(mergeQuantities('', ''), '2');
      assert.equal(mergeQuantities('2', ''), '3');
      assert.equal(mergeQuantities('3', ''), '4');

      // 7. Grocery Classifier Frozen priority & aisle categorization
      assert.equal(classifyGroceryItem('frozen broccoli florets'), 'Frozen');
      assert.equal(classifyGroceryItem('chicken breast'), 'Meat & Seafood');
      assert.equal(classifyGroceryItem('frozen chicken nuggets'), 'Frozen');
      assert.equal(classifyGroceryItem('heavy cream'), 'Dairy & Eggs');
      assert.equal(classifyGroceryItem('paper towels'), 'Household');
      assert.equal(classifyGroceryItem('sourdough bread'), 'Bakery');
      assert.equal(classifyGroceryItem('sparkling water'), 'Snacks & Drinks');
      assert.equal(classifyGroceryItem('jasmine rice'), 'Pantry');
    });

    // =========================================================================
    // SECTION 4: SQLite WAL Integrity, Rollback & Backup Verification
    // =========================================================================
    await t.test('Section 4: SQLite Transaction Rollback & Backup Sniffing', () => {
      // 1. Transaction rollback test: verify no partial write and connection unlocks cleanly
      const initialCount = (
        db.prepare('SELECT COUNT(*) as c FROM family_members').get() as { c: number }
      ).c;

      assert.throws(
        () => {
          runTransaction(() => {
            db.prepare(
              `INSERT INTO family_members (id, name, initial, emoji, role, color_bg, color_text, color_accent, sort_order)
               VALUES ('test-rollback', 'Rollback Ghost', 'G', '👻', 'child', '#FFF', '#000', '#123', 99)`
            ).run();
            // Deliberately throw inside transaction
            throw new Error('Simulated failure during transaction');
          });
        },
        /Simulated failure/,
        'runTransaction must rethrow error'
      );

      // Verify row was rolled back
      const afterCount = (
        db.prepare('SELECT COUNT(*) as c FROM family_members').get() as { c: number }
      ).c;
      assert.equal(afterCount, initialCount, 'Rolled-back transaction must leave count unchanged');
      assert.equal(
        db.prepare("SELECT id FROM family_members WHERE id = 'test-rollback'").get(),
        undefined,
        'Rolled-back row must not exist'
      );

      // Verify connection is immediately usable for subsequent transactions
      const nextResult = runTransaction(() => {
        return db.prepare('SELECT COUNT(*) as c FROM app_settings').get() as { c: number };
      });
      assert.ok(nextResult.c > 0, 'Subsequent transaction must succeed without locked database error');

      // 2. Perform point-in-time backup and inspect SQLite file
      const backupPath = performBackup();
      assert.ok(fs.existsSync(backupPath), 'Backup file must exist on disk');

      const backupDb = new DatabaseSync(backupPath);
      const integrity = backupDb.prepare('PRAGMA integrity_check;').get() as {
        integrity_check?: string;
      };
      assert.equal(integrity.integrity_check, 'ok', 'Backup snapshot must pass PRAGMA integrity_check');

      const backupMembers = backupDb.prepare('SELECT COUNT(*) as c FROM family_members').get() as {
        c: number;
      };
      assert.equal(backupMembers.c, initialCount, 'Backup must contain exact member count');
      backupDb.close();

      // 3. Backup pruning test: produce 10 backups and verify at most 7 remain
      for (let i = 0; i < 9; i++) {
        performBackup();
      }
      const retainedBackups = fs
        .readdirSync(BACKUPS_DIR)
        .filter((f) => f.startsWith('lucarne-') && f.endsWith('.db'));
      assert.ok(
        retainedBackups.length <= 7,
        `Retained backups (${retainedBackups.length}) must be <= 7 after pruning`
      );
    });

    // =========================================================================
    // SECTION 5: SSE Real-Time Stream & Broken Client Resilience
    // =========================================================================
    await t.test('Section 5: SSE Connection Pool & Drop Resilience', () => {
      const messagesClient1: string[] = [];
      const messagesClient2: string[] = [];

      // Register client 1 (healthy)
      const unreg1 = registerSSEClient('test-client-1', (chunk) => {
        messagesClient1.push(chunk);
      });

      // Register client 2 (broken: throws on write)
      registerSSEClient('test-client-2', () => {
        throw new Error('Broken TCP pipe');
      });

      // Register client 3 (healthy)
      const unreg3 = registerSSEClient('test-client-3', (chunk) => {
        messagesClient2.push(chunk);
      });

      // Broadcast invalidation across topics
      broadcastInvalidate(['events', 'chores']);

      // Healthy clients must receive the message despite client 2 throwing
      assert.equal(messagesClient1.length, 1);
      assert.equal(messagesClient2.length, 1);
      assert.ok(messagesClient1[0].includes('"type":"invalidate"'));
      assert.ok(messagesClient1[0].includes('events'));

      // Second broadcast: verify broken client 2 was pruned and does not affect broadcast
      broadcastInvalidate(['lists']);
      assert.equal(messagesClient1.length, 2);
      assert.equal(messagesClient2.length, 2);

      // Clean up clients
      unreg1();
      unreg3();
    });

    // =========================================================================
    // SECTION 6: Offline Outbox & Retry Backoff Semantics
    // =========================================================================
    await t.test('Section 6: Outbox Retry Semantics & Exponential Backoff', async () => {
      // Create a Google account and calendar source linked to an unreachable URL
      const testAccountId = `acc-test-${crypto.randomUUID()}`;
      const testSourceId = `src-test-${crypto.randomUUID()}`;

      db.prepare(`
        INSERT INTO google_accounts (id, email, display_name, access_token, refresh_token, expiry_date, sync_status)
        VALUES (?, 'offline@example.com', 'Offline User', 'fake_token', 'fake_refresh', ${Date.now() + 3600_000}, 'ok')
      `).run(testAccountId);

      db.prepare(`
        INSERT INTO calendar_sources (id, google_account_id, external_calendar_id, name, enabled, is_writable)
        VALUES (?, ?, 'primary', 'Offline Cal', 1, 1)
      `).run(testSourceId, testAccountId);

      // Create an event that enqueues an outbox mutation
      const evRes = await app.request('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Offline Event',
          calendarSourceId: testSourceId,
        }),
      });
      assert.equal(evRes.status, 201);
      const ev = (await evRes.json()) as { id: string };

      // Point API URL to dead address to trigger fetch error
      process.env.GOOGLE_API_BASE_URL = 'http://127.0.0.1:1';

      // Flush outbox: must fail gracefully and record attempt with exponential backoff
      await flushOutboxMutations(true);

      const mutation = db
        .prepare("SELECT * FROM outbox_mutations WHERE entity_id = ? AND action = 'upsert'")
        .get(ev.id) as { attempts: number; next_retry_at: number; last_error: string } | undefined;

      assert.ok(mutation, 'Mutation must remain in outbox without being deleted');
      assert.equal(mutation.attempts, 1, 'Attempt counter must increment to 1');
      assert.ok(mutation.next_retry_at > Date.now(), 'next_retry_at must be in the future');
      assert.ok(mutation.last_error, 'last_error must record failure details');

      // Test 5 failed attempts: verify mutation is NOT abandoned / deleted
      for (let i = 2; i <= 5; i++) {
        await flushOutboxMutations(true);
      }
      const mutationAfter5 = db
        .prepare('SELECT attempts, next_retry_at FROM outbox_mutations WHERE entity_id = ?')
        .get(ev.id) as { attempts: number; next_retry_at: number } | undefined;

      assert.ok(mutationAfter5, 'Mutation must NOT be discarded after 5 attempts');
      assert.equal(mutationAfter5.attempts, 5, 'Attempts must equal 5');

      // Clean up event and verify outbox mutation is removed
      await app.request(`/api/events/${ev.id}`, { method: 'DELETE' });

      // Restore mock URL
      process.env.GOOGLE_API_BASE_URL = mockUrl;
    });
  } finally {
    await mockServer.stop();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
