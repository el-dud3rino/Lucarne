import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { startTestServer, TestServerInstance } from './testServer.js';

test('Mobile Companion PWA (390x844): Bottom Nav, Responsive Views & Zero Horizontal Overflow', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;

  try {
    server = await startTestServer(4059);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page: Page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });

    // Helper: verify zero horizontal overflow (scrollWidth <= clientWidth)
    const assertZeroHorizontalOverflow = async (viewName: string) => {
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
        const clientWidth = Math.max(doc.clientWidth, body.clientWidth);
        return {
          hasOverflow: scrollWidth > clientWidth,
          scrollWidth,
          clientWidth,
        };
      });

      assert.equal(
        overflow.hasOverflow,
        false,
        `Mobile view "${viewName}" must have zero horizontal overflow (scrollWidth: ${overflow.scrollWidth}, clientWidth: ${overflow.clientWidth})`
      );
    };

    // 1. Verify Desktop sidebar is hidden on mobile
    const desktopSidebar = page.locator('aside');
    assert.equal(await desktopSidebar.isVisible(), false, 'Desktop sidebar must be hidden on mobile screen');

    // 2. Verify Mobile Bottom Navigation Bar is visible with 7 items
    const mobileBottomNav = page.locator('nav.md\\:hidden');
    assert.equal(await mobileBottomNav.isVisible(), true, 'Mobile bottom nav bar must be visible on mobile screens');
    const navButtons = mobileBottomNav.locator('button');
    assert.equal(await navButtons.count(), 7, 'Mobile bottom nav bar must contain 7 navigation buttons');

    // 3. Check Calendar View on mobile
    await page.waitForSelector('text=5-Day');
    await assertZeroHorizontalOverflow('Mobile Calendar View');

    // 3b. Home stacks its panels on a phone without sideways overflow
    await mobileBottomNav.locator('button', { hasText: 'Home' }).click();
    await page.waitForSelector('[data-testid="home-view"]');
    await assertZeroHorizontalOverflow('Mobile Home View');

    // 4. Navigate to Chores View via bottom nav
    const choresTab = mobileBottomNav.locator('button', { hasText: 'Chores' });
    await choresTab.click();
    await page.waitForSelector('text=Star Tracker');
    await assertZeroHorizontalOverflow('Mobile Chores View');

    // 5. Navigate to Lists View via bottom nav
    const listsTab = mobileBottomNav.locator('button', { hasText: 'Lists' });
    await listsTab.click();
    await page.waitForSelector('text=Groceries');
    await assertZeroHorizontalOverflow('Mobile Lists View');

    // Verify newItemQty input is visible on mobile companion viewport (<768px)
    const qtyInput = page.locator('input[placeholder="Qty"]');
    assert.equal(
      await qtyInput.isVisible(),
      true,
      'newItemQty input must be visible on mobile companion viewports (<768px)'
    );

    // 6. Navigate to Meals View via bottom nav
    const mealsTab = mobileBottomNav.locator('button', { hasText: 'Meals' });
    await mealsTab.click();
    await page.waitForSelector('text=Weekly Plan');
    await assertZeroHorizontalOverflow('Mobile Meals View');

    // 7. Navigate to Settings View via bottom nav
    const settingsTab = mobileBottomNav.locator('button', { hasText: 'Settings' });
    await settingsTab.click();
    await page.waitForSelector('text=Family Profiles & Colors');
    await assertZeroHorizontalOverflow('Mobile Settings View');

  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
});
