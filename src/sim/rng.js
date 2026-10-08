/**
 * A deterministic random number generator.
 *
 * `Math.random` would do for most things, but the mine has to be the *same*
 * mine every time you load a save. A seeded stream means the terrain can be
 * regenerated from a single number instead of storing a megabyte of tiles, and
 * it means the test harness gets the same world on every run.
 *
 * mulberry32: 32 bits of state, good enough for rock and cheap enough to call
 * a million times while generating a 400-row mine.
 */

/** Returns a function producing floats in [0, 1) from a 32-bit seed. */
export function makeRng(seed) {
  let a = (seed | 0) || 0x9e3779b9;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.range = (lo, hi) => lo + next() * (hi - lo);
  return next;
}

/**
 * A stable hash of two integers, in [0, 1).
 *
 * Used for anything that must not move when you look away: the speckle inside
 * a tile, which of the four ore variants a tile gets, whether a sparkle is
 * drawn. Those must be a pure function of position, not of draw order.
 */
export function hash2(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
