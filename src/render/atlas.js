/**
 * Every tile in the game, drawn once at startup.
 *
 * Drawing rock tile by tile, every frame, with per-pixel noise, is a way to
 * spend a whole frame on the background. Instead the rock is rendered once into
 * a set of small canvases and blitted: one rock sprite per depth band per
 * variant, one ore sprite per ore per variant, and one crack overlay per
 * damage step.
 *
 * Sprites are rendered at `SS` times tile size and blitted down, so they stay
 * sharp on a high-DPI display or when the whole world is scaled up to fill a
 * wide window. The noise inside them comes from the same position hash the rest
 * of the game uses, so a rock looks the same every time you fly past it.
 */

import { TILE, ORES, ORE_BY_ID } from '../config.js';
import { hash2 } from '../sim/rng.js';
import { rockAt, BAND_DEPTHS, BAND_COUNT, bandIndexAt } from './palette.js';

/** Supersampling factor for the sprites. 2 is enough for a 2x zoom. */
export const SS = 2;
const S = TILE * SS;

function make(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * Speckled rock, quantised.
 *
 * Three tones, whole blocks, no soft edges and no alpha: the texture is a grid
 * of flat squares picked by position hash, so it reads as a tile rather than as
 * a photograph of one. Soft radial mottles and half-transparent grain were what
 * made this look modern, and they also cost more to draw than the blocks do.
 */
function drawRock(ctx, band, variant, depthFt) {
  const { base, hi, lo } = rockAt(depthFt);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  const step = SS * 3;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const h = hash2(x + variant * 61, y + band * 97);
      if (h < 0.45) continue;
      ctx.fillStyle = h > 0.74 ? hi : lo;
      ctx.fillRect(x, y, step, step);
    }
  }

  // A lit top-left and a shadowed bottom-right, one block thick, so a wall of
  // rock reads as stacked blocks.
  ctx.fillStyle = hi;
  ctx.fillRect(0, 0, S, SS);
  ctx.fillRect(0, 0, SS, S);
  ctx.fillStyle = lo;
  ctx.fillRect(0, S - SS, S, SS);
  ctx.fillRect(S - SS, 0, SS, S);

  // A chip out of one corner, chosen per variant, so a wall of rock is not a
  // grid of identical squares.
  const corner = variant % 4;
  const cx = corner === 1 || corner === 3 ? S : 0;
  const cy = corner >= 2 ? S : 0;
  ctx.fillStyle = lo;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + (cx === 0 ? 1 : -1) * S * 0.34, cy);
  ctx.lineTo(cx, cy + (cy === 0 ? 1 : -1) * S * 0.3);
  ctx.closePath();
  ctx.fill();
}

/**
 * An ore tile: solid facets with black outlines.
 *
 * The glow and the soft core are gone. Ore has to be the brightest thing in the
 * rock, and flat saturated colour on a black outline does that at a glance
 * without any blur, which is how a game from this era got your eye.
 */
function drawOre(ctx, ore, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);

  const cx = S * 0.5;
  const cy = S * 0.5;
  const facets = 4 + (variant % 3);
  const ink = '#0b0d14';

  // A dark socket, hard-edged, so the crystal sits *in* the rock.
  ctx.fillStyle = ore.tint;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = SS;
  ctx.stroke();

  for (let i = 0; i < facets; i += 1) {
    const a = (i / facets) * Math.PI * 2 + variant * 0.7;
    const dist = S * 0.1 * (1 + hash2(i + variant * 13, band * 7));
    const px = cx + Math.cos(a) * dist;
    const py = cy + Math.sin(a) * dist;
    const size = S * (0.11 + hash2(band * 3 + i, variant * 5) * 0.09);

    ctx.beginPath();
    ctx.moveTo(px, py - size);
    ctx.lineTo(px + size * 0.82, py);
    ctx.lineTo(px, py + size);
    ctx.lineTo(px - size * 0.82, py);
    ctx.closePath();
    ctx.fillStyle = ore.color;
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = SS;
    ctx.stroke();

    // One hard lit facet on the upper left. No alpha: a half-transparent
    // highlight is what a soft renderer does.
    ctx.beginPath();
    ctx.moveTo(px, py - size);
    ctx.lineTo(px - size * 0.82, py);
    ctx.lineTo(px, py + size * 0.1);
    ctx.closePath();
    ctx.fillStyle = ore.spark;
    ctx.fill();
  }

  // A single glint, so the eye catches it before it has read the shape.
  ctx.fillStyle = ore.spark;
  ctx.fillRect(cx - SS, cy - S * 0.24, SS * 2, SS * 2);
}

/**
 * Gas pockets look like ordinary rock until the drill opens one.
 *
 * This is the one tile that should *not* stand out, so the green cast stays
 * faint and the speckle is the same block grid the rock uses. The seam is the
 * only deliberate tell, and it has to be deniable.
 */
