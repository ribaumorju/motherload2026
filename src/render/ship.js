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
  for (const side of [-1, 1]) {
    const len = 10 + power * 22 + Math.sin(time * 40) * 2;
    const grad = ctx.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(190, 235, 255, 0.95)');
    grad.addColorStop(0.4, 'rgba(90, 170, 255, 0.7)');
    grad.addColorStop(1, 'rgba(40, 90, 220, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(side * 8 - 4, 9);
    ctx.lineTo(side * 8 + 4, 9);
    ctx.lineTo(side * 8, 9 + len);
    ctx.closePath();
    ctx.fill();
  }
}

function drawHull(ctx, s, time) {
  const w = 26;
  const h = 22;

  // Drop shadow / ground glow so the pod sits in the world.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.62, w * 0.55, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const body = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  body.addColorStop(0, '#c9d4e4');
  body.addColorStop(0.35, '#8b98ac');
  body.addColorStop(0.6, '#5d6879');
  body.addColorStop(1, '#39414f');
  ctx.fillStyle = body;

  // A rounded, slightly tapered pod.
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 3, -h / 2);
  ctx.lineTo(w / 2 - 3, -h / 2);
  ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + 4);
  ctx.lineTo(w / 2 - 2, h / 2 - 3);
  ctx.quadraticCurveTo(w / 2 - 2, h / 2, w / 2 - 6, h / 2);
  ctx.lineTo(-w / 2 + 6, h / 2);
  ctx.quadraticCurveTo(-w / 2 + 2, h / 2, -w / 2 + 2, h / 2 - 3);
  ctx.lineTo(-w / 2, -h / 2 + 4);
  ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + 3, -h / 2);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(20, 26, 36, 0.9)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Panel seams and rivets.
  ctx.strokeStyle = 'rgba(30, 38, 50, 0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 4, -1);
  ctx.lineTo(w / 2 - 4, -1);
  ctx.moveTo(-6, h / 2 - 2);
  ctx.lineTo(-6, -h / 2 + 2);
  ctx.moveTo(6, h / 2 - 2);
  ctx.lineTo(6, -h / 2 + 2);
  ctx.stroke();

  // Specular streak along the top-left, which is what sells "metal".
  const shine = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  shine.addColorStop(0, 'rgba(255,255,255,0.45)');
  shine.addColorStop(0.5, 'rgba(255,255,255,0.04)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + 3, -h / 2 + 1);
  ctx.lineTo(-2, -h / 2 + 1);
  ctx.lineTo(-8, h / 2 - 2);
  ctx.lineTo(-w / 2 + 3, h / 2 - 2);
  ctx.closePath();
  ctx.fill();

  // Side lamps, warm, pulsing gently.
  const lamp = 0.6 + 0.4 * Math.sin(time * 2.4);
  for (const side of [-1, 1]) {
    ctx.fillStyle = `rgba(255, 196, 92, ${lamp})`;
    ctx.beginPath();
    ctx.arc(side * (w / 2 - 4), 2, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCockpit(ctx, s, time) {
  // Glass, with a pilot silhouette behind it and a light inside.
  const grad = ctx.createRadialGradient(-3, -6, 1, 0, -4, 11);
  grad.addColorStop(0, 'rgba(190, 240, 255, 0.95)');
  grad.addColorStop(0.55, 'rgba(80, 170, 220, 0.8)');
  grad.addColorStop(1, 'rgba(20, 50, 80, 0.9)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, -4, 8.5, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pilot: a head that turns with the ship.
  const look = clamp(s.ship.dirX, -1, 1) * 1.6;
  ctx.fillStyle = 'rgba(16, 24, 34, 0.85)';
  ctx.beginPath();
  ctx.arc(look, -3, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // Glass highlight.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.ellipse(-3.2, -7.5, 2.6, 1.5, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // Hold gauge: a bar of ore colour that fills as the bay fills.
  const filled = load(s);
  if (filled > 0.01) {
    const w = 18;
    ctx.fillStyle = 'rgba(8, 12, 18, 0.8)';
    ctx.fillRect(-w / 2, 6.5, w, 3.5);
    ctx.fillStyle = filled > 0.9 ? '#ff5a5a' : filled > 0.6 ? '#ffd23f' : '#4dd4ff';
    ctx.fillRect(-w / 2 + 0.5, 7, (w - 1) * filled, 2.5);
  }
}

function drawDrill(ctx, ship, spin) {
  const active = ship.drilling;
  ctx.save();
  ctx.translate(0, 11);

  // Mount.
  ctx.fillStyle = '#2b3242';
  ctx.fillRect(-7, -3, 14, 5);

  // The bit: a cone with flutes, rotating.
  ctx.rotate(spin);
  const len = 13;
  const grad = ctx.createLinearGradient(0, 0, 0, len);
  grad.addColorStop(0, active ? '#ffd88a' : '#9aa6b8');
  grad.addColorStop(1, active ? '#ff7a2f' : '#4a5568');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(6, 0);
  ctx.lineTo(0, len);
  ctx.closePath();
  ctx.fill();

  // Flutes: three grooves, drawn as lines that move with the spin.
  ctx.strokeStyle = active ? 'rgba(255, 240, 200, 0.9)' : 'rgba(200, 215, 235, 0.5)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i += 1) {
    const a = (i / 3) * Math.PI * 2;
    const px = Math.cos(a) * 4;
    ctx.beginPath();
    ctx.moveTo(px, 1);
    ctx.lineTo(px * 0.25, len * 0.85);
    ctx.stroke();
  }

  // Contact sparks when it is biting.
  if (active) {
    ctx.fillStyle = 'rgba(255, 230, 160, 0.95)';
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + spin * 3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 4, len - 2, 1.6, 0, Math.PI * 2);
      ctx.fill();
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

  const intensity = 1 - ratio / 0.6;
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  const pulse = 0.55 + 0.45 * Math.sin(time * 9);
  grad.addColorStop(0, `rgba(255, 90, 60, ${0.35 * intensity * pulse})`);
  grad.addColorStop(1, 'rgba(255, 40, 20, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(-28, -28, 56, 56);
  ctx.globalCompositeOperation = 'source-over';
}

/** A brief white flash on the pod when it takes a hit. */
export function drawHitFlash(ctx, s, origin) {
  if (!s.ship.impact) return;
  const x = s.ship.x - origin.x;
  const y = s.ship.y - origin.y;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp(s.ship.impact, 0, 1) * 0.8;
  ctx.fillStyle = '#ffd0c0';
  ctx.beginPath();
  ctx.arc(x, y, TILE * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
