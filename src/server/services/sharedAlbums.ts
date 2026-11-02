import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, MEDIA_PHOTOS_DIR } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import {
  buildBatchRequest,
  extractAlbumKeys,
  extractAlbumTitle,
  isGoogleImageHost,
  parseBatchResponse,
  SHARE_HOSTS,
  sizedImageUrl,
  type AlbumKeys,
  type SharedAlbumItem,
} from './sharedAlbumParse.js';

/**
 * Mirrors PUBLIC Google Photos shared albums into the local screensaver gallery (unofficial;
 * see sharedAlbumParse.ts). New photos are downloaded at <=1920px; photos removed from the album are
 * removed locally, but ONLY after a complete, successful listing so a partial failure never deletes.
 */

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_PAGES = 200;
const MAX_ITEMS = 20_000;
const DOWNLOAD_CONCURRENCY = 4;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const RESYNC_AFTER_MS = 24 * 60 * 60 * 1000;

export class SharedAlbumError extends Error {}

export interface AlbumProgress {
  state: 'idle' | 'queued' | 'listing' | 'downloading' | 'ok' | 'error';
  done: number;
  total: number;
  message: string;
}

const progress = new Map<string, AlbumProgress>();

export function getAlbumProgress(albumId: string): AlbumProgress {
  return progress.get(albumId) ?? { state: 'idle', done: 0, total: 0, message: '' };
}

function allowLocalHosts(): boolean {
  return process.env.SHARED_ALBUM_ALLOW_LOCAL === '1';
}

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
}

function assertShareHost(url: URL): void {
  if (SHARE_HOSTS.has(url.hostname) || (allowLocalHosts() && isLocal(url.hostname))) return;
  throw new SharedAlbumError(
    'That doesn\'t look like a Google Photos shared-album link. In Google Photos open the album, tap Share → Create link, and paste the photos.app.goo.gl link here.'
  );
}

