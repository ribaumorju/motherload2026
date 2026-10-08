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
 * Speckled rock. The trick that makes it read as stone rather than as a flat
 * swatch is that the speckle is drawn twice: a coarse mottle for the body, then
 * a fine grain, then a lit top edge and a shadowed bottom edge so every tile
 * looks like a chipped block rather than a square.
 */
function drawRock(ctx, band, variant, depthFt) {
  const { base, hi, lo } = rockAt(depthFt);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);

  // Coarse mottle: a handful of blobs at fixed offsets per variant.
  for (let i = 0; i < 26; i += 1) {
    const r = hash2(variant * 131 + i, band * 17 + 3);
    const r2 = hash2(band * 29 + i, variant * 7 + 11);
    const x = r * S;
    const y = r2 * S;
    const rad = (2 + r * 4) * SS;
    ctx.fillStyle = r > 0.5 ? lo : hi;
    ctx.globalAlpha = 0.16 + r2 * 0.14;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Fine grain, one pixel-ish dot per cell.
  const step = 3 * SS;
  for (let y = 0; y < S; y += step) {
    for (let x = 0; x < S; x += step) {
      const h = hash2(x + variant * 61, y + band * 97);
      if (h < 0.42) continue;
      ctx.fillStyle = h > 0.78 ? hi : lo;
      ctx.globalAlpha = 0.12 + (h - 0.42) * 0.3;
      ctx.fillRect(x + (h * 3 * SS) % (step - 1), y + (h * 7 * SS) % (step - 1), SS, SS);
    }
  }
  ctx.globalAlpha = 1;

  // Edge shading, so tiles read as separate blocks.
  ctx.fillStyle = hi;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 0, S, SS);
  ctx.fillRect(0, 0, SS, S);
  ctx.fillStyle = lo;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, S - SS, S, SS);
  ctx.fillRect(S - SS, 0, SS, S);
  ctx.globalAlpha = 1;

  // A chip out of one corner, chosen per variant, so a wall of rock is not a
  // grid of identical squares.
  const corner = variant % 4;
  const cx = corner === 1 || corner === 3 ? S : 0;
  const cy = corner >= 2 ? S : 0;
  ctx.fillStyle = lo;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + (cx === 0 ? 1 : -1) * S * 0.34, cy);
  ctx.lineTo(cx, cy + (cy === 0 ? 1 : -1) * S * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * An ore tile. The ore is a cluster of facets rather than a flat square: a
 * glowing core, a few crystal shapes, and a dark rim so it stands out against
 * rock of any depth.
 */
function drawOre(ctx, ore, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);

  const cx = S * 0.5;
  const cy = S * 0.5;
  const facets = 4 + (variant % 3);

  // Dark socket so the crystal sits *in* the rock.
  ctx.fillStyle = ore.tint;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  for (let i = 0; i < facets; i += 1) {
    const a = (i / facets) * Math.PI * 2 + variant * 0.7;
    const dist = S * 0.11 * (1 + hash2(i + variant * 13, band * 7));
    const px = cx + Math.cos(a) * dist;
    const py = cy + Math.sin(a) * dist;
    const size = S * (0.1 + hash2(band * 3 + i, variant * 5) * 0.1);

    ctx.beginPath();
    ctx.moveTo(px, py - size);
    ctx.lineTo(px + size * 0.82, py);
    ctx.lineTo(px, py + size);
    ctx.lineTo(px - size * 0.82, py);
    ctx.closePath();
    ctx.fillStyle = ore.color;
    ctx.fill();

    // A lit facet on the upper-left of each crystal, and a highlight pip.
    ctx.beginPath();
    ctx.moveTo(px, py - size);
    ctx.lineTo(px - size * 0.82, py);
    ctx.lineTo(px, py + size * 0.15);
    ctx.closePath();
    ctx.fillStyle = ore.spark;
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Core glow.
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.4);
  grad.addColorStop(0, ore.spark);
  grad.addColorStop(0.35, ore.color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** Gas pockets look like ordinary rock until the drill opens one. */
function drawGas(ctx, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);
  const grad = ctx.createRadialGradient(S * 0.5, S * 0.5, 0, S * 0.5, S * 0.5, S * 0.5);
  grad.addColorStop(0, 'rgba(180, 255, 120, 0.5)');
  grad.addColorStop(1, 'rgba(120, 200, 60, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  // A faint seam, the only hint you get.
  ctx.strokeStyle = 'rgba(200, 255, 150, 0.35)';
  ctx.lineWidth = SS;
  ctx.beginPath();
  ctx.moveTo(S * 0.15, S * 0.62);
  ctx.quadraticCurveTo(S * 0.5, S * 0.3, S * 0.85, S * 0.66);
  ctx.stroke();
}

/** Lava is bright and obviously lethal, and it glows from below the floor. */
function drawLava(ctx, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);
  const grad = ctx.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0, '#ff5a12');
  grad.addColorStop(0.5, '#ffb020');
  grad.addColorStop(1, '#c81f04');
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = grad;
  ctx.fillRect(SS, SS, S - SS * 2, S - SS * 2);
  ctx.globalAlpha = 1;
  // Crust blobs floating on the surface.
  for (let i = 0; i < 5; i += 1) {
    const h = hash2(variant * 31 + i, band * 13 + 7);
    const h2 = hash2(band * 19 + i, variant * 11);
    ctx.fillStyle = 'rgba(60, 12, 4, 0.75)';
    ctx.beginPath();
    ctx.arc(h * S, h2 * S, S * (0.05 + h * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The crack overlay. Drawn on top of a tile while it is being drilled, with
 * alpha driven by progress, so rock visibly gives way instead of blinking out.
 */
function drawCrack(ctx, step) {
  const lines = 2 + step * 3;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.lineCap = 'round';
  for (let i = 0; i < lines; i += 1) {
    const h = hash2(i * 17 + step * 101, step * 53 + i);
    const h2 = hash2(step * 7 + i, i * 29);
    ctx.lineWidth = (1 + h * 2) * SS;
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
