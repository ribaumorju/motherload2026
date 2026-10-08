/**
 * Painting the mine.
 *
 * Order matters and is fixed: sky, surface, tunnels, tiles, props, light, then
 * particles. The light pass is the last of the world layers because it is a
 * darkness with holes punched in it - everything the player is meant to see has
 * to already be on the canvas before the darkness goes on top.
 *
 * The darkness is built in a separate canvas at a quarter resolution and
 * stretched back up. It is a smooth gradient with soft edges, so the low
 * resolution is invisible, and it turns a full-screen per-pixel pass into a few
 * hundred cheap operations.
 */

import {
  TILE, COLS, ROWS, SKY_ROWS, SURFACE_ROW, FACILITIES, ENDGAME,
} from '../config.js';
import { KIND, kindOf, variantOf, rowDepth } from '../sim/world.js';
import { hash2 } from '../sim/rng.js';
import { SS } from './atlas.js';
import { bandIndexAt, SKY } from './palette.js';

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

/**
 * The sky: flat bands, hard stars, a hard sun.
 *
 * It used to be a four-stop gradient with a radial bloom around the sun and
 * stars whose alpha twinkled. Flat bands are what this era of game actually
 * drew, and it costs six `fillRect`s instead of building two gradients every
 * frame.
 *
 * Drawn only when the view includes sky, which for most of the game it does not.
 */
export function drawSky(ctx, cam, origin, viewW, viewH) {
  const skyBottom = (SKY_ROWS + 1) * TILE;
  const y = skyBottom - origin.y;
  if (y < 0) return;

  const bands = [SKY.zenith, SKY.zenith, SKY.high, SKY.high, SKY.low, SKY.horizon];
  const bandH = y / bands.length;
  for (let i = 0; i < bands.length; i += 1) {
    ctx.fillStyle = bands[i];
    ctx.fillRect(0, Math.floor(i * bandH), viewW, Math.ceil(bandH) + 1);
  }

  // Stars, whole pixels on a fixed grid so they do not crawl as the camera moves.
  ctx.fillStyle = '#ffffff';
  for (let gx = 0; gx < COLS * TILE; gx += 37) {
    for (let gy = -600; gy < skyBottom; gy += 43) {
      const h = hash2(gx, gy);
      if (h < 0.8) continue;
      const sx = gx + h * 20 - origin.x;
      const sy = gy - origin.y;
      if (sx < 0 || sx > viewW || sy < 0 || sy > y) continue;
      const s = h > 0.94 ? 2 : 1;
      ctx.fillRect(sx, sy, s, s);
    }
  }

  // The sun, low and warm: a hard disc with an outline, no bloom.
  const sunX = 15.5 * TILE - origin.x;
  const sunY = skyBottom - 30 - origin.y;
  ctx.fillStyle = SKY.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#7a4a1c';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawHills(ctx, origin, skyBottom, viewW);
}

function drawHills(ctx, origin, skyBottom, viewW) {
  const layers = [
    { parallax: 0.35, height: 130, color: '#1c2740', step: 210 },
    { parallax: 0.6, height: 78, color: '#121a28', step: 150 },
  ];
  for (const layer of layers) {
    const base = skyBottom - origin.y - layer.height;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(0, skyBottom - origin.y + 2);
    const shift = -origin.x * layer.parallax;
    for (let x = -layer.step; x <= viewW + layer.step; x += 12) {
      const world = x - shift;
      const h = Math.sin(world / layer.step) * 0.5 + Math.sin(world / (layer.step * 0.37)) * 0.5;
      // Snapped to 4px steps: a smooth curve up here would be the only soft edge
      // left on the screen.
      ctx.lineTo(x, Math.round((base + h * layer.height * 0.5) / 4) * 4);
    }
    ctx.lineTo(viewW, skyBottom - origin.y + 2);
    ctx.closePath();
    ctx.fill();
  }
}