function drawGas(ctx, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);

  const step = SS * 3;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const h = hash2(x * 3 + variant * 71, y * 5 + band * 37);
      if (h < 0.55) continue;
      ctx.fillStyle = 'rgba(150, 255, 110, 0.22)';
      ctx.fillRect(x, y, step, step);
    }
  }

  // A hard seam, the only hint you get.
  ctx.strokeStyle = 'rgba(190, 255, 140, 0.3)';
  ctx.lineWidth = SS;
  ctx.beginPath();
  ctx.moveTo(S * 0.15, S * 0.62);
  ctx.lineTo(S * 0.4, S * 0.42);
  ctx.lineTo(S * 0.62, S * 0.56);
  ctx.lineTo(S * 0.85, S * 0.4);
  ctx.stroke();
}

/** Lava is bright and obviously lethal, in three flat tones of hot. */
function drawLava(ctx, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);

  const step = SS * 3;
  ctx.fillStyle = '#ff7a10';
  ctx.fillRect(SS, SS, S - SS * 2, S - SS * 2);

  // Hot and cooling patches, hard-edged, so it reads as molten rather than as a
  // flat orange square.
  for (let y = SS; y < S - SS; y += step) {
    for (let x = SS; x < S - SS; x += step) {
      const h = hash2(x * 7 + variant * 31, y * 11 + band * 13);
      if (h < 0.5) continue;
      ctx.fillStyle = h > 0.78 ? '#ffd24a' : '#c81f04';
      ctx.fillRect(x, y, step, step);
    }
  }

  // Crust floating on the surface, in whole blocks.
  for (let i = 0; i < 4; i += 1) {
    const h = hash2(variant * 31 + i, band * 13 + 7);
    const h2 = hash2(band * 19 + i, variant * 11);
    ctx.fillStyle = '#3c0c04';
    ctx.fillRect(
      Math.floor(SS + h * (S - SS * 2 - step)),
      Math.floor(SS + h2 * (S - SS * 2 - step)),
      step, step,
    );
  }
}

/**
 * The crack overlay. Drawn on top of a tile while it is being drilled, with
 * alpha driven by progress, so rock visibly gives way instead of blinking out.
 */
function drawCrack(ctx, step) {
  const lines = 2 + step * 3;
  ctx.strokeStyle = '#0b0d14';
  // Square caps and whole-block width: round caps and hairline strokes are the
  // modern tell, and a crack should look like it was cut out of the tile.
  ctx.lineCap = 'square';
  for (let i = 0; i < lines; i += 1) {
    const h = hash2(i * 17 + step * 101, step * 53 + i);
    const h2 = hash2(step * 7 + i, i * 29);
    ctx.lineWidth = (h > 0.5 ? 2 : 1) * SS;
    ctx.beginPath();
    const x0 = h * S;
    const y0 = h2 * S;
    ctx.moveTo(x0, y0);
    let x = x0;
    let y = y0;
    for (let seg = 0; seg < 3; seg += 1) {
      const a = hash2(i * 7 + seg, step * 31 + seg) * Math.PI * 2;
      x += Math.cos(a) * S * 0.18;
      y += Math.sin(a) * S * 0.18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/**
 * Builds the whole atlas. Called once. Returns flat arrays indexed by
 * `band * 4 + variant`, which keeps the per-tile lookup to one multiply.
 */
export function buildAtlas() {
  const rock = [];
  const ore = new Map();
  const gas = [];
  const lava = [];
  const crack = [];

  for (let band = 0; band < BAND_COUNT; band += 1) {
    for (let variant = 0; variant < 4; variant += 1) {
      const depth = BAND_DEPTHS[band];
      const rk = make(S);
      drawRock(rk.getContext('2d'), band, variant, depth);
      rock[band * 4 + variant] = rk;

      const g = make(S);
      drawGas(g.getContext('2d'), band, variant, depth);
      gas[band * 4 + variant] = g;

      const l = make(S);
      drawLava(l.getContext('2d'), band, variant, depth);
      lava[band * 4 + variant] = l;
    }
  }

  for (const def of ORES) {
    const variants = [];
    for (let variant = 0; variant < 4; variant += 1) {
      const c = make(S);
      // Ore sits in the rock of its own depth, so a deep gem in shallow rock
      // does not exist and never gets drawn.
      const band = bandIndexAt(def.from);
      drawOre(c.getContext('2d'), def, band, variant, def.from);
      variants[variant] = c;
    }
    ore.set(def.id, variants);
  }

  for (let step = 0; step < 4; step += 1) {
    const c = make(S);
    drawCrack(c.getContext('2d'), step);
    crack[step] = c;
  }

  return { rock, ore, gas, lava, crack };
}
