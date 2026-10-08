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
  TILE, COLS, ROWS, SKY_ROWS, SURFACE_ROW, FACILITIES, ENDGAME, ORE_BY_ID,
} from '../config.js';
import { KIND, kindOf, variantOf, rowDepth } from '../sim/world.js';
import { hash2 } from '../sim/rng.js';
import { SS } from './atlas.js';
import { bandIndexAt, darknessAt, SKY } from './palette.js';

const LIGHT_SCALE = 4; // the light map is rendered at 1/LIGHT_SCALE resolution

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

/**
 * The sky, with stars that fade out as you descend and a sun that sits low.
 * Drawn only when the view actually includes sky, which for most of the game it
 * does not.
 */
export function drawSky(ctx, cam, origin, viewW, viewH) {
  const skyBottom = (SKY_ROWS + 1) * TILE;
  const y = skyBottom - origin.y;
  if (y < 0) return;

  const grad = ctx.createLinearGradient(0, 0, 0, Math.max(y, 1));
  grad.addColorStop(0, SKY.zenith);
  grad.addColorStop(0.45, SKY.high);
  grad.addColorStop(0.8, SKY.low);
  grad.addColorStop(1, SKY.horizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, y);

  // Stars on a fixed grid, so they do not crawl as the camera moves.
  ctx.fillStyle = '#ffffff';
  for (let gx = 0; gx < COLS * TILE; gx += 37) {
    for (let gy = -600; gy < skyBottom; gy += 43) {
      const h = hash2(gx, gy);
      if (h < 0.72) continue;
      const sx = gx + h * 20 - origin.x;
      const sy = gy - origin.y;
      if (sx < -4 || sx > viewW + 4 || sy < -4 || sy > y) continue;
      const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(cam.t * 0.8 + h * 12));
      ctx.globalAlpha = (h - 0.72) * 2.2 * twinkle;
      const s = h > 0.94 ? 2 : 1;
      ctx.fillRect(sx, sy, s, s);
    }
  }
  ctx.globalAlpha = 1;

  // The sun, low and warm, with a bloom.
  const sunX = 15.5 * TILE - origin.x;
  const sunY = skyBottom - 30 - origin.y;
  const bloom = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 190);
  bloom.addColorStop(0, 'rgba(255, 230, 176, 0.9)');
  bloom.addColorStop(0.25, 'rgba(255, 170, 90, 0.35)');
  bloom.addColorStop(1, 'rgba(255, 120, 60, 0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(sunX - 200, sunY - 200, 400, 400);
  ctx.fillStyle = SKY.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 17, 0, Math.PI * 2);
  ctx.fill();

  drawHills(ctx, origin, skyBottom, viewW);
}

