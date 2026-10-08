/**
 * The pod.
 *
 * Drawn from primitives rather than from a sprite so it can react: the hull
 * tilts into the direction of travel, the drill spins faster the harder it is
 * working, the cockpit glass lights up from inside, the hold shows how full it
 * is, and a battered hull smokes. Every one of those is a readout the player
 * gets without looking away from the ship.
 */

import { TILE, PHYS } from '../config.js';
import { clamp } from '../sim/physics.js';
import { load, maxHull } from '../sim/game.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} s          the game state
 * @param {{x:number,y:number}} origin  camera origin in world pixels
 * @param {number} time
 * @param {number} drillSpin  accumulated rotation of the bit, in radians
 */
export function drawShip(ctx, s, origin, time, drillSpin) {
  const ship = s.ship;
  const x = ship.x - origin.x;
  const y = ship.y - origin.y;

  // Lean into the travel: a little roll makes horizontal speed readable, and a
  // lot of it looks like a bug.
  const tilt = clamp(ship.vx / PHYS.maxSpeedX, -1, 1) * 0.22;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);

  drawThrusters(ctx, ship, time);
  drawHull(ctx, s, time);
  drawCockpit(ctx, s, time);
  drawDrill(ctx, ship, drillSpin);
  drawDamage(ctx, s, time);

  ctx.restore();
}

function drawThrusters(ctx, ship, time) {
  const up = clamp(ship.vy / PHYS.maxSpeedY, -1, 1);
  const thrusting = up < -0.05;
  if (!thrusting) return;

  const power = clamp(-up * 1.6, 0.2, 1);
  // Two flat tones and a stepped length: a flame drawn as blocks, not as a
  // gradient that fades out.
  for (const side of [-1, 1]) {
    const len = 10 + power * 22 + (Math.sin(time * 40) > 0 ? 4 : 0);
    const cx = side * 8;
    ctx.fillStyle = '#3a7bff';
    ctx.fillRect(cx - 4, 9, 8, len);
    ctx.fillStyle = '#bfe8ff';
    ctx.fillRect(cx - 2, 9, 4, len * 0.6);
  }
}

function drawHull(ctx, s, time) {
  const w = 26;
  const h = 22;

  // A flat body with a hard bevel - lighter along the top and left, darker along
  // the bottom and right - and a black outline all the way round.
  ctx.fillStyle = '#7d8798';
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 3, -h / 2);
  ctx.lineTo(w / 2 - 3, -h / 2);
  ctx.lineTo(w / 2 - 2, h / 2 - 3);
  ctx.lineTo(-w / 2 + 2, h / 2 - 3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#b6c2d4';
  ctx.fillRect(-w / 2 + 3, -h / 2, w - 6, 3);
  ctx.fillRect(-w / 2 + 2, -h / 2 + 3, 3, h - 6);
  ctx.fillStyle = '#454e5e';
  ctx.fillRect(-w / 2 + 3, h / 2 - 6, w - 6, 3);
  ctx.fillRect(w / 2 - 5, -h / 2 + 3, 3, h - 6);

  ctx.strokeStyle = '#0b0d14';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 3, -h / 2);
  ctx.lineTo(w / 2 - 3, -h / 2);
  ctx.lineTo(w / 2 - 2, h / 2 - 3);
  ctx.lineTo(-w / 2 + 2, h / 2 - 3);
  ctx.closePath();
  ctx.stroke();

  // Panel seams.
  ctx.strokeStyle = '#454e5e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 4, -1.5);
  ctx.lineTo(w / 2 - 4, -1.5);
  ctx.moveTo(-6.5, h / 2 - 4);
  ctx.lineTo(-6.5, -h / 2 + 2);
  ctx.moveTo(6.5, h / 2 - 4);
  ctx.lineTo(6.5, -h / 2 + 2);
  ctx.stroke();

  // One hard highlight streak. No gradient.
  ctx.fillStyle = '#d6e2f2';
  ctx.fillRect(-w / 2 + 4, -h / 2 + 3, 4, h - 13);

  // Side lamps: hard squares that blink on and off.
  if (Math.sin(time * 2.4) > 0) {
    ctx.fillStyle = '#ffc45c';
    for (const side of [-1, 1]) ctx.fillRect(side * (w / 2 - 5) - 2, 0, 4, 4);
  }
}

