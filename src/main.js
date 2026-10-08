/**
 * The game loop and the wiring.
 *
 * Two rules keep this readable:
 *
 *   - The sim never sees the DOM, the canvas, the audio graph or the keyboard.
 *     It gets `step(state, dt, input)` and it puts what happened in
 *     `state.events`. This file drains those events and turns them into sound,
 *     toasts and numbers. That is why the whole game can be tested in Node.
 *   - The sim runs on a fixed timestep, the renderer on the real one. Physics
 *     that varies with frame rate is physics that behaves differently on a
 *     laptop and a phone, and the drill in particular is a rate over time.
 */

import {
  TILE, COLS, BEST_KEY, FACILITIES, ITEMS, ORE_BY_ID,
} from './config.js';
import {
  createState, step, maxFuel, maxHull, atFacility,
  useItem, tileHardness, digSpeed,
} from './sim/game.js';
import { rowOf } from './sim/physics.js';
import { loadFrom, saveTo, clearSave } from './sim/save.js';
import { createCamera, resizeCamera, updateCamera, camOrigin } from './render/camera.js';
import { buildAtlas } from './render/atlas.js';
import {
  drawSky, drawSurface, drawTiles, drawNatas,
} from './render/world.js';
import { drawShip, drawHitFlash } from './render/ship.js';
import {
  createFx, updateFx, drawDust, drawBubbles, drawSparks, drawGasClouds, drawPops,
  drawHeatTint, drawFlash, drawCrt, spawnOreBurst,
} from './render/fx.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { showTitle, showHelp, showPause, showShop, showEnd } from './menus.js';
import {
  money, grouped, MEMOS, MILESTONES, reachedCount, findQuip,
} from './teksti.js';

const FIXED_DT = 1 / 120;
const MAX_STEPS = 8;
const AUTOSAVE_MS = 12000;

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

const app = document.getElementById('app');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });

const hud = createHud(app);
const input = createInput(window);
const audio = createAudio();
const fx = createFx();
const atlas = buildAtlas();

let state = null;
let camera = null;
let running = false;
let paused = true;
let accumulator = 0;
let lastFrame = performance.now();
let drillSpin = 0;
let lastSave = performance.now();
let endShown = false;
let bestDepth = readBest();
let warnedFuel = false;
let warnedHull = false;
/** How many RNOV memos and dug-tile milestones have already been announced. */
let memosFired = 0;
let milestonesFired = 0;

/** View size in world pixels, and the scale applied to draw them. */
const view = { w: 800, h: 500, scale: 1, dpr: 1 };

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(Math.round(value)));
  } catch {
    /* private mode; the score just does not persist */
  }
}

/* ------------------------------------------------------------------ */
/* Resize                                                              */
/* ------------------------------------------------------------------ */

/**
 * The world is exactly `COLS` tiles wide, and the view always shows at least
 * that much: the scale is `viewport width / world width`, never less than 1, so
 * on a wide monitor you see the whole mine across and on a phone you see fewer
 * columns with the camera following. Either way the play area is never wider
 * than the map, which is what stops the walls from having nothing behind them.
 */
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  view.dpr = dpr;
  view.scale = Math.min(3, Math.max(1, cssW / (COLS * TILE)));
  view.w = cssW / view.scale;
  view.h = cssH / view.scale;

  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  if (camera) resizeCamera(camera, view.w, view.h);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));

/* ------------------------------------------------------------------ */
/* Starting and stopping                                               */
/* ------------------------------------------------------------------ */

function startNew() {
  state = createState();
  begin();
  hud.toast('Nov rudnik. 12.800 čevljev do dna.', 'info', 3600);
}

function continueSaved() {
  const loaded = loadFrom();
  state = loaded || createState();
  begin();
  if (loaded) hud.toast(`Dobrodošli nazaj. ${grouped(state.depth)} ft globoko.`, 'info');
  else hud.toast('Shranjene igre ni. Začenjamo nov rudnik.', 'warn');
}

