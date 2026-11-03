import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { startTestServer, TestServerInstance } from './testServer.js';

test('End-to-End User Flows: Calendar, Chores & Stars, Groceries, Meals & Cook Mode', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;

  try {
    server = await startTestServer(4058);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page: Page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });

    // =========================================================
    // 1. CALENDAR EVENT FLOW (Create, View, Edit, Delete)
    // =========================================================
    // The wall opens on Home; go to the Calendar
    await page.waitForSelector('[data-testid="home-view"]');
    await page.locator('aside button', { hasText: 'Calendar' }).click();
    await page.waitForSelector('text=5-Day');

    // Click "+" button on the first day column
    const addEventBtn = page.locator('button[title="Add event"]').first();
    await addEventBtn.click();

    // Event modal should appear
    await page.waitForSelector('text=New Event');
    const titleInput = page.locator('input[placeholder="Event title..."]');
    await titleInput.fill('Family Movie Night');

    // Assign to a family member (click first member pill inside modal form)
    const memberPill = page.locator('form div:has-text("Who is this for?") button').first();
    await memberPill.click();

    // Save event
    const saveBtn = page.locator('button:has-text("Save Event")');
    await saveBtn.click();
    await page.waitForTimeout(500);

    // Verify "Family Movie Night" appears on the calendar
    const eventCard = page.locator('button:has-text("Family Movie Night")').first();
    await eventCard.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await eventCard.isVisible(), true, 'Created event must appear on the calendar');

    // Edit event
    await eventCard.click();
    await page.waitForSelector('text=Edit Event');
    const editTitleInput = page.locator('input[placeholder="Event title..."]');
    await editTitleInput.fill('Family Board Game Night');
    await page.locator('button:has-text("Save Event")').click();
    await page.waitForTimeout(500);

    const updatedEventCard = page.locator('button:has-text("Family Board Game Night")').first();
    await updatedEventCard.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await updatedEventCard.isVisible(), true, 'Updated event title must appear on calendar');

    // Delete event
    await updatedEventCard.click();
    await page.waitForSelector('text=Edit Event');
    const deleteBtn = page.locator('button:has-text("Delete")');
    await deleteBtn.click();
    await page.waitForTimeout(500);

    assert.equal(
      await page.locator('button:has-text("Family Board Game Night")').count(),
      0,
      'Deleted event must be removed from calendar'
    );

    // =========================================================
    // 2. CHORES & STAR TRACKER FLOW
    // =========================================================
    const choresNav = page.locator('aside button', { hasText: 'Chores' });
    await choresNav.click();
    await page.waitForSelector('text=Star Tracker');

    // Open Star Tracker drawer to inspect initial stars
    const starTrackerBtn = page.locator('button:has-text("Star Tracker")');
    await starTrackerBtn.click();
    await page.waitForSelector('[data-testid="rewards-sheet"]');
    await page.waitForSelector('text=Household Star Tracker');

    // Close Star Tracker sheet
    await page.locator('[data-testid="rewards-sheet"] button[aria-label="Close"]').click();
    await page.waitForTimeout(300);

    // Toggle a chore (click the first chore card)
    const choreCard = page.locator('div.group:has(span.text-amber-600)').first();
    await choreCard.waitFor({ state: 'visible' });
    await choreCard.click();
    await page.waitForTimeout(500);

    // =========================================================
    // 3. GROCERY LIST & AISLE AUTO-SORT FLOW
    // =========================================================
    const listsNav = page.locator('aside button', { hasText: 'Lists' });
    await listsNav.click();
    await page.waitForSelector('text=Groceries');

    // Add "2 cartons heavy cream"
    const groceryInput = page.locator('input[placeholder*="auto-sorts"]');
    await groceryInput.fill('2 cartons heavy cream');
    const addGroceryBtn = page.locator('form button:has-text("Add")');
    await addGroceryBtn.click();
    await page.waitForTimeout(500);

    // Verify it got categorized under "Dairy & Eggs"
    const dairySection = page.getByText('Dairy & Eggs', { exact: true }).first();
    await dairySection.waitFor({ state: 'visible', timeout: 5000 });
    const creamItem = page.locator('text=heavy cream').first();
    assert.equal(await creamItem.isVisible(), true, 'Item "heavy cream" should appear under Groceries');

    // Check off the grocery item
    const itemRow = page.locator('div.group:has-text("heavy cream")').first();
    const checkbox = itemRow.locator('button').first();
    await checkbox.click();
    await page.waitForTimeout(500);

    // Verify item is checked (appears in Completed / Checked section)
    const completedHeader = page.locator('text=Completed');
    assert.equal(await completedHeader.isVisible(), true, 'Checked section should be visible');

    // =========================================================
    // 4. MEALS & COOK MODE & SEND TO GROCERIES FLOW
    // =========================================================
    const mealsNav = page.locator('aside button', { hasText: 'Meals' });
    await mealsNav.click();
    await page.waitForSelector('text=Weekly Plan');

    // Switch to Recipe Box tab
    const recipeBoxTab = page.locator('button', { hasText: 'Recipe Box' });
    await recipeBoxTab.click();
    await page.waitForSelector('text=Sheet Pan Chicken Fajitas');

    // Open Cook Mode for "Sheet Pan Chicken Fajitas"
    const fajitasCard = page.locator('button:has-text("Sheet Pan Chicken Fajitas")').first();
    await fajitasCard.click();

    // Verify Cook Mode layout
    await page.waitForSelector('text=Cook Mode · Screen Awake');
    await page.waitForSelector('text=Ingredients');

    // Send ingredients to Groceries
    const sendGroceriesBtn = page.locator('button:has-text("Add Ingredients to Groceries")');
    assert.equal(await sendGroceriesBtn.isVisible(), true, 'Add Ingredients to Groceries button should be visible');
    await sendGroceriesBtn.click();

    // Verify toast confirmation
    await page.waitForSelector('text=Added to Groceries!');

    // Exit Cook Mode
    const exitCookBtn = page.locator('button:has-text("Exit")');
    await exitCookBtn.click();
    await page.waitForTimeout(300);

    // Verify returning to Lists shows the new ingredients from the recipe
    await listsNav.click();
    await page.waitForSelector('text=Groceries');
    // Check that one of the recipe ingredients (e.g. bell peppers or fajita seasoning) is now in Groceries
    const recipeIngredientItem = page.locator('text=/bell peppers|fajita seasoning|chicken/i').first();
    await recipeIngredientItem.waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(
      await recipeIngredientItem.isVisible(),
      true,
      'Ingredients sent from Cook Mode must appear in Groceries list'
    );

  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
});
