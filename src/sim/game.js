/**
 * The game itself: one state object, one `step`, no DOM.
 *
 * Keeping the simulation free of rendering and of the browser is what lets the
 * test suite run a whole mining session in Node in a few milliseconds, and what
 * lets a save file be a small object rather than a serialised screen.
 *
 * Coordinates: the ship and the camera live in pixels, tiles are `TILE` wide.
 * Depth is reported in feet because that is what the fiction uses, but it is
 * derived from the row, so it can never drift out of sync with the map.
 */

import {
  TILE, COLS, ROWS, SKY_ROWS, SURFACE_ROW, ORE_BY_ID, UPGRADES, MAX_TIER, ITEM_BY_KEY,
  PHYS, FUEL_PRICE, REPAIR_PRICE, GAS, LAVA, START_CASH, ENDGAME, DEPTH_FT, FEET_PER_PX,
  HAZARD,
} from '../config.js';
import { World, KIND, kindOf, EMPTY, rowDepth } from './world.js';
import { blocked, unstick, colOf, rowOf, clamp, SHIP_HALF_H } from './physics.js';

const START_COL = 12;

/** The ship idles just above the landing strip, so it can never start buried. */
export const SURFACE_Y = (SKY_ROWS + 0.5) * TILE;

/** Row of every tier's price and value, flattened for the shop and the HUD. */
export const upgradeTier = (key, tier) => UPGRADES[key].tiers[clamp(tier, 0, UPGRADES[key].tiers.length - 1)];

