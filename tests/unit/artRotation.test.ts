import test from 'node:test';
import assert from 'node:assert/strict';
import { ART_GAP_MAX, ART_GAP_MIN, artworksToPhotos, mixArtIntoSlides } from '../../src/client/lib/artRotation.js';
import type { FamilyMember, PhotoItem } from '../../src/shared/types.js';

const photo = (id: string, source: PhotoItem['source'] = 'upload'): PhotoItem => ({
  id,
  url: `/media/photos/${id}.jpg`,
  orientation: 'landscape',
  caption: '',
  source,
  albumId: null,
  createdAt: '2026-11-03T00:00:00Z',
});
const slidesOf = (n: number) => Array.from({ length: n }, (_, i) => [photo(`p${i}`)]);

test('one drawing after every 10–15 photos, cycling through all drawings', () => {
  const art = ['a', 'b', 'c'].map((id) => photo(id, 'art'));
  for (const seed of [0.11, 0.42, 0.77, 0.93]) {
    const mixed = mixArtIntoSlides(slidesOf(200), art, seed);
    let run = 0;
    const gaps: number[] = [];
    const seen = new Set<string>();
    for (const slide of mixed) {
      if (slide[0].source === 'art') {
        gaps.push(run);
        seen.add(slide[0].id);
        run = 0;
      } else run += slide.length;
    }
    assert.ok(gaps.length >= 200 / ART_GAP_MAX - 1, 'drawings keep showing up');
    for (const g of gaps) assert.ok(g >= ART_GAP_MIN && g <= ART_GAP_MAX, `gap ${g} out of range`);
    assert.equal(seen.size, 3, 'every drawing gets a turn');
    assert.equal(mixed.filter((s) => s[0].source !== 'art').length, 200, 'no photo is dropped');
  }
});

test('paired portraits count as two photos', () => {
  const pairs = Array.from({ length: 40 }, (_, i) => [photo(`l${i}`), photo(`r${i}`)]);
  const mixed = mixArtIntoSlides(pairs, [photo('a', 'art')], 0.5);
  const firstArt = mixed.findIndex((s) => s[0].source === 'art');
  assert.ok(firstArt >= 5 && firstArt <= 8, `first drawing after ${firstArt} pairs`);
});

test('small slideshows still show a drawing once per loop; no drawings changes nothing', () => {
  const slides = slidesOf(4);
  const mixed = mixArtIntoSlides(slides, [photo('a', 'art')], 0.3);
  assert.equal(mixed.length, 5);
  assert.equal(mixed[4][0].id, 'a');
  assert.equal(mixArtIntoSlides(slides, [], 0.3), slides);
  assert.deepEqual(mixArtIntoSlides([], [photo('a', 'art')], 0.3), [[photo('a', 'art')]]);
});

test('drawings are captioned with the artist', () => {
  const kid = { id: 'k', name: 'Ada', emoji: '🦄' } as FamilyMember;
  const [withKid, orphan] = artworksToPhotos(
    [
      { id: '1', memberId: 'k', url: '/media/art/1.png', createdAt: 'x', updatedAt: 'y' },
      { id: '2', memberId: 'gone', url: '/media/art/2.png', createdAt: 'x', updatedAt: 'y' },
    ],
    [kid]
  );
  assert.equal(withKid.caption, '🦄 By Ada');
  assert.equal(withKid.source, 'art');
  assert.equal(orphan.caption, 'Family art');
});