function begin() {
  resize();
  camera = createCamera(view.w, view.h);
  // Put the camera on the ship immediately, or the first frame swings in from
  // the top-left corner.
  camera.x = state.ship.x;
  camera.y = state.ship.y;
  updateCamera(camera, state.ship, 1);
  endShown = false;
  warnedFuel = false;
  warnedHull = false;
  memosFired = 0;
  milestonesFired = 0;
  running = true;
  paused = false;
  accumulator = 0;
  lastFrame = performance.now();
  audio.resume();
}

function quitToTitle() {
  running = false;
  paused = true;
  saveGame(true);
  showTitle(app, {
    hasSave: Boolean(loadFrom()),
    onStart: () => { clearSave(); startNew(); },
    onContinue: continueSaved,
    onHelp: () => showHelp(app),
  });
}

function saveGame(announce = false) {
  if (!state) return;
  const ok = saveTo(state);
  if (announce) {
    hud.toast(ok ? 'Shranjeno.' : 'Shranjevanje ni mogoče (shramba blokirana).', ok ? 'info' : 'warn', 1600);
  }
  if (ok) writeBest(state.maxDepth);
}

/* ------------------------------------------------------------------ */
/* Events out of the sim                                               */
/* ------------------------------------------------------------------ */

/**
 * Turns the sim's event log into sound and messages.
 *
 * The events are drained every frame, so nothing accumulates. Anything that
 * needs to survive a frame boundary belongs in the state, not here.
 */
function handleEvents() {
  for (const event of state.events) {
    switch (event.type) {
      case 'ore': {
        const ore = ORE_BY_ID[event.ore];
        audio.orePickup(ore.tier);
        spawnOreBurst(state, event.col, event.row, ore);
        // The value and the joke go in one line, because two toasts for one
        // pickup is one toast too many. Only the ores worth remarking on have a
        // quip, which is also what keeps the surface ores quiet.
        const quip = findQuip(ore);
        if (quip) hud.toast(`${ore.name}, ${money(ore.value)} na kvadrat. ${quip}`, 'gold', 4600);
        break;
      }
      case 'full':
        audio.holdFull();
        break;
      case 'gas':
        audio.gasBurst();
        hud.toast('Žep plina! Ta te je stal.', 'danger');
        break;
      case 'lavaBlocked':
        audio.deny();
        hud.toast('Prevroče za vrtanje. Pojdi okoli.', 'warn', 1800);
        break;
      case 'blast':
        audio.blast();
        if (event.ore > 0) hud.toast(`Eksplozija je odprla ${event.ore} rudnih kvadratov.`, 'info');
        break;
      case 'dug':
        break;
      case 'upgrade':
      case 'buy':
      case 'used':
        break;
      case 'won':
        audio.win();
        saveGame();
        break;
      default:
        break;
    }
  }
  state.events.length = 0;
}

/** Warnings that are worth interrupting the player for, but only once each. */
function checkWarnings() {
  const fuelFrac = state.ship.fuel / maxFuel(state);
  const hullFrac = state.ship.hull / maxHull(state);
  if (fuelFrac < 0.18 && !warnedFuel) {
    warnedFuel = true;
    audio.alarm();
    hud.toast('Gorivo je pri kraju. Na površje.', 'danger', 3400);
  } else if (fuelFrac > 0.4) {
    warnedFuel = false;
  }
  if (hullFrac < 0.25 && !warnedHull) {
    warnedHull = true;
    audio.alarm();
    hud.toast('Trup je kritičen.', 'danger', 3400);
  } else if (hullFrac > 0.5) {
    warnedHull = false;
  }
}

/**
 * Head office writes to you, and it notices how much rock you have moved.
 *
 * Both lists are thresholds on a number that only ever grows, so "how many have
 * I passed" is enough to know which ones still owe a message - no set of fired
 * ids, nothing to serialise, and it cannot double-fire. The loop rather than an
 * `if` because a fast descent can cross two thresholds in one frame and the
 * second memo would otherwise be silently swallowed.
 *
 * Presentation only, so it lives here rather than in the sim: a memo changes
 * nothing about the game, and the sim has no business knowing about toasts.
 */
