/**
 * Painting the mine.
 *
 * Order matters and is fixed: sky, then the surface standing on it, then the
 * tiles, then everything that moves. Above ground it is sky, hills, clouds,
 * grass, trees, buildings; below it is rock, ore and hazards. There is no light
 * pass any more - the mine is lit edge to edge, and what tells you how deep you
 * are is the rock's own colour.
 *
 * The buildings themselves live in `buildings.js`; this file is the ground they
 * stand on and the rock underneath it.
 */

import {
  TILE, COLS, ROWS, SKY_ROWS, SURFACE_ROW, FACILITIES, ENDGAME,
} from '../config.js';
import { KIND, kindOf, variantOf, rowDepth } from '../sim/world.js';
import { hash2 } from '../sim/rng.js';
import { SS } from './atlas.js';
import { bandIndexAt, SKY } from './palette.js';
import { drawFacilities } from './buildings.js';

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

/**
 * The sky: flat bands, a low sun, drifting clouds, two ridges of hills.
 *
 * Daytime blue, not the near-black it was. The original was a bright day over a
 * green field and the mine was the dark place underneath, and having the surface
 * be the darkest spot on the screen had that backwards. The stars went with the
 * night: stars in a blue sky read as a bug, not as a mood.
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

  // The sun, low and warm: a hard disc with an outline, no bloom.
  const sunX = 15.5 * TILE - origin.x;
  const sunY = skyBottom - 38 - origin.y;
  ctx.fillStyle = SKY.sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c8a24a';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawClouds(ctx, cam, origin, viewW, y);
  drawHills(ctx, origin, skyBottom, viewW);
}

/**
 * Clouds, drifting on a slow parallax.
 *
 * These are most of what turns the surface from a backdrop into a place: a blue
 * block with three buildings on it reads as a diagram, and the same block with
 * cloud shadows moving across it does not.
 *
 * Each cloud is placed from the hash of its index, so the sky is the same sky
 * every run, and it wraps over a span slightly wider than the mine so the drift
 * never shows an edge.
 */
function drawClouds(ctx, cam, origin, viewW, skyH) {
  const drift = cam.t * 7 - origin.x * 0.12;
  const span = COLS * TILE + 600;
  for (let i = 0; i < 10; i += 1) {
    const h = hash2(i * 13 + 1, 7);
    const h2 = hash2(i * 7 + 3, 11);
    const w = 44 + Math.round(h * 52);
    const x = Math.round((((h * span + drift) % span) + span) % span - 300);
    const y = 16 + Math.round(h2 * Math.max(24, skyH * 0.5));
    if (x > viewW + 120 || x + w < -120) continue;
    cloud(ctx, x, y, w, h);
  }
}

/** One cloud: stacked hard blocks, a lit top and a cool grey underside. */
function cloud(ctx, x, y, w, seed) {
  const rows = 3 + (seed > 0.55 ? 1 : 0);
  for (let r = 0; r < rows; r += 1) {
    const inset = (rows - 1 - r) * 9;
    const ww = w - inset * 2;
    if (ww <= 0) break;
    ctx.fillStyle = r === 0 ? '#ffffff' : '#f2f7fd';
    ctx.fillRect(x + inset, y + r * 7, ww, 7);
  }
  // The underside, in a cool grey, so a white cloud has some weight on it.
  ctx.fillStyle = '#b8cbe0';
  ctx.fillRect(x + 9, y + rows * 7, w - 18, 3);
  // Puffs on the crown, offset by the seed so no two clouds are the same shape.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + 10 + Math.round(seed * 12), y - 7, 20, 8);
  ctx.fillRect(x + 34 + Math.round(seed * 8), y - 4, 14, 5);
}