/** Everything a fresh game starts with. */
export function createState(seed = (Math.random() * 0xffffffff) >>> 0) {
  const state = {
    seed,
    version: 1,
    world: null,
    ship: {
      x: (START_COL + 0.5) * TILE,
      y: SURFACE_Y,
      vx: 0,
      vy: 0,
      fuel: 0,
      hull: 0,
      heat: 0,
      drilling: false,
      drillDir: 'down',
      thrust: 0,
      dirX: 0,
      facing: 1,
      impact: 0,
    },
    tiers: { drill: 0, hull: 0, engine: 0, radiator: 0, tank: 0, cargo: 0 },
    cargo: [],
    cargoWeight: 0,
    cash: START_CASH,
    depth: 0,
    maxDepth: 0,
    items: { fuel: 0, nanobots: 0, dynamite: 0, c4: 0, teleporter: 0, transmitter: 0 },
    stats: { dug: 0, earned: 0, trips: 0, deaths: 0, best: 0 },
    time: 0,
    shake: 0,
    flash: 0,
    events: [],
    deaths: [],
    gasClouds: [],
    sparks: [],
    glow: [],
    pops: [],
    won: false,
    ended: null,
  };
  state.world = new World(seed);
  state.ship.fuel = maxFuel(state);
  state.ship.hull = maxHull(state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Derived numbers                                                     */
/* ------------------------------------------------------------------ */

export const maxFuel = (s) => upgradeTier('tank', s.tiers.tank).value;
export const maxHull = (s) => upgradeTier('hull', s.tiers.hull).value;
export const cargoCap = (s) => upgradeTier('cargo', s.tiers.cargo).value;
export const drillPower = (s) => upgradeTier('drill', s.tiers.drill).value;
export const radiatorPct = (s) => upgradeTier('radiator', s.tiers.radiator).value / 100;
export const enginePower = (s) => upgradeTier('engine', s.tiers.engine).value;
export const load = (s) => clamp(s.cargoWeight / cargoCap(s), 0, 1);

/** Depth in feet, measured at the ship, floored at the surface. */
export const depthAt = (y) => Math.max(0, (y - SKY_ROWS * TILE) * (DEPTH_FT / (ROWS * TILE)));

/** Rock gets harder with depth, but not six times harder: that killed pacing. */
export const tileHardness = (row) => 1 + Math.min(1.5, rowDepth(row) / 6000);

/**
 * How fast the drill eats rock, in pixels per second.
 *
 * The drill's rated speed is in *feet* per second, and the map is scaled such
 * that one pixel is one foot, so the conversion is a division rather than a
 * multiplication. It is written out anyway: using the rating directly as pixels
 * made the basic drill cut a 32-foot tile in a twenty-fifth of a second, which
 * looked like teleporting and made every tier above the first pointless.
 */
export const digSpeed = (s, row) => drillPower(s) / FEET_PER_PX / tileHardness(row);

/**
 * How many rows past the hull's edge the drill will look for rock.
 *
 * The search has to exist: while the pod is cutting a tile it sits part-way
 * inside it, so its hull edge crosses into the next row before the tile is
 * finished, and the target has to be "the first solid tile that way" rather than
 * "the tile one row over". Without the search the target jumps to the square
 * beyond the one being cut, and the pod is left wedged through a tile it can no
 * longer reach.
 *
 * It also has to stop. Now that the arrow keys drill by themselves, holding
 * Down while falling through an open shaft would otherwise search all the way to
 * the bedrock and start cutting a tile hundreds of feet below the pod.
 */
const DRILL_REACH = 2;

/**
 * Which tile the drill is pointing at, given what the player is asking for.
 *
 * The drill follows the controls: push left or right and it cuts that way, push
 * nothing and it cuts down.
 *
 * Cutting sideways is not a luxury. Without it a pod that falls into one of the
 * mine's open caverns, or that ends up beside a seam rather than under it, has
 * no way to reach anything except the square metre directly beneath it, and can
 * be walled in with nothing to do but fly home.
 *
 * Cutting *up* matters even more. The caverns are enclosed pockets in solid
 * rock, so a pod that falls into one is walled in on every side; if the drill
 * could not point upward, the only ways out would be to dig deeper or to run out
 * of fuel and be wrecked on purpose. Drilling up is slow and expensive compared
 * to flying, so it never replaces the climb home - it only removes the trap.
 */
export function drillTarget(state, input) {
  const ship = state.ship;
  const col = colOf(ship.x);
  const row = rowOf(ship.y);

  // Sideways is the adjacent column, always. The pod is 26px wide inside a 32px
  // tile, so an edge-based target would name the tile the ship is standing in.
  if (input.left && !input.right) return { col: col - 1, row, dir: 'left' };
  if (input.right && !input.left) return { col: col + 1, row, dir: 'right' };

  if (input.up && !input.down) {
    const start = rowOf(ship.y - SHIP_HALF_H);
    for (let r = start; r > SKY_ROWS && r >= start - DRILL_REACH; r -= 1) {
      if (kindOf(state.world.tile(col, r)) !== KIND.EMPTY) return { col, row: r, dir: 'up' };
    }
    /**
     * Nothing solid within reach: name the empty tile the search started on, so
     * `drill` sees EMPTY and does nothing.
     *
     * Naming a real row instead - which is what this used to do - meant a pod
     * flying up above the surface drilled the landing strip it had just left,
     * because the nearest "real" row above the sky is the ground. That silently
     * chewed a hole in the surface every time the player flew over it, and the
     * drill's extra drag made climbing out of the mine look sluggish.
     */
    return { col, row: start, dir: 'up' };
  }

  const start = rowOf(ship.y + SHIP_HALF_H);
  for (let r = start; r <= start + DRILL_REACH && r < ROWS - 1; r += 1) {
    if (kindOf(state.world.tile(col, r)) !== KIND.EMPTY) return { col, row: r, dir: 'down' };
  }
  // Same reasoning as the upward case: name an empty tile, not a real one.
  return { col, row: start, dir: 'down' };
}

/* ------------------------------------------------------------------ */
/* Cargo                                                               */
/* ------------------------------------------------------------------ */

export function addCargo(s, ore, amount = 1) {
  s.cargo.push({ id: ore.id, n: amount });
  s.cargoWeight += ore.weight * amount;
}

/** Ore grouped by id, heaviest value first: what the processor pays for. */
export function cargoManifest(s) {
  const byId = new Map();
  for (const slot of s.cargo) {
    const entry = byId.get(slot.id) || { ore: ORE_BY_ID[slot.id], n: 0 };
    entry.n += slot.n;
    byId.set(slot.id, entry);
  }
  return [...byId.values()].sort((a, b) => b.ore.value * b.n - a.ore.value * a.n);
}

export const cargoValue = (s) => cargoManifest(s).reduce((sum, e) => sum + e.ore.value * e.n, 0);

/**
 * Sells everything aboard. Only allowed at the processor, and only in whole
 * units: there is no partial sale, because the fun of the loop is the trip.
 */
export function sellCargo(s) {
  const value = cargoValue(s);
  const weight = s.cargoWeight;
  s.cargo = [];
  s.cargoWeight = 0;
  s.cash += value;
  s.stats.earned += value;
  if (weight > 0) s.stats.trips += 1;
  return value;
}

/* ------------------------------------------------------------------ */
/* Facilities                                                          */
/* ------------------------------------------------------------------ */

export const atSurface = (s) => rowOf(s.ship.y) <= SKY_ROWS + 1;

export const atFacility = (s, key) => {
  const def = { fuel: 3, sell: 10, shop: 20 }[key];
  return atSurface(s) && Math.abs(colOf(s.ship.x) - def) <= 1;
};

/** Refuels. Returns credits spent. */
export function refuel(s) {
  const need = maxFuel(s) - s.ship.fuel;
  if (need <= 0) return 0;
  const litres = Math.min(need, s.cash / FUEL_PRICE);
  s.ship.fuel = Math.min(maxFuel(s), s.ship.fuel + litres);
  const cost = litres * FUEL_PRICE;
  s.cash -= cost;
  return cost;
}

/** Repairs. Returns credits spent. */
export function repair(s) {
  const need = maxHull(s) - s.ship.hull;
  if (need <= 0) return 0;
  const points = Math.min(need, s.cash / REPAIR_PRICE);
  s.ship.hull = Math.min(maxHull(s), s.ship.hull + points);
  const cost = points * REPAIR_PRICE;
  s.cash -= cost;
  return cost;
}

/** Buys the next tier of a part. Returns true when something was bought. */
export function buyUpgrade(s, key) {
  const tier = s.tiers[key];
  if (tier >= MAX_TIER) return false;
  const next = UPGRADES[key].tiers[tier + 1];
  if (s.cash < next.price) return false;
  s.cash -= next.price;
  s.tiers[key] = tier + 1;
  if (key === 'hull') s.ship.hull = maxHull(s);
  if (key === 'tank') s.ship.fuel = maxFuel(s);
  s.events.push({ type: 'upgrade', key });
  return true;
}

export function buyItem(s, key) {
  const def = ITEM_BY_KEY[key];
  if (!def || s.items[key] >= def.max || s.cash < def.price) return false;
  s.cash -= def.price;
  s.items[key] += 1;
  s.events.push({ type: 'buy', key });
  return true;
}

/**
 * Uses a consumable. Fuel and nanobots are instant; the two transporters put
 * you back on the surface. The cheap one is a gamble: it drops most of the
 * hold, which is the whole reason the expensive one exists.
 */
export function useItem(s, key) {
  if (!s.items[key] || s.items[key] <= 0) return false;
  if (key === 'fuel') {
    s.items.fuel -= 1;
    s.ship.fuel = Math.min(maxFuel(s), s.ship.fuel + maxFuel(s) * 0.33);
  } else if (key === 'nanobots') {
    s.items.nanobots -= 1;
    s.ship.hull = Math.min(maxHull(s), s.ship.hull + maxHull(s) * 0.6);
  } else if (key === 'teleporter' || key === 'transmitter') {
    s.items[key] -= 1;
    if (key === 'teleporter') {
      // The untested one loses most of the cargo and always hurts a little.
      s.cargo = s.cargo.slice(0, Math.max(1, Math.floor(s.cargo.length * 0.15)));
      s.cargoWeight = s.cargo.reduce((sum, slot) => sum + ORE_BY_ID[slot.id].weight * slot.n, 0);
      s.ship.hull = Math.max(1, s.ship.hull - maxHull(s) * 0.1);
    }
    s.ship.x = (3 + 0.5) * TILE;
    s.ship.y = SURFACE_Y;
    s.ship.vx = 0;
    s.ship.vy = 0;
    s.flash = 0.7;
  } else if (key === 'dynamite' || key === 'c4') {
    s.items[key] -= 1;
    explode(s, colOf(s.ship.x), rowOf(s.ship.y), key === 'c4' ? 3.2 : 2.2);
  } else {
    return false;
  }
  s.events.push({ type: 'used', key });
  return true;
}

/* ------------------------------------------------------------------ */
/* Damage, blasts, hazards                                             */
/* ------------------------------------------------------------------ */

export function hurt(s, amount, cause = 'damage') {
  if (s.ship.hull <= 0) return;
  s.ship.hull -= amount;
  s.shake = Math.min(1, s.shake + amount / 40);
  if (s.ship.hull <= 0) destroy(s, cause);
}

/**
 * Destruction keeps your cash and your upgrades but not your ore, which is the
 * original's bargain: dying is a setback measured in one trip, never in the
 * run. Insurance is deliberately not a purchase.
 */
function destroy(s, cause = 'destroyed') {
  s.ship.hull = 0;
  s.cargo = [];
  s.cargoWeight = 0;
  s.deaths.push({ depth: Math.round(s.depth), cause });
  s.stats.deaths += 1;
  s.shake = 1;
  s.flash = 1;
  s.ended = { type: 'destroyed', cause };
  s.ship.x = (START_COL + 0.5) * TILE;
  s.ship.y = SURFACE_Y;
  s.ship.vx = 0;
  s.ship.vy = 0;
  s.ship.fuel = maxFuel(s) * 0.5;
  s.ship.hull = maxHull(s) * 0.5;
}

export function explode(s, col, row, radius) {
  const cleared = s.world.carve(col, row, radius);
  let ore = 0;
  for (const cell of cleared) {
    if (kindOf(cell.tile) === KIND.ORE) ore += 1;
  }
  s.events.push({ type: 'blast', col, row, radius, ore });
  s.shake = Math.min(1, s.shake + 0.5);
  for (let i = 0; i < 26; i += 1) {
    s.sparks.push({
      x: (col + 0.5 + (Math.random() - 0.5) * radius) * TILE,
      y: (row + 0.5 + (Math.random() - 0.5) * radius) * TILE,
      vx: (Math.random() - 0.5) * 260,
      vy: (Math.random() - 0.5) * 260,
      life: 0.35 + Math.random() * 0.5,
      max: 0.85,
      tone: i % 3 === 0 ? '#fff1c4' : '#ff9a3c',
      size: 1 + Math.random() * 2.4,
    });
  }
}

/**
 * Gas. It looks exactly like dirt until the drill touches it, which is the
 * point: no amount of looking keeps you safe, only not drilling there.
 */
function detonateGas(s, col, row) {
  const depth = rowDepth(row);
  const dmg = (GAS.damageBase + Math.max(0, depth - HAZARD.gasFrom) * GAS.damagePerFt)
    * (1 - radiatorPct(s));
  explode(s, col, row, GAS.radius);
  s.ship.fuel = Math.max(0, s.ship.fuel - maxFuel(s) * 0.04);
  hurt(s, dmg, 'gas pocket');
  s.events.push({ type: 'gas', col, row });
  // A cloud that lingers: the ship should not be able to sit in the crater.
  s.gasClouds.push({ x: (col + 0.5) * TILE, y: (row + 0.5) * TILE, r: 2.4 * TILE, life: 0, max: 2.6 });
}

function touchLava(s, dt) {
  const { x, y } = s.ship;
  const col = colOf(x);
  const row = rowOf(y);
  let hot = false;
  for (let dy = -LAVA.proximity; dy <= LAVA.proximity; dy += 1) {
    for (let dx = -LAVA.proximity; dx <= LAVA.proximity; dx += 1) {
      if (kindOf(s.world.tile(col + dx, row + dy)) === KIND.LAVA) hot = true;
    }
  }
  s.ship.heat = hot ? 1 : Math.max(0, s.ship.heat - dt * 1.6);
  if (!hot) return;

  hurt(s, LAVA.dps * (1 - radiatorPct(s)) * dt, 'lava');
  if (Math.random() < dt * 24) {
    s.sparks.push({
      x: (col + 0.5 + (Math.random() - 0.5) * 1.4) * TILE,
      y: (row + 0.5 + (Math.random() - 0.5) * 1.4) * TILE,
      vx: (Math.random() - 0.5) * 90,
      vy: -40 - Math.random() * 90,
      life: 0.5,
      max: 0.5,
      tone: '#ff7a2f',
      size: 1 + Math.random() * 2,
    });
  }
}

/**
 * Eats the tile the drill is pointed at. Returns what happened, so the caller
 * can make noise and sparks without the sim knowing what a speaker is.
 *
 * The pod does not move into a square until that square is gone. An earlier
 * version pushed the pod into the tile *while* it was cutting, which meant the
 * target advanced to the next square before the current one was finished; the
 * drill then spread its damage across a run of half-cut tiles and finished
 * almost none of them. It looked like a very slow drill rather than a bug.
 *
 * Downward needs no help at all: gravity drops the pod into the hole the
 * instant it opens. Sideways and upward are pushed, because nothing else moves
 * the pod in those directions.
 */
function drill(s, dt, target) {
  const { col, row, dir } = target;
  const tile = s.world.tile(col, row);
  const kind = kindOf(tile);
  if (kind === KIND.EMPTY) return null;
  if (row <= SKY_ROWS || row >= ROWS - 1) return null;

  const hardness = tileHardness(row);

  if (kind === KIND.GAS) {
    detonateGas(s, col, row);
    return 'gas';
  }

  // Lava is the one thing the bit will not cut. Letting the drill chew through
  // it turned a visible obstacle into a race between the drill and the hull
  // bar, which is neither readable nor interesting: the answer to lava should be
  // to go around it, and that only works if going through is not an option.
  if (kind === KIND.LAVA) return 'lava';

  const speed = digSpeed(s, row); // pixels of rock per second
  const done = s.world.addDamage(col, row, (speed / TILE) * dt);
  // Keep the pod over the square it is cutting, so the hole stays wide enough
  // for the hull to descend through.
  trackColumn(s, target, dt);
  // Every second the drill runs hits the tank, and harder rock costs more.
  s.ship.fuel -= PHYS.fuelDrill * (0.6 + 0.4 * hardness) * dt;
  if (done < 1) return null;

  if (kind === KIND.ORE) {
    const ore = ORE_BY_ID[s.world.oreAt(col, row)];
    const room = cargoCap(s) - s.cargoWeight;
    // Ore only fits whole. Half a ruby is not a ruby, and the rounding-down is
    // what makes a nearly-full hold a decision rather than a nuisance.
    if (ore && room >= ore.weight) {
      addCargo(s, ore, 1);
      s.pops.push({
        x: (col + 0.5) * TILE, y: (row + 0.5) * TILE, life: 0, max: 1.5,
        text: `+${ore.name}`, tone: ore.color, value: ore.value,
      });
      // The ore's *id*, not its key: consumers look it up in ORE_BY_ID, which
      // is keyed by id. Publishing the key here instead was a crash on the very
      // first tile of ore, because ORE_BY_ID['ironium'] is undefined.
      s.events.push({ type: "ore", ore: ore.id, col, row });
    } else {
      // Full hold: the ore is destroyed rather than banked, which is what makes
      // flying home with the hold half empty worth the fuel.
      s.events.push({ type: "full", col, row });
      s.pops.push({
        x: (col + 0.5) * TILE, y: (row + 0.5) * TILE, life: 0, max: 1.1,
        text: "HOLD FULL", tone: "#ff5a5a", value: 0,
      });
    }
  }

  s.world.setTile(col, row, EMPTY);
  s.stats.dug += 1;
  s.events.push({ type: "dug", col, row, kind });
  // Only now is there somewhere to move into.
  if (dir !== "down") nudgeIntoHole(s, target, speed, dt);
  return "dug";
}

/**
 * Steers the pod back over the column it is cutting.
 *
 * The hull is 26px wide inside a 32px tile, so it only fits down a one-tile
 * tunnel while it is roughly centred on it. Left alone it drifts until it
 * straddles two columns, and then the tunnel it just dug is too narrow for it
 * to enter and it jams on the ledge between them. Centring on the bit reads as
 * the drill steering the pod, which is also what it is.
 */
function trackColumn(s, target, dt) {
  const { col, dir } = target;
  if (dir === "left" || dir === "right") return;
  const ship = s.ship;
  const offset = (col + 0.5) * TILE - ship.x;
  if (Math.abs(offset) <= 0.5) return;
  const nx = ship.x + Math.sign(offset) * Math.min(Math.abs(offset), PHYS.drillTrack * dt);
  if (!blocked(s.world, nx, ship.y, { col, row: target.row })) ship.x = nx;
}

/**
 * Slides the pod into a hole it has just finished making, sideways or upward.
 * It stops at the centre of the new square, so the pod ends up over the bit
 * rather than drifting on through the wall it just opened.
 */
function nudgeIntoHole(s, target, speed, dt) {
  const { col, row, dir } = target;
  const ship = s.ship;
  const step = Math.min(speed, PHYS.maxSpeedY) * dt;
  const ignore = { col, row };

  if (dir === "up") {
    // Where the pod's centre has to be to sit inside the row above.
    const targetY = (row + 1) * TILE - SHIP_HALF_H + 1;
    if (ship.y <= targetY + 0.5) return;
    const ny = Math.max(ship.y - step, targetY);
    if (!blocked(s.world, ship.x, ny, ignore)) ship.y = ny;
    return;
  }

  const sign = dir === "left" ? -1 : 1;
  const targetX = (col + 0.5) * TILE;
  const moving = sign < 0 ? ship.x > targetX + 0.5 : ship.x < targetX - 0.5;
  if (!moving) return;
  const nx = ship.x + sign * step;
  const clamped = sign < 0 ? Math.max(nx, targetX) : Math.min(nx, targetX);
  if (!blocked(s.world, clamped, ship.y, ignore)) ship.x = clamped;
}

/* ------------------------------------------------------------------ */
/* The step                                                            */
/* ------------------------------------------------------------------ */

/**
 * Advances one fixed tick. `input` is `{ left, right, up, down, drill }`; the
 * sim never reads a keyboard.
 */
export function step(s, dt, input) {
  const ship = s.ship;
  s.time += dt;
  if (!s.world) return;

  // --- thrust ---------------------------------------------------------
  const filled = load(s);
  const accel = (enginePower(s) / 150) * PHYS.turnAccel * (1 - PHYS.cargoSlowdown * filled);
  const horizontal = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const vertical = (input.down ? 1 : 0) - (input.up ? 1 : 0);

  if (horizontal) ship.facing = horizontal;
  ship.dirX = horizontal;

  // Held thrust, so the ship keeps pushing as long as a key is down. This is
  // the whole feel of the original: it is not momentum, it is insistence.
  if (horizontal) ship.vx += accel * horizontal * dt;
  if (vertical) ship.vy += (accel * 0.85) * vertical * dt;
  if (!vertical) ship.vy += PHYS.gravity * dt;

  const maxX = PHYS.maxSpeedX * (0.75 + 0.45 * (enginePower(s) / 150)) * (1 - 0.4 * filled);
  ship.vx = clamp(ship.vx, -maxX, maxX);
  ship.vy = clamp(ship.vy, -PHYS.maxSpeedY, PHYS.maxSpeedY);

  // --- the drill ------------------------------------------------------
  /**
   * Pushing into rock cuts it.
   *
   * Holding a direction drills that way, which is what the original did and what
   * makes the controls one idea instead of two: you point the pod at the rock and
   * it goes through it, with no separate drill button to find. Space (or Shift)
   * still drills straight down on its own, for a player who wants to hover and
   * cut without moving.
   *
   * Drilling up is allowed too, and it is the only way out of one of the mine's
   * enclosed caverns. It is slower and dearer than flying, so it never becomes
   * the way home - only the way out of a trap.
   */
  const pushing = Boolean(input.left || input.right || input.up || input.down);
  const wantsToDig = Boolean(input.drill) || pushing;
  ship.drilling = false;
  if (wantsToDig) {
    const target = drillTarget(s, input);
    // What the bit is aimed at, for the renderer: the drill has to point at the
    // rock it is cutting rather than spin through every direction in turn.
    ship.drillDir = target.dir;
    const before = s.world.tile(target.col, target.row);
    const result = drill(s, dt, target);
    if (result) {
      ship.drilling = result === 'dug';
      // Bumping into lava is worth a nudge, but only once every second or so -
      // the message is not news after the first time.
      if (result === 'lava' && s.time - (ship.lastLavaHint || -99) > 1.2) {
        ship.lastLavaHint = s.time;
        s.events.push({ type: 'lavaBlocked', col: target.col, row: target.row });
      }
    } else if (kindOf(before) !== KIND.EMPTY) {
      // Mid-tile: still drilling, still burning fuel, still making noise.
      ship.drilling = true;
    } else if (target.dir === 'down' && Math.abs(ship.vy) < 20) {
      /**
       * Aimed down at open air while sitting still.
       *
       * That means the pod is resting on the edge of a ledge in the column next
       * door: the hull is 26px wide in a 32px tile, so a pod a few pixels off
       * centre is held up by its neighbour's rock while its own column is clear
       * all the way down. There is nothing to cut and nothing to fall through,
       * so holding the drill did nothing at all and the pod sat there forever.
       *
       * Centring it on its own column slides it off the ledge and it drops. This
       * only runs when the pod is at rest, so it never fights the player for
       * control while they are flying.
       */
      trackColumn(s, target, dt);
    }
  }

  // --- integration ----------------------------------------------------
  moveShip(s, dt);

  // --- flight drag ----------------------------------------------------
  const drag = ship.drilling ? PHYS.drillDrag : PHYS.drag;
  if (!horizontal) ship.vx *= Math.exp(-drag * dt * 0.9);
  if (!vertical) ship.vy *= Math.exp(-drag * dt * PHYS.verticalDrag);

  // A ship that is somehow inside rock gets pushed out rather than pinned.
  // This is what makes an old save, a teleport or a map change survivable.
  unstick(s.world, ship);

  // --- fuel -----------------------------------------------------------
  const thrusting = Boolean(horizontal || input.up || input.down);
  const burn = (thrusting ? PHYS.fuelThrust : PHYS.fuelIdle) * (0.6 + filled * 0.9);
  ship.fuel = Math.max(0, ship.fuel - burn * dt);
  if (ship.fuel <= 0 && !s.ended) destroy(s, 'out of fuel');

  // --- damage sources -------------------------------------------------
  touchLava(s, dt);
  ship.impact = Math.max(0, ship.impact - dt * 2.5);
  s.shake = Math.max(0, s.shake - dt * 1.8);
  s.flash = Math.max(0, s.flash - dt * 2.2);

  // --- bookkeeping ----------------------------------------------------
  s.depth = depthAt(ship.y);
  s.maxDepth = Math.max(s.maxDepth, s.depth);
  s.stats.best = Math.max(s.stats.best, s.depth);

  stepParticles(s, dt);
  checkEnding(s);

  ship.thrust = Math.abs(ship.vx) / PHYS.maxSpeedX;
  return s;
}

/**
 * Sub-stepped, axis-separated movement. Sub-stepping is not optional: at the
 * top engine speed the ship crosses half a tile per tick, and without it a fast
 * descent tunnels straight through a gas pocket.
 */
function moveShip(s, dt) {
  const ship = s.ship;
  const steps = Math.max(1, Math.ceil((Math.abs(ship.vx) + Math.abs(ship.vy)) * dt / (TILE * 0.4)));
  const sub = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    const nx = ship.x + ship.vx * sub;
    if (blocked(s.world, nx, ship.y)) ship.vx = 0;
    else ship.x = nx;

    const ny = ship.y + ship.vy * sub;
    const hit = blocked(s.world, ship.x, ny);
    if (hit) {
      if (ship.vy > PHYS.fallSafe * 0.9) {
        const excess = ship.vy - PHYS.fallSafe;
        if (excess > 0) {
          hurt(s, excess * PHYS.fallScale, 'a hard landing');
          ship.impact = clamp(excess / 400, 0, 1);
        }
      }
      ship.vy = 0;
    } else {
      ship.y = ny;
    }
  }
  ship.x = clamp(ship.x, TILE * 0.5, (COLS - 0.5) * TILE);
}

function stepParticles(s, dt) {
  s.sparks = s.sparks.filter((p) => {
    p.life += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 240 * dt;
    p.vx *= Math.exp(-1.6 * dt);
    return p.life < p.max;
  });
  s.pops = s.pops.filter((p) => { p.life += dt; return p.life < p.max; });
  s.gasClouds = s.gasClouds.filter((c) => { c.life += dt; return c.life < c.max; });
  s.glow = s.glow.filter((g) => { g.life += dt; return g.life < g.max; });
}

/* ------------------------------------------------------------------ */
/* The end                                                             */
/* ------------------------------------------------------------------ */

/**
 * Mr. Natas, at the bottom of everything, behind more rock than any sane person
 * would dig. Touching him ends the run with the mother lode and the credits.
 */
function checkEnding(s) {
  if (s.won) return;
  const col = colOf(s.ship.x);
  const row = rowOf(s.ship.y);
  if (Math.abs(col - ENDGAME.col) <= 1 && Math.abs(row - ENDGAME.row) <= 1) {
    s.won = true;
    s.cash += ENDGAME.reward;
    s.stats.earned += ENDGAME.reward;
    s.ended = { type: 'won' };
    s.events.push({ type: 'won' });
  }
}
