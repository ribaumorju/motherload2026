/**
 * Where things are allowed to be.
 *
 * Movement is sub-tile: the ship has a float position and slides against the
 * grid, which is what makes it feel like a vehicle rather than a chess piece.
 * Collision is axis-separated so that pressing into a wall while falling still
 * lets you fall, and the collision box is deliberately a little shorter than
 * its tile so a one-tile tunnel is comfortable to fly through.
 */

import { TILE } from '../config.js';

/** Half-width and half-height of the ship's collision box, in pixels. */
export const SHIP_HALF_W = 13;
export const SHIP_HALF_H = 11;

/** Tile coordinates a pixel position is centred on. */
export const colOf = (x) => Math.floor(x / TILE);
export const rowOf = (y) => Math.floor(y / TILE);

/**
 * Is the box at (x, y) overlapping anything solid?
 *
 * `ignore` is the tile the drill is currently eating, so that the ship can sit
 * half-inside the hole it is making instead of bouncing off it.
 *
 * If the box is somehow already inside rock, it is pulled out: a ship that
 * starts a tick embedded has to escape, not be pinned there by its own hull.
 */
export function blocked(world, x, y, ignore = null) {
  const c0 = colOf(x - SHIP_HALF_W);
  const c1 = colOf(x + SHIP_HALF_W);
  const r0 = rowOf(y - SHIP_HALF_H);
  const r1 = rowOf(y + SHIP_HALF_H);
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      if (ignore && ignore.col === col && ignore.row === row) continue;
      if (world.isSolid(col, row)) return { col, row };
    }
  }
  return null;
}

/**
 * Nudges a box out of rock along the shortest axis, one pixel at a time.
 *
 * Movement resolves each axis on its own, which handles every normal collision
 * but not the pathological one: a box that is already overlapping - after a
 * teleport, a save from an older build, or a tile that appeared under the ship
 * - has nothing to resolve against and would stay embedded forever. This is the
 * escape hatch, and it is deliberately blunt.
 */
export function unstick(world, ship) {
  if (!blocked(world, ship.x, ship.y)) return false;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    for (let step = 1; step <= 40; step += 1) {
      const nx = ship.x + dx * step;
      const ny = ship.y + dy * step;
      if (!blocked(world, nx, ny)) {
        ship.x = nx;
        ship.y = ny;
        ship.vx = 0;
        ship.vy = 0;
        return true;
      }
    }
  }
  return false;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Screen shake decay and the easing helpers the renderer wants.
 * Kept here rather than in the renderer so the sim owns time, not the canvas.
 */
export function approach(current, target, rate, dt) {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}
