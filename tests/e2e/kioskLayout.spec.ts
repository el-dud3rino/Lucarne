import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { startTestServer, TestServerInstance } from './testServer.js';

test('Kiosk 1920x1080 Zero Overflow & Touch Target Sizes across views', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;

  try {
    server = await startTestServer(4056);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page: Page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
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
        `View "${viewName}" must have zero horizontal overflow (scrollWidth: ${overflow.scrollWidth}, clientWidth: ${overflow.clientWidth})`
      );
    };

    // Helper: verify primary interactive controls satisfy >= 40x40px CSS target size
    const assertPrimaryControlTouchTargets = async (viewName: string) => {
      const failures = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('button, select, [role="button"]'));
        const undersized: Array<{ text: string; tag: string; width: number; height: number }> = [];

        for (const el of els) {
          const htmlEl = el as HTMLElement;
          if (htmlEl.offsetParent === null) continue; // skip hidden
          const style = window.getComputedStyle(htmlEl);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            if (rect.width < 39.5 || rect.height < 39.5) {
              undersized.push({
                text: (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label') || '').trim().slice(0, 30),
                tag: el.tagName.toLowerCase(),
                width: Math.round(rect.width * 10) / 10,
                height: Math.round(rect.height * 10) / 10,
              });
            }
          }
        }
        return undersized;
      });

      assert.equal(
        failures.length,
        0,
        `View "${viewName}" has interactive controls undersized below 40x40px touch target: ${JSON.stringify(failures)}`
      );
    };

    // 1. Calendar View: Schedule sub-view (default)
    await page.waitForSelector('text=5-Day');
    await assertZeroHorizontalOverflow('Calendar Schedule');
    await assertPrimaryControlTouchTargets('Calendar Schedule');

    // Calendar: People sub-view
    const peopleTab = page.locator('button', { hasText: 'People' });
    if (await peopleTab.isVisible()) {
      await peopleTab.click();
      await page.waitForTimeout(300);
      await assertZeroHorizontalOverflow('Calendar People');
      await assertPrimaryControlTouchTargets('Calendar People');
    }

    // Calendar: Week sub-view
    const weekTab = page.locator('button', { hasText: 'Week' });
    if (await weekTab.isVisible()) {
      await weekTab.click();
      await page.waitForTimeout(300);
      await assertZeroHorizontalOverflow('Calendar Week');
      await assertPrimaryControlTouchTargets('Calendar Week');
    }

    // Calendar: Month sub-view
    const monthTab = page.locator('button', { hasText: 'Month' });
    if (await monthTab.isVisible()) {
      await monthTab.click();
      await page.waitForTimeout(300);
      await assertZeroHorizontalOverflow('Calendar Month');
      await assertPrimaryControlTouchTargets('Calendar Month');
    }

    // 2. Chores View
    const choresNav = page.locator('aside button', { hasText: 'Chores' });
    await choresNav.click();
    await page.waitForSelector('text=Star Tracker');
    await assertZeroHorizontalOverflow('Chores View');
    await assertPrimaryControlTouchTargets('Chores View');

    // 3. Lists View
    const listsNav = page.locator('aside button', { hasText: 'Lists' });
    await listsNav.click();
    await page.waitForSelector('text=Groceries');
    await assertZeroHorizontalOverflow('Lists View');
    await assertPrimaryControlTouchTargets('Lists View');

    // 4. Meals View
    const mealsNav = page.locator('aside button', { hasText: 'Meals' });
    await mealsNav.click();
    await page.waitForSelector('text=Weekly Plan');
    await assertZeroHorizontalOverflow('Meals View');
    await assertPrimaryControlTouchTargets('Meals View');

    // 5. Cook Mode
    const recipeCard = page.locator('text=Sheet Pan Chicken Fajitas');
    if (await recipeCard.isVisible()) {
      await recipeCard.click();
      await page.waitForSelector('text=Cook Mode');
      await assertZeroHorizontalOverflow('Cook Mode');

      // Close Cook Mode
      const closeCookMode = page.locator('button', { hasText: 'Exit' });
      if (await closeCookMode.isVisible()) {
        await closeCookMode.click();
        await page.waitForTimeout(300);
      }
    }

    // 6. Settings View
    const settingsNav = page.locator('aside button', { hasText: 'Settings' });
    await settingsNav.click();
    await page.waitForSelector('text=Family Profiles & Colors');
    await assertZeroHorizontalOverflow('Settings View');
    await assertPrimaryControlTouchTargets('Settings View');

    // 7. Screensaver Overlay
    const photoFrameBtn = page.locator('button[title*="Screensaver"], button:has-text("Photo Frame")');
    if (await photoFrameBtn.isVisible()) {
      await photoFrameBtn.click();
      await page.waitForTimeout(500);
      await assertZeroHorizontalOverflow('Screensaver Overlay');
      // Tap anywhere to dismiss screensaver
      await page.mouse.click(500, 500);
      await page.waitForTimeout(300);
    }

  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
});