/** The grass line and the facilities standing on it. */
export function drawSurface(ctx, origin, time) {
  const y = SURFACE_ROW * TILE - origin.y;
  if (y < -TILE * 2 || y > 4000) return;

  // Flat grass with a hard shadow line under it, rather than a gradient.
  ctx.fillStyle = SKY.grassLit;
  ctx.fillRect(0, y, COLS * TILE, TILE * 0.5);
  ctx.fillStyle = SKY.grass;
  ctx.fillRect(0, y + TILE * 0.5 - 2, COLS * TILE, 2);
  ctx.fillStyle = SKY.soil;
  ctx.fillRect(0, y + TILE * 0.5, COLS * TILE, TILE * 1.5);

  // A few tufts, deterministic per column.
  ctx.strokeStyle = SKY.grassLit;
  ctx.lineWidth = 1;
  for (let col = 0; col < COLS; col += 1) {
    const h = hash2(col, 7);
    if (h < 0.45) continue;
    const bx = (col + h) * TILE - origin.x;
    for (let b = 0; b < 3; b += 1) {
      const hx = hash2(col * 3 + b, 11);
      ctx.beginPath();
      ctx.moveTo(bx + b * 3, y + TILE * 0.5);
      ctx.lineTo(bx + b * 3 + (hx - 0.5) * 6, y + TILE * 0.5 - 5 - hx * 5);
      ctx.stroke();
    }
  }

  for (const facility of FACILITIES) drawFacility(ctx, facility, origin, y, time);
}

/**
 * A facility: a flat box with a hard bevel, a sign band, lit windows, and a
 * beacon that blinks rather than glows.
 *
 * The beacon is the only affordance telling the player "you can dock here", so
 * it is worth the lines - but it blinks on and off now instead of pulsing
 * through a soft halo, because a halo is the one thing this style does not have.
 */
function drawFacility(ctx, facility, origin, groundY, time) {
  const x = facility.col * TILE - origin.x;
  const w = Math.round(TILE * 2.6);
  const h = Math.round(TILE * 2.1);
  const top = Math.round(groundY - h);
  const left = Math.round(x - w / 2);

  // Light from the top-left, dark to the bottom-right, black outline: how a
  // building was drawn before anyone reached for a gradient.
  ctx.fillStyle = '#2b3242';
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = '#3d4759';
  ctx.fillRect(left, top, w, 3);
  ctx.fillRect(left, top, 3, h);
  ctx.fillStyle = '#151a24';
  ctx.fillRect(left, top + h - 3, w, 3);
  ctx.fillRect(left + w - 3, top, 3, h);
  ctx.strokeStyle = '#0b0d14';
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1);

  // The sign band.
  ctx.fillStyle = facility.color;
  ctx.fillRect(left + 4, top + 5, w - 8, 7);

  // Lit windows.
  ctx.fillStyle = '#ffecb4';
  for (let i = 0; i < 3; i += 1) {
    const wx = left + 6 + i * 12;
    ctx.fillRect(wx, top + 18, 8, 8);
    ctx.strokeStyle = '#0b0d14';
    ctx.strokeRect(wx + 0.5, top + 18.5, 7, 7);
  }

  if (Math.sin(time * 3 + facility.col) > 0) {
    ctx.fillStyle = facility.color;
    ctx.fillRect(Math.round(x) - 3, top - 9, 6, 6);
    ctx.strokeStyle = '#0b0d14';
    ctx.strokeRect(Math.round(x) - 2.5, top - 8.5, 5, 5);
  }
}

/* ------------------------------------------------------------------ */
/* Tiles                                                               */
/* ------------------------------------------------------------------ */

/**
 * Blits the visible tiles. Only the tiles on screen are touched, which is what
 * keeps a 400-row mine at a stable frame rate.
 *
 * Damaged tiles get a crack overlay whose alpha tracks drill progress, and a
 * tile at high damage is also nudged inward so the hole looks like it is
 * opening rather than like a decal pasted on a full square.
 */
