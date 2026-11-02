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
  env: { ...process.env, DATA_DIR: DEMO_DIR, PORT: String(PORT), GEMINI_API_KEY: '', GOOGLE_CLIENT_ID: '' },
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

const nav = (page: Page, label: string) => page.locator('aside button', { hasText: label }).first().click();

try {
  await waitForServer();
  const browser = await launch();

  // ---------- wall display, 1920x1080 ----------
  const wall = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await wall.goto(BASE, { waitUntil: 'networkidle' });
  await wall.waitForSelector('text=5-Day');
  await settle(wall, 2000); // weather + fonts
  await shot(wall, 'calendar-5day');

  await wall.locator('button', { hasText: /^Week$/ }).first().click();
  await settle(wall);
  await shot(wall, 'calendar-week');

  await wall.locator('button', { hasText: /^Month$/ }).first().click();
  await settle(wall);
  await shot(wall, 'calendar-month');

  await nav(wall, 'Chores');
  await settle(wall);
  await shot(wall, 'chores');

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

  await wall.goto(BASE, { waitUntil: 'networkidle' });
  await nav(wall, 'Photos');
  await settle(wall, 3500); // photo fade-in
  await shot(wall, 'screensaver');
  await wall.close();

  // ---------- phone companion, 390x844 ----------
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
