/**
 * The colour of depth.
 *
 * The mine is one continuous descent, and the only thing telling the player how
 * far down they are - before they read a number - is the rock. So the rock
 * changes: warm brown near the grass, then grey, then cold slate, then a purple
 * so dark it is almost black, and finally near the bottom a black rock lit from
 * within by red. Each band is interpolated rather than switched, because a hard
 * colour change at a depth reads as a rendering bug.
 *
 * Colours are `[r, g, b]` triples so they can be mixed arithmetically. They are
 * turned into CSS strings once, at module load, not per tile.
 */

import { DEPTH_FT } from '../config.js';
import { clamp, lerp } from '../sim/physics.js';

/** Depth stops, in feet, with the rock's face, top edge and bottom edge. */
const BANDS = [
  { at: 0, base: [96, 66, 46], hi: [126, 92, 62], lo: [58, 38, 26] },
  { at: 1200, base: [104, 74, 52], hi: [136, 102, 72], lo: [62, 42, 28] },
  { at: 2800, base: [92, 82, 76], hi: [124, 114, 106], lo: [54, 46, 42] },
  { at: 4600, base: [66, 74, 92], hi: [96, 106, 128], lo: [36, 42, 58] },
  { at: 6400, base: [62, 54, 82], hi: [92, 80, 116], lo: [32, 26, 48] },
  { at: 8200, base: [46, 36, 56], hi: [74, 58, 86], lo: [22, 16, 30] },
  { at: 10000, base: [30, 20, 26], hi: [58, 34, 38], lo: [14, 8, 12] },
  { at: 12000, base: [20, 10, 12], hi: [64, 22, 22], lo: [8, 3, 4] },
];

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c, a = 1) => `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${a})`;

/** Rock face, top edge and bottom edge at a depth in feet. */
export function rockAt(depthFt) {
  const d = clamp(depthFt, 0, DEPTH_FT);
  let i = 0;
  while (i < BANDS.length - 2 && d >= BANDS[i + 1].at) i += 1;
  const a = BANDS[i];
  const b = BANDS[Math.min(i + 1, BANDS.length - 1)];
  const span = b.at - a.at || 1;
  const t = clamp((d - a.at) / span, 0, 1);
  return {
    base: css(mix(a.base, b.base, t)),
    hi: css(mix(a.hi, b.hi, t)),
    lo: css(mix(a.lo, b.lo, t)),
    baseRgb: mix(a.base, b.base, t),
  };
}

/** The depth each band is named after, shared with the sprite atlas. */
export const BAND_DEPTHS = BANDS.map((b) => b.at);
export const BAND_COUNT = BANDS.length;

/**
 * Which pre-rendered rock band a depth falls in. The atlas only has one sprite
 * per band, so this is the lookup that decides which sprite a tile blits.
 */
export function bandIndexAt(depthFt) {
  const d = clamp(depthFt, 0, DEPTH_FT);
  let i = 0;
  while (i < BANDS.length - 2 && d >= BANDS[i + 1].at) i += 1;
  return i;
}

/**
 * Bands are cached per 64-foot step. `rockAt` does a few lerps and a string
 * build, and calling it per tile per frame at 60fps for 500 tiles is real work
 * for a value that changes imperceptibly.
 */
const cache = new Map();
export function rockCached(depthFt) {
  const key = Math.floor(depthFt / 64) * 64;
  let hit = cache.get(key);
  if (!hit) {
    hit = rockAt(key);
    cache.set(key, hit);
  }
  return hit;
}

/** The sky above the mine, and the haze that sits on the horizon. */
export const SKY = {
  zenith: '#070d1b',
  high: '#12233f',
  low: '#3b5a72',
  horizon: '#c98f5e',
  sun: '#ffe6b0',
  grass: '#2f4a2a',
  grassLit: '#4d7038',
  soil: '#4a3324',
};

/** Darkness per depth: it gets properly black down there. */
export const darknessAt = (depthFt) => lerp(0.06, 0.93, clamp(depthFt / 3200, 0, 1));