function checkMemos() {
  while (memosFired < reachedCount(MEMOS, state.maxDepth)) {
    audio.click();
    hud.toast(MEMOS[memosFired].text, 'info', 5600);
    memosFired += 1;
  }
  while (milestonesFired < reachedCount(MILESTONES, state.stats.dug)) {
    audio.click();
    hud.toast(MILESTONES[milestonesFired].text, 'gold', 5200);
    milestonesFired += 1;
  }
}

/* ------------------------------------------------------------------ */
/* Interaction                                                         */
/* ------------------------------------------------------------------ */

function openDock() {
  const facility = FACILITIES.find((f) => atFacility(state, f.key));
  if (!facility) {
    audio.deny();
    hud.toast('Tu ni s čim pristati.', 'warn', 1400);
    return;
  }
  audio.dock();
  // The counter is where the money is; the ship tab is where the shopping is.
  const tab = facility.key === 'shop' ? 'ship' : 'counter';
  showShop(app, state, {
    initialTab: tab,
    onSpend: (kind, amount) => {
      if (kind === 'purchase') audio.purchase();
      else if (kind === 'sale') { audio.sale(amount || 0); hud.toast(`Prodano za ${money(amount || 0)}.`, 'gold'); }
      else audio.deny();
      saveGame();
    },
    onClose: () => saveGame(),
  });
}

/**
 * Uses one of the carried consumables. The order is fixed and matches the digit
 * keys and the HUD order, so the muscle memory is "1 is the fuel, 2 is the
 * repair" rather than "whatever is first in the object".
 */
function useSlot(index) {
  const item = ITEMS[index];
  if (!item) return;
  if (state.items[item.key] <= 0) {
    audio.deny();
    hud.toast(`${item.name} ni na krovu.`, 'warn', 1400);
    return;
  }
  if (useItem(state, item.key)) {
    if (item.key === 'teleporter' || item.key === 'transmitter') {
      audio.teleport();
      hud.toast(item.key === 'teleporter' ? 'Teleportirano. Večina tovora ni prišla.' : 'Poslano domov, tovor cel.', 'info');
    } else if (item.key === 'nanobots') {
      audio.purchase();
      hud.toast('Nanoboti so popravili trup.', 'info');
    } else {
      audio.purchase();
      hud.toast('Porabljeno rezervno gorivo.', 'info');
    }
  }
}

function handleHotkeys() {
  if (input.consume('pause')) togglePause();
  if (input.consume('mute')) toggleMute();
  if (input.consume('help')) showHelp(app);
  if (input.consume('use')) openDock();
  for (let i = 0; i < ITEMS.length && i < 6; i += 1) {
    if (input.consume(`item${i + 1}`)) useSlot(i);
  }
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  input.clear();
  if (paused) {
    showPause(app, {
      muted: audio.muted,
      onResume: () => { paused = false; },
      onSave: () => saveGame(true),
      onToggleSound: () => toggleMute(),
      onQuit: quitToTitle,
    });
  }
}

function toggleMute() {
  audio.setMuted(!audio.muted);
  hud.setSoundIcon(audio.muted);
  if (!audio.muted) audio.resume();
}

hud.buttons.pause.addEventListener('click', () => { audio.click(); togglePause(); });
hud.buttons.help.addEventListener('click', () => { audio.click(); showHelp(app); });
hud.buttons.sound.addEventListener('click', () => { toggleMute(); });

// Browsers will not start audio without a gesture. Any gesture will do.
const unlockAudio = () => { audio.unlock(); audio.resume(); };
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

/**
 * One iteration of the game loop.
 *
 * Split out of `frame` so it can be driven directly. `requestAnimationFrame` is
 * the right scheduler and it is what runs in a browser, but it does not fire in
 * every headless configuration, and a loop body that can only be reached
 * through a frame callback is a loop body nothing can test.
 *
 * `now` is a millisecond timestamp from the same clock as `lastFrame`.
 */
