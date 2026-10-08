/**
 * Particles and the full-screen effects.
 *
 * The sim owns the particle *data* (sparks, pops, gas clouds) because they are
 * gameplay - a cloud that hurts you has to exist whether or not it is drawn.
 * This module owns everything that is purely for the eye: rock dust off the
 * drill, bubbles in lava, floating damage numbers, the vignette, and the blast
 * flash.
 *
 * Dust is emitted here rather than in the sim because it is a function of the
 * drill being on, not of the world changing.
 */

import { TILE, COLS, ROWS } from '../config.js';
import { KIND, kindOf, rowDepth } from '../sim/world.js';
import { clamp } from '../sim/physics.js';
import { rockAt } from './palette.js';

const MAX_DUST = 260;

export function createFx() {
  return {
    dust: [],
    bubbles: [],
    dustTimer: 0,
    bubbleTimer: 0,
  };
}

/**
 * Rock dust thrown off by the drill. The colour is taken from the rock being
 * cut, so digging through slate throws grey and digging through the deep stuff
 * throws black - a small detail that makes the mine feel like it has substance.
 */
export function updateFx(fx, s, dt, origin, viewW, viewH) {
  const ship = s.ship;

  if (ship.drilling) {
    fx.dustTimer += dt;
    const rate = 0.012;
    while (fx.dustTimer > rate) {
      fx.dustTimer -= rate;
      if (fx.dust.length > MAX_DUST) break;
      const col = Math.floor(ship.x / TILE);
      const row = Math.floor(ship.y / TILE) + 1;
      const rock = rockAt(rowDepth(row));
      const spread = 12;
      fx.dust.push({
        x: ship.x + (Math.random() - 0.5) * spread,
        y: ship.y + 12 + Math.random() * 6,
        vx: (Math.random() - 0.5) * 90,
        vy: -30 - Math.random() * 70,
        life: 0,
        max: 0.4 + Math.random() * 0.5,
        size: 1 + Math.random() * 2.2,
        color: rock.base,
        glow: false,
      });
    }
  } else {
    fx.dustTimer = 0;
  }

  // Bubbles rise out of any lava on screen. Cheap, and it makes lava read as a
  // liquid rather than as an orange tile.
  fx.bubbleTimer += dt;
  while (fx.bubbleTimer > 0.08) {
    fx.bubbleTimer -= 0.08;
    const c0 = Math.max(0, Math.floor(origin.x / TILE));
    const c1 = Math.min(COLS - 1, Math.ceil((origin.x + viewW) / TILE));
    const r0 = Math.max(0, Math.floor(origin.y / TILE));
    const r1 = Math.min(ROWS - 1, Math.ceil((origin.y + viewH) / TILE));
    const tries = 12;
    for (let i = 0; i < tries; i += 1) {
      const col = c0 + Math.floor(Math.random() * (c1 - c0 + 1));
      const row = r0 + Math.floor(Math.random() * (r1 - r0 + 1));
      if (kindOf(s.world.tile(col, row)) !== KIND.LAVA) continue;
      fx.bubbles.push({
        x: (col + Math.random()) * TILE,
        y: (row + 0.9) * TILE,
        vx: (Math.random() - 0.5) * 12,
        vy: -18 - Math.random() * 22,
        life: 0,
        max: 0.7 + Math.random() * 0.7,
        size: 1 + Math.random() * 2.4,
      });
      break;
    }
  }

  const advance = (list, gravity, damp) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const p = list[i];
      p.life += dt;
      if (p.life >= p.max) {
        list.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += gravity * dt;
      p.vx *= Math.exp(-damp * dt);
    }
  };
  advance(fx.dust, 180, 2.2);
  advance(fx.bubbles, -10, 1.4);
}