export function drawTiles(ctx, world, origin, viewW, viewH, atlas) {
  const c0 = Math.max(0, Math.floor(origin.x / TILE));
  const c1 = Math.min(COLS - 1, Math.ceil((origin.x + viewW) / TILE));
  const r0 = Math.max(0, Math.floor(origin.y / TILE));
  const r1 = Math.min(ROWS - 1, Math.ceil((origin.y + viewH) / TILE));

  for (let row = r0; row <= r1; row += 1) {
    const band = bandIndexAt(rowDepth(row));
    const y = row * TILE - origin.y;
    for (let col = c0; col <= c1; col += 1) {
      const i = row * COLS + col;
      const tile = world.tiles[i];
      const kind = kindOf(tile);
      if (kind === KIND.EMPTY) continue;

      const variant = variantOf(tile);
      const idx = band * 4 + variant;
      const x = col * TILE - origin.x;
      const damage = world.damage[i];

      const inset = damage > 0.05 ? Math.min(TILE * 0.22, damage * TILE * 0.22) : 0;
      const size = TILE - inset * 2;

      let sprite = atlas.rock[idx];
      if (kind === KIND.ORE) sprite = (atlas.ore.get(world.ore[i]) || [])[variant] || sprite;
      else if (kind === KIND.GAS) sprite = atlas.gas[idx];
      else if (kind === KIND.LAVA) sprite = atlas.lava[idx];

      ctx.drawImage(sprite, 0, 0, TILE * SS, TILE * SS, x + inset, y + inset, size, size);

      if (damage > 0.05 && kind !== KIND.LAVA) {
        const step = Math.min(3, Math.floor(damage * 4));
        ctx.globalAlpha = Math.min(1, damage * 1.15);
        ctx.drawImage(atlas.crack[step], 0, 0, TILE * SS, TILE * SS, x + inset, y + inset, size, size);
        ctx.globalAlpha = 1;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Mr. Natas                                                           */
/* ------------------------------------------------------------------ */

/**
 * The thing at the bottom. A hole in the dark with a face in it, lit from
 * nowhere, and it watches. Deliberately unsettling: the reward for reaching it
 * should feel like it was not entirely worth the trip.
 */
export function drawNatas(ctx, origin, time) {
  const x = (ENDGAME.col + 0.5) * TILE - origin.x;
  const y = (ENDGAME.row + 0.5) * TILE - origin.y;
  if (x < -400 || x > 4000 || y < -400 || y > 4000) return;

  // A red halo in flat rings, outermost darkest, rather than one soft radial
  // fade: it reads as drawn light instead of rendered light.
  for (const ring of [
    { r: TILE * 6, color: '#150206' },
    { r: TILE * 3.4, color: '#2b0409' },
    { r: TILE * 2.2, color: '#4a0810' },
  ]) {
    ctx.fillStyle = ring.color;
    ctx.beginPath();
    ctx.arc(x, y, ring.r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (Math.sin(time * 1.4) > 0) {
    ctx.fillStyle = '#5e0a14';
    ctx.beginPath();
    ctx.arc(x, y, TILE * 1.75, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#080305';
  ctx.beginPath();
  ctx.arc(x, y, TILE * 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ff2b2b';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Eyes: hard blocks that blink off, not soft ellipses.
  if (Math.sin(time * 0.7) <= 0.94) {
    ctx.fillStyle = '#ff3b3b';
    ctx.fillRect(Math.round(x - TILE * 0.62), Math.round(y - TILE * 0.3), 9, 7);
    ctx.fillRect(Math.round(x + TILE * 0.62) - 9, Math.round(y - TILE * 0.3), 9, 7);
  }

  // The grin, as straight lines.
  ctx.strokeStyle = '#ff6a6a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - TILE * 0.5, y + TILE * 0.35);
  ctx.lineTo(x - TILE * 0.17, y + TILE * 0.62);
  ctx.lineTo(x + TILE * 0.17, y + TILE * 0.62);
  ctx.lineTo(x + TILE * 0.5, y + TILE * 0.35);
  ctx.stroke();
}