function drawCockpit(ctx, s, time) {
  // Glass: two flat blues with a hard rim, no radial gradient.
  ctx.fillStyle = '#2f6f9e';
  ctx.beginPath();
  ctx.ellipse(0, -4, 8.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6fc4e8';
  ctx.beginPath();
  ctx.ellipse(0, -4, 6.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#0b0d14';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, -4, 8.5, 7, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Pilot: a head that turns with the ship.
  const look = clamp(s.ship.dirX, -1, 1) * 1.6;
  ctx.fillStyle = '#101822';
  ctx.beginPath();
  ctx.arc(look, -3, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // Glass highlight: a hard bar rather than a soft ellipse.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-5, -9, 5, 2);

  // Hold gauge: a bar of ore colour that fills as the bay fills.
  const filled = load(s);
  if (filled > 0.01) {
    const w = 18;
    ctx.fillStyle = '#080c12';
    ctx.fillRect(-w / 2, 6.5, w, 4);
    ctx.fillStyle = filled > 0.9 ? '#ff5a5a' : filled > 0.6 ? '#ffd23f' : '#4dd4ff';
    ctx.fillRect(-w / 2 + 1, 7.5, (w - 2) * filled, 2);
  }
}

/**
 * The bit, aimed at the rock it is cutting.
 *
 * The assembly turns to face the direction of the cut and then stays there;
 * only the flutes travel. An earlier version rotated the whole cone by the spin
 * angle, so the bit swept through every orientation like a clock hand and spent
 * most of its time pointing at empty space. A drill that is not aimed at the
 * wall it is boring into does not read as a drill.
 */
function drawDrill(ctx, ship, spin) {
  const active = ship.drilling;
  const dir = ship.drillDir || 'down';

  // Where the bit mounts on the hull (26 wide, 22 tall), and which way it points.
  const mount = { down: [0, 11], up: [0, -11], right: [13, 0], left: [-13, 0] }[dir];
  const facing = { down: 0, right: Math.PI / 2, up: Math.PI, left: -Math.PI / 2 }[dir];

  ctx.save();
  ctx.translate(mount[0], mount[1]);
  ctx.rotate(facing);

  // Mount plate.
  ctx.fillStyle = '#2b3242';
  ctx.fillRect(-7, -3, 14, 5);

  // The cone, flat-shaded in two tones with a hard outline: two colours and a
  // black edge, the way a sprite from 1999 would have done it.
  const len = 13;
  ctx.fillStyle = active ? '#ff9a2e' : '#7c8698';
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(6, 0);
  ctx.lineTo(0, len);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = active ? '#ffd88a' : '#aab4c4';
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(0, 0);
  ctx.lineTo(0, len);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#151b28';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(6, 0);
  ctx.lineTo(0, len);
  ctx.closePath();
  ctx.stroke();

  // Flutes: the only moving part. They slide across the bit as it turns, which
  // makes a screw thread read as turning without the bit changing direction.
  const travel = Math.sin(spin) * 3.4;
  ctx.strokeStyle = active ? '#fff3c8' : '#5d6879';
  ctx.lineWidth = 1.2;
  for (const base of [-3.2, 0, 3.2]) {
    ctx.beginPath();
    ctx.moveTo(base + travel * 0.4, 1);
    ctx.lineTo(base * 0.2 + travel, len - 1);
    ctx.stroke();
  }

  // Contact sparks at the tip while it is biting.
  if (active) {
    ctx.fillStyle = '#ffe9a8';
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + spin * 3;
      ctx.fillRect(Math.cos(a) * 3.5 - 1, len - 3 + Math.sin(a) * 2, 2, 2);
    }
  }
  ctx.restore();
}

/**
 * Wear and tear. Smoke below half hull, sparks below a quarter, and a red glow
 * that pulses with the hull's remaining integrity, so "how close am I to dying"
 * is answerable at a glance from the corner of the eye.
 */
function drawDamage(ctx, s, time) {
  const ratio = clamp(s.ship.hull / Math.max(1, maxHull(s)), 0, 1);
  if (ratio > 0.6) return;

  /**
   * A hard red box around the pod that blinks, rather than a soft red glow that
   * pulses through it. Same warning, drawn the way the rest of the screen is
   * drawn: whole pixels, hard edges, and it is either there or it is not.
   */
  if (Math.sin(time * 9) < 0) return;
  const intensity = 1 - ratio / 0.6;
  ctx.strokeStyle = `rgba(255, 60, 40, ${0.35 + 0.65 * intensity})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(-16.5, -14.5, 33, 29);
}

/** A brief white flash on the pod when it takes a hit. */
export function drawHitFlash(ctx, s, origin) {
  if (!s.ship.impact) return;
  const x = s.ship.x - origin.x;
  const y = s.ship.y - origin.y;
  const t = clamp(s.ship.impact, 0, 1);
  ctx.save();
  ctx.globalAlpha = t * 0.9;
  ctx.fillStyle = '#ffd0c0';
  const size = Math.round(TILE * (0.9 + t));
  ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  ctx.restore();
}