export function drawDust(ctx, fx, origin) {
  for (const p of fx.dust) {
    const t = p.life / p.max;
    ctx.globalAlpha = (1 - t) * 0.75;
    ctx.fillStyle = p.color;
    const s = p.size * (1 - t * 0.4);
    ctx.fillRect(p.x - origin.x - s / 2, p.y - origin.y - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

export function drawBubbles(ctx, fx, origin) {
  ctx.save();
  for (const p of fx.bubbles) {
    const t = p.life / p.max;
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.fillStyle = t < 0.4 ? '#ffe08a' : '#ff8a2f';
    const s = Math.max(1, Math.round(p.size * (1 - t * 0.5)));
    ctx.fillRect(Math.round(p.x - origin.x - s / 2), Math.round(p.y - origin.y - s / 2), s, s);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Blast sparks, which the sim creates and this draws. */
export function drawSparks(ctx, s, origin) {
  ctx.save();
  for (const p of s.sparks) {
    const t = p.life / p.max;
    ctx.globalAlpha = (1 - t) * 0.95;
    ctx.fillStyle = p.tone;
    // Whole-pixel blocks rather than additive dots: additive blending makes
    // every spark bloom, which is the one thing this style does not do.
    const size = Math.max(1, Math.round(p.size * (1 - t * 0.6)));
    ctx.fillRect(Math.round(p.x - origin.x - size / 2), Math.round(p.y - origin.y - size / 2), size, size);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Lingering gas, drawn as a sickly drifting cloud. */
export function drawGasClouds(ctx, s, origin) {
  ctx.save();
  for (const cloud of s.gasClouds) {
    const t = cloud.life / cloud.max;
    const alpha = (1 - t) * 0.4;
    const r = cloud.r * (0.7 + t * 0.9);
    const x = cloud.x - origin.x;
    const y = cloud.y - origin.y;
    // Two flat discs, the inner one brighter, instead of a soft radial fade.
    ctx.fillStyle = `rgba(90, 180, 60, ${alpha * 0.6})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(150, 255, 110, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Floating text: what you just picked up and what it is worth. These are the
 * reward signal, so they are drawn big, in the ore's own colour, and they rise
 * and fade rather than blinking out.
 */
export function drawPops(ctx, s, origin) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const pop of s.pops) {
    const t = pop.life / pop.max;
    const rise = t * 34;
    const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
    const x = pop.x - origin.x;
    const y = pop.y - origin.y - rise;
    const scale = t < 0.15 ? 0.7 + (t / 0.15) * 0.3 : 1;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.font = `400 ${Math.round(16 * scale)}px "VT323", ui-monospace, monospace`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(pop.text, x, y);
    ctx.fillStyle = pop.tone;
    ctx.fillText(pop.text, x, y);
    if (pop.value) {
      ctx.font = `400 ${Math.round(14 * scale)}px "VT323", ui-monospace, monospace`;
      ctx.strokeText(`$${pop.value.toLocaleString()}`, x, y + 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`$${pop.value.toLocaleString()}`, x, y + 13);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * The heat warning, while the pod is standing in something hot.
 *
 * This was a vignette as well: a cold blue radial darkening that deepened with
 * depth. That was doing the fog's job a second time, and with the fog gone it
 * was the only soft edge left on the screen. Now it is just the tint, and it
 * blinks rather than breathing.
 */
export function drawHeatTint(ctx, viewW, viewH, heat, time) {
  if (!Number.isFinite(viewW) || !Number.isFinite(viewH) || viewW <= 0 || viewH <= 0) return;
  if (heat <= 0.01) return;
  const pulse = Math.sin(time * 7) > 0 ? 1 : 0.55;
  ctx.fillStyle = `rgba(255, 60, 20, ${0.16 * heat * pulse})`;
  ctx.fillRect(0, 0, viewW, viewH);
}

/** The white flash on a blast or a death. */
export function drawFlash(ctx, amount, viewW, viewH, tone = '255, 235, 200') {
  if (amount <= 0.01) return;
  ctx.fillStyle = `rgba(${tone}, ${clamp(amount, 0, 1) * 0.55})`;
  ctx.fillRect(0, 0, viewW, viewH);
}

/**
 * Scanlines, at very low alpha: a nod to the CRT the original ran on.
 *
 * The travelling highlight is gone. It was a nice touch on a screen that had
 * soft gradients in every corner; against flat colours it just looks like a
 * smear sliding down the glass.
 */
export function drawCrt(ctx, viewW, viewH) {
  ctx.save();
  ctx.globalAlpha = 0.045;
  ctx.fillStyle = '#000';
  for (let y = 0; y < viewH; y += 3) ctx.fillRect(0, y, viewW, 1);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Ore-coloured burst when a tile is finished, used for the big finds. */
export function spawnOreBurst(s, col, row, ore) {
  const count = ore.tier >= 3 ? 26 : 12;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + Math.random();
    const speed = 40 + Math.random() * 150;
    s.sparks.push({
      x: (col + 0.5) * TILE,
      y: (row + 0.5) * TILE,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0,
      max: 0.5 + Math.random() * 0.6,
      tone: Math.random() < 0.5 ? ore.color : ore.spark,
      size: 1 + Math.random() * 2.4,
    });
  }
}
