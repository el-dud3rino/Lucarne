import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { startTestServer, TestServerInstance } from './testServer.js';

test('Touch Keyboard: Kiosk 1080p Virtual Keyboard & Mobile Suppression', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;

  try {
    server = await startTestServer(4057);
    browser = await chromium.launch({ channel: 'msedge', headless: true });

    // ---------------------------------------------------------
    // 1. KIOSK MODE (1920x1080)
    // ---------------------------------------------------------
    const kioskPage: Page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
    });

    await kioskPage.goto(server.url, { waitUntil: 'networkidle' });

    // Navigate to Lists view
    await kioskPage.locator('aside button', { hasText: 'Lists' }).click();
    await kioskPage.waitForSelector('text=Groceries');

    // Find the item input
    const groceryInput = kioskPage.locator('input[placeholder*="auto-sorts"]');
    await groceryInput.waitFor({ state: 'visible' });

    // Ensure keyboard is not visible before focus
    const doneBtn = kioskPage.locator('button:has-text("Done")');
    assert.equal(await doneBtn.isVisible(), false, 'Keyboard should not be visible before focus');

    // Focus input
    await groceryInput.focus();
    await doneBtn.waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(await doneBtn.isVisible(), true, 'Virtual keyboard should appear on focus in kiosk mode');

    // Verify Quick Chips are displayed in keyboard top preview bar
    const breadChip = kioskPage.locator('div.fixed button', { hasText: 'Bread' });
    assert.equal(await breadChip.isVisible(), true, 'Quick chip "Bread" should be visible in keyboard');

    // Check Shift is initially on for empty input: letter B should be capitalized
    const keyB = kioskPage.getByRole('button', { name: 'B', exact: true });
    assert.equal(await keyB.isVisible(), true, 'Key B should be capitalized when shifted');

    // Type "Bread" using virtual keys
    await keyB.click();
    // After typing first letter, auto-capitalization turns off, so remaining keys are lowercase
    await kioskPage.getByRole('button', { name: 'r', exact: true }).click();
    await kioskPage.getByRole('button', { name: 'e', exact: true }).click();
    await kioskPage.getByRole('button', { name: 'a', exact: true }).click();
    await kioskPage.getByRole('button', { name: 'd', exact: true }).click();

    let inputValue = await groceryInput.inputValue();
    assert.equal(inputValue, 'Bread', `Input value should be 'Bread', got '${inputValue}'`);

    // Test Backspace single tap: delete key has svg.lucide-delete
    const backspaceBtn = kioskPage.locator('div.fixed button:has(svg.lucide-delete)');
    await backspaceBtn.click();
    inputValue = await groceryInput.inputValue();
    assert.equal(inputValue, 'Brea', `Input value should be 'Brea' after single backspace, got '${inputValue}'`);

    // Test Backspace Debounce Hold:
    // 1) Hold for 250ms (< 500ms initial debounce threshold) -> deletes exactly 1 character
    const bBox = await backspaceBtn.boundingBox();
    assert.ok(bBox, 'Backspace button must have bounding box');
    await kioskPage.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
    await kioskPage.mouse.down();
    await kioskPage.waitForTimeout(250);
    await kioskPage.mouse.up();
    inputValue = await groceryInput.inputValue();
    assert.equal(inputValue, 'Bre', `Input value should be 'Bre' after 250ms hold (single deletion), got '${inputValue}'`);

    // 2) Long hold for 750ms (> 500ms threshold) -> initial at 0ms + repeats at ~595ms, ~690ms -> deletes remainder
    await kioskPage.mouse.down();
    await kioskPage.waitForTimeout(750);
    await kioskPage.mouse.up();
    inputValue = await groceryInput.inputValue();
    assert.equal(inputValue, '', `Input value should be empty after 750ms backspace hold, got '${inputValue}'`);

    // Type "Brea" again for shift test
    await keyB.click();
    await kioskPage.getByRole('button', { name: 'r', exact: true }).click();
    await kioskPage.getByRole('button', { name: 'e', exact: true }).click();
    await kioskPage.getByRole('button', { name: 'a', exact: true }).click();

    // Test Shift button: toggle back to uppercase
    const shiftBtn = kioskPage.locator('div.fixed button:has(svg.lucide-arrow-big-up)');
    await shiftBtn.click();
    const keyD = kioskPage.getByRole('button', { name: 'D', exact: true });
    assert.equal(await keyD.isVisible(), true, 'Key D should be uppercase after pressing shift');
    await keyD.click();
    inputValue = await groceryInput.inputValue();
    assert.equal(inputValue, 'BreaD', `Input value should be 'BreaD', got '${inputValue}'`);

    // Test Clear button in top preview bar
    const clearBtn = kioskPage.getByRole('button', { name: 'Clear', exact: true });
    await clearBtn.click();
    inputValue = await groceryInput.inputValue();
    assert.equal(inputValue, '', `Input value should be empty after Clear, got '${inputValue}'`);

    // Test Quick Chip tap: clicking 'Milk' chip inserts 'Milk'
    const milkChip = kioskPage.getByRole('button', { name: 'Milk', exact: true });
    await milkChip.click();
    inputValue = await groceryInput.inputValue();
    assert.equal(inputValue, 'Milk', `Input value should be 'Milk' after clicking quick chip, got '${inputValue}'`);

    // Test Number Mode toggle
    const numModeBtn = kioskPage.getByRole('button', { name: '123 / #', exact: true });
    await numModeBtn.click();
    const key7 = kioskPage.getByRole('button', { name: '7', exact: true });
    assert.equal(await key7.isVisible(), true, 'Key 7 should be visible in number mode');

    // Switch back to ABC
    const abcBtn = kioskPage.getByRole('button', { name: 'ABC', exact: true });
    await abcBtn.click();
    const keyBShifted = kioskPage.getByRole('button', { name: 'B', exact: true });
    assert.equal(await keyBShifted.isVisible(), true, 'Key B should be visible after returning from number mode');

    // Test Hide button closes the keyboard
    const hideBtn = kioskPage.locator('div.fixed button', { hasText: 'Hide' });
    await hideBtn.click();
    await kioskPage.waitForTimeout(300);
    assert.equal(await doneBtn.isVisible(), false, 'Keyboard should be hidden after clicking Hide');

    // ---------------------------------------------------------
    // 2. MODAL AUTO-SCROLL & NON-OBSCURING CHECK (1920x1080)
    // ---------------------------------------------------------
    await kioskPage.locator('aside button', { hasText: 'Calendar' }).click();
    await kioskPage.waitForSelector('text=4-Day');
    await kioskPage.locator('button:has-text("Add Event")').click();
    await kioskPage.waitForSelector('text=Add Family Event');

    const notesInput = kioskPage.locator('input[placeholder*="Notes"]');
    await notesInput.scrollIntoViewIfNeeded();
    await notesInput.focus();
    await doneBtn.waitFor({ state: 'visible', timeout: 3000 });
    await kioskPage.waitForTimeout(300);

    // Verify keyboard does not obscure notesInput
    const kbBox = await kioskPage.locator('div.fixed.bottom-0').boundingBox();
    const inputBx = await notesInput.boundingBox();
    assert.ok(kbBox && inputBx, 'Both keyboard and notes input must have bounding boxes');
    const inputBottom = inputBx.y + inputBx.height;
    assert.ok(
      inputBottom <= kbBox.y + 5,
      `Notes input (bottom: ${inputBottom}) must not be obscured by keyboard (top: ${kbBox.y})`
    );

    // Verify container paddingBottom was expanded
    const modalContainerPadding = await notesInput.evaluate((el) => {
      let parent = el.parentElement;
      while (parent) {
        if (window.getComputedStyle(parent).overflowY === 'auto') {
          return window.getComputedStyle(parent).paddingBottom;
        }
        parent = parent.parentElement;
      }
      return '0px';
    });
    assert.ok(
      parseInt(modalContainerPadding, 10) >= 300,
      `Modal container paddingBottom should be >= 300px, got ${modalContainerPadding}`
    );

    // Close modal
    await kioskPage.locator('div.fixed button', { hasText: 'Hide' }).click();
    await kioskPage.locator('div.fixed button:has(svg.lucide-x)').first().click();
    await kioskPage.waitForTimeout(300);

    await kioskPage.close();

    // ---------------------------------------------------------
    // 3. TABLET KIOSK VIEWPORT (768x1024) - ACTIVE BOUNDARY
    // ---------------------------------------------------------
    const tabletPage: Page = await browser.newPage({
      viewport: { width: 768, height: 1024 },
    });
    await tabletPage.goto(server.url, { waitUntil: 'networkidle' });
    await tabletPage.locator('aside button', { hasText: 'Lists' }).click();
    await tabletPage.waitForSelector('text=Groceries');

    const tabletGroceryInput = tabletPage.locator('input[placeholder*="auto-sorts"]');
    await tabletGroceryInput.focus();
    const tabletDoneBtn = tabletPage.locator('div.fixed button:has-text("Done")');
    await tabletDoneBtn.waitFor({ state: 'visible', timeout: 3000 });
    assert.equal(
      await tabletDoneBtn.isVisible(),
      true,
      'Virtual on-screen keyboard MUST be active on 768px tablet kiosk boundary'
    );
    await tabletPage.close();

    // ---------------------------------------------------------
    // 4. MOBILE COMPANION SUPPRESSION (390x844 iPhone Viewport)
    // ---------------------------------------------------------
    const mobilePage: Page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });

    await mobilePage.goto(server.url, { waitUntil: 'networkidle' });

    // Open Lists view on mobile (bottom nav bar)
    const mobileListsNav = mobilePage.locator('nav button', { hasText: 'Lists' });
    await mobileListsNav.click();
    await mobilePage.waitForSelector('text=Groceries');

    // Focus grocery input on mobile
    const mobileGroceryInput = mobilePage.locator('input[placeholder*="auto-sorts"]');
    await mobileGroceryInput.waitFor({ state: 'visible' });
    await mobileGroceryInput.focus();
    await mobilePage.waitForTimeout(500);

    // On mobile (<768px), OnScreenKeyboard must NOT appear (suppressed for native keyboard)
    const mobileDoneBtn = mobilePage.locator('div.fixed button:has-text("Done")');
    assert.equal(
      await mobileDoneBtn.isVisible(),
      false,
      'Virtual on-screen keyboard must be suppressed on mobile screens (<768px)'
    );

    await mobilePage.close();

  } finally {
    if (browser) await browser.close();
    if (server) await server.stop();
  }
});
