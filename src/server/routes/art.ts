import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { db, MEDIA_ART_DIR } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import type { Artwork } from '../../shared/types.js';

/**
 * Kids' drawings from the Draw tab. The client uploads the canvas as a raw PNG body.
 * Every save writes a NEW file (media is served with immutable caching) and removes the old one.
 */
export const artRouter = new Hono();

const MAX_BYTES = 15 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function mapRow(r: Record<string, unknown>): Artwork {
  return {
    id: String(r.id),
    memberId: r.member_id ? String(r.member_id) : null,
    url: `/media/art/${String(r.filename)}`,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function getArtwork(id: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM artworks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
}

/** Reads and validates the PNG body; returns an error message instead when it isn't usable. */
async function readPng(req: Request): Promise<Buffer | string> {
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) return 'The drawing was empty';
  if (buf.length > MAX_BYTES) return 'That drawing is too big to save';
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) return 'Drawings must be PNG images';
  return buf;
}

function writeFile(buf: Buffer): string {
  const filename = `${crypto.randomUUID()}.png`;
  fs.writeFileSync(path.join(MEDIA_ART_DIR, filename), buf);
  return filename;
}

function removeFile(filename: string): void {
  try {
    fs.unlinkSync(path.join(MEDIA_ART_DIR, path.basename(filename)));
  } catch {
    // already gone
  }
}

artRouter.get('/', (c) => {
  const rows = db.prepare('SELECT * FROM artworks ORDER BY updated_at DESC').all() as Record<string, unknown>[];
  return c.json(rows.map(mapRow));
});

artRouter.post('/', async (c) => {
  const memberId = c.req.query('memberId') || '';
  if (!db.prepare('SELECT 1 FROM family_members WHERE id = ?').get(memberId)) {
    return c.json({ error: 'Pick who is drawing' }, 400);
  }
  const png = await readPng(c.req.raw);
  if (typeof png === 'string') return c.json({ error: png }, 400);

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const filename = writeFile(png);
  db.prepare('INSERT INTO artworks (id, member_id, filename, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    memberId,
    filename,
    nowIso,
    nowIso
  );
  broadcastInvalidate(['art']);
  return c.json(mapRow(getArtwork(id)!), 201);
});

/** Saves a resumed drawing over the old version. */
artRouter.put('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = getArtwork(id);
  if (!existing) return c.json({ error: 'That drawing was deleted' }, 404);
  const png = await readPng(c.req.raw);
  if (typeof png === 'string') return c.json({ error: png }, 400);

  const filename = writeFile(png);
  db.prepare('UPDATE artworks SET filename = ?, updated_at = ? WHERE id = ?').run(filename, new Date().toISOString(), id);
  removeFile(String(existing.filename));
  broadcastInvalidate(['art']);
  return c.json(mapRow(getArtwork(id)!));
});

artRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = getArtwork(id);
  if (existing) {
    db.prepare('DELETE FROM artworks WHERE id = ?').run(id);
    removeFile(String(existing.filename));
    broadcastInvalidate(['art']);
  }
  return c.json({ ok: true });
});