function drawHills(ctx, origin, skyBottom, viewW) {
  const layers = [
    { parallax: 0.35, height: 150, color: '#3a6b45', step: 210, cap: '#4d8459' },
    { parallax: 0.6, height: 92, color: '#24482c', step: 150, cap: '#33603c' },
  ];
  for (const layer of layers) {
    const base = skyBottom - origin.y - layer.height;
    const shift = -origin.x * layer.parallax;
    const top = [];
    for (let x = -layer.step; x <= viewW + layer.step; x += 12) {
      const world = x - shift;
      const h = Math.sin(world / layer.step) * 0.5 + Math.sin(world / (layer.step * 0.37)) * 0.5;
      // Snapped to 4px steps: a smooth curve up here would be the only soft edge
      // left on the screen.
      top.push([x, Math.round((base + h * layer.height * 0.5) / 4) * 4]);
    }

    ctx.fillStyle = layer.color;
    ctx.beginPath();
    ctx.moveTo(top[0][0], skyBottom - origin.y + 2);
    for (const [x, ty] of top) ctx.lineTo(x, ty);
    ctx.lineTo(top[top.length - 1][0], skyBottom - origin.y + 2);
    ctx.closePath();
    ctx.fill();

    // A lit crest along the ridge, so a hill has a top edge instead of being a
    // silhouette pasted on the sky.
    ctx.strokeStyle = layer.cap;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(top[0][0], top[0][1]);
    for (const [x, ty] of top) ctx.lineTo(x, ty);
    ctx.stroke();
  }
}

/**
 * The ground, and everything standing on it.
 *
 * The tree line is doing most of the work here. A flat green strip with three
 * boxes on it is a diagram; the same strip with pines along it, grass breaking
 * the ground line and a treeline dropping away behind the buildings is a valley.
 * The trees go down first, so the buildings stand in front of them.
 */
export function drawSurface(ctx, origin, time) {
  const y = SURFACE_ROW * TILE - origin.y;
  if (y < -TILE * 2 || y > 4000) return;

  const w = COLS * TILE;

  // Flat grass with a lit top lip and a hard shadow under it, not a gradient.
  ctx.fillStyle = SKY.grassLit;
  ctx.fillRect(0, y, w, TILE * 0.5);
  ctx.fillStyle = SKY.grass;
  ctx.fillRect(0, y + TILE * 0.5 - 3, w, 3);
  ctx.fillStyle = SKY.soil;
  ctx.fillRect(0, y + TILE * 0.5, w, TILE * 1.5);

  // Grass breaking the ground line. Whole-pixel blades leaning off vertical, so
  // the horizon is not a ruler line across the screen.
  for (let col = 0; col < COLS; col += 1) {
    const h = hash2(col, 7);
    if (h < 0.3) continue;
    const bx = Math.round((col + h) * TILE - origin.x);
    for (let b = 0; b < 4; b += 1) {
      const hx = hash2(col * 3 + b, 11);
      const th = 3 + Math.round(hx * 5);
      ctx.fillStyle = hx > 0.5 ? SKY.grassLit : SKY.grass;
      ctx.fillRect(bx + b * 3, Math.round(y - th), 1, th);
      if (hx > 0.7) ctx.fillRect(bx + b * 3 + 1, Math.round(y - th + 1), 1, th - 1);
    }
  }

  // The treeline, behind the buildings.
  for (let i = 0; i < 30; i += 1) {
    const h = hash2(i * 17 + 3, 5);
    const h2 = hash2(i * 29 + 7, 13);
    const tx = Math.round(h * w) - origin.x;
    if (tx < -40 || tx > w + 40) continue;
    // Keep the buildings' sightlines clear, so a pine never grows through a
    // depot's sign.
    let crowded = false;
    for (const f of FACILITIES) {
      if (Math.abs(f.col * TILE - origin.x - tx) < 84) crowded = true;
    }
    if (crowded) continue;
    drawPine(ctx, tx, y, h2 > 0.62 ? 1 : 0);
  }

  drawFacilities(ctx, FACILITIES, origin, y, time);
}

/**
 * A pine: a trunk and three or four stepped tiers of needles, widest at the
 * bottom. Stepped rather than a triangle because a diagonal edge is the one
 * thing this style of drawing does not have.
 */
function drawPine(ctx, x, baseY, size) {
  const tiers = 3 + size;
  const tierH = 9 + size * 2;
  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(x - 1, baseY - 8, 3, 8);

  for (let i = 0; i < tiers; i += 1) {
    const half = Math.max(2, Math.round(9 - i * 2.1));
    const ty = Math.round(baseY - 6 - (i + 1) * tierH);
    ctx.fillStyle = i % 2 === 0 ? '#2b5b3d' : '#23482f';
    ctx.fillRect(x - half, ty, half * 2, tierH);
    // Light catching the left of each tier, and the top lip of the whole tree.
    ctx.fillStyle = '#3d7a51';
    ctx.fillRect(x - half, ty, 2, tierH);
    ctx.fillRect(x - half, ty, half * 2, 2);
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

