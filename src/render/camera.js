/**
 * The camera: where the window into the mine is, and how it shakes.
 *
 * Three things make this feel like a game rather than a scrolling bitmap:
 *
 *   - the camera leads the ship in the direction it is travelling, so you see
 *     where you are going rather than where you have been;
 *   - it is clamped to the mine, so you never look at the void past the walls;
 *   - it is quantised to whole pixels when drawn. A camera at a fractional
 *     offset makes every tile edge shimmer as it moves, which on a grid of hard
 *     edges reads as the whole screen vibrating.
 */

import { TILE, COLS, ROWS } from '../config.js';
import { clamp, approach } from '../sim/physics.js';

/** How much empty sky above the mine the camera is allowed to show. */
const SKY_REVEAL = TILE * 5;

export function createCamera(viewW, viewH) {
  return {
    x: 0, y: 0,
    w: viewW, h: viewH,
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    t: 0,
  };
}

export function resizeCamera(cam, viewW, viewH) {
  cam.w = viewW;
  cam.h = viewH;
}

/**
 * Follows the ship. `lead` is how far ahead of the ship the camera sits, scaled
 * by speed, which is what makes fast flight feel fast.
 */
export function updateCamera(cam, ship, dt, lead = 0.34) {
  const targetX = ship.x + ship.vx * lead;
  const targetY = ship.y + ship.vy * lead * 0.6;

  // Vertical follow is slower than horizontal: the ship spends most of its life
  // descending, and matching it exactly makes the rock rush past unreadably.
  cam.x = approach(cam.x, targetX, 9, dt);
  cam.y = approach(cam.y, targetY, 6.5, dt);

  /**
   * `cam.x` and `cam.y` are the *centre* of the view, not its top-left corner,
   * so the clamp bounds are the half-size inset from each edge. Clamping to
   * `0..world - view` - which is what this used to do - treats the centre as a
   * corner, and the view is then offset by half a screen: on a window whose
   * width matches the mine, half the screen showed empty space beside the rock
   * and the ship was drawn off the edge of it.
   *
   * When the view is larger than the world in an axis there is nothing to
   * follow, so the camera sits on the world's centre and the world is centred
   * in the window.
   */
  const worldW = COLS * TILE;
  const worldH = ROWS * TILE;
  const halfW = cam.w / 2;
  const halfH = cam.h / 2;

  cam.x = cam.w >= worldW ? worldW / 2 : clamp(cam.x, halfW, worldW - halfW);

  // The top edge may reach a little above the mine, so the sky is visible while
  // the ship is on the surface. The bottom edge stops at the bedrock.
  const bottomLimit = Math.max(halfH, worldH - halfH);
  const topLimit = Math.min(halfH - SKY_REVEAL, bottomLimit);
  cam.y = cam.h >= worldH ? worldH / 2 : clamp(cam.y, topLimit, bottomLimit);

  cam.t += dt;
  if (cam.shake > 0.001) {
    // Decaying, deterministic wobble. Random shake looks like noise; a sine
    // pair at unrelated frequencies looks like a machine being hit.
    cam.shake = Math.max(0, cam.shake - dt * 2.6);
    const a = cam.shake * cam.shake * 16;
    cam.shakeX = Math.sin(cam.t * 71) * a;
    cam.shakeY = Math.cos(cam.t * 53) * a;
  } else {
    cam.shakeX = 0;
    cam.shakeY = 0;
  }
  return cam;
}

/** Screen position of the camera's top-left corner, snapped to whole pixels. */
export const camOrigin = (cam) => ({
  x: Math.round(cam.x - cam.w / 2 + cam.shakeX),
  y: Math.round(cam.y - cam.h / 2 + cam.shakeY),
});
