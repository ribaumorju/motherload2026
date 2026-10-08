/**
 * The mine: what it is made of, and how it changes when you dig it.
 *
 * The world is two flat arrays of `COLS * ROWS` entries. The first holds what
 * the tile *is*:
 *
 *   bits 0-2   kind (0 solid rock, 1 gas pocket, 2 lava, 3 ore, 4 empty)
 *   bits 3-4   variant, so a wall of rock is not a wall of identical squares
 *
 * The second holds the ore id (0 or 1-10) for tiles whose kind is `ORE`.
 * Packing the id into the first byte looked tidy until the tenth ore arrived
 * and there was no room left; a second byte per tile costs 9.6 KB for the whole
 * 400-row mine and removes the ceiling entirely.
 *
 * The variant seeds the tile's speckle. It has to be stored rather than
 * derived from position, because a rock that gets chipped and then finished
 * would otherwise change the way it looks, which reads as a glitch.
 */

import {
  COLS, ROWS, SKY_ROWS, SURFACE_DEPTH, HAZARD, ORES, FEET_PER_PX, TILE, ORE_DENSITY,
} from '../config.js';
import { makeRng } from './rng.js';

export const KIND = { SOLID: 0, GAS: 1, LAVA: 2, ORE: 3, EMPTY: 4 };

export const pack = (kind, variant = 0) => (kind & 7) | ((variant & 3) << 3);
export const kindOf = (t) => t & 7;
export const variantOf = (t) => (t >> 3) & 3;

/** Empty space. Everything that is not this is diggable-or-blocking. */
export const EMPTY = pack(KIND.EMPTY);

/** The depth in feet at the *top* of a row. */
export const rowDepth = (row) => Math.max(0, (row - SKY_ROWS) * TILE * FEET_PER_PX);

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.tiles = new Uint8Array(COLS * ROWS);
    /** Ore ids, parallel to `tiles`. Only meaningful when the kind is ORE. */
    this.ore = new Uint8Array(COLS * ROWS);
    /** Drill progress per tile, 0..1. Kept out of the byte above on purpose. */
    this.damage = new Float32Array(COLS * ROWS);
    this.generate();
  }

  generate() {
    const rng = makeRng(this.seed);
    const t = this.tiles;
    const o = this.ore;
    for (let row = 0; row < ROWS; row += 1) {
      const depth = rowDepth(row);
      // Only the four most recent ores this depth has unlocked are in play;
      // older ones are still findable in spirit but not worth generating, and
      // their rarity weights keep them common even so. Each ore carries its own
      // rarity, which is what stops the surface being a diamond mine.
      const unlocked = ORES.filter((ore) => ore.from <= depth);
      const pool = unlocked.slice(-4);
      const weights = pool.map((ore) => ore.rarity);
      const total = weights.reduce((a, b) => a + b, 0);

      for (let col = 0; col < COLS; col += 1) {
        const i = row * COLS + col;
        const variant = rng.int(4);
        if (row < SKY_ROWS) { t[i] = EMPTY; continue; }
        if (row === ROWS - 1) { t[i] = pack(KIND.SOLID, variant); continue; }

        const r = rng();
        if (depth >= HAZARD.gasFrom && r < 0.02) { t[i] = pack(KIND.GAS, variant); continue; }
        if (depth >= HAZARD.lavaFrom && r < 0.03) { t[i] = pack(KIND.LAVA, variant); continue; }
        if (total > 0 && rng() < ORE_DENSITY) {
          let roll = rng() * total;
          let picked = pool[pool.length - 1];
          for (let k = 0; k < pool.length; k += 1) {
            roll -= weights[k];
            if (roll <= 0) { picked = pool[k]; break; }
          }
          t[i] = pack(KIND.ORE, variant);
          o[i] = picked.id;
        }
        // Everything else is already zero: solid rock.
      }
    }

    // Level the surface into a landing strip so the ship starts on a floor
    // rather than buried at whatever the ore roll put there, and so the three
    // facilities have ground to stand on.
    for (let row = SKY_ROWS; row < SKY_ROWS + SURFACE_DEPTH; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const i = row * COLS + col;
        t[i] = row === SKY_ROWS + SURFACE_DEPTH - 1 ? pack(KIND.SOLID, 0) : EMPTY;
        o[i] = 0;
      }
    }

    // A handful of open caverns, which give the early game somewhere to drop
    // into and the lighting something to show off.
    for (let c = 0; c < 90; c += 1) {
      const cx = rng.int(COLS);
      const cy = SKY_ROWS + 8 + rng.int(ROWS - SKY_ROWS - 20);
      const radius = 1 + rng.range(0, 2.2);
      this.carve(cx, cy, radius);
    }
  }

  inBounds(col, row) {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS;
  }

  tile(col, row) {
    if (col < 0 || col >= COLS || row < 0) return EMPTY;
    if (row >= ROWS) return pack(KIND.SOLID, 0);
    return this.tiles[row * COLS + col];
  }

  /** Ore id at a tile, or 0 when there is none. */
  oreAt(col, row) {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return 0;
    return this.ore[row * COLS + col];
  }

  isSolid(col, row) {
    if (row >= ROWS) return true; // bedrock floor
    if (col < 0 || col >= COLS || row < 0) return false;
    return kindOf(this.tiles[row * COLS + col]) !== KIND.EMPTY;
  }

  setTile(col, row, value) {
    if (!this.inBounds(col, row)) return;
    const i = row * COLS + col;
    this.tiles[i] = value;
    this.ore[i] = 0;
    this.damage[i] = 0;
  }

  /** Digging progress, 0..1. */
  getDamage(col, row) {
    if (!this.inBounds(col, row)) return 0;
    return this.damage[row * COLS + col];
  }

  addDamage(col, row, amount) {
    if (!this.inBounds(col, row)) return 0;
    const i = row * COLS + col;
    this.damage[i] = Math.min(1, this.damage[i] + amount);
    return this.damage[i];
  }

  /**
   * Removes everything inside a radius. `keepBedrock` guards the sky rows and
   * the floor: an explosion at the surface should not open a hole into the sky.
   */
  carve(col, row, radius) {
    const r2 = radius * radius;
    const cleared = [];
    for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx += 1) {
        if (dx * dx + dy * dy > r2) continue;
        const c = col + dx;
        const rw = row + dy;
        if (!this.inBounds(c, rw)) continue;
        // The sky rows and the floor are not diggable, even by explosives: an
        // explosion at the surface must not open a hole into the sky.
        if (rw < SKY_ROWS || rw >= ROWS - 1) continue;
        const i = rw * COLS + c;
        if (this.tiles[i] !== EMPTY) {
          cleared.push({ col: c, row: rw, tile: this.tiles[i], ore: this.ore[i] });
        }
        this.tiles[i] = EMPTY;
        this.ore[i] = 0;
        this.damage[i] = 0;
      }
    }
    return cleared;
  }

  /** Every ore still in the ground, for the completion check and the minimap. */
  remainingOre() {
    let n = 0;
    for (let i = 0; i < this.tiles.length; i += 1) if (kindOf(this.tiles[i]) === KIND.ORE) n += 1;
    return n;
  }
}
