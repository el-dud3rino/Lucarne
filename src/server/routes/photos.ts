import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { db, MEDIA_PHOTOS_DIR } from '../db/connection.js';
import { broadcastInvalidate } from '../sse.js';
import {
  createPhotosPickerSession,
  pollAndImportPhotosPickerSession,
} from '../services/google.js';
import type { PhotoItem } from '../../shared/types.js';

export const photosRouter = new Hono();

export function detectOrientationFromBuffer(buf: Buffer): 'landscape' | 'portrait' {
  if (!buf || buf.length < 16) return 'landscape';

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    if (buf.length >= 24) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return height > width ? 'portrait' : 'landscape';
    }
  }

  // 2. WebP: RIFF .... WEBP
  if (
    buf.length >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const format = buf.toString('ascii', 12, 16);
    if (format === 'VP8 ') {
      const width = (buf[26] | (buf[27] << 8)) & 0x3fff;
      const height = (buf[28] | (buf[29] << 8)) & 0x3fff;
      return height > width ? 'portrait' : 'landscape';
    } else if (format === 'VP8L') {
      const width = 1 + (((buf[22] & 0x3f) << 8) | buf[21]);
      const height = 1 + (((buf[24] & 0x0f) << 10) | (buf[23] << 2) | ((buf[22] & 0xc0) >> 6));
      return height > width ? 'portrait' : 'landscape';
    } else if (format === 'VP8X') {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return height > width ? 'portrait' : 'landscape';
    }
  }

  // 3. JPEG: FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    let width = 0;
    let height = 0;
    let exifOrientation = 1;

    while (offset < buf.length - 1) {
      if (buf[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xd9) break; // EOI
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
        offset += 2;
        continue;
      }

      if (offset + 4 > buf.length) break;
      const len = buf.readUInt16BE(offset + 2);

      // Check APP1 (Exif) for orientation tag
      if (marker === 0xe1 && offset + 2 + len <= buf.length && len >= 14) {
        const exifHeader = buf.toString('ascii', offset + 4, offset + 8);
        if (exifHeader === 'Exif') {
          try {
            const tiffOffset = offset + 10;
            const isLittleEndian = buf.readUInt16BE(tiffOffset) === 0x4949; // 'II'
            const read16 = (o: number) => (isLittleEndian ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
            const read32 = (o: number) => (isLittleEndian ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
            const firstIfdOffset = read32(tiffOffset + 4);
            const ifd0 = tiffOffset + firstIfdOffset;
            if (ifd0 + 2 <= buf.length) {
              const numEntries = read16(ifd0);
              for (let i = 0; i < numEntries && ifd0 + 2 + (i + 1) * 12 <= buf.length; i++) {
                const entryOffset = ifd0 + 2 + i * 12;
                const tag = read16(entryOffset);
                if (tag === 0x0112) {
                  exifOrientation = read16(entryOffset + 8);
                  break;
                }
              }
            }
          } catch {
            // Ignore exif parse failures
          }
        }
      }

      // SOF markers defining width and height
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        if (offset + 9 <= buf.length) {
          height = buf.readUInt16BE(offset + 5);
          width = buf.readUInt16BE(offset + 7);
          break;
        }
      }

      offset += 2 + len;
    }

    if (width > 0 && height > 0) {
      if (exifOrientation >= 5 && exifOrientation <= 8) {
        const tmp = width;
        width = height;
        height = tmp;
      }
      return height > width ? 'portrait' : 'landscape';
    }
  }

  return 'landscape';
}

function mapPhotoRow(row: Record<string, unknown>): PhotoItem {
  return {
    id: String(row.id),
    url: String(row.url),
    orientation: (row.orientation as PhotoItem['orientation']) || 'landscape',
    caption: String(row.caption || ''),
    source: (row.source as PhotoItem['source']) || 'starter',
    createdAt: String(row.created_at),
  };
}

photosRouter.get('/', (c) => {
  const rows = db
    .prepare('SELECT * FROM photos ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];
  return c.json(rows.map(mapPhotoRow));
});

photosRouter.get('/media/:id', (c) => {
  const idOrFile = c.req.param('id');
  let filename = '';

  const row = db.prepare('SELECT url FROM photos WHERE id = ?').get(idOrFile) as
    | { url: string }
    | undefined;
  if (row?.url && row.url.startsWith('/media/photos/')) {
    filename = path.basename(row.url);
  } else {
    const candidate = path.basename(idOrFile);
    if (fs.existsSync(path.join(MEDIA_PHOTOS_DIR, candidate))) {
      filename = candidate;
    }
  }

  if (!filename) {
    return c.json({ error: 'Photo not found' }, 404);
  }

  const filePath = path.join(MEDIA_PHOTOS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return c.json({ error: 'Photo file not found' }, 404);
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType =
    ext === '.png'
      ? 'image/png'
      : ext === '.webp'
      ? 'image/webp'
      : ext === '.gif'
      ? 'image/gif'
      : 'image/jpeg';

  const data = fs.readFileSync(filePath);
  return new Response(data, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(data.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});

photosRouter.post('/upload', async (c) => {
  const body = await c.req.json<{
    dataUrl: string;
    caption?: string;
    orientation?: 'landscape' | 'portrait';
  }>();

  const match = (body.dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!match) {
    return c.json({ error: 'Invalid image data URL' }, 400);
  }
  const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
  const buf = Buffer.from(match[2], 'base64');
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_PHOTOS_DIR, filename), buf);

  const detected = detectOrientationFromBuffer(buf);
  const orientation = body.orientation || detected;

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const url = `/media/photos/${filename}`;
  db.prepare(
    `INSERT INTO photos (id, url, orientation, caption, source, created_at)
     VALUES (?, ?, ?, ?, 'upload', ?)`
  ).run(id, url, orientation, (body.caption || '').trim(), nowIso);

  broadcastInvalidate(['photos']);
  return c.json({ id, url, orientation }, 201);
});

photosRouter.delete('/:id', (c) => {
  const id = c.req.param('id');
  const existing = db.prepare('SELECT url FROM photos WHERE id = ?').get(id) as
    | { url: string }
    | undefined;
  if (!existing) {
    return c.json({ error: 'Photo not found' }, 404);
  }

  if (existing.url.startsWith('/media/photos/')) {
    const filePath = path.join(MEDIA_PHOTOS_DIR, path.basename(existing.url));
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
  db.prepare('DELETE FROM photos WHERE id = ?').run(id);
  broadcastInvalidate(['photos']);
  return c.json({ ok: true });
});

photosRouter.post('/picker/start', async (c) => {
  const { accountId } = await c.req.json<{ accountId: string }>();
  try {
    const session = await createPhotosPickerSession(accountId);
    return c.json(session);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to start Picker session' },
      400
    );
  }
});

photosRouter.post('/picker/poll', async (c) => {
  const { accountId, sessionId } = await c.req.json<{ accountId: string; sessionId: string }>();
  try {
    const status = await pollAndImportPhotosPickerSession(accountId, sessionId);
    return c.json(status);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to poll Picker session' },
      400
    );
  }
});
