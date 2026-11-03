import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { startTestServer, TestServerInstance } from './testServer.js';

interface UndersizedElement {
  context: string;
  tag: string;
  text: string;
  width: number;
  height: number;
  classes: string;
}

// Helper: Scan all visible clickable elements for >= 39.5px touch targets
async function scanTouchTargets(page: Page, contextName: string): Promise<UndersizedElement[]> {
  const failures = await page.evaluate((context) => {
    const candidates = Array.from(
      document.querySelectorAll('button, select, [role="button"], input[type="button"], input[type="submit"]')
    );
    const undersized: Array<{
      context: string;
      tag: string;
      text: string;
      width: number;
      height: number;
      classes: string;
    }> = [];

    for (const el of candidates) {
      const htmlEl = el as HTMLElement;
      if (htmlEl.offsetParent === null) continue; // hidden in DOM
      const style = window.getComputedStyle(htmlEl);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.opacity === '0' ||
        style.pointerEvents === 'none'
      ) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      if (rect.width < 39.5 || rect.height < 39.5) {
        undersized.push({
          context,
          tag: el.tagName.toLowerCase(),
          text: (
            el.textContent ||
            el.getAttribute('title') ||
            el.getAttribute('aria-label') ||
            (el as HTMLInputElement).value ||
            ''
          )
            .trim()
            .slice(0, 40),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          classes: (el.className || '').toString().slice(0, 60),
        });
      }
    }
    return undersized;
  }, contextName);

  if (failures.length > 0) {
    console.log(`[TouchTarget Failures in "${contextName}"]`, JSON.stringify(failures, null, 2));
  } else {
    console.log(`[TouchTarget Pass in "${contextName}"]`);
  }
  return failures;
}

// Helper: Verify zero horizontal overflow (scrollWidth <= clientWidth)
async function checkZeroHorizontalOverflow(page: Page, viewName: string) {
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
    const clientWidth = Math.max(doc.clientWidth, body.clientWidth);
    return {
      hasOverflow: scrollWidth > clientWidth,
      scrollWidth,
      clientWidth,
      diff: scrollWidth - clientWidth,
    };
  });

  console.log(`[Overflow check: ${viewName}] scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}, hasOverflow=${result.hasOverflow}`);
  assert.equal(
    result.hasOverflow,
    false,
    `View "${viewName}" has horizontal overflow: scrollWidth=${result.scrollWidth} > clientWidth=${result.clientWidth} (overflow: +${result.diff}px)`
  );
}