function drawHills(ctx, origin, skyBottom, viewW) {
  const layers = [
    { parallax: 0.35, height: 130, color: 'rgba(24, 34, 52, 0.85)', step: 210 },
    { parallax: 0.6, height: 78, color: 'rgba(16, 24, 38, 0.95)', step: 150 },
  ];
  for (const layer of layers) {
    const base = skyBottom - origin.y - layer.height;
    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(0, skyBottom - origin.y + 2);
    const shift = -origin.x * layer.parallax;
    for (let x = -layer.step; x <= viewW + layer.step; x += 8) {
      const world = x - shift;
      const h = Math.sin(world / layer.step) * 0.5 + Math.sin(world / (layer.step * 0.37)) * 0.5;
      ctx.lineTo(x, base + h * layer.height * 0.5);
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

  const grad = ctx.createLinearGradient(0, y, 0, y + TILE * 1.2);
  grad.addColorStop(0, SKY.grassLit);
  grad.addColorStop(1, SKY.grass);
  ctx.fillStyle = grad;
  ctx.fillRect(0, y, COLS * TILE, TILE * 0.5);
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
 * A facility is a small building with a coloured sign and a beacon that pulses.
 * The pulse is the only affordance telling the player "you can dock here", so it
 * is worth the lines.
 */
function drawFacility(ctx, facility, origin, groundY, time) {
  const x = facility.col * TILE - origin.x;
  const w = TILE * 2.6;
  const h = TILE * 2.1;
  const top = groundY - h;

  const grad = ctx.createLinearGradient(0, top, 0, groundY);
  grad.addColorStop(0, '#2b3242');
  grad.addColorStop(1, '#151a24');
  ctx.fillStyle = grad;
  roundRect(ctx, x - w / 2, top, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = facility.color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.8;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.fillStyle = facility.color;
  ctx.globalAlpha = 0.9;
  roundRect(ctx, x - w / 2 + 4, top + 5, w - 8, 7, 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(255, 236, 180, 0.85)';
  for (let i = 0; i < 3; i += 1) ctx.fillRect(x - w / 2 + 6 + i * 12, top + 18, 8, 8);

  const pulse = 0.5 + 0.5 * Math.sin(time * 3 + facility.col);
  ctx.fillStyle = facility.color;
  ctx.globalAlpha = 0.35 + pulse * 0.5;
  ctx.beginPath();
  ctx.arc(x, top - 7, 3 + pulse * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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

/**
 * Faint glow behind every ore tile on screen, so a rich seam is visible at the
 * edge of your light before you can identify it. This is the single biggest
 * reason the mine reads as a place worth exploring rather than as a wall.
 */
export function drawOreGlow(ctx, world, origin, viewW, viewH, time) {
  const c0 = Math.max(0, Math.floor(origin.x / TILE));
  const c1 = Math.min(COLS - 1, Math.ceil((origin.x + viewW) / TILE));
  const r0 = Math.max(0, Math.floor(origin.y / TILE));
  const r1 = Math.min(ROWS - 1, Math.ceil((origin.y + viewH) / TILE));

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const i = row * COLS + col;
      if (kindOf(world.tiles[i]) !== KIND.ORE) continue;
      const ore = ORE_BY_ID[world.ore[i]];
      if (!ore) continue;
      const x = (col + 0.5) * TILE - origin.x;
      const y = (row + 0.5) * TILE - origin.y;
      const pulse = 0.75 + 0.25 * Math.sin(time * 2 + hash2(col, row) * 8);
      const radius = TILE * (0.9 + ore.tier * 0.22);
      if (!Number.isFinite(radius) || radius <= 0) continue;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, hexA(ore.spark, 0.17 * pulse));
      grad.addColorStop(1, hexA(ore.spark, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }
  ctx.restore();
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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

  const pulse = 0.85 + 0.15 * Math.sin(time * 1.4);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, TILE * 6);
  glow.addColorStop(0, `rgba(255, 40, 40, ${0.3 * pulse})`);
  glow.addColorStop(0.5, 'rgba(140, 10, 20, 0.12)');
  glow.addColorStop(1, 'rgba(80, 0, 10, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - TILE * 6, y - TILE * 6, TILE * 12, TILE * 12);

  ctx.fillStyle = '#0a0406';
  ctx.beginPath();
  ctx.arc(x, y, TILE * 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff3b3b';
  const blink = Math.sin(time * 0.7) > 0.94 ? 0.15 : 1;
  ctx.globalAlpha = blink;
  ctx.beginPath();
  ctx.ellipse(x - TILE * 0.45, y - TILE * 0.2, TILE * 0.17, TILE * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + TILE * 0.45, y - TILE * 0.2, TILE * 0.17, TILE * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = '#ff6a6a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y + TILE * 0.15, TILE * 0.7, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* Lighting                                                            */
/* ------------------------------------------------------------------ */

/**
 * The darkness, with the ship's headlight and every glow cut out of it.
 *
 * `destination-out` on a separate canvas is the cheapest correct way to do
 * this: build the dark, punch holes, composite once. Doing it with per-tile
 * alpha would look like a grid, and doing it per-pixel in JS would cost more
 * than everything else in the frame combined.
 */
export function createLightLayer() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return { canvas, ctx: canvas.getContext('2d') };
}

export function drawLighting(layer, viewW, viewH, origin, ship, depthFt, extraLights, time) {
  const w = Math.max(1, Math.ceil(viewW / LIGHT_SCALE));
  const h = Math.max(1, Math.ceil(viewH / LIGHT_SCALE));
  if (layer.canvas.width !== w || layer.canvas.height !== h) {
    layer.canvas.width = w;
    layer.canvas.height = h;
  }
  const ctx = layer.ctx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = `rgba(2, 3, 8, ${darknessAt(depthFt)})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';

  const punch = (sx, sy, radius, strength) => {
    const lx = (sx - origin.x) / LIGHT_SCALE;
    const ly = (sy - origin.y) / LIGHT_SCALE;
    const lr = radius / LIGHT_SCALE;
    // A non-finite radius makes createRadialGradient throw, which would take the
    // whole frame down over a cosmetic light. Skip it instead.
    if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lr) || lr <= 0) return;
    if (lx + lr < 0 || lx - lr > w || ly + lr < 0 || ly - lr > h) return;
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
    grad.addColorStop(0, `rgba(0,0,0,${strength})`);
    grad.addColorStop(0.45, `rgba(0,0,0,${strength * 0.55})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
  };

  // The ship's own lamp, with a flicker so it reads as a lamp and not a decal.
  const flicker = 0.94 + 0.06 * Math.sin(time * 23) * Math.sin(time * 7.3);
  punch(ship.x, ship.y, TILE * 5.4 * flicker, 0.96);
  punch(ship.x, ship.y, TILE * 2.2, 1);

  for (const light of extraLights) punch(light.x, light.y, light.r, light.strength);

  ctx.globalCompositeOperation = 'source-over';
  return layer.canvas;
}

/**
 * Every ore tile, gas pocket and lava pool on screen that should glow, in world
 * coordinates, so the light pass does not have to walk the grid a second time.
 */
export function collectLights(world, origin, viewW, viewH) {
  const lights = [];
  const c0 = Math.max(0, Math.floor(origin.x / TILE));
  const c1 = Math.min(COLS - 1, Math.ceil((origin.x + viewW) / TILE));
  const r0 = Math.max(0, Math.floor(origin.y / TILE));
  const r1 = Math.min(ROWS - 1, Math.ceil((origin.y + viewH) / TILE));
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const i = row * COLS + col;
      const kind = kindOf(world.tiles[i]);
      if (kind === KIND.LAVA) {
        lights.push({ x: (col + 0.5) * TILE, y: (row + 0.5) * TILE, r: TILE * 2.6, strength: 0.5 });
      } else if (kind === KIND.ORE) {
        const ore = ORE_BY_ID[world.ore[i]];
        if (ore && ore.tier >= 2) {
          lights.push({ x: (col + 0.5) * TILE, y: (row + 0.5) * TILE, r: TILE * 1.5, strength: 0.3 });
        }
      }
    }
  }
  return lights;
}
