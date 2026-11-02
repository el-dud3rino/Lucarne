import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser } from 'playwright';
import { startTestServer, TestServerInstance } from './testServer.js';

test('On-screen keyboard closes when a form is submitted (1920x1080 kiosk)', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;
  try {
    server = await startTestServer(4063);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(server.url, { waitUntil: 'networkidle' });

    await page.locator('aside button', { hasText: 'Lists' }).click();
    const input = page.locator('input[placeholder*="auto-sorts"]');
    await input.click();

    const doneKey = page.locator('button', { hasText: /^\s*Done\s*$/ });
    await doneKey.waitFor({ state: 'visible', timeout: 5000 });

    await input.fill('2 cartons heavy cream');
    await page.locator('form button:has-text("Add")').click();

    await doneKey.waitFor({ state: 'detached', timeout: 3000 });
    assert.equal(await doneKey.count(), 0, 'keyboard closed after submit');
    await page.locator('text=heavy cream').first().waitFor({ state: 'visible', timeout: 5000 });
  } finally {
    await browser?.close();
    await server?.stop();
  }
});
