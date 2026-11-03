import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, Browser, Page } from 'playwright';
import { startTestServer, TestServerInstance } from './testServer.js';

async function scribble(page: Page) {
  await page.waitForSelector('[data-testid="draw-canvas"] canvas[data-ready="true"]');
  const box = (await page.locator('[data-testid="draw-canvas"] canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.3 + i * 0.03));
  await page.mouse.up();
}

const artCount = async (server: TestServerInstance) =>
  ((await (await fetch(`${server.url}/api/art`)).json()) as unknown[]).length;

test('Draw tab: pick a kid, draw, auto-save after 60s idle, resume, throw away, done', async () => {
  let server: TestServerInstance | null = null;
  let browser: Browser | null = null;
  try {
    server = await startTestServer(4071);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.clock.install();
    await page.goto(`${server.url}/?tab=draw`, { waitUntil: 'networkidle' });

    await page.waitForSelector('[data-testid="draw-view"]');
    await page.locator('[data-testid^="draw-artist-"]').first().click();
    await page.waitForSelector('[data-testid="draw-canvas"]');

    // Nothing drawn yet: the left button just exits.
    assert.equal(await page.locator('[data-testid="draw-exit"]').getAttribute('aria-label'), 'Exit');

    // Switch tools and colors, then draw.
    await page.locator('[data-testid="draw-tool-marker"]').click();
    await page.locator('button[aria-label^="color "]').nth(3).click();
    await scribble(page);
    assert.equal(await page.locator('[data-testid="draw-exit"]').getAttribute('aria-label'), 'Throw away');

    // Left alone for a minute: it saves and goes back to "Who's drawing?"
    await page.clock.fastForward(61_000);
    await page.locator('[data-testid="draw-canvas"]').waitFor({ state: 'detached', timeout: 10_000 });
    assert.equal(await artCount(server), 1, 'the idle drawing was saved');
    await page.locator('[data-testid="draw-artwork"]').first().waitFor();

    // Resume it, add more, then throw the changes away — the saved picture stays.
    await page.locator('[data-testid="draw-artwork"]').first().click();
    await page.waitForSelector('[data-testid="draw-canvas"]');
    await scribble(page);
    await page.locator('[data-testid="draw-exit"]').click();
    await page.locator('[data-testid="draw-trash-yes"]').click();
    await page.locator('[data-testid="draw-canvas"]').waitFor({ state: 'detached' });
    assert.equal(await artCount(server), 1);

    // A new picture with ✓ Done.
    await page.locator('[data-testid^="draw-artist-"]').first().click();
    await page.locator('[data-testid="draw-tool-paint"]').click();
    await scribble(page);
    await page.locator('[data-testid="draw-done"]').click();
    await page.waitForSelector('[data-testid="draw-saved"]');
    await page.clock.fastForward(2_000);
    await page.locator('[data-testid="draw-canvas"]').waitFor({ state: 'detached' });
    assert.equal(await artCount(server), 2);
    assert.equal(await page.locator('[data-testid="draw-artwork"]').count(), 2);

    // The saved file is a real PNG the slideshow can show.
    const [first] = (await (await fetch(`${server.url}/api/art`)).json()) as Array<{ url: string }>;
    const img = await fetch(`${server.url}${first.url}`);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.ok((await img.arrayBuffer()).byteLength > 1000);
  } finally {
    await browser?.close();
    await server?.stop();
  }
});
