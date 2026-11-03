/**
 * Captures README screenshots from the fictional demo household.
 *
 *   npm run build && npm run demo:seed -- --fresh && npm run demo:screenshots
 *
 * Starts Lucarne on ./demo-data (never your real ./data) on a spare port, drives it with Playwright
 * at 1920x1080 (wall) and 390x844 (phone), and writes JPEGs to docs/screenshots/.
 * Settings is intentionally not captured: it shows the machine's local network address.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';

const DEMO_DIR = path.resolve(process.env.DEMO_DATA_DIR || './demo-data');
const OUT_DIR = path.resolve('docs/screenshots');
const PORT = Number(process.env.DEMO_PORT || 3099);
const BASE = `http://localhost:${PORT}`;

if (!fs.existsSync(path.join(DEMO_DIR, 'lucarne.db'))) {
  console.error('No demo data found. Run: npm run demo:seed');
  process.exit(1);
}
if (!fs.existsSync('dist/server/server/index.js')) {
  console.error('No build found. Run: npm run build');
  process.exit(1);
}
fs.mkdirSync(OUT_DIR, { recursive: true });

const server = spawn(process.execPath, ['--no-warnings', 'dist/server/server/index.js'], {
  env: {
    ...process.env,
    DATA_DIR: DEMO_DIR,
    PORT: String(PORT),
    GEMINI_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_MAPS_API_KEY: '',
    // The demo's Maps key is a placeholder: send any Maps request to a dead local port, never to Google.
    GOOGLE_PLACES_BASE_URL: 'http://127.0.0.1:9',
    GOOGLE_ROUTES_BASE_URL: 'http://127.0.0.1:9',
  },
  stdio: 'ignore',
});

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Demo server did not start');
}

async function launch(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
  } catch {
    return chromium.launch({ headless: true }); // Playwright's bundled Chromium
  }
}

const settle = async (page: Page, ms = 1200) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(ms);
};

async function shot(page: Page, name: string) {
  const file = path.join(OUT_DIR, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85 });
  console.log('  saved', path.relative(process.cwd(), file), `(${Math.round(fs.statSync(file).size / 1024)} KB)`);
}

/** Screenshots always show the demo day at 4:00 PM, whatever time they're taken. */
const DEMO_CLOCK = (() => {
  const d = new Date();
  d.setHours(16, 0, 0, 0);
  return d;
})();

const nav = (page: Page, label: string) => page.locator('aside button', { hasText: label }).first().click();

/** Draws a simple kid's picture (sun, house, grass, flower) through the real Draw page. */
async function drawPicture(page: Page) {
  const box = (await page.locator('[data-testid="draw-canvas"] canvas').boundingBox())!;
  const P = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const stroke = async (pts: Array<[number, number]>) => {
    const [first, ...rest] = pts.map(([x, y]) => P(x, y));
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const p of rest) await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
  };
  const circle = (cx: number, cy: number, r: number, turns = 1): Array<[number, number]> =>
    Array.from({ length: Math.round(28 * turns) + 1 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2;
      return [cx + (Math.cos(a) * r * 9) / 16, cy + Math.sin(a) * r];
    });
  const tool = async (t: string, colorIndex: number) => {
    await page.locator(`[data-testid="draw-tool-${t}"]`).click();
    await page.locator('button[aria-label^="color "]').nth(colorIndex).click();
  };
  // Grass and sky with paint
  await tool('paint', 4);
  for (const y of [0.86, 0.91, 0.96]) await stroke([[0.02, y], [0.35, y - 0.02], [0.65, y + 0.01], [0.98, y - 0.01]]);
  await tool('paint', 5);
  for (const y of [0.05, 0.1]) await stroke([[0.02, y], [0.3, y + 0.01], [0.6, y - 0.01], [0.98, y]]);
  // Sun with crayon
  await tool('crayon', 2);
  for (const r of [0.1, 0.07, 0.04]) await stroke(circle(0.84, 0.26, r, 1.05));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    await stroke([[0.84 + Math.cos(a) * 0.075, 0.26 + Math.sin(a) * 0.13], [0.84 + Math.cos(a) * 0.11, 0.26 + Math.sin(a) * 0.2]]);
  }
  // House with markers
  await tool('marker', 0);
  await stroke([[0.22, 0.84], [0.22, 0.5], [0.46, 0.5], [0.46, 0.84], [0.22, 0.84]]);
  await stroke([[0.19, 0.52], [0.34, 0.26], [0.49, 0.52]]);
  await tool('marker', 7);
  await stroke([[0.31, 0.84], [0.31, 0.68], [0.37, 0.68], [0.37, 0.84]]);
  await stroke([[0.25, 0.56], [0.29, 0.56], [0.29, 0.63], [0.25, 0.63], [0.25, 0.56]]);
  // Flower with crayons
  await tool('crayon', 10);
  for (const [dx, dy] of [[0, -0.06], [0.035, 0], [0, 0.06], [-0.035, 0]]) await stroke(circle(0.68 + dx, 0.62 + dy, 0.035, 1.05));
  await tool('crayon', 4);
  await stroke([[0.68, 0.66], [0.68, 0.86]]);
}

