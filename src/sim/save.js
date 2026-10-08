/**
 * Saving is a seed, a ship and a list of holes.
 *
 * The mine is fully determined by its seed, so nothing about the terrain needs
 * storing except what the player changed. Holes are the only mutation that
 * matters, and a hole is one tile index, so a deep run saves in a few kilobytes
 * instead of a megabyte.
 *
 * The holes are packed two bytes each rather than written as JSON numbers: a
 * dug-out mine is thousands of tiles and `Uint16Array` keeps the string small
 * enough to be comfortable in localStorage. Tiles beyond `0xffff` are not
 * possible here - 24 * 400 is 9600 - and the guard below is what keeps that
 * true if the map ever grows.
 */

import { SAVE_KEY, ORE_BY_ID } from '../config.js';
import { EMPTY } from './world.js';
import { createState, maxFuel, maxHull, depthAt } from './game.js';

export function packHoles(world) {
  const out = [];
  for (let i = 0; i < world.tiles.length; i += 1) {
    if (world.tiles[i] === EMPTY) out.push(i);
  }
  if (out.some((i) => i > 0xffff)) throw new Error('mine too large for 16-bit tile indexing');
  return new Uint16Array(out);
}

/** Turns a state into a plain object that survives `JSON.stringify`. */
export function serialize(s) {
  const holes = packHoles(s.world);
  return {
    version: s.version,
    seed: s.seed,
    cash: s.cash,
    tiers: { ...s.tiers },
    items: { ...s.items },
    cargo: s.cargo.map((slot) => ({ id: slot.id, n: slot.n })),
    cargoWeight: s.cargoWeight,
    ship: { x: s.ship.x, y: s.ship.y, fuel: s.ship.fuel, hull: s.ship.hull },
    stats: { ...s.stats },
    maxDepth: s.maxDepth,
    won: Boolean(s.won),
    holes: Array.from(holes),
  };
}

/** Rebuilds a live state. Returns null when the payload is unusable. */
export function deserialize(data) {
  if (!data || typeof data !== 'object' || data.version !== 1) return null;
  if (!Number.isFinite(data.seed)) return null;
  const s = createState(data.seed >>> 0);
  s.tiers = { ...s.tiers, ...(data.tiers || {}) };
  s.items = { ...s.items, ...(data.items || {}) };
  s.cash = Number.isFinite(data.cash) ? data.cash : s.cash;
  s.cargo = Array.isArray(data.cargo)
    ? data.cargo.filter((slot) => slot && Number.isInteger(slot.id) && ORE_BY_ID[slot.id] && slot.n > 0)
    : [];
  s.stats = { ...s.stats, ...(data.stats || {}) };
  s.maxDepth = Number.isFinite(data.maxDepth) ? data.maxDepth : 0;
  s.won = Boolean(data.won);

  // A save can outlive a patched ore table; a slot pointing at an ore that no
  // longer exists would make the processor pay NaN, so the weight is rebuilt
  // from the manifest rather than trusted.
  s.cargoWeight = s.cargo.reduce(
    (sum, slot) => sum + ORE_BY_ID[slot.id].weight * slot.n, 0,
  );

  const ship = data.ship || {};
  if (Number.isFinite(ship.x)) s.ship.x = ship.x;
  if (Number.isFinite(ship.y)) s.ship.y = ship.y;
  s.ship.fuel = Math.min(maxFuel(s), Math.max(0, Number(ship.fuel) || 0));
  s.ship.hull = Math.min(maxHull(s), Math.max(0.0001, Number(ship.hull) || maxHull(s)));

  // Depth is derived from the ship's position rather than stored, but it has to
  // be derived *now*: the HUD reads it before the first tick, and a fresh state
  // would otherwise report the surface until the player moved.
  s.depth = depthAt(s.ship.y);
  s.maxDepth = Math.max(s.maxDepth, s.depth);

  for (const index of data.holes || []) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= s.world.tiles.length) continue;
    s.world.tiles[i] = EMPTY;
    s.world.ore[i] = 0;
  }
  return s;
}

/** Reads a save out of localStorage, or null. Never throws on bad data. */
export function loadFrom(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    return raw ? deserialize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveTo(s, storage = globalThis.localStorage) {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(serialize(s)));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(storage = globalThis.localStorage) {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    /* storage is unavailable; nothing to clear */
  }
}
