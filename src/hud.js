/**
 * The heads-up display.
 *
 * DOM, not canvas. The HUD is text and bars that have to stay crisp at any
 * device pixel ratio, respond to hover, and be readable by a screen reader;
 * canvas is the wrong tool for all three. The only canvas here is the depth
 * gauge, which is genuinely a picture.
 *
 * Every setter compares before writing. Assigning `textContent` the same string
 * still replaces the text node and forces a re-rasterise, and this HUD is
 * written to sixty times a second - doing that unconditionally is the classic
 * way to make a fast game feel slow.
 */

import {
  TILE, COLS, ROWS, FACILITIES, ENDGAME, ORE_BY_ID, DEPTH_FT,
} from './config.js';
import { KIND, kindOf } from './sim/world.js';
import { load, maxFuel, maxHull, cargoCap, cargoManifest, cargoValue, atFacility } from './sim/game.js';
import { clamp } from './sim/physics.js';
import { bandIndexAt } from './render/palette.js';
import { money, grouped } from './teksti.js';

const num = (n, d = 0) => Number(n).toFixed(d);

export function createHud(root) {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  /* ---------------- build ---------------- */

  const hud = el('div', 'hud');

  // Top-left: the numbers you always want.
  const topLeft = el('div', 'panel hud-top');
  const cashEl = el('div', 'stat stat-cash');
  const cashLabel = el('span', 'stat-label', 'PRORAČUN');
  const cashValue = el('strong', 'stat-value', '$0');
  cashEl.append(cashLabel, cashValue);

  const depthEl = el('div', 'stat stat-depth');
  const depthLabel = el('span', 'stat-label', 'GLOBINA');
  const depthValue = el('strong', 'stat-value', '0 ft');
  depthEl.append(depthLabel, depthValue);

  const bestEl = el('div', 'stat stat-best');
  const bestLabel = el('span', 'stat-label', 'REKORD');
  const bestValue = el('strong', 'stat-value', '0 ft');
  bestEl.append(bestLabel, bestValue);

  topLeft.append(cashEl, depthEl, bestEl);

  // Top-right: controls.
  const topRight = el('div', 'panel hud-buttons');
  const buttons = {};
  for (const [key, label, title] of [
    ['help', '?', 'How to play (H)'],
    ['sound', '\u266A', 'Sound on/off (M)'],
    ['pause', 'II', 'Pause (Esc)'],
  ]) {
    const b = el('button', 'icon-btn', label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    buttons[key] = b;
    topRight.append(b);
  }

  // Bottom-left: the three meters.
  const meters = el('div', 'panel hud-meters');
  const bars = {};
  for (const [key, label, cls] of [
    ['fuel', 'GORIVO', 'bar-fuel'],
    ['hull', 'TRUP', 'bar-hull'],
    ['cargo', 'TOVOR', 'bar-cargo'],
  ]) {
    const row = el('div', `meter ${cls}`);
    const name = el('span', 'meter-name', label);
    const track = el('div', 'meter-track');
    const fill = el('div', 'meter-fill');
    const readout = el('span', 'meter-value', '');
    track.append(fill);
    row.append(name, track, readout);
    meters.append(row);
    bars[key] = { fill, readout };
  }

  // Bottom-right: the depth gauge and the ore radar.
  const instruments = el('div', 'panel hud-instruments');
  const gaugeCanvas = el('canvas', 'gauge');
  gaugeCanvas.width = 26;
  gaugeCanvas.height = 300;
  const radarCanvas = el('canvas', 'radar');
  radarCanvas.width = 108;
  radarCanvas.height = 108;
  const gaugeWrap = el('div', 'gauge-wrap');
  const gaugeLabels = el('div', 'gauge-labels');
  gaugeWrap.append(gaugeCanvas, gaugeLabels);
  instruments.append(gaugeWrap, radarCanvas);

  // Toasts: short messages that stack and expire.
  const toastBox = el('div', 'toasts');

  // The dock prompt, shown when standing at a facility.
  const prompt = el('div', 'dock-prompt');
  prompt.hidden = true;

  // The cargo manifest, shown while docked at the processor.
  const manifest = el('div', 'panel manifest');
  manifest.hidden = true;

  hud.append(topLeft, topRight, meters, instruments, toastBox, prompt, manifest);
  root.append(hud);

  /* ---------------- state ---------------- */

  const cache = new Map();
  const toasts = [];

  /** Writes only when the value actually changed. */
  function set(node, text) {
    const key = node;
    if (cache.get(key) === text) return;
    cache.set(key, text);
    node.textContent = text;
  }

  function setWidth(node, pct) {
    const value = `${clamp(pct, 0, 1) * 100}%`;
    if (node.style.width === value) return;
    node.style.width = value;
  }

  const gaugeCtx = gaugeCanvas.getContext('2d');
  const radarCtx = radarCanvas.getContext('2d');

  /** One tint per depth band, matching the rock the gauge stands for. */
  const BAND_TINT = ['#5c3f2c', '#63472f', '#5c534c', '#414a5c', '#3d3652', '#2c2238', '#1e141a', '#140a0c'];

  /** Depth labels, drawn once into the gauge's gutter. */
  const LABEL_STEP = 2000;
  function buildGaugeLabels() {
    gaugeLabels.textContent = '';
    for (let ft = LABEL_STEP; ft < DEPTH_FT; ft += LABEL_STEP) {
      const tick = el('span', 'gauge-tick', `${ft / 1000}k`);
      tick.style.top = `${(ft / DEPTH_FT) * 100}%`;
      gaugeLabels.append(tick);
    }
  }
  buildGaugeLabels();

  /**
   * The depth gauge: the whole mine, top to bottom, with the rock colour at
   * each depth, the player's position, their best depth, the facilities at the
   * top and Mr. Natas at the bottom.
   */
  function drawGauge(state) {
    const w = gaugeCanvas.width;
    const h = gaugeCanvas.height;
    const ctx = gaugeCtx;
    ctx.clearRect(0, 0, w, h);

    // Rock column, one pixel per depth slice.
    for (let y = 0; y < h; y += 1) {
      const ft = (y / h) * DEPTH_FT;
      const band = bandIndexAt(ft);
      ctx.fillStyle = BAND_TINT[band];
      ctx.fillRect(0, y, w, 1);
    }

    // Hazards, as a hint of what is down there. Solid, not half-transparent:
    // this is a two-pixel readout and it has to survive the scanlines.
    const lavaY = (3000 / DEPTH_FT) * h;
    ctx.fillStyle = '#ff5a12';
    ctx.fillRect(0, lavaY, w, 2);
    const gasY = (4750 / DEPTH_FT) * h;
    ctx.fillStyle = '#7dff6a';
    ctx.fillRect(0, gasY, w, 2);

    // Mr. Natas.
    const natasY = (ENDGAME.row / ROWS) * h;
    ctx.fillStyle = '#ff2b2b';
    ctx.fillRect(Math.round(w / 2) - 3, Math.round(natasY) - 3, 6, 6);

    // Best depth, as a hard line.
    const bestY = clamp(state.maxDepth / DEPTH_FT, 0, 1) * h;
    ctx.strokeStyle = '#7d8aa0';
    ctx.beginPath();
    ctx.moveTo(0, Math.round(bestY) + 0.5);
    ctx.lineTo(w, Math.round(bestY) + 0.5);
    ctx.stroke();

    // The ship.
    const shipY = clamp(state.depth / DEPTH_FT, 0, 1) * h;
    const shipX = (state.ship.x / (COLS * TILE)) * w;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(shipX, shipY - 5);
    ctx.lineTo(shipX + 4, shipY + 3);
    ctx.lineTo(shipX - 4, shipY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#0b0d14';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * The ore radar: what the drill could reach if it went sideways. It only
   * shows ore near the ship, so it is a tool for the next ten seconds rather
   * than a map of the mine, which is the whole point - the player still has to
   * decide where to go.
   */
  function drawRadar(state) {
    const w = radarCanvas.width;
    const h = radarCanvas.height;
    const ctx = radarCtx;
    const cx = w / 2;
    const cy = h / 2;
    const range = 11; // tiles
    const scale = (w / 2) / range;

    ctx.clearRect(0, 0, w, h);

    // A grid, not rings and a crosshair. This is a console readout; a round scope
    // with a soft sweeping beam is the modern reading of the same idea.
    ctx.strokeStyle = '#1d3a2c';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const p = Math.round((w * i) / 4) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }

    // A hard sweep line, so the display looks alive without a gradient beam.
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.time * 1.6);
    ctx.strokeStyle = '#2f6b4f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w / 2 - 2, 0);
    ctx.stroke();
    ctx.restore();

    // Blips: solid squares, no additive blending and no fade. Distance is shown
    // by size instead, which is the only depth cue a flat grid can carry.
    const col = Math.floor(state.ship.x / TILE);
    const row = Math.floor(state.ship.y / TILE);
    for (let dy = -range; dy <= range; dy += 1) {
      for (let dx = -range; dx <= range; dx += 1) {
        const i = (row + dy) * COLS + (col + dx);
        if (i < 0 || i >= state.world.tiles.length) continue;
        const kind = kindOf(state.world.tiles[i]);
        if (kind !== KIND.ORE && kind !== KIND.GAS && kind !== KIND.LAVA) continue;
        const dist = Math.hypot(dx, dy);
        if (dist > range) continue;
        const ore = ORE_BY_ID[state.world.ore[i]];
        const tone = kind === KIND.LAVA ? '#ff5a12' : kind === KIND.GAS ? '#7dff6a' : ore.color;
        const size = dist < range * 0.4 ? 4 : dist < range * 0.75 ? 3 : 2;
        ctx.fillStyle = tone;
        ctx.fillRect(
          Math.round(cx + dx * scale - size / 2),
          Math.round(cy + dy * scale - size / 2),
          size, size,
        );
      }
    }

    // The ship.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(cx) - 3, Math.round(cy) - 3, 6, 6);
    ctx.strokeStyle = '#0b0d14';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(cx) - 2.5, Math.round(cy) - 2.5, 5, 5);
  }

  /* ---------------- public ---------------- */

  function toast(text, tone = 'info', ms = 2600) {
    const node = el('div', `toast toast-${tone}`, text);
    toastBox.append(node);
    toasts.push({ node, until: performance.now() + ms });
    // Cap the stack so a burst of pickups cannot cover the screen.
    while (toasts.length > 5) {
      const old = toasts.shift();
      old.node.remove();
    }
  }

  function tickToasts(now) {
    for (let i = toasts.length - 1; i >= 0; i -= 1) {
      const t = toasts[i];
      if (now < t.until) {
        const left = t.until - now;
        if (left < 400) t.node.style.opacity = String(left / 400);
        continue;
      }
      t.node.remove();
      toasts.splice(i, 1);
    }
  }

  function updateManifest(state) {
    const docked = atFacility(state, 'sell');
    if (!docked) {
      if (!manifest.hidden) manifest.hidden = true;
      return;
    }
    const entries = cargoManifest(state);
    const signature = entries.map((e) => `${e.ore.id}:${e.n}`).join(',') + `|${Math.round(cargoValue(state))}`;
    if (manifest.dataset.sig === signature && !manifest.hidden) return;
    manifest.dataset.sig = signature;
    manifest.hidden = false;
    manifest.textContent = '';

    const head = el('div', 'manifest-head');
    head.append(el('span', null, 'TOVORNI LIST'), el('strong', null, money(cargoValue(state))));
    manifest.append(head);

    if (!entries.length) {
      manifest.append(el('div', 'manifest-empty', 'Tovor je prazen. Pritisni E za gorivo in popravilo.'));
      return;
    }
    for (const entry of entries) {
      const row = el('div', 'manifest-row');
      const swatch = el('i', 'swatch');
      swatch.style.background = entry.ore.color;
      row.append(
        swatch,
        el('span', 'manifest-name', entry.ore.name),
        el('span', 'manifest-count', `x${entry.n}`),
        el('strong', 'manifest-value', money(entry.ore.value * entry.n)),
      );
      manifest.append(row);
    }
  }

  function updatePrompt(state) {
    const near = FACILITIES.find((f) => atFacility(state, f.key));
    if (!near) {
      if (!prompt.hidden) prompt.hidden = true;
      return;
    }
    const action = near.key === 'fuel' ? 'E - natoči gorivo'
      : near.key === 'sell' ? 'E - prodaj tovor'
        : 'E - odpri servis';
    const key = `${near.key}|${action}|${near.note || ''}`;
    if (prompt.dataset.key !== key) {
      prompt.dataset.key = key;
      prompt.textContent = '';
      prompt.append(
        el('strong', null, near.name),
        el('span', null, action),
        // The office hours are the joke, so they get their own line rather than
        // being buried in the action text.
        near.note ? el('em', 'dock-note', near.note) : null,
      );
    }
    if (prompt.hidden) prompt.hidden = false;
  }

  /**
   * @param {object} state
   * @param {object} opts  `{ lowFuel, lowHull }` for the warning pulse
   */
  function update(state, opts = {}) {
    set(cashValue, money(state.cash));
  set(depthValue, `${grouped(state.depth)} ft`);
  set(bestValue, `${grouped(state.maxDepth)} ft`);

    const fuelFrac = state.ship.fuel / maxFuel(state);
    const hullFrac = state.ship.hull / maxHull(state);
    const cargoFrac = load(state);

    setWidth(bars.fuel.fill, fuelFrac);
    setWidth(bars.hull.fill, hullFrac);
    setWidth(bars.cargo.fill, cargoFrac);

    set(bars.fuel.readout, `${num(state.ship.fuel, 1)} / ${num(maxFuel(state))} L`);
    set(bars.hull.readout, `${num(state.ship.hull, 0)} / ${num(maxHull(state))} HP`);
    set(bars.cargo.readout, `${num(state.cargoWeight)} / ${num(cargoCap(state))} kg`);

    bars.fuel.fill.classList.toggle('is-low', fuelFrac < 0.2);
    bars.hull.fill.classList.toggle('is-low', hullFrac < 0.3);
    bars.cargo.fill.classList.toggle('is-full', cargoFrac > 0.9);

    meters.classList.toggle('warn-fuel', Boolean(opts.lowFuel));
    meters.classList.toggle('warn-hull', Boolean(opts.lowHull));

    drawGauge(state);
    drawRadar(state);
    updateManifest(state);
    updatePrompt(state);
    tickToasts(performance.now());
  }

  return {
    update,
    toast,
    buttons,
    elements: { cashValue, depthValue, bestValue, meters, manifest, prompt },
    setSoundIcon(muted) {
      buttons.sound.textContent = muted ? '\u2715' : '\u266A';
      buttons.sound.classList.toggle('is-off', muted);
    },
  };
}
