import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchRequest,
  extractAlbumKeys,
  extractAlbumTitle,
  parseBatchResponse,
  parseItem,
  sizedImageUrl,
} from '../../src/server/services/sharedAlbumParse.js';
import { batchResponse, rawItem, shareHtml } from '../mocks/sharedAlbumFixtures.js';

test('album keys + title from the share page', () => {
  const html = shareHtml('AF1QipAlbumKey_1', 'AuthKey-xyz', 'Family &amp; Friends');
  assert.deepEqual(extractAlbumKeys(html), { albumKey: 'AF1QipAlbumKey_1', authKey: 'AuthKey-xyz' });
  assert.equal(extractAlbumTitle(html), 'Family & Friends');
});

test('a non-public / sign-in page yields no keys', () => {
  assert.equal(extractAlbumKeys('<html>sign in</html>'), null);
});

test('batch request body round-trips to the snAcKc envelope', () => {
  const req = buildBatchRequest('https://photos.google.com', { albumKey: 'A', authKey: 'K' }, 'TOKEN2');
  assert.match(req.url, /\/u\/0\/_\/PhotosUi\/data\/batchexecute\?rpcids=snAcKc&source-path=%2Fshare%2FA$/);
  const envelope = JSON.parse(decodeURIComponent(req.body.replace(/^f\.req=/, '')));
  assert.equal(envelope[0][0][0], 'snAcKc');
  assert.deepEqual(JSON.parse(envelope[0][0][1]), ['A', 'TOKEN2', null, 'K']);
});

test('parses items, next token, and video markers from a batchexecute response', () => {
  const text = batchResponse(
    [
      rawItem('p1', 'https://lh3.googleusercontent.com/pw/AP1Gcz_abc', 4032, 3024),
      rawItem('v1', 'https://lh3.googleusercontent.com/pw/AP1Gcz_vid', 1920, 1080, true),
      ['broken'],
    ],
    'NEXT'
  );
  const parsed = parseBatchResponse(text)!;
  assert.equal(parsed.nextToken, 'NEXT');
  assert.equal(parsed.items.length, 2, 'malformed item skipped');
  assert.deepEqual(
    { ...parsed.items[0], isVideo: parsed.items[0].isVideo },
    { id: 'p1', url: 'https://lh3.googleusercontent.com/pw/AP1Gcz_abc', width: 4032, height: 3024, takenAtMs: 1700000000000, isVideo: false }
  );
  assert.equal(parsed.items[1].isVideo, true);
  assert.equal(parseBatchResponse(batchResponse([], null))!.nextToken, null);
  assert.equal(parseBatchResponse('<html>error</html>'), null);
  assert.equal(parseItem(null), null);
});

test('sized URLs cap the longest side at 1920 and keep aspect', () => {
  assert.equal(sizedImageUrl('https://x/pw/abc', 4032, 3024), 'https://x/pw/abc=w1920-h1440');
  assert.equal(sizedImageUrl('https://x/pw/abc=w400-h300-no', 3024, 4032), 'https://x/pw/abc=w1440-h1920');
  assert.equal(sizedImageUrl('https://x/pw/abc', 800, 600), 'https://x/pw/abc=w800-h600');
  assert.equal(sizedImageUrl('https://x/pw/abc', 0, 0), 'https://x/pw/abc=w1920-h1080');
});
