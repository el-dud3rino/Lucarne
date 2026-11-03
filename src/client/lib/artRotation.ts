import type { Artwork, FamilyMember, PhotoItem } from '../../shared/types.js';

/** Small seeded PRNG so the slideshow order stays stable across re-renders. */
function seededRandom(seed: number): () => number {
  let state = Math.floor(seed * 2 ** 31) || 1;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

export const ART_GAP_MIN = 10;
export const ART_GAP_MAX = 15;

/** Turns kids' drawings into slideshow items, captioned with the artist. */
export function artworksToPhotos(art: Artwork[], members: FamilyMember[]): PhotoItem[] {
  return art.map((a) => {
    const m = members.find((x) => x.id === a.memberId);
    return {
      id: `art-${a.id}`,
      url: a.url,
      orientation: 'landscape',
      caption: m ? `${m.emoji} By ${m.name}` : 'Family art',
      source: 'art',
      albumId: null,
      createdAt: a.updatedAt,
    };
  });
}

/**
 * Slips one drawing into the slideshow after every 10–15 regular photos (random gap each time),
 * cycling through the drawings in a shuffled order. When the whole slideshow has fewer photos than
 * the first gap, one drawing goes at the end so it still shows once per loop.
 */
export function mixArtIntoSlides(slides: PhotoItem[][], art: PhotoItem[], seed: number): PhotoItem[][] {
  if (art.length === 0) return slides;
  const rand = seededRandom(seed);
  const order = [...art];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (slides.length === 0) return order.map((a) => [a]);

  const nextGap = () => ART_GAP_MIN + Math.floor(rand() * (ART_GAP_MAX - ART_GAP_MIN + 1));
  const out: PhotoItem[][] = [];
  let artIdx = 0;
  let sinceArt = 0;
  let gap = nextGap();
  for (const slide of slides) {
    out.push(slide);
    sinceArt += slide.length;
    if (sinceArt >= gap) {
      out.push([order[artIdx % order.length]]);
      artIdx++;
      sinceArt = 0;
      gap = nextGap();
    }
  }
  if (artIdx === 0) out.push([order[0]]);
  return out;
}