function assertImageHost(url: URL): void {
  if (isGoogleImageHost(url.hostname) || (allowLocalHosts() && isLocal(url.hostname))) return;
  throw new SharedAlbumError(`Unexpected image host ${url.hostname}`);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

export interface ResolvedAlbum {
  keys: AlbumKeys;
  title: string;
  origin: string;
}

/** Opens the share link (following the short-link redirect) and extracts the album keys. */
export async function resolveSharedAlbum(shareUrl: string): Promise<ResolvedAlbum> {
  let url: URL;
  try {
    url = new URL(shareUrl.trim());
  } catch {
    throw new SharedAlbumError('Paste the full album link, e.g. https://photos.app.goo.gl/AbC123');
  }
  assertShareHost(url);

  const res = await fetchWithTimeout(url.toString(), {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const finalUrl = new URL(res.url || url.toString());
  assertShareHost(finalUrl);
  if (res.status === 404) throw new SharedAlbumError('Google says this album link doesn\'t exist (404). Check the link.');
  if (!res.ok) throw new SharedAlbumError(`Google Photos returned HTTP ${res.status} for this album link. Try again later.`);

  const html = await res.text();
  const keys = extractAlbumKeys(html);
  if (!keys) {
    throw new SharedAlbumError(
      'Couldn\'t read this album. Make sure link sharing is turned on for it (Share → Create link). If it is, Google may have changed its page format and Lucarne needs an update.'
    );
  }
  return { keys, title: extractAlbumTitle(html) || 'Shared album', origin: `${finalUrl.protocol}//${finalUrl.host}` };
}

/** Lists every item in the album, page by page. `complete` is false if listing stopped early. */
export async function listSharedAlbumItems(
  resolved: ResolvedAlbum,
  onPage?: (count: number) => void
): Promise<{ items: SharedAlbumItem[]; complete: boolean }> {
  const seen = new Map<string, SharedAlbumItem>();
  let token: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const req = buildBatchRequest(resolved.origin, resolved.keys, token);
    let parsed: ReturnType<typeof parseBatchResponse> = null;
    try {
      const res = await fetchWithTimeout(req.url, {
        method: 'POST',
        headers: {
          'User-Agent': BROWSER_UA,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          Accept: '*/*',
          Origin: resolved.origin,
          Referer: `${resolved.origin}/share/${resolved.keys.albumKey}?key=${resolved.keys.authKey}`,
        },
        body: req.body,
      });
      if (!res.ok) throw new SharedAlbumError(`Google Photos returned HTTP ${res.status} while listing photos.`);
      parsed = parseBatchResponse(await res.text());
    } catch (err) {
      if (page === 0) throw err instanceof SharedAlbumError ? err : new SharedAlbumError(`Could not list album photos: ${(err as Error).message}`);
      return { items: [...seen.values()], complete: false };
    }
    if (!parsed) {
      if (page === 0) {
        throw new SharedAlbumError('Google Photos answered in an unexpected format. Google may have changed its album page; Lucarne needs an update.');
      }
      return { items: [...seen.values()], complete: false };
    }
    const before = seen.size;
    for (const item of parsed.items) seen.set(item.id, item);
    onPage?.(seen.size);
    if (seen.size >= MAX_ITEMS) return { items: [...seen.values()], complete: false };
    if (!parsed.nextToken) return { items: [...seen.values()], complete: true };
    if (seen.size === before) return { items: [...seen.values()], complete: false }; // no progress; avoid looping
    token = parsed.nextToken;
  }
  return { items: [...seen.values()], complete: false };
}

const EXT_BY_TYPE: Record<string, string> = { 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/png': '.png' };

async function downloadPhoto(item: SharedAlbumItem): Promise<string> {
  const url = new URL(sizedImageUrl(item.url, item.width, item.height));
  assertImageHost(url);
  const res = await fetchWithTimeout(url.toString(), {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'image/jpeg,image/webp;q=0.9,image/*;q=0.8' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type];
  if (!ext) throw new Error(`not an image (${type})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) throw new Error('bad image size');
  const filename = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(MEDIA_PHOTOS_DIR, filename), buf);
  return `/media/photos/${filename}`;
}

function deleteLocalPhotoFile(url: string): void {
  if (!url.startsWith('/media/photos/')) return;
  try {
    fs.unlinkSync(path.join(MEDIA_PHOTOS_DIR, path.basename(url)));
  } catch {
    // already gone
  }
}

interface AlbumRow {
  id: string;
  share_url: string;
  album_key: string;
  auth_key: string;
  title: string;
}

async function syncAlbumNow(album: AlbumRow): Promise<void> {
  const p: AlbumProgress = { state: 'listing', done: 0, total: 0, message: '' };
  progress.set(album.id, p);
  try {
    const resolved = await resolveSharedAlbum(album.share_url);
    if (resolved.title && resolved.title !== album.title) {
      db.prepare('UPDATE photo_albums SET title = ? WHERE id = ?').run(resolved.title, album.id);
    }
    const { items, complete } = await listSharedAlbumItems(resolved, (n) => {
      p.total = n;
    });
    const photosOnly = items.filter((i) => !i.isVideo);
    const existing = new Map(
      (
        db.prepare('SELECT id, external_id, url FROM photos WHERE album_id = ?').all(album.id) as Array<{
          id: string;
          external_id: string;
          url: string;
        }>
      ).map((r) => [r.external_id, r])
    );
    const toAdd = photosOnly.filter((i) => !existing.has(i.id));

    // Remove photos that were deleted from the album, only when we saw the whole album.
    if (complete) {
      const keep = new Set(photosOnly.map((i) => i.id));
      const del = db.prepare('DELETE FROM photos WHERE id = ?');
      let removed = 0;
      for (const [externalId, row] of existing) {
        if (keep.has(externalId)) continue;
        deleteLocalPhotoFile(row.url);
        del.run(row.id);
        removed++;
      }
      if (removed > 0) broadcastInvalidate(['photos']);
    }

    p.state = 'downloading';
    p.total = toAdd.length;
    p.done = 0;
    let failed = 0;
    const insert = db.prepare(
      `INSERT INTO photos (id, url, orientation, caption, source, external_id, album_id, created_at)
       VALUES (?, ?, ?, '', 'shared_album', ?, ?, ?)`
    );
    let next = 0;
    const worker = async () => {
      while (next < toAdd.length) {
        const item = toAdd[next++];
        try {
          const localUrl = await downloadPhoto(item);
          const created = item.takenAtMs ? new Date(item.takenAtMs).toISOString() : new Date().toISOString();
          insert.run(
            crypto.randomUUID(),
            localUrl,
            item.height > item.width ? 'portrait' : 'landscape',
            item.id,
            album.id,
            created
          );
        } catch {
          failed++;
        }
        p.done++;
        if (p.done % 50 === 0) broadcastInvalidate(['photos']);
      }
    };
    await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));

    const count = (db.prepare('SELECT COUNT(*) AS n FROM photos WHERE album_id = ?').get(album.id) as { n: number }).n;
    const notes: string[] = [];
    if (failed) notes.push(`${failed} photo${failed === 1 ? '' : 's'} failed to download and will be retried next sync`);
    if (!complete) notes.push('Google stopped listing the album partway; the rest will be picked up next sync');
    const syncError = notes.length ? notes.join('. ') + '.' : null;
    db.prepare('UPDATE photo_albums SET photo_count = ?, last_synced_at = ?, sync_error = ? WHERE id = ?').run(
      count,
      new Date().toISOString(),
      syncError,
      album.id
    );
    p.state = syncError ? 'error' : 'ok';
    p.message = syncError ?? '';
    broadcastInvalidate(['photos']);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare('UPDATE photo_albums SET sync_error = ? WHERE id = ?').run(message, album.id);
    p.state = 'error';
    p.message = message;
    broadcastInvalidate(['photos']);
  }
}

// One album syncs at a time (gentle on Google and on the Pi's network/SD).
const queue: string[] = [];
let draining = false;

export function queueAlbumSync(albumId: string): void {
  if (queue.includes(albumId) || ['listing', 'downloading'].includes(getAlbumProgress(albumId).state)) return;
  queue.push(albumId);
  progress.set(albumId, { state: 'queued', done: 0, total: 0, message: '' });
  if (!draining) void drain();
}

async function drain(): Promise<void> {
  draining = true;
  try {
    while (queue.length > 0) {
      const id = queue.shift()!;
      const album = db.prepare('SELECT * FROM photo_albums WHERE id = ? AND enabled = 1').get(id) as AlbumRow | undefined;
      if (album) await syncAlbumNow(album);
    }
  } finally {
    draining = false;
  }
}

/** Waits until the queue is empty (used by tests and manual "sync now"). */
export async function waitForAlbumSyncs(timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while ((draining || queue.length > 0) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function addSharedAlbum(shareUrl: string): Promise<{ id: string; title: string }> {
  const resolved = await resolveSharedAlbum(shareUrl);
  const existing = db.prepare('SELECT id, title FROM photo_albums WHERE album_key = ?').get(resolved.keys.albumKey) as
    | { id: string; title: string }
    | undefined;
  if (existing) {
    queueAlbumSync(existing.id);
    return existing;
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO photo_albums (id, share_url, album_key, auth_key, title, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, shareUrl.trim(), resolved.keys.albumKey, resolved.keys.authKey, resolved.title, new Date().toISOString());
  queueAlbumSync(id);
  return { id, title: resolved.title };
}

export function removeSharedAlbum(albumId: string): void {
  const rows = db.prepare('SELECT url FROM photos WHERE album_id = ?').all(albumId) as Array<{ url: string }>;
  for (const r of rows) deleteLocalPhotoFile(r.url);
  db.prepare('DELETE FROM photos WHERE album_id = ?').run(albumId);
  db.prepare('DELETE FROM photo_albums WHERE id = ?').run(albumId);
  progress.delete(albumId);
  broadcastInvalidate(['photos']);
}

/** Re-sync albums daily so new photos added to them appear on the frame automatically. */
export function startSharedAlbumLoop(): void {
  const tick = () => {
    const due = db
      .prepare('SELECT id, last_synced_at FROM photo_albums WHERE enabled = 1')
      .all() as Array<{ id: string; last_synced_at: string | null }>;
    for (const a of due) {
      const last = a.last_synced_at ? new Date(a.last_synced_at).getTime() : 0;
      if (Date.now() - last > RESYNC_AFTER_MS) queueAlbumSync(a.id);
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 60 * 60 * 1000).unref();
}
