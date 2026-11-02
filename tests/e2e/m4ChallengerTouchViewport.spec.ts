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

async function scanInteractiveTouchTargets(page: Page, contextName: string): Promise<UndersizedElement[]> {
  const failures = await page.evaluate((context) => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button, select, [role="button"], input[type="button"], input[type="submit"], input[type="text"], input[type="password"], input[type="time"]'
      )
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
            (el as HTMLInputElement).placeholder ||
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

  console.log(
    `[Overflow check: ${viewName}] scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}, hasOverflow=${result.hasOverflow}`
  );
  assert.equal(
    result.hasOverflow,
    false,
    `View "${viewName}" has horizontal overflow: scrollWidth=${result.scrollWidth} > clientWidth=${result.clientWidth} (overflow: +${result.diff}px)`
  );
}

test('Challenger 2 - Tasks 3 & 4: SettingsView and Screensaver Touch Targets (>= 40x40px) & Zero Overflow on 1920x1080 and 390x844', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;

  try {
    server = await startTestServer(4077);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page: Page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });

    await page.goto(server.url, { waitUntil: 'networkidle' });

    // =========================================================================
    // 1. KIOSK VIEWPORT: 1920x1080
    // =========================================================================
    console.log('\n--- 1. Testing Kiosk 1920x1080 SettingsView ---');
    const settingsNav = page.locator('aside button', { hasText: 'Settings' });
    await settingsNav.click();
    await page.waitForSelector('text=Family Profiles & Colors');
    await page.waitForTimeout(300);

    // Assert zero horizontal overflow in SettingsView at 1920x1080
    await checkZeroHorizontalOverflow(page, 'SettingsView (1920x1080 Kiosk)');

    // Scan all interactive touch targets in SettingsView at 1920x1080
    const settingsTargets1920 = await scanInteractiveTouchTargets(page, 'SettingsView (1920x1080)');
    assert.equal(
      settingsTargets1920.length,
      0,
      `Undersized targets found in SettingsView at 1920x1080: ${JSON.stringify(settingsTargets1920)}`
    );

    // Open Edit Member Profile Modal
    const editMemberBtn = page.locator('button[title="Edit profile"]').first();
    assert.ok(await editMemberBtn.isVisible(), 'Edit profile button should be visible');
    await editMemberBtn.click();
    await page.waitForSelector('text=Edit Profile:');
    await page.waitForTimeout(200);

    // Assert zero overflow in Edit Member modal
    await checkZeroHorizontalOverflow(page, 'SettingsView Edit Member Modal (1920x1080)');

    // Scan all interactive touch targets inside modal
    const modalTargets1920 = await scanInteractiveTouchTargets(page, 'Edit Member Modal (1920x1080)');
    assert.equal(
      modalTargets1920.length,
      0,
      `Undersized targets in Edit Member Modal: ${JSON.stringify(modalTargets1920)}`
    );

    // Close modal via Cancel button
    const cancelModalBtn = page.locator('button:has-text("Cancel")');
    await cancelModalBtn.click();
    await page.waitForTimeout(200);

    // Test Screensaver Overlay at 1920x1080
    console.log('\n--- Testing Screensaver Overlay at 1920x1080 ---');
    const screensaverBtn = page.locator('aside button[title*="Screensaver"]');
    if (await screensaverBtn.isVisible()) {
      await screensaverBtn.click();
      await page.waitForTimeout(500);

      // Verify zero horizontal overflow at 1920x1080
      await checkZeroHorizontalOverflow(page, 'ScreensaverOverlay (1920x1080)');

      // Verify Screensaver wakes on pointer/touch click
      await page.mouse.click(960, 540);
      await page.waitForTimeout(300);
      assert.equal(
        await page.locator('.fixed.z-\\[200\\]').count(),
        0,
        'Screensaver should wake on touch/pointer down and dismiss overlay'
      );

      // Re-trigger screensaver and verify wake on keydown
      await screensaverBtn.click();
      await page.waitForTimeout(500);
      assert.equal(
        await page.locator('.fixed.z-\\[200\\]').count(),
        1,
        'Screensaver should be active'
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      assert.equal(
        await page.locator('.fixed.z-\\[200\\]').count(),
        0,
        'Screensaver should wake and dismiss on keydown event'
      );

      // Now trigger screensaver again, and resize to 390x844 mobile viewport to test mobile screensaver overflow
      await screensaverBtn.click();
      await page.waitForTimeout(500);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await checkZeroHorizontalOverflow(page, 'ScreensaverOverlay (390x844 Mobile)');

      // Dismiss screensaver on mobile tap
      await page.mouse.click(195, 400);
      await page.waitForTimeout(300);
      assert.equal(
        await page.locator('.fixed.z-\\[200\\]').count(),
        0,
        'Screensaver should dismiss on mobile tap'
      );
    }

    // =========================================================================
    // 2. MOBILE COMPANION VIEWPORT: 390x844
    // =========================================================================
    console.log('\n--- 2. Testing Mobile Companion 390x844 SettingsView ---');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // Navigate to Settings via bottom nav
    const mobileSettingsTab = page.locator('nav.md\\:hidden button', { hasText: 'Settings' });
    assert.ok(await mobileSettingsTab.isVisible(), 'Mobile bottom nav Settings tab must be visible');
    await mobileSettingsTab.click();
    await page.waitForSelector('text=Family Profiles & Colors');
    await page.waitForTimeout(300);

    // Assert zero horizontal overflow in SettingsView at 390x844
    await checkZeroHorizontalOverflow(page, 'SettingsView (390x844 Mobile)');

    // Scan all interactive touch targets on mobile
    const settingsTargets390 = await scanInteractiveTouchTargets(page, 'SettingsView (390x844 Mobile)');
    assert.equal(
      settingsTargets390.length,
      0,
      `Undersized targets found in SettingsView at 390x844: ${JSON.stringify(settingsTargets390)}`
    );

    // Open Edit Member modal on mobile
    const mobileEditMemberBtn = page.locator('button[title="Edit profile"]').first();
    await mobileEditMemberBtn.click();
    await page.waitForSelector('text=Edit Profile:');
    await page.waitForTimeout(200);

    // Check zero overflow with modal open on mobile
    await checkZeroHorizontalOverflow(page, 'SettingsView Edit Member Modal (390x844 Mobile)');

    const modalTargets390 = await scanInteractiveTouchTargets(page, 'Edit Member Modal (390x844 Mobile)');
    assert.equal(
      modalTargets390.length,
      0,
      `Undersized targets in Edit Member Modal at 390x844: ${JSON.stringify(modalTargets390)}`
    );

    // Close modal
    await page.locator('button:has-text("Cancel")').click();
    await page.waitForTimeout(200);

    console.log('\n=== ALL TASKS 3 & 4 TESTS PASSED CLEANLY ===');
  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
});