function tick(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (!running || !state) return;

  handleHotkeys();
  const active = !paused && !document.hidden;

  if (active) {
    accumulator += dt;
    let steps = 0;
    const held = input.read();
    while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
      step(state, FIXED_DT, held);
      accumulator -= FIXED_DT;
      steps += 1;
    }
    // If the tab was throttled, drop the backlog rather than fast-forwarding
    // the mine through a second of drilling in one frame.
    if (steps >= MAX_STEPS) accumulator = 0;

    handleEvents();
    checkWarnings();
    checkMemos();

    const row = rowOf(state.ship.y);
    const hardness = tileHardness(row);
    audio.update(state, hardness, dt);

    // Only the flutes move, and only while the bit is biting. A drill that keeps
    // turning on its own reads as a spinning top rather than as a tool.
    if (state.ship.drilling) drillSpin += dt * (6 + digSpeed(state, row) * 0.06);

    if (state.ended && !endShown) {
      endShown = true;
      if (state.ended.type === 'won') {
        hud.toast('Našli ste ga.', 'gold', 6000);
      } else {
        audio.death();
        hud.toast(`Plovilo je izgubljeno: ${state.ended.cause}. Nadgradnje ostajajo.`, 'danger', 4200);
      }
      saveGame();
      showEnd(app, state, {
        won: state.ended.type === 'won',
        onContinue: () => { state.ended = null; endShown = false; },
        onRestart: () => { clearSave(); startNew(); },
      });
    }

    if (now - lastSave > AUTOSAVE_MS) {
      lastSave = now;
      saveGame();
    }
  }

  updateCamera(camera, state.ship, dt);
  const origin = camOrigin(camera);
  // Dust and bubbles are purely cosmetic, so they run on the real timestep and
  // keep animating while the game is paused rather than freezing mid-air.
  updateFx(fx, state, Math.min(0.05, dt), origin, view.w, view.h);
  render(origin);
  hud.update(state, {
    lowFuel: state.ship.fuel / maxFuel(state) < 0.2,
    lowHull: state.ship.hull / maxHull(state) < 0.3,
  });
}

function frame(now) {
  requestAnimationFrame(frame);
  tick(now);
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function render(origin) {
  const { w: vw, h: vh, scale, dpr } = view;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#04060c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

  const depth = state.depth;

  // --- world ---
  drawSky(ctx, camera, origin, vw, vh);
  drawSurface(ctx, origin, state.time);
  drawTiles(ctx, state.world, origin, vw, vh, atlas);
  drawNatas(ctx, origin, state.time);

  // --- entities ---
  drawGasClouds(ctx, state, origin);
  drawBubbles(ctx, fx, origin);
  drawDust(ctx, fx, origin);
  drawShip(ctx, state, origin, state.time, drillSpin);
  drawSparks(ctx, state, origin);
  drawHitFlash(ctx, state, origin);
  drawPops(ctx, state, origin);

  // --- the screen effects that sit on top of everything ---
  drawHeatTint(ctx, vw, vh, state.ship.heat, state.time);
  drawFlash(ctx, state.flash, vw, vh, state.ended && state.ended.type === 'won' ? '255, 240, 200' : '255, 200, 160');
  drawCrt(ctx, vw, vh);

  if (state.world && paused) {
    ctx.fillStyle = 'rgba(3, 5, 10, 0.35)';
    ctx.fillRect(0, 0, vw, vh);
  }
}

/* ------------------------------------------------------------------ */
/* Go                                                                  */
/* ------------------------------------------------------------------ */

resize();
window.addEventListener('pagehide', () => saveGame());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveGame();
});

showTitle(app, {
  hasSave: Boolean(loadFrom()),
  onStart: () => { clearSave(); startNew(); },
  onContinue: continueSaved,
  onHelp: () => showHelp(app),
});

requestAnimationFrame(frame);

/**
 * A hook for the headless harness.
 *
 * `tick` is exposed so the loop body can be driven without a frame callback,
 * which is the only way to exercise it in a headless browser that does not
 * schedule animation frames. It is the real loop, not a copy of it.
 */
globalThis.__DEEPCORE__ = {
  get state() { return state; },
  get camera() { return camera; },
  get paused() { return paused; },
  startNew,
  continueSaved,
  tick,
  view,
};