test('Challenger M2: Touch Target Compliance & Multi-Viewport Overflow Stress', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;

  try {
    server = await startTestServer(4092);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page: Page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });

    // =========================================================================
    // PART 1: EXHAUSTIVE TOUCH TARGET SCAN (>= 39.5px) ACROSS ALL VIEWS & MODALS
    // =========================================================================
    const allUndersized: UndersizedElement[] = [];

    // 1.0 Home (default on the wall)
    await page.waitForSelector('[data-testid="home-view"]');
    allUndersized.push(...(await scanTouchTargets(page, 'Home')));

    // 1.1 Calendar Schedule Sub-View
    await page.locator('aside button', { hasText: 'Calendar' }).click();
    await page.waitForSelector('text=5-Day');
    allUndersized.push(...(await scanTouchTargets(page, 'Calendar (Schedule)')));

    // Open EventModal from Calendar
    const addEventBtn = page.locator('button:has-text("Add Event")');
    if (await addEventBtn.isVisible()) {
      await addEventBtn.click();
      await page.waitForSelector('text=Add Family Event');
      allUndersized.push(...(await scanTouchTargets(page, 'EventModal (Add Event)')));

      // Close EventModal via Cancel
      const cancelBtn = page.locator('form button:has-text("Cancel")');
      await cancelBtn.click();
      await page.waitForTimeout(200);
    }

    // 1.2 Calendar People Sub-View
    const peopleTab = page.locator('button', { hasText: 'People' });
    if (await peopleTab.isVisible()) {
      await peopleTab.click();
      await page.waitForTimeout(200);
      allUndersized.push(...(await scanTouchTargets(page, 'Calendar (People)')));
    }

    // 1.3 Calendar Week Sub-View
    const weekTab = page.locator('button', { hasText: 'Week' });
    if (await weekTab.isVisible()) {
      await weekTab.click();
      await page.waitForTimeout(200);
      allUndersized.push(...(await scanTouchTargets(page, 'Calendar (Week)')));
    }

    // 1.4 Calendar Month Sub-View
    const monthTab = page.locator('button', { hasText: 'Month' });
    if (await monthTab.isVisible()) {
      await monthTab.click();
      await page.waitForTimeout(200);
      allUndersized.push(...(await scanTouchTargets(page, 'Calendar (Month)')));
    }

    // Switch back to schedule
    const scheduleTab = page.locator('button', { hasText: '5-Day' });
    if (await scheduleTab.isVisible()) {
      await scheduleTab.click();
      await page.waitForTimeout(200);
    }

    // 1.5 Chores View & Modals
    const choresNav = page.locator('aside button', { hasText: 'Chores' });
    await choresNav.click();
    await page.waitForSelector('text=Star Tracker');
    allUndersized.push(...(await scanTouchTargets(page, 'Chores View')));

    // Open ChoreModal
    const newChoreBtn = page.locator('button:has-text("New Chore")');
    if (await newChoreBtn.isVisible()) {
      await newChoreBtn.click();
      await page.waitForSelector('text=New Chore');
      allUndersized.push(...(await scanTouchTargets(page, 'ChoreModal (New Chore)')));

      // Close ChoreModal
      const cancelChore = page.locator('form button:has-text("Cancel")');
      await cancelChore.click();
      await page.waitForTimeout(200);
    }

    // Open Star Tracker modal
    const starTrackerPill = page.locator('button:has-text("Star Tracker")');
    if (await starTrackerPill.isVisible()) {
      await starTrackerPill.click();
      await page.waitForSelector('text=Household Star Tracker');
      allUndersized.push(...(await scanTouchTargets(page, 'Chores Star Tracker Modal')));

      // Close Star Tracker modal using its dedicated close button inside the modal overlay
      const closeStarsBtn = page.locator('.fixed.z-50 button:has(svg.lucide-x)').first();
      await closeStarsBtn.click();
      await page.waitForTimeout(200);
    }

    // 1.6 Lists View & Create List Form
    const listsNav = page.locator('aside button', { hasText: 'Lists' });
    await listsNav.click();
    await page.waitForSelector('text=Groceries');
    allUndersized.push(...(await scanTouchTargets(page, 'Lists View')));

    // Open Create List form
    const newListBtn = page.locator('button:has-text("New List")');
    if (await newListBtn.isVisible()) {
      await newListBtn.click();
      await page.waitForSelector('input[placeholder="List name..."]');
      allUndersized.push(...(await scanTouchTargets(page, 'Lists View (Create List Form)')));

      const cancelNewList = page.locator('form button:has-text("Cancel")');
      await cancelNewList.click();
      await page.waitForTimeout(200);
    }

    // 1.7 Meals View & Modals
    const mealsNav = page.locator('aside button', { hasText: 'Meals' });
    await mealsNav.click();
    await page.waitForSelector('text=Weekly Plan');
    allUndersized.push(...(await scanTouchTargets(page, 'Meals View (Weekly Plan)')));

    // Open AssignMealModal by clicking an empty meal slot
    const emptySlot = page.locator('div:has-text("Plan")').first();
    if (await emptySlot.isVisible()) {
      await emptySlot.click();
      await page.waitForTimeout(300);
      allUndersized.push(...(await scanTouchTargets(page, 'AssignMealModal')));

      // Close AssignMealModal
      const closeAssign = page.locator('.fixed.z-50 button:has(svg.lucide-x)').first();
      if (await closeAssign.isVisible()) {
        await closeAssign.click();
        await page.waitForTimeout(200);
      }
    }

    // Switch to Recipe Box
    const recipeBoxTab = page.locator('button:has-text("Recipe Box")');
    if (await recipeBoxTab.isVisible()) {
      await recipeBoxTab.click();
      await page.waitForTimeout(200);
      allUndersized.push(...(await scanTouchTargets(page, 'Meals View (Recipe Box)')));
    }

    // Open Cook Mode Modal
    const fajitasCard = page.locator('text=Sheet Pan Chicken Fajitas');
    if (await fajitasCard.isVisible()) {
      await fajitasCard.click();
      await page.waitForSelector('text=Cook Mode');
      allUndersized.push(...(await scanTouchTargets(page, 'Cook Mode Modal')));

      // Exit Cook Mode
      const exitCook = page.locator('button:has-text("Exit")');
      await exitCook.click();
      await page.waitForTimeout(200);
    }

    // Open Import / Discover Meals Modal
    const importMealsBtn = page.locator('button:has-text("Import / Discover Meals")');
    if (await importMealsBtn.isVisible()) {
      await importMealsBtn.click();
      await page.waitForSelector('text=Import & Discover Clean Recipes');
      allUndersized.push(...(await scanTouchTargets(page, 'ImportRecipeModal (URL Tab)')));

      // Test AI Tab in Import Modal
      const aiTab = page.locator('button:has-text("Gemini Meal Search")');
      if (await aiTab.isVisible()) {
        await aiTab.click();
        await page.waitForTimeout(200);
        allUndersized.push(...(await scanTouchTargets(page, 'ImportRecipeModal (AI Tab)')));
      }

      // Test JSON Tab in Import Modal
      const jsonTab = page.locator('button:has-text("JSON Meals Seed")');
      if (await jsonTab.isVisible()) {
        await jsonTab.click();
        await page.waitForTimeout(200);
        allUndersized.push(...(await scanTouchTargets(page, 'ImportRecipeModal (JSON Tab)')));
      }

      // Close Import Modal
      const closeImport = page.locator('.fixed.z-50 button:has(svg.lucide-x)').first();
      if (await closeImport.isVisible()) {
        await closeImport.click();
        await page.waitForTimeout(200);
      }
    }

    // Open Send Week to Groceries Modal (if button visible)
    const sendGroceriesBtn = page.locator('button:has-text("Send Week to Groceries")');
    if (await sendGroceriesBtn.isVisible()) {
      await sendGroceriesBtn.click();
      await page.waitForSelector('text=Send Planned Meals to Groceries');
      allUndersized.push(...(await scanTouchTargets(page, 'SendMealsToGroceriesModal')));

      const cancelSend = page.locator('button:has-text("Cancel")');
      await cancelSend.click();
      await page.waitForTimeout(200);
    }

    // 1.8 Settings View
    const settingsNav = page.locator('aside button', { hasText: 'Settings' });
    await settingsNav.click();
    await page.waitForSelector('text=Family Profiles & Colors');
    allUndersized.push(...(await scanTouchTargets(page, 'Settings View')));

    // 1.9 Screensaver Overlay
    const photosBtn = page.locator('aside button:has-text("Photos"), aside button[title*="Screensaver"]');
    if (await photosBtn.isVisible()) {
      await photosBtn.click();
      await page.waitForTimeout(300);
      allUndersized.push(...(await scanTouchTargets(page, 'Screensaver Overlay')));

      // Dismiss screensaver
      await page.mouse.click(500, 500);
      await page.waitForTimeout(200);
    }

    console.log(`\n=== Exhaustive Touch Target Summary ===`);
    console.log(`Total undersized elements across all views & modals: ${allUndersized.length}`);

    // =========================================================================
    // PART 2: ZERO HORIZONTAL OVERFLOW STRESS ACROSS 6 VIEWPORTS
    // =========================================================================
    console.log('\n=== Multi-Viewport Zero Horizontal Overflow Testing ===');
    const viewports = [
      { name: '1920x1080 (kiosk standard)', width: 1920, height: 1080 },
      { name: '1366x768 (budget kiosk)', width: 1366, height: 768 },
      { name: '1024x768 (compact desktop / iPad landscape)', width: 1024, height: 768 },
      { name: '768x1024 (tablet portrait)', width: 768, height: 1024 },
      { name: '390x844 (iPhone companion)', width: 390, height: 844 },
      { name: '360x640 (Android small companion)', width: 360, height: 640 },
    ];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(200);

      const isMobile = vp.width < 768;

      // Check Calendar View
      if (isMobile) {
        const calTab = page.locator('nav button', { hasText: 'Calendar' });
        if (await calTab.isVisible()) await calTab.click();
      } else {
        const calTab = page.locator('aside button', { hasText: 'Calendar' });
        if (await calTab.isVisible()) await calTab.click();
      }
      await page.waitForTimeout(150);
      await checkZeroHorizontalOverflow(page, `Calendar on ${vp.name}`);

      // Check Chores View
      if (isMobile) {
        await page.locator('nav button', { hasText: 'Chores' }).click();
      } else {
        await page.locator('aside button', { hasText: 'Chores' }).click();
      }
      await page.waitForTimeout(150);
      await checkZeroHorizontalOverflow(page, `Chores on ${vp.name}`);

      // Check Lists View
      if (isMobile) {
        await page.locator('nav button', { hasText: 'Lists' }).click();
      } else {
        await page.locator('aside button', { hasText: 'Lists' }).click();
      }
      await page.waitForTimeout(150);
      await checkZeroHorizontalOverflow(page, `Lists on ${vp.name}`);

      // Check Meals View
      if (isMobile) {
        await page.locator('nav button', { hasText: 'Meals' }).click();
      } else {
        await page.locator('aside button', { hasText: 'Meals' }).click();
      }
      await page.waitForTimeout(150);
      await checkZeroHorizontalOverflow(page, `Meals on ${vp.name}`);

      // Check Settings View
      if (isMobile) {
        await page.locator('nav button', { hasText: 'Settings' }).click();
      } else {
        await page.locator('aside button', { hasText: 'Settings' }).click();
      }
      await page.waitForTimeout(150);
      await checkZeroHorizontalOverflow(page, `Settings on ${vp.name}`);
    }

    // =========================================================================
    // PART 3: MOBILE COMPANION STRESS (390x844) WITH LONG TEXT WRAPPING
    // =========================================================================
    console.log('\n=== Mobile Companion Stress: Long Text Wrapping & Qty Visibility ===');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('nav button', { hasText: 'Lists' }).click();
    await page.waitForTimeout(200);

    // Verify newItemQty is visible
    const qtyInput = page.locator('input[placeholder="Qty"]');
    assert.equal(
      await qtyInput.isVisible(),
      true,
      'newItemQty must be visible on 390x844 mobile companion'
    );

    // Add extremely long text items
    const textInput = page.locator('input[placeholder*="Add to"]');
    await textInput.fill('Extra Long Name Organic Pasture Raised Heirloom Tomato Soup With Fresh Basil And Garlic Croutons');
    await qtyInput.fill('4 jars');
    await page.locator('form button:has-text("Add")').click();
    await page.waitForTimeout(300);

    // Add unbroken 70-character string
    await textInput.fill('Supercalifragilisticexpialidocious_Extra_Long_Organic_Whole_Almond_Milk');
    await qtyInput.fill('2 pk');
    await page.locator('form button:has-text("Add")').click();
    await page.waitForTimeout(300);

    // Verify zero horizontal overflow after long text injection
    await checkZeroHorizontalOverflow(page, 'Mobile Lists with Long Text Items');

    // Verify newItemQty remains visible
    assert.equal(
      await qtyInput.isVisible(),
      true,
      'newItemQty input must remain visible after long items are added'
    );

    // =========================================================================
    // PART 4: CALENDAR MONTH ADVERSARIAL MULTI-EVENT & VIEWPORT STRESS
    // =========================================================================
    console.log('\n=== PART 4: Calendar Month Adversarial Multi-Event & Viewport Stress ===');
    await page.setViewportSize({ width: 1920, height: 1080 });
    const calendarNav = page.locator('aside button', { hasText: 'Calendar' });
    await calendarNav.click();
    await page.waitForTimeout(200);

    const monthTabStress = page.locator('button', { hasText: 'Month' });
    await monthTabStress.click();
    await page.waitForTimeout(300);

    // Initial check on seeded Month view event cards
    const initialMonthCards = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.grid-cols-7.grid-rows-5 button'));
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return {
          text: (c.textContent || '').trim().replace(/\s+/g, ' '),
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
        };
      });
    });

    console.log(`Initial Month view cards found: ${initialMonthCards.length}`);
    for (const card of initialMonthCards) {
      assert.ok(
        card.height >= 39.5,
        `Initial card "${card.text}" height ${card.height}px < 39.5px`
      );
      assert.ok(
        card.width >= 39.5,
        `Initial card "${card.text}" width ${card.width}px < 39.5px`
      );
    }

    // Now inject multiple varied events into the server
    const baseNow = new Date();
    const curY = baseNow.getFullYear();
    const curM = baseNow.getMonth();
    // Clean up any previously injected stress events for idempotency
    const existingRes = await fetch(
      `${server.url}/api/events?start=${encodeURIComponent(
        new Date(curY, curM, 1).toISOString()
      )}&end=${encodeURIComponent(new Date(curY, curM + 1, 1).toISOString())}`
    );
    if (existingRes.ok) {
      const existingEvents = (await existingRes.json()) as Array<{ id: string; title: string }>;
      for (const ev of existingEvents) {
        if (
          ev.title &&
          (ev.title.includes('Festival') ||
            ev.title.includes('Planning') ||
            ev.title.includes('Concert') ||
            ev.title.includes('Library') ||
            ev.title.includes('Checkup') ||
            ev.title.includes('Grading') ||
            ev.title.includes('Quad') ||
            ev.title.includes('Six'))
        ) {
          await fetch(`${server.url}/api/events/${ev.id}`, { method: 'DELETE' });
        }
      }
    }

    const makeIso = (day: number, hour: number, minute: number) => {
      const d = new Date(curY, curM, day, hour, minute, 0);
      return d.toISOString();
    };

    // Day 15: 1 all-day event (single-line)
    await fetch(`${server.url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Single All-Day Festival',
        allDay: true,
        startIso: makeIso(15, 0, 0),
        endIso: makeIso(15, 23, 59),
        memberIds: ['mem-kid1'],
      }),
    });

    // Day 16: 2 events (1 all-day + 1 timed with member avatars)
    await fetch(`${server.url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Teacher Planning Day',
        allDay: true,
        startIso: makeIso(16, 0, 0),
        endIso: makeIso(16, 23, 59),
        memberIds: [],
      }),
    });
    await fetch(`${server.url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Band Concert & Solo Rehearsal',
        allDay: false,
        location: 'High School Auditorium',
        startIso: makeIso(16, 14, 0),
        endIso: makeIso(16, 16, 0),
        memberIds: ['mem-kid1', 'mem-dad'],
      }),
    });

    // Day 17: 3 events (1 all-day + 2 timed) -> exactly fills cell
    await fetch(`${server.url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Library Book Due',
        allDay: true,
        startIso: makeIso(17, 0, 0),
        endIso: makeIso(17, 23, 59),
        memberIds: ['mem-kid2'],
      }),
    });
    await fetch(`${server.url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Pediatric Checkup',
        allDay: false,
        location: 'Main Medical Plaza',
        startIso: makeIso(17, 9, 30),
        endIso: makeIso(17, 10, 30),
        memberIds: ['mem-mom', 'mem-kid2'],
      }),
    });
    await fetch(`${server.url}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Martial Arts Grading',
        allDay: false,
        startIso: makeIso(17, 17, 0),
        endIso: makeIso(17, 18, 30),
        memberIds: ['mem-kid1'],
      }),
    });

    // Day 18: 4 events -> triggers "+1" overflow chip
    for (let i = 1; i <= 4; i++) {
      await fetch(`${server.url}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Quad Event ${i} on Day 18`,
          allDay: i % 2 === 0,
          startIso: makeIso(18, 8 + i * 2, 0),
          endIso: makeIso(18, 9 + i * 2, 0),
          memberIds: ['mem-family'],
        }),
      });
    }

    // Day 19: 6 events -> triggers "+3" overflow chip
    for (let i = 1; i <= 6; i++) {
      await fetch(`${server.url}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Six Event ${i} on Day 19`,
          allDay: i === 1,
          startIso: makeIso(19, 7 + i, 0),
          endIso: makeIso(19, 8 + i, 0),
          memberIds: ['mem-mom', 'mem-dad'],
        }),
      });
    }

    // Reload page to re-fetch all newly inserted events
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    await page.locator('aside button', { hasText: 'Calendar' }).click();

    // Re-select Month sub-view
    const monthTabAfterEvents = page.locator('button', { hasText: 'Month' });
    await monthTabAfterEvents.click();
    await page.waitForTimeout(400);

    // Scan touch targets again in Month view with injected events
    allUndersized.push(...(await scanTouchTargets(page, 'Calendar (Month Multi-Event Stressed)')));

    // Assert ALL event cards in Month view have height >= 39.5px and width >= 39.5px
    const stressedCards = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.grid-cols-7.grid-rows-5 button'));
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return {
          text: (c.textContent || '').trim().replace(/\s+/g, ' '),
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
        };
      });
    });

    console.log(`Stressed Month view cards found: ${stressedCards.length}`);
    assert.ok(stressedCards.length >= 10, `Expected at least 10 cards, got ${stressedCards.length}`);

    const undersizedStressed = stressedCards.filter((c) => c.height < 39.5 || c.width < 39.5);
    assert.equal(
      undersizedStressed.length,
      0,
      `Undersized cards in Month view: ${JSON.stringify(undersizedStressed, null, 2)}`
    );

    // Verify "+N more" overflow chips render cleanly
    const overflowChips = await page.evaluate(() => {
      const chips = Array.from(document.querySelectorAll('.grid-cols-7 span.text-\\[11px\\]'));
      return chips.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent?.trim() || '',
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
          visible: r.width > 0 && r.height > 0,
        };
      });
    });

    console.log('Month view overflow chips detected:', JSON.stringify(overflowChips, null, 2));
    const chipPlusOne = overflowChips.find((c) => c.text === '+1');
    const chipPlusThree = overflowChips.find((c) => c.text === '+3');
    assert.ok(chipPlusOne && chipPlusOne.visible, '"+1" overflow chip must be visible for 4-event cell');
    assert.ok(chipPlusThree && chipPlusThree.visible, '"+3" overflow chip must be visible for 6-event cell');

    // Verify Zero Document Horizontal AND Vertical Overflow at 1920x1080
    const docOverflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
      const clientWidth = Math.max(doc.clientWidth, body.clientWidth);
      const scrollHeight = Math.max(doc.scrollHeight, body.scrollHeight);
      const clientHeight = Math.max(doc.clientHeight, body.clientHeight);
      return {
        hasHOverflow: scrollWidth > clientWidth,
        hDiff: scrollWidth - clientWidth,
        hasVOverflow: scrollHeight > clientHeight,
        vDiff: scrollHeight - clientHeight,
      };
    });

    console.log(`Document overflow check at 1920x1080 in Month view: H_overflow=${docOverflow.hasHOverflow}, V_overflow=${docOverflow.hasVOverflow}`);
    assert.equal(
      docOverflow.hasHOverflow,
      false,
      `Horizontal overflow in Month view: +${docOverflow.hDiff}px`
    );
    assert.equal(
      docOverflow.hasVOverflow,
      false,
      `Vertical overflow in Month view: +${docOverflow.vDiff}px`
    );

    // Verify cell content containment: no card spills outside day cell
    const cellSpills = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.grid-cols-7.grid-rows-5 > div'));
      const spills: Array<{ cellIndex: number; overflowPx: number }> = [];
      cells.forEach((cell, idx) => {
        const cellRect = cell.getBoundingClientRect();
        const cards = Array.from(cell.querySelectorAll('button')) as HTMLButtonElement[];
        if (cards.length === 0) return;
        const lastCard = cards[cards.length - 1];
        const lastCardRect = lastCard.getBoundingClientRect();
        if (lastCardRect.bottom > cellRect.bottom + 2) {
          spills.push({
            cellIndex: idx,
            overflowPx: Math.round((lastCardRect.bottom - cellRect.bottom) * 10) / 10,
          });
        }
      });
      return spills;
    });

    const challengerFailures: string[] = [];

    if (cellSpills.length > 0) {
      challengerFailures.push(
        `Detected ${cellSpills.length} day cells where stacked event cards spill outside cell bounds due to multi-line timed event heights (~50px) exceeding cell capacity (~180px): ${JSON.stringify(cellSpills)}`
      );
    }

    // Verify month navigation stability
    const nextChevron = page.locator('button:has(svg.lucide-chevron-right)').first();
    await nextChevron.click();
    await page.waitForTimeout(300);
    await checkZeroHorizontalOverflow(page, 'Month View: Next Month');

    const prevChevron = page.locator('button:has(svg.lucide-chevron-left)').first();
    await prevChevron.click();
    await page.waitForTimeout(300);
    await prevChevron.click();
    await page.waitForTimeout(300);
    await checkZeroHorizontalOverflow(page, 'Month View: Prev Month');

    // Navigate deterministically to August 2026 (requires 6 weeks / 37 cells), independent of today's date
    const monthIndex = (txt: string | null) => {
      const d = new Date(`1 ${(txt || '').trim()}`);
      return d.getFullYear() * 12 + d.getMonth();
    };
    const targetIdx = 2026 * 12 + 7;
    for (let i = 0; i < 60; i++) {
      const cur = monthIndex(await page.locator('h2').textContent());
      if (cur === targetIdx) break;
      await (cur > targetIdx ? prevChevron : nextChevron).click();
      await page.waitForTimeout(150);
    }

    const augHeader = await page.locator('h2').textContent();
    console.log(`Month header navigated to: "${augHeader}"`);

    const augInMonthDays = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('.grid-cols-7.grid-rows-5 > div'));
      const inMonthCells = cells.filter((c) => !c.classList.contains('opacity-50'));
      const dayNums = inMonthCells.map((c) => c.querySelector('span.w-7.h-7')?.textContent?.trim());
      return dayNums;
    });
    console.log(
      `August 2026 in-month days count: ${augInMonthDays.length}, includes '30': ${augInMonthDays.includes('30')}, includes '31': ${augInMonthDays.includes('31')}`
    );

    if (!augInMonthDays.includes('30') || !augInMonthDays.includes('31')) {
      challengerFailures.push(
        `6-week month truncation defect: August 2026 has 31 days and starts on Saturday, requiring 37 cells across 6 rows, but hardcoded 35-cell grid-rows-5 truncates the month at August 29 (only ${augInMonthDays.length} days shown), omitting August 30 and August 31 completely from view!`
      );
    }

    // Final assertion on touch target failures and challenger findings
    assert.equal(
      allUndersized.length,
      0,
      `Detected ${allUndersized.length} clickable elements undersized below 39.5px: ${JSON.stringify(allUndersized, null, 2)}`
    );

    assert.equal(
      challengerFailures.length,
      0,
      `Adversarial challenger detected ${challengerFailures.length} defect(s):\n${challengerFailures.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    );

    console.log('\n=== ALL CHALLENGER TESTS PASSED SUCCESSFULLY ===');
  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
});