try {
  await waitForServer();
  const browser = await launch();

  // ---------- wall display, 1920x1080 ----------
  const wall = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await wall.clock.install({ time: DEMO_CLOCK });
  await wall.goto(BASE, { waitUntil: 'networkidle' });
  await wall.waitForSelector('[data-testid="home-view"]');
  await settle(wall, 2000); // weather + fonts + recipe photo
  await shot(wall, 'home');

  await nav(wall, 'Calendar');
  await wall.waitForSelector('text=5-Day');
  await settle(wall);
  await shot(wall, 'calendar-5day');

  // Event form: Google Maps place + automatic drive time (from the demo's cached estimate)
  await wall.locator('button', { hasText: 'Haircuts' }).first().click();
  await wall.waitForSelector('text=Auto · 9 min');
  await settle(wall, 400);
  await wall.locator('form').first().screenshot({ path: path.join(OUT_DIR, 'event-drive.jpg'), type: 'jpeg', quality: 85 });
  console.log('  saved docs/screenshots/event-drive.jpg');
  await wall.locator('button', { hasText: 'Cancel' }).first().click();

  await wall.locator('button', { hasText: /^Week$/ }).first().click();
  await settle(wall);
  await shot(wall, 'calendar-week');

  await wall.locator('button', { hasText: /^Month$/ }).first().click();
  await settle(wall);
  await shot(wall, 'calendar-month');

  await nav(wall, 'Chores');
  await settle(wall);
  await shot(wall, 'chores');

  await wall.getByRole('tab', { name: 'Routines' }).click();
  await settle(wall);
  await shot(wall, 'routines');

  await wall.getByRole('tab', { name: 'Habits' }).click();
  await settle(wall);
  await shot(wall, 'habits');
  await wall.getByRole('tab', { name: 'Chores' }).click();

  await wall.locator('button', { hasText: 'Star Tracker' }).first().click();
  await wall.waitForSelector('[data-testid="rewards-sheet"]');
  await settle(wall, 600);
  await shot(wall, 'rewards');
  await wall.keyboard.press('Escape');

  await wall.locator('button', { hasText: 'Kid Mode' }).first().click();
  await wall.locator('[role="dialog"] button', { hasText: 'Leo' }).first().click();
  await wall.waitForSelector('[data-testid="kid-mode"]');
  await settle(wall, 800);
  await shot(wall, 'kid-mode');
  await wall.getByRole('button', { name: 'Exit kid mode' }).click();

  await nav(wall, 'Calendar');
  await wall.getByRole('button', { name: 'Magic Import' }).click();
  await wall.waitForSelector('[data-testid="magic-import"]');
  await settle(wall, 400);
  await shot(wall, 'magic-import');
  await wall.keyboard.press('Escape');

  await nav(wall, 'Lists');
  await settle(wall);
  await shot(wall, 'groceries');

  await nav(wall, 'Meals');
  await settle(wall, 2000); // recipe photos
  await shot(wall, 'meals');

  const cook = wall.locator('text=Tap for Cook Mode').first();
  if (await cook.count()) {
    await cook.click();
    await settle(wall, 1500);
    await shot(wall, 'cook-mode');
    await wall.keyboard.press('Escape');
  }

  // Draw: a kid's picture, saved into the photo rotation
  await wall.goto(`${BASE}/?tab=draw`, { waitUntil: 'networkidle' }); // ('Draw' also matches buttons on Meals)
  await wall.locator('[data-testid^="draw-artist-"]', { hasText: 'Leo' }).first().click();
  await wall.waitForSelector('[data-testid="draw-canvas"] canvas[data-ready="true"]');
  await drawPicture(wall);
  await wall.locator('[data-testid="draw-tool-crayon"]').click();
  await settle(wall, 300);
  await shot(wall, 'draw');
  await wall.locator('[data-testid="draw-done"]').click();
  await wall.waitForSelector('[data-testid="draw-saved"]');
  await wall.clock.fastForward(2000);
  await wall.locator('[data-testid="draw-canvas"]').waitFor({ state: 'detached' });

  await wall.goto(BASE, { waitUntil: 'networkidle' });
  await nav(wall, 'Photos');
  await settle(wall, 3500); // photo fade-in
  await shot(wall, 'screensaver');

  // Keep the slideshow going until the drawing comes around (one per 10–15 photos)
  for (let i = 0; i < 40; i++) {
    if (await wall.locator('div.opacity-100 img[src^="/media/art/"]').count()) {
      await settle(wall, 1200);
      await shot(wall, 'screensaver-art');
      break;
    }
    await wall.clock.fastForward(12_500);
    await wall.waitForTimeout(1200);
  }
  await wall.close();

  // ---------- phone companion, 390x844 ----------
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.clock.install({ time: DEMO_CLOCK });
  await phone.goto(BASE, { waitUntil: 'networkidle' });
  await settle(phone, 1500);
  await shot(phone, 'phone-calendar');
  await phone.getByRole('button', { name: /Lists/ }).last().click();
  await settle(phone);
  await shot(phone, 'phone-groceries');
  await phone.close();

  await browser.close();
} finally {
  server.kill();
}
