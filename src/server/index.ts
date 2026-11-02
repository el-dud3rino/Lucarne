import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { serve } from '@hono/node-server';
import { initSchema } from './db/schema.js';
import { seedIfNeeded } from './db/seed.js';
import { MEDIA_PHOTOS_DIR, MEDIA_RECIPES_DIR, performBackup } from './db/connection.js';
import { registerSSEClient } from './sse.js';
import { familyRouter } from './routes/family.js';
import { eventsRouter } from './routes/events.js';
import { choresRouter } from './routes/chores.js';
import { listsRouter } from './routes/lists.js';
import { mealsRouter } from './routes/meals.js';
import { photosRouter } from './routes/photos.js';
import { handleGoogleOAuthCallbackRoute, settingsRouter } from './routes/settings.js';
import { syncAllEnabledCalendars } from './services/google.js';

initSchema();
seedIfNeeded();

const app = new Hono();

// Health & LAN info (used by QR code handoff so phones on home Wi-Fi can connect easily!)
app.get('/api/health', (c) => {
  const nets = os.networkInterfaces();
  const lanIps: string[] = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        lanIps.push(addr.address);
      }
    }
  }
  return c.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    lanIps,
    hostname: os.hostname(),
  });
});

// Real-time Server-Sent Events stream
app.get('/api/stream', (c) => {
  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache');
  c.header('Connection', 'keep-alive');
  return stream(c, async (s) => {
    const clientId = crypto.randomUUID();
    await s.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);
    const unregister = registerSSEClient(clientId, (chunk) => {
      s.write(chunk).catch(() => {});
    });
    s.onAbort(() => {
      unregister();
    });
    // Keep stream open until client disconnects
    await new Promise(() => {});
  });
});

// Google OAuth2 callback redirect
app.get('/api/google/callback', async (c) => {
  const code = c.req.query('code');
  const origin = new URL(c.req.url).origin;
  if (!code) {
    return c.html('<h2>Missing authorization code.</h2><a href="/">Return to Lucarne</a>', 400);
  }
  try {
    await handleGoogleOAuthCallbackRoute(code, origin);
    return c.redirect('/?tab=settings&oauth=success');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'OAuth error';
    return c.html(`<h2>Google Connection Error</h2><p>${msg}</p><a href="/">Back</a>`, 400);
  }
});

// Mount domain routers
app.route('/api/family', familyRouter);
app.route('/api/events', eventsRouter);
app.route('/api/chores', choresRouter);
app.route('/api/lists', listsRouter);
app.route('/api/meals', mealsRouter);
app.route('/api/photos', photosRouter);
app.route('/api/settings', settingsRouter);

// Serve locally cached media (photos & recipe images) with immutable cache headers for 0ms repeat loads
app.get('/media/:bucket/:file', (c) => {
  const bucket = c.req.param('bucket');
  const file = path.basename(c.req.param('file'));
  const baseDir = bucket === 'photos' ? MEDIA_PHOTOS_DIR : bucket === 'recipes' ? MEDIA_RECIPES_DIR : null;
  if (!baseDir) return c.notFound();

  const fullPath = path.join(baseDir, file);
  if (!fs.existsSync(fullPath)) return c.notFound();

  const ext = path.extname(file).toLowerCase();
  const mime =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
      ? 'image/webp'
      : 'image/jpeg';

  const buf = fs.readFileSync(fullPath);
  return new Response(buf, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

// Serve compiled React SPA in production
const clientDist = path.resolve('./dist/client');
if (fs.existsSync(clientDist)) {
  app.get('*', (c) => {
    const reqPath = new URL(c.req.url).pathname;
    const candidate = path.join(clientDist, reqPath === '/' ? 'index.html' : reqPath);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.webp': 'image/webp',
        '.ico': 'image/x-icon',
      };
      return new Response(fs.readFileSync(candidate), {
        headers: { 'Content-Type': mimeMap[ext] || 'application/octet-stream' },
      });
    }
    return new Response(fs.readFileSync(path.join(clientDist, 'index.html')), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  });
}

// Background incremental Google Calendar sync every 90s
setInterval(() => {
  syncAllEnabledCalendars().catch(() => {});
}, 90_000).unref();

// Automated daily SQLite rolling backup every 24h
setInterval(() => {
  try {
    performBackup();
  } catch {
    // ignore
  }
}, 24 * 60 * 60 * 1000).unref();

const port = Number(process.env.PORT || 3001);
serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`✨ Lucarne server listening on http://localhost:${info.port}`);
});
