/**
 * Pure parsing helpers for PUBLIC Google Photos shared-album links.
 *
 * There is no official API for this (the Library API lost access to existing albums in 2025 and
 * the Picker caps a pick at 2,000 items), so this reads the same undocumented data the
 * photos.google.com web viewer uses: the album/auth keys embedded in the share page, then pages of
 * items from the "snAcKc" batchexecute RPC. Google can change this at any time; every parser here
 * is defensive and skips anything it doesn't understand instead of throwing.
 */

export interface AlbumKeys {
  albumKey: string;
  authKey: string;
}

export interface SharedAlbumItem {
  id: string;
  url: string;
  width: number;
  height: number;
  takenAtMs: number | null;
  isVideo: boolean;
}

export const SHARE_HOSTS = new Set(['photos.app.goo.gl', 'goo.gl', 'photos.google.com']);
const MAX_SIDE = 1920;

export function isGoogleImageHost(host: string): boolean {
  return host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
}

/**
 * Album + auth keys embedded in the share page (the web viewer's own snAcKc request).
 * Deliberately no URL-based fallback: a private/disabled album still has keys in its URL,
 * and we want to report "not public" rather than fail obscurely later.
 */
export function extractAlbumKeys(html: string): AlbumKeys | null {
  const m = html.match(
    /snAcKc[^}]*?request:\s*\[\s*"([A-Za-z0-9_-]+)"\s*,\s*null\s*,\s*null\s*,\s*"([A-Za-z0-9_-]+)"/s
  );
  return m ? { albumKey: m[1], authKey: m[2] } : null;
}

export function extractAlbumTitle(html: string): string {
  const raw = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  return decodeHtmlEntities(raw)
    .replace(/\s*[-–]\s*Google Photos\s*$/i, '')
    .trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** POST request for one page of album items. `token` is null for the first page. */
export function buildBatchRequest(origin: string, keys: AlbumKeys, token: string | null) {
  const inner = JSON.stringify([keys.albumKey, token, null, keys.authKey]);
  const envelope = JSON.stringify([[['snAcKc', inner, null, 'generic']]]);
  return {
    url: `${origin}/u/0/_/PhotosUi/data/batchexecute?rpcids=snAcKc&source-path=${encodeURIComponent(
      `/share/${keys.albumKey}`
    )}`,
    body: `f.req=${encodeURIComponent(envelope)}`,
  };
}

function findRpcPayload(node: unknown, depth = 0): string | null {
  if (!Array.isArray(node) || depth > 3) return null;
  if (node[0] === 'wrb.fr' && node[1] === 'snAcKc' && typeof node[2] === 'string') return node[2];
  for (const child of node) {
    const found = findRpcPayload(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function hasVideoMarker(node: unknown, depth = 0): boolean {
  if (depth > 8 || node === null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => hasVideoMarker(n, depth + 1));
  const obj = node as Record<string, unknown>;
  if ('76647426' in obj) return true; // marks items with a duration (videos / motion photos)
  return Object.values(obj).some((v) => hasVideoMarker(v, depth + 1));
}

export function parseItem(raw: unknown): SharedAlbumItem | null {
  if (!Array.isArray(raw) || typeof raw[0] !== 'string') return null;
  const visual = raw[1];
  if (!Array.isArray(visual) || visual.length < 3) return null;
  const [url, width, height] = visual;
  if (typeof url !== 'string' || !url.startsWith('http')) return null;
  const w = typeof width === 'number' && width > 0 ? width : 0;
  const h = typeof height === 'number' && height > 0 ? height : 0;
  const taken = typeof raw[2] === 'number' && raw[2] > -5364662400000 && raw[2] < 4102444800000 ? raw[2] : null;
  return { id: raw[0], url, width: w, height: h, takenAtMs: taken, isVideo: hasVideoMarker(raw) };
}

/** Parses a batchexecute response into items + the next page token ('' / null when done). */
export function parseBatchResponse(text: string): { items: SharedAlbumItem[]; nextToken: string | null } | null {
  const body = text.trim().replace(/^\)\]\}'/, '').trim();
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('[')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(t);
    } catch {
      continue;
    }
    const payload = findRpcPayload(parsed);
    if (!payload) continue;
    let inner: unknown;
    try {
      inner = JSON.parse(payload);
    } catch {
      return null;
    }
    if (!Array.isArray(inner)) return null;
    const rawItems = Array.isArray(inner[1]) ? inner[1] : [];
    const items = rawItems.map(parseItem).filter((i): i is SharedAlbumItem => i !== null);
    const nextToken = typeof inner[2] === 'string' && inner[2] ? inner[2] : null;
    return { items, nextToken };
  }
  return null;
}

/** Image URL sized so the longest side is at most 1920px (aspect preserved). */
export function sizedImageUrl(url: string, width: number, height: number): string {
  const base = url.replace(/=[whs]\d+(?:-[a-z0-9]+)*$/i, '');
  if (!width || !height) return `${base}=w${MAX_SIDE}-h1080`;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  return `${base}=w${Math.max(1, Math.round(width * scale))}-h${Math.max(1, Math.round(height * scale))}`;
}
