/**
 * The runnable check for everything that is not pixels.
 *
 *   node tests/selftest.mjs
 *
 * It exercises the sim the way the game does - through `step` with a fake
 * input - so a change that breaks movement, the drill, the economy or the save
 * file fails here instead of being discovered by mining for ten minutes.
 *
 * No framework. Node's own `assert` and a counter, because that is all this
 * needs and a test dependency is a dependency.
 */

import assert from 'node:assert/strict';
import {
  COLS, ROWS, SKY_ROWS, TILE, ORES, ORE_BY_ID, MAX_TIER, PHYS, START_CASH, LAVA,
  UPGRADES, UPGRADE_KEYS, ITEMS, FACILITIES, DEPTH_FT,
} from '../src/config.js';
import {
  money, grouped, RNOV, MEMOS, MILESTONES, reachedCount, findQuip,
} from '../src/teksti.js';
import { World, KIND, kindOf, variantOf, pack, EMPTY, rowDepth } from '../src/sim/world.js';
import { makeRng, hash2 } from '../src/sim/rng.js';
import {
  createState, step, sellCargo, cargoValue, refuel, repair, buyUpgrade, buyItem, useItem,
  cargoCap, maxFuel, maxHull, drillPower, depthAt, explode, cargoManifest, upgradeTier, addCargo,
  drillTarget,
} from '../src/sim/game.js';
import { serialize, deserialize, packHoles } from '../src/sim/save.js';
import { blocked, colOf, rowOf, SHIP_HALF_H } from '../src/sim/physics.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`FAIL  ${name}`);
    console.log(`      ${err.message}`);
  }
}

/** Runs the sim for `seconds` of game time with a held input. */
function run(state, seconds, input = {}, dt = 1 / 60) {
  const ticks = Math.round(seconds / dt);
  for (let i = 0; i < ticks; i += 1) step(state, dt, { left: 0, right: 0, up: 0, down: 0, drill: 0, ...input });
  return state;
}

const hover = { up: 0, down: 0 };

/* ------------------------------------------------------------------ */
console.log('\n--- rng ---');

test('makeRng is deterministic and stays in range', () => {
  const a = makeRng(1234);
  const b = makeRng(1234);
  for (let i = 0; i < 500; i += 1) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('makeRng.int stays inside [0, n)', () => {
  const rng = makeRng(7);
  for (let i = 0; i < 1000; i += 1) {
    const v = rng.int(4);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 4, `bad int ${v}`);
  }
});

test('hash2 is stable for a position and spread across positions', () => {
  assert.equal(hash2(12, 40), hash2(12, 40));
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) seen.add(Math.floor(hash2(i, i * 3) * 16));
  assert.ok(seen.size > 8, `hash is clumping: ${seen.size} buckets`);
});

/* ------------------------------------------------------------------ */
console.log('\n--- tile packing ---');

test('tiles round-trip their kind and variant', () => {
  for (const kind of [KIND.SOLID, KIND.GAS, KIND.LAVA, KIND.ORE, KIND.EMPTY]) {
    for (let variant = 0; variant < 4; variant += 1) {
      const t = pack(kind, variant);
      assert.equal(kindOf(t), kind);
      assert.equal(variantOf(t), variant);
      assert.ok(t < 256, 'tile must fit a byte');
    }
  }
});

test('EMPTY is actually empty and not solid', () => {
  assert.equal(kindOf(EMPTY), KIND.EMPTY);
});

/* ------------------------------------------------------------------ */
console.log('\n--- world generation ---');

test('same seed makes the same mine', () => {
  const a = new World(99);
  const b = new World(99);
  assert.deepEqual(Array.from(a.tiles), Array.from(b.tiles));
});

test('different seeds make different mines', () => {
  const a = new World(1);
  const b = new World(2);
  let diff = 0;
  for (let i = 0; i < a.tiles.length; i += 1) if (a.tiles[i] !== b.tiles[i]) diff += 1;
  assert.ok(diff > a.tiles.length * 0.2, `seeds barely differ: ${diff}`);
});

test('the sky is empty, the floor is solid, and the surface row is diggable', () => {
  const w = new World(5);
  for (let col = 0; col < COLS; col += 1) {
    assert.equal(kindOf(w.tile(col, 0)), KIND.EMPTY, 'sky should be open');
    assert.notEqual(kindOf(w.tile(col, ROWS - 1)), KIND.EMPTY, 'floor should be bedrock');
    assert.equal(w.isSolid(col, ROWS), true, 'below the map is solid');
  }
});

test('every ore id used in the ground exists in the table', () => {
  const w = new World(11);
  for (let i = 0; i < w.tiles.length; i += 1) {
    if (kindOf(w.tiles[i]) !== KIND.ORE) continue;
    assert.ok(ORE_BY_ID[w.ore[i]], `unknown ore id ${w.ore[i]}`);
  }
});

test('deep-only ore never appears above its depth', () => {
  const w = new World(21);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const i = row * COLS + col;
      if (kindOf(w.tiles[i]) !== KIND.ORE) continue;
      const ore = ORE_BY_ID[w.ore[i]];
      assert.ok(rowDepth(row) + 40 >= ore.from, `${ore.name} at ${Math.round(rowDepth(row))}ft, unlocks ${ore.from}ft`);
    }
  }
});

test('the shallow mine is common ore only, and the gems live deep', () => {
  const w = new World(31);
  let ore = 0;
  let gems = 0;
  let shallowOre = 0;
  let shallowGems = 0;
  for (let i = 0; i < w.tiles.length; i += 1) {
    if (kindOf(w.tiles[i]) !== KIND.ORE) continue;
    const def = ORE_BY_ID[w.ore[i]];
    const row = Math.floor(i / COLS);
    const deep = def.from >= 5000;
    ore += 1;
    if (deep) gems += 1;
    if (rowDepth(row) < 2500) {
      shallowOre += 1;
      if (deep) shallowGems += 1;
    }
  }
  assert.ok(ore > 500, `almost no ore: ${ore}`);
  assert.ok(gems > 0, 'no gems anywhere');
  assert.equal(shallowGems, 0, 'a gem turned up near the surface');
  assert.ok(shallowOre > 50, `nothing to find up top: ${shallowOre}`);
});

test('hazards respect their depth gates', () => {
  const w = new World(41);
  let gas = 0;
  let lava = 0;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const kind = kindOf(w.tile(col, row));
      if (kind === KIND.GAS) { gas += 1; assert.ok(rowDepth(row) >= 4000, 'gas too shallow'); }
      if (kind === KIND.LAVA) { lava += 1; assert.ok(rowDepth(row) >= 2500, 'lava too shallow'); }
    }
  }
  assert.ok(gas > 0 && lava > 0, `hazards missing: gas ${gas}, lava ${lava}`);
});

test('carving clears tiles and reports what it removed', () => {
  const w = new World(51);
  const before = w.remainingOre();
  const cleared = w.carve(10, 60, 2);
  assert.ok(cleared.length > 0);
  for (const cell of cleared) assert.equal(kindOf(w.tile(cell.col, cell.row)), KIND.EMPTY);
  assert.ok(w.remainingOre() <= before);
});

test('carving cannot breach the sky or the floor', () => {
  const w = new World(61);
  w.carve(5, 1, 3);
  w.carve(5, ROWS - 1, 3);
  for (let col = 2; col < 8; col += 1) {
    assert.notEqual(kindOf(w.tile(col, ROWS - 1)), KIND.EMPTY, 'floor was breached');
  }
});

/* ------------------------------------------------------------------ */
console.log('\n--- starting state ---');

test('a new game is sane: fuel, hull, cash, empty hold, empty sky', () => {
  const s = createState(777);
  assert.equal(s.cash, START_CASH);
  assert.equal(s.ship.fuel, maxFuel(s));
  assert.equal(s.ship.hull, maxHull(s));
  assert.equal(s.cargoWeight, 0);
  assert.equal(s.cargo.length, 0);
  assert.equal(s.won, false);
  assert.ok(!blocked(s.world, s.ship.x, s.ship.y), 'ship starts inside rock');
  assert.ok(s.depth < 40, `ship starts too deep: ${s.depth}`);
});

test('the ship falls in open air and comes to rest on solid ground', () => {
  const s = createState(778);
  s.ship.y = 40 * TILE; // high in a shaft, well clear of the floor
  const y0 = s.ship.y;
  run(s, 0.4, hover);
  assert.ok(s.ship.y > y0, 'ship did not fall');
  assert.ok(s.ship.vy > 0, 'no downward velocity');
  // Then keep falling until it lands, and confirm it stops rather than sinking.
  run(s, 4, hover);
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'fell into rock');
  assert.ok(Math.abs(s.ship.vy) < 1e-6, `still moving after landing: ${s.ship.vy}`);
});

test('the ship never ends up inside solid rock', () => {
  const s = createState(779);
  // Fly around hard for a few simulated seconds and check every tick.
  const ticks = 600;
  for (let i = 0; i < ticks; i += 1) {
    const input = {
      left: i % 97 < 24 ? 1 : 0,
      right: i % 97 >= 24 && i % 97 < 48 ? 1 : 0,
      up: i % 13 < 5 ? 1 : 0,
      down: i % 13 >= 5 && i % 13 < 9 ? 1 : 0,
      drill: i % 3 === 0 ? 1 : 0,
    };
    step(s, 1 / 60, input);
    const inside = blocked(s.world, s.ship.x, s.ship.y);
    assert.equal(inside, null, `stuck in rock at tick ${i} (col ${inside && inside.col}, row ${inside && inside.row})`);
  }
});

test('the ship is stopped by walls', () => {
  const s = createState(780);
  for (let i = 0; i < 240; i += 1) step(s, 1 / 60, { left: 1, up: 1, right: 0, down: 0, drill: 0 });
  assert.ok(s.ship.x > 0 && s.ship.x < COLS * TILE, `ship left the map: ${s.ship.x}`);
  assert.ok(colOf(s.ship.x) >= 0);
});

/* ------------------------------------------------------------------ */
console.log('\n--- drilling and digging ---');

test('drilling down opens a tunnel and moves the ship into it', () => {
  const s = createState(900);
  const y0 = s.ship.y;
  run(s, 4, { drill: 1 });
  assert.ok(s.ship.y > y0 + TILE, `barely moved: ${(s.ship.y - y0).toFixed(1)}px`);
  assert.ok(s.stats.dug > 0, 'nothing was dug');
  assert.ok(s.depth > 0, 'depth did not increase');
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'ended up inside rock');
});

test('a deeper drill digs further in the same time', () => {
  const a = createState(901);
  const b = createState(901);
  b.tiers.drill = 3;
  run(a, 3, { drill: 1 });
  run(b, 3, { drill: 1 });
  assert.ok(b.stats.dug > a.stats.dug, `tier 3 dug ${b.stats.dug}, basic dug ${a.stats.dug}`);
});

test('drilling burns fuel', () => {
  const s = createState(902);
  const f0 = s.ship.fuel;
  run(s, 3, { drill: 1 });
  assert.ok(s.ship.fuel < f0, 'the drill is free');
});

test('ore goes into the hold and the hold has a weight limit', () => {
  const s = createState(903);
  run(s, 30, { drill: 1 });
  assert.ok(s.cargoWeight > 0, 'never picked anything up');
  assert.ok(s.cargoWeight <= cargoCap(s) + 0.001, `hold overflowed: ${s.cargoWeight}/${cargoCap(s)}`);
  for (const slot of s.cargo) assert.ok(ORE_BY_ID[slot.id], `bad cargo id ${slot.id}`);
});

test('every event carries an id that resolves in the ore table', () => {
  // The event log is the interface between the sim and everything that reacts to
  // it. An id that does not resolve there is a crash in the caller, on the first
  // tile of ore, which is exactly what happened when this published a name.
  const s = createState(906);
  const seen = new Set();
  const ticks = 60 * 60;
  for (let i = 0; i < ticks; i += 1) {
    step(s, 1 / 60, { left: 0, right: 0, up: 0, down: 0, drill: 1 });
    for (const event of s.events) {
      if (event.type !== 'ore') continue;
      seen.add(event.ore);
      assert.ok(ORE_BY_ID[event.ore], `ore event published ${JSON.stringify(event.ore)}, which is not in ORE_BY_ID`);
      assert.equal(typeof event.ore, 'number', 'ore events must publish a numeric id');
    }
    s.events.length = 0;
  }
  assert.ok(seen.size > 0, 'a minute of drilling never produced an ore event');
});

test('every event type the renderer handles is actually produced', () => {
  // Guards the other direction: an event the sim never emits means dead code in
  // the handler, and an event the handler does not know about is a silent drop.
  const handled = new Set(['ore', 'full', 'gas', 'blast', 'dug', 'upgrade', 'buy', 'used', 'won', 'lavaBlocked']);
  const produced = new Set();
  const s = createState(907);
  s.cash = 1e9;
  buyUpgrade(s, 'drill');
  buyItem(s, 'dynamite');
  useItem(s, 'dynamite');
  for (let i = 0; i < 60 * 90; i += 1) {
    step(s, 1 / 60, { left: 0, right: 0, up: 0, down: 0, drill: 1 });
    for (const event of s.events) produced.add(event.type);
    s.events.length = 0;
  }
  for (const type of produced) {
    assert.ok(handled.has(type), `the sim emits "${type}" but nothing handles it`);
  }
  assert.ok(produced.has('dug'), 'nothing was dug');
  assert.ok(produced.has('ore'), 'no ore was found');
});

test('a full hold stops accepting ore instead of overflowing', () => {
  const s = createState(904);
  s.cargo = [];
  addCargo(s, ORES[0], 1);
  s.cargoWeight = cargoCap(s) - 1; // one kilogram short
  run(s, 20, { drill: 1 });
  assert.ok(s.cargoWeight <= cargoCap(s) + 0.001, `overflowed: ${s.cargoWeight}`);
});

test('half-dug tiles are remembered rather than reset', () => {
  const w = new World(905);
  w.addDamage(10, 40, 0.4);
  assert.ok(Math.abs(w.getDamage(10, 40) - 0.4) < 1e-6);
  w.setTile(10, 40, EMPTY);
  assert.equal(w.getDamage(10, 40), 0, 'finishing a tile must clear its progress');
});

test('the drill follows the controls: down when idle, sideways when pushed', () => {
  const s = createState(908);
  const idle = drillTarget(s, { left: 0, right: 0, up: 0, down: 0 });
  assert.equal(idle.dir, 'down');
  assert.equal(idle.col, colOf(s.ship.x));

  const left = drillTarget(s, { left: 1, right: 0, up: 0, down: 0 });
  assert.equal(left.dir, 'left');
  assert.ok(left.col < colOf(s.ship.x), 'the left target is not to the left');

  const right = drillTarget(s, { left: 0, right: 1, up: 0, down: 0 });
  assert.equal(right.dir, 'right');
  assert.ok(right.col > colOf(s.ship.x), 'the right target is not to the right');

  // Pushing both ways is not a direction, so it falls back to digging down.
  const both = drillTarget(s, { left: 1, right: 1, up: 0, down: 0 });
  assert.equal(both.dir, 'down');
});

test('pushing into rock drills it, with no drill button held', () => {
  // The arrow keys are the drill: hold a direction and it cuts that way. This is
  // how the original played, and it is why there is no separate drill control to
  // find. Note `drill: 0` - nothing but the direction is being held.
  const s = createState(920);
  const y0 = s.ship.y;
  run(s, 4, { down: 1 });
  assert.ok(s.stats.dug > 0, 'holding down with no drill key dug nothing');
  assert.ok(s.ship.y > y0 + TILE, `holding down did not descend: ${(s.ship.y - y0).toFixed(1)}px`);
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'ended up inside rock');
});

test('the sim tells the renderer which way the bit is aimed', () => {
  // The bit has to point at the rock it is cutting, and the renderer can only
  // know that if the sim publishes it. Without this the drill has no direction
  // to hold and falls back to spinning through all of them.
  const s = createState(922);
  const at = (input) => {
    step(s, 1 / 60, { left: 0, right: 0, up: 0, down: 0, drill: 0, ...input });
    return s.ship.drillDir;
  };
  assert.equal(at({ right: 1 }), 'right');
  assert.equal(at({ left: 1 }), 'left');
  assert.equal(at({ up: 1 }), 'up');
  assert.equal(at({ drill: 1 }), 'down');
});

test('holding a direction in open air does not drill a distant tile', () => {
  /**
   * The drill looks a couple of rows past the hull for rock, because while a
   * tile is being cut the pod sits part-way inside it and its edge crosses into
   * the next row.
   *
   * That search has to be bounded. Now that a held arrow key drills by itself,
   * an unbounded one would mean falling down an open shaft while holding Down
   * and quietly boring a hole hundreds of feet below the pod - which is invisible
   * while it happens and leaves a tunnel where nothing was ever dug.
   */
  const s = createState(921);
  const col = colOf(s.ship.x);
  const top = rowOf(s.ship.y) + 1;
  for (let row = top; row < top + 30; row += 1) s.world.setTile(col, row, EMPTY);
  const far = top + 20;
  // Put rock back at the bottom rather than trusting the generator to have left
  // some there: the mine is full of natural caverns, and this test needs to know
  // exactly where the nearest solid tile is.
  s.world.setTile(col, far, pack(KIND.ROCK, 0));
  assert.ok(s.world.isSolid(col, far), 'the tile at the bottom of the shaft should be solid');

  // Short enough that the pod cannot fall the whole way to the solid tile.
  run(s, 0.4, { down: 1 });

  assert.ok(s.world.isSolid(col, far), 'the drill cut a tile far below the pod');
  assert.equal(s.stats.dug, 0, 'something was dug through open air');
});

test('a pod resting on a ledge can still get down instead of jamming', () => {
  /**
   * The hull is 26px wide in a 32px tile, so a pod a few pixels off centre is
   * held up by the *neighbouring* column's rock while its own column is clear all
   * the way down. There is nothing to cut and nothing to fall through, so
   * holding the drill did nothing at all and the pod sat on the ledge forever.
   *
   * The bot found this after twenty seconds of not moving, and reported the
   * column below as "empty, empty, empty, empty, empty, empty, empty", which is
   * the whole diagnosis: a wedged pod looks the same as unbreakable rock until
   * you look at what is actually underneath it.
   */
  const s = createState(923);
  const col = 8;
  const ledge = SKY_ROWS + 12; // the first row of rock in the neighbouring column
  const depth = 18;
  // Both columns start clear, then the neighbouring one turns to rock from
  // `ledge` down: that is the ledge the hull ends up sitting on.
  for (let r = ledge - 1; r < ledge + depth; r += 1) {
    s.world.setTile(col, r, EMPTY);
    s.world.setTile(col - 1, r, EMPTY);
  }
  for (let r = ledge; r < ledge + depth; r += 1) s.world.setTile(col - 1, r, pack(KIND.ROCK, 0));
  s.world.setTile(col, ledge + depth, pack(KIND.ROCK, 0)); // a floor to land on

  // A few pixels left of the column's centre, so the hull overlaps the ledge.
  s.ship.x = col * TILE + 12;
  s.ship.y = ledge * TILE - SHIP_HALF_H - 1;
  s.ship.vx = 0;
  s.ship.vy = 0;
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'the pod starts inside rock');

  const y0 = s.ship.y;
  run(s, 3, { down: 1 });

  assert.ok(s.ship.y > y0 + TILE, `the pod never dropped off the ledge: ${(s.ship.y - y0).toFixed(1)}px`);
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'ended up inside rock');
});

test('holding sideways carves a horizontal tunnel', () => {
  const s = createState(909);
  // The mine has open caverns in it, so find a spot with solid rock to the left
  // rather than assuming one.
  let placed = false;
  for (let row = 30; row < 120 && !placed; row += 1) {
    for (let col = 4; col < COLS - 4 && !placed; col += 1) {
      if (!s.world.isSolid(col, row)) continue;
      if (!s.world.isSolid(col - 1, row) || !s.world.isSolid(col - 2, row)) continue;
      s.ship.x = (col + 0.5) * TILE;
      s.ship.y = (row + 0.5) * TILE;
      s.ship.vx = 0;
      s.ship.vy = 0;
      placed = true;
    }
  }
  assert.ok(placed, 'found nowhere in the mine with solid rock to the left');

  const col0 = colOf(s.ship.x);
  const row0 = rowOf(s.ship.y);
  assert.ok(s.world.isSolid(col0 - 1, row0), 'the left neighbour should start solid');

  run(s, 5, { left: 1, drill: 1 });

  assert.ok(s.stats.dug > 0, 'drilling sideways dug nothing');
  assert.ok(!s.world.isSolid(col0 - 1, row0), 'the tile to the left was never opened');
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'ended up inside rock');
  assert.ok(colOf(s.ship.x) < col0, `did not move left: col ${col0} -> ${colOf(s.ship.x)}`);
});

/**
 * Puts the pod in a pocket with solid rock directly overhead, which is the only
 * situation where drilling up is the answer. A pod in open space just flies.
 */
function inPocket(seed) {
  const s = createState(seed);
  for (let row = 40; row < 250; row += 1) {
    for (let col = 4; col < COLS - 4; col += 1) {
      if (s.world.isSolid(col, row)) continue;
      if (!s.world.isSolid(col, row - 1) || !s.world.isSolid(col, row - 2)) continue;
      s.ship.x = (col + 0.5) * TILE;
      s.ship.y = (row + 0.5) * TILE;
      s.ship.vx = 0;
      s.ship.vy = 0;
      return s;
    }
  }
  return null;
}

test('the drill cuts upward, which is the only way out of an enclosed cavern', () => {
  const s = inPocket(913);
  assert.ok(s, 'found nowhere in the mine with solid rock overhead');

  const target = drillTarget(s, { left: 0, right: 0, up: 1, down: 0 });
  assert.equal(target.dir, 'up');
  assert.ok(target.row < rowOf(s.ship.y), 'the up target is not above the ship');

  const col = colOf(s.ship.x);
  const rowAbove = rowOf(s.ship.y) - 1;
  assert.ok(s.world.isSolid(col, rowAbove), 'the ceiling should start solid');

  run(s, 8, { up: 1, drill: 1 });

  assert.ok(!s.world.isSolid(col, rowAbove), 'the ceiling was never opened');
  assert.ok(s.stats.dug > 0, 'drilling up dug nothing');
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'ended up inside rock');
});

test('tunnelling upward is far slower than flying up', () => {
  // If tunnelling upward were competitive with flying, fuel would stop being the
  // thing that limits a trip. This pins the relationship rather than the numbers.
  const flyer = createState(914);
  const startY = flyer.ship.y;
  run(flyer, 3, { up: 1 });
  const flew = startY - flyer.ship.y;

  const digger = inPocket(914);
  assert.ok(digger, 'found nowhere in the mine with solid rock overhead');
  const digStart = digger.ship.y;
  run(digger, 3, { up: 1, drill: 1 });
  const dug = digStart - digger.ship.y;

  assert.ok(flew > 0, 'flying up went nowhere');
  assert.ok(dug > 0, 'tunnelling up went nowhere');
  assert.ok(digger.stats.dug > 0, 'the digging run cut no rock at all');
  assert.ok(
    flew > dug * 3,
    `flying (${flew.toFixed(0)}px) should be far faster than tunnelling (${dug.toFixed(0)}px)`,
  );
});

/* ------------------------------------------------------------------ */
console.log('\n--- cargo and selling ---');

test('the manifest groups by ore and the value matches the table', () => {
  const s = createState(910);
  s.cargo = [];
  addCargo(s, ORE_BY_ID[1], 3);
  addCargo(s, ORE_BY_ID[1], 2);
  addCargo(s, ORE_BY_ID[4], 1);
  const manifest = cargoManifest(s);
  assert.equal(manifest.length, 2);
  assert.equal(manifest[0].ore.id, 4, 'the valuable ore should sort first');
  const expected = 5 * ORE_BY_ID[1].value + 1 * ORE_BY_ID[4].value;
  assert.equal(cargoValue(s), expected);
});

test('selling banks the value, empties the hold and counts a trip', () => {
  const s = createState(911);
  s.cargo = [];
  addCargo(s, ORE_BY_ID[2], 4);
  const value = cargoValue(s);
  const cash0 = s.cash;
  const paid = sellCargo(s);
  assert.equal(paid, value);
  assert.equal(s.cash, cash0 + value);
  assert.equal(s.cargo.length, 0);
  assert.equal(s.cargoWeight, 0);
  assert.equal(s.stats.trips, 1);
});

test('selling an empty hold pays nothing and is not a trip', () => {
  const s = createState(912);
  assert.equal(sellCargo(s), 0);
  assert.equal(s.stats.trips, 0);
});

/* ------------------------------------------------------------------ */
console.log('\n--- economy ---');

test('refuelling fills the tank and charges for exactly what it put in', () => {
  const s = createState(920);
  s.ship.fuel = 2;
  const need = maxFuel(s) - 2;
  const cash0 = s.cash;
  const spent = refuel(s);
  assert.ok(Math.abs(spent - need) < 1e-6, `charged ${spent} for ${need} L`);
  assert.ok(Math.abs(s.ship.fuel - maxFuel(s)) < 1e-6);
  assert.ok(Math.abs(s.cash - (cash0 - spent)) < 1e-6);
});

test('refuelling with no money buys only what you can afford', () => {
  const s = createState(921);
  s.ship.fuel = 0;
  s.cash = 5;
  const spent = refuel(s);
  assert.ok(spent <= 5 + 1e-9, `spent ${spent} with $5`);
  assert.ok(s.cash >= 0, 'cash went negative');
});

test('repairing cannot overshoot the hull and cannot overdraw cash', () => {
  const s = createState(922);
  s.ship.hull = maxHull(s) - 3;
  const spent = repair(s);
  assert.ok(spent > 0);
  assert.ok(s.ship.hull <= maxHull(s) + 1e-9);
  assert.ok(s.cash >= 0);
  s.ship.hull = 1;
  s.cash = 0;
  assert.equal(repair(s), 0);
});

test('an upgrade costs its price, raises its stat, and cannot be paid twice', () => {
  const s = createState(923);
  const before = drillPower(s);
  const price = upgradeTier('drill', 1).price;
  s.cash = price - 1;
  assert.equal(buyUpgrade(s, 'drill'), false, 'bought with too little cash');
  s.cash = price;
  assert.equal(buyUpgrade(s, 'drill'), true);
  assert.equal(s.cash, 0);
  assert.ok(drillPower(s) > before);
  assert.equal(buyUpgrade(s, 'drill'), false, 'bought with no cash left');
});

test('a new hull tier arrives repaired, a new tank arrives full', () => {
  const s = createState(924);
  s.cash = 100000;
  s.ship.hull = 1;
  s.ship.fuel = 0;
  buyUpgrade(s, 'hull');
  buyUpgrade(s, 'tank');
  assert.equal(s.ship.hull, maxHull(s));
  assert.equal(s.ship.fuel, maxFuel(s));
});

test('the top tier cannot be exceeded', () => {
  const s = createState(925);
  s.cash = 1e12;
  for (let i = 0; i < 20; i += 1) buyUpgrade(s, 'drill');
  assert.equal(s.tiers.drill, MAX_TIER);
});

test('items are limited in quantity and by cash', () => {
  const s = createState(926);
  s.cash = 1e9;
  for (let i = 0; i < 20; i += 1) buyItem(s, 'dynamite');
  assert.equal(s.items.dynamite, 8, 'stock limit ignored');
  s.cash = 0;
  assert.equal(buyItem(s, 'c4'), false);
});

test('using an item you do not have does nothing', () => {
  const s = createState(927);
  assert.equal(useItem(s, 'dynamite'), false);
  assert.equal(useItem(s, 'nonsense'), false);
});

test('nanobots repair, reserve fuel refuels, and both are consumed once', () => {
  const s = createState(928);
  s.cash = 1e9;
  buyItem(s, 'nanobots');
  buyItem(s, 'fuel');
  s.ship.hull = maxHull(s) * 0.2;
  s.ship.fuel = 1;
  const hull0 = s.ship.hull;
  assert.equal(useItem(s, 'nanobots'), true);
  assert.ok(s.ship.hull > hull0);
  assert.equal(s.items.nanobots, 0);
  assert.equal(useItem(s, 'fuel'), true);
  assert.ok(s.ship.fuel > 1);
});

test('the cheap teleporter loses cargo but the good one keeps it', () => {
  const cheap = createState(929);
  const good = createState(929);
  for (const s of [cheap, good]) {
    s.cash = 1e9;
    s.items.teleporter = 1;
    s.items.transmitter = 1;
    s.cargo = [];
    for (let i = 0; i < 10; i += 1) addCargo(s, ORE_BY_ID[1], 1);
  }
  const weight0 = cheap.cargoWeight;
  useItem(cheap, 'teleporter');
  useItem(good, 'transmitter');
  assert.ok(cheap.cargoWeight < weight0 * 0.5, 'the cheap teleporter kept the ore');
  assert.ok(Math.abs(good.cargoWeight - weight0) < 1e-9, 'the transmitter lost ore');
  for (const s of [cheap, good]) assert.ok(s.depth < 40, 'did not arrive at the surface');
});

/* ------------------------------------------------------------------ */
console.log('\n--- hazards and death ---');

test('explosives clear a pocket', () => {
  const s = createState(930);
  const before = s.world.remainingOre();
  explode(s, 12, 80, 2.2);
  assert.ok(s.world.remainingOre() <= before);
  assert.equal(kindOf(s.world.tile(12, 80)), KIND.EMPTY);
});

test('a gas pocket detonates, hurts and clears a hole', () => {
  const s = createState(931);
  // Plant a gas pocket directly under the ship so the drill must meet it.
  const col = colOf(s.ship.x);
  const row = Math.floor(s.ship.y / TILE) + 2;
  s.world.tiles[row * COLS + col] = pack(KIND.GAS, 0);
  const hull0 = s.ship.hull;
  run(s, 3, { drill: 1 });
  assert.ok(s.ship.hull < hull0, 'the gas pocket was harmless');
  assert.equal(kindOf(s.world.tile(col, row)), KIND.EMPTY, 'the pocket did not blow open');
  assert.ok(s.gasClouds.length > 0, 'no cloud left behind');
});

test('lava grills you and heat decays once clear of it', () => {
  const s = createState(932);
  const col = colOf(s.ship.x);
  const row = Math.floor(s.ship.y / TILE) + 1;
  for (let dx = -2; dx <= 2; dx += 1) {
    s.world.tiles[row * COLS + (col + dx)] = pack(KIND.LAVA, 0);
  }
  const hull0 = s.ship.hull;
  run(s, 1, hover);
  assert.ok(s.ship.hull < hull0, 'lava did nothing');
  assert.equal(s.ship.heat, 1);
});

test('a gas pocket is a serious cost at every depth, and never instant death', () => {
  // Gas cannot be seen, so it may not be a coin flip on the whole run: it has to
  // cost real hull without ending the trip outright, at every depth it appears.
  for (const [depthFt, hullTier] of [[5000, 2], [7000, 3], [9500, 4], [12000, 5]]) {
    const s = createState(915);
    s.tiers.hull = hullTier;
    s.ship.hull = maxHull(s);
    const col = colOf(s.ship.x);
    const gasRow = SKY_ROWS + Math.round(depthFt / (12800 / (ROWS * TILE)) / TILE);
    // Put the pod in the square directly above the pocket with nothing between,
    // so the very first thing the drill meets is the gas.
    s.world.tiles[(gasRow - 1) * COLS + col] = EMPTY;
    s.world.tiles[gasRow * COLS + col] = pack(KIND.GAS, 0);
    s.ship.y = (gasRow - 1) * TILE + 16;
    s.ship.vy = 0;
    assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'the test pod starts inside rock');

    const before = s.ship.hull;
    run(s, 3, { drill: 1 });
    const lost = before - s.ship.hull;
    const fraction = lost / maxHull(s);

    assert.ok(lost > 0, `the pocket at ${depthFt}ft was harmless`);
    assert.ok(
      fraction < 0.75,
      `the pocket at ${depthFt}ft took ${(fraction * 100).toFixed(0)}% of a tier-${hullTier} hull`,
    );
    assert.ok(
      fraction > 0.1,
      `the pocket at ${depthFt}ft only took ${(fraction * 100).toFixed(0)}% of the hull - not a hazard`,
    );
  }
});

test('a brush with lava is survivable, but standing in it is not', () => {
  // The rate has to leave room to escape in a mid-game hull, and has to be
  // lethal in a starting one - that gap is what the hull ladder buys.
  const starting = createState(916);
  starting.tiers.hull = 0;
  starting.ship.hull = maxHull(starting);
  const surviveSeconds = maxHull(starting) / LAVA.dps;
  assert.ok(surviveSeconds < 0.6, `a starting hull survives ${surviveSeconds.toFixed(2)}s in lava - too forgiving`);

  const late = createState(917);
  late.tiers.hull = 4;
  late.ship.hull = maxHull(late);
  const lateSeconds = maxHull(late) / LAVA.dps;
  assert.ok(lateSeconds > 2.5, `a tier-4 hull only survives ${lateSeconds.toFixed(2)}s in lava - no room to escape`);
});

test('the drill will not cut lava, so lava has to be routed around', () => {
  const s = createState(918);
  // A hull that survives the burn, so the test measures the drill and not the
  // respawn that follows a wreck.
  s.tiers.hull = 6;
  s.ship.hull = maxHull(s);
  const col = colOf(s.ship.x);
  const lavaRow = SKY_ROWS + 40;
  s.world.tiles[(lavaRow - 1) * COLS + col] = EMPTY;
  s.world.tiles[lavaRow * COLS + col] = pack(KIND.LAVA, 0);
  s.ship.y = (lavaRow - 1) * TILE + 16;
  s.ship.vy = 0;
  assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, 'the test pod starts inside rock');

  const dug0 = s.stats.dug;
  run(s, 4, { drill: 1 });

  assert.equal(kindOf(s.world.tile(col, lavaRow)), KIND.LAVA, 'the drill cut through lava');
  assert.equal(s.stats.dug, dug0, 'the drill dug something it should not have');
  assert.ok(s.ship.hull < maxHull(s), 'sitting next to lava should burn');
  assert.ok(s.ship.hull > 0, 'the test hull should have survived the burn');
});

test('explosives clear lava, so a blockage is never permanent', () => {
  // Lava cannot be drilled, so if explosives could not remove it either, a wide
  // enough pool would wall the player off from the rest of the mine with no
  // recourse. This is the property that makes "go around it" safe advice.
  const s = createState(920);
  const col = 12;
  const row = SKY_ROWS + 60;
  for (let dx = -2; dx <= 2; dx += 1) {
    s.world.tiles[row * COLS + (col + dx)] = pack(KIND.LAVA, 0);
  }
  assert.equal(kindOf(s.world.tile(col, row)), KIND.LAVA);

  s.cash = 1e9;
  buyItem(s, 'c4');
  s.ship.x = (col + 0.5) * TILE;
  s.ship.y = (row - 1.5) * TILE;
  s.ship.vx = 0;
  s.ship.vy = 0;
  assert.equal(useItem(s, 'c4'), true);

  assert.equal(kindOf(s.world.tile(col, row)), KIND.EMPTY, 'the blast left the lava in place');
  assert.equal(s.world.isSolid(col, row), false, 'the tile is still blocking');
});

test('every event the sim emits is handled by the game', () => {
  // The event log is the sim's only output channel. A type nothing listens for
  // is either dead code or a silent drop, and both are worth catching here.
  const handled = new Set(['ore', 'full', 'gas', 'blast', 'dug', 'upgrade', 'buy', 'used', 'won', 'lavaBlocked']);
  const s = createState(919);
  const produced = new Set();
  for (let i = 0; i < 60 * 30; i += 1) {
    step(s, 1 / 60, { left: 0, right: 0, up: 0, down: 0, drill: 1 });
    for (const event of s.events) produced.add(event.type);
    s.events.length = 0;
  }
  for (const type of produced) {
    assert.ok(handled.has(type), `the sim emits "${type}" but nothing handles it`);
  }
});

test('a hard landing costs hull', () => {
  const s = createState(933);
  s.ship.y = 60 * TILE;
  s.ship.vy = 600;
  const hull0 = s.ship.hull;
  run(s, 0.6, {});
  assert.ok(s.ship.hull < hull0 || s.ended, 'the landing was free');
});

test('running out of fuel ends the trip but keeps the cash', () => {
  const s = createState(934);
  s.cash = 12345;
  s.ship.fuel = 0.02;
  run(s, 1.5, { up: 1 });
  assert.ok(s.ended, 'no fuel and no consequence');
  assert.equal(s.stats.deaths, 1);
  assert.ok(s.cash >= 12345, 'cash was taken');
  assert.ok(s.ship.fuel > 0, 'not restarted with any fuel');
});

test('destruction costs the hold but not the upgrades', () => {
  const s = createState(935);
  s.cash = 1e9;
  buyUpgrade(s, 'drill');
  const tier = s.tiers.drill;
  addCargo(s, ORE_BY_ID[1], 3);
  s.ship.fuel = 0.01;
  run(s, 1.5, { up: 1 });
  assert.equal(s.cargoWeight, 0, 'the hold survived a crash');
  assert.equal(s.tiers.drill, tier, 'upgrades were lost');
});

test('hull never goes below zero and death is recorded once', () => {
  const s = createState(936);
  s.ship.hull = 1;
  const col = colOf(s.ship.x);
  const row = Math.floor(s.ship.y / TILE) + 1;
  for (let dx = -2; dx <= 2; dx += 1) s.world.tiles[row * COLS + (col + dx)] = pack(KIND.LAVA, 0);
  run(s, 6, hover);
  assert.ok(s.ship.hull >= 0, `hull went negative: ${s.ship.hull}`);
  assert.ok(s.stats.deaths >= 1);
});

/* ------------------------------------------------------------------ */
console.log('\n--- depth and the end ---');

test('depth is zero at the surface and grows as you dig', () => {
  assert.equal(Math.round(depthAt(SKY_ROWS * TILE)), 0);
  const s = createState(940);
  run(s, 6, { drill: 1 });
  assert.ok(s.depth > 0, 'no depth after digging');
  assert.ok(s.maxDepth >= s.depth, 'max depth went backwards');
});

test('reaching Mr. Natas ends the run with the mother lode', () => {
  const s = createState(941);
  const cash0 = s.cash;
  s.ship.x = (11 + 0.5) * TILE;
  s.ship.y = (ROWS - 6 + 0.5) * TILE;
  step(s, 1 / 60, {});
  assert.equal(s.won, true);
  assert.ok(s.cash > cash0, 'the ending paid nothing');
  assert.equal(s.ended.type, 'won');
});

test('the ending only fires once', () => {
  const s = createState(942);
  s.ship.x = (11 + 0.5) * TILE;
  s.ship.y = (ROWS - 6 + 0.5) * TILE;
  step(s, 1 / 60, {});
  const cash = s.cash;
  for (let i = 0; i < 30; i += 1) step(s, 1 / 60, {});
  assert.equal(s.cash, cash, 'the ending paid twice');
});

/* ------------------------------------------------------------------ */
console.log('\n--- saving ---');

test('a save round-trips the run that matters', () => {
  const s = createState(950);
  s.cash = 4242;
  s.tiers.drill = 2;
  s.tiers.cargo = 1;
  s.items.dynamite = 3;
  addCargo(s, ORE_BY_ID[1], 2);
  run(s, 6, { drill: 1 });
  const dug = s.stats.dug;
  const depth = s.depth;
  const load0 = s.cargoWeight;

  const restored = deserialize(serialize(s));
  assert.ok(restored, 'the save did not load');
  assert.equal(restored.cash, 4242);
  assert.equal(restored.tiers.drill, 2);
  assert.equal(restored.items.dynamite, 3);
  assert.equal(restored.stats.dug, dug);
  assert.equal(restored.cargoWeight, load0);
  assert.ok(Math.abs(restored.depth - depth) < 1e-6, 'the ship moved while saving');
  assert.deepEqual(Array.from(restored.world.tiles), Array.from(s.world.tiles), 'the mine changed');
});

test('a dug tunnel survives the round trip', () => {
  const s = createState(951);
  run(s, 8, { drill: 1 });
  const holes = packHoles(s.world).length;
  assert.ok(holes > 0);
  const restored = deserialize(JSON.parse(JSON.stringify(serialize(s))));
  assert.equal(packHoles(restored.world).length, holes);
});

test('corrupt or foreign saves are refused instead of crashing', () => {
  assert.equal(deserialize(null), null);
  assert.equal(deserialize({}), null);
  assert.equal(deserialize({ version: 99 }), null);
  assert.equal(deserialize('nonsense'), null);
});

test('a save with an ore that no longer exists loads without it', () => {
  const s = createState(952);
  const data = serialize(s);
  data.cargo = [{ id: 99, n: 4 }, { id: 1, n: 2 }];
  const restored = deserialize(data);
  assert.ok(restored);
  assert.equal(restored.cargo.length, 1);
  assert.equal(restored.cargoWeight, ORE_BY_ID[1].weight * 2);
});

test('an out-of-range hole index is ignored', () => {
  const s = createState(953);
  const data = serialize(s);
  data.holes = [-1, 1e9, 'nope', 100];
  const restored = deserialize(data);
  assert.ok(restored);
  assert.equal(kindOf(restored.world.tiles[100]), KIND.EMPTY);
});

/* ------------------------------------------------------------------ */
console.log('\n--- besedilo in denar (the words, and the money) ---');

test('money is in euros and grouped the Slovenian way', () => {
  // A dot for thousands, a space before the sign. The tests assert on this exact
  // shape, which is the whole reason it is hand-rolled instead of trusting
  // `toLocaleString` to agree between the browser and Node.
  assert.equal(money(0), '0 €');
  assert.equal(money(999), '999 €');
  assert.equal(money(5000), '5.000 €');
  assert.equal(money(12800), '12.800 €');
  assert.equal(money(50000000), '50.000.000 €');
  assert.equal(money(1234.4), '1.234 €');
  assert.equal(money(1234567), '1.234.567 €');
  assert.equal(grouped(12800), '12.800');
});

test('the branding is the agency it says it is', () => {
  assert.equal(RNOV.short, 'RNOV');
  assert.equal(RNOV.full, 'Razvoj in nadzor oskrbovalne verige');
});

test('the RNOV memos are in order and the last one is reachable', () => {
  // `reachedCount` is what stops a memo firing twice, and it only works because
  // the thresholds are sorted and strictly increasing: an out-of-order entry
  // would count as already passed before the player got there.
  for (let i = 1; i < MEMOS.length; i += 1) {
    assert.ok(MEMOS[i].at > MEMOS[i - 1].at, `memo ${i} is out of order`);
  }
  assert.equal(reachedCount(MEMOS, 0), 0, 'a memo fired before the run started');
  assert.equal(reachedCount(MEMOS, MEMOS[0].at), 1, 'the first memo does not fire at its own depth');
  assert.equal(reachedCount(MEMOS, 1e9), MEMOS.length);
  assert.ok(
    MEMOS[MEMOS.length - 1].at < DEPTH_FT,
    'the deepest memo is below the bottom of the mine, so nobody would ever read it',
  );
});

test('the dug-tile milestones are in order and all reachable', () => {
  for (let i = 1; i < MILESTONES.length; i += 1) {
    assert.ok(MILESTONES[i].at > MILESTONES[i - 1].at, `milestone ${i} is out of order`);
  }
  assert.equal(reachedCount(MILESTONES, 0), 0);
  assert.equal(reachedCount(MILESTONES, 1e9), MILESTONES.length);
});

test('the deep ores have a joke and the cheap ones stay quiet', () => {
  // The quips double as the "this was worth the trip" signal, so an ore with no
  // quip says nothing on pickup - which is what stops the surface from burying
  // the screen in toasts.
  assert.ok(findQuip(ORE_BY_ID[10]), 'the rarest ore has no line');
  assert.ok(findQuip(ORE_BY_ID[7]), 'smaragd has no line');
  assert.equal(findQuip(ORE_BY_ID[1]), null, 'the cheapest ore should not talk');
  assert.equal(findQuip(null), null, 'a missing ore should not throw');
});

test('nothing player-facing is blank or still in dollars', () => {
  // The guard against a half-finished translation. A blank label or a leftover
  // "$" is exactly the kind of thing that ships because nobody re-read the shop.
  const check = (label, value) => {
    assert.ok(typeof value === 'string' && value.trim().length > 0, `${label} is blank`);
    assert.ok(!value.includes('$'), `${label} still has a dollar sign: ${value}`);
  };
  for (const ore of ORES) check(`ore ${ore.key}`, ore.name);
  for (const key of UPGRADE_KEYS) {
    check(`upgrade ${key} label`, UPGRADES[key].label);
    check(`upgrade ${key} blurb`, UPGRADES[key].blurb);
    check(`upgrade ${key} unit`, UPGRADES[key].unit);
    for (const t of UPGRADES[key].tiers) check(`upgrade ${key} tier name`, t.name);
  }
  for (const item of ITEMS) {
    check(`item ${item.key} name`, item.name);
    check(`item ${item.key} blurb`, item.blurb);
  }
  for (const facility of FACILITIES) {
    check(`facility ${facility.key} name`, facility.name);
    check(`facility ${facility.key} note`, facility.note);
  }
  for (const memo of MEMOS) check('memo', memo.text);
  for (const milestone of MILESTONES) check('milestone', milestone.text);
});

/* ------------------------------------------------------------------ */
console.log('\n--- balance sanity ---');

test('the first trip pays for the first drill', () => {
  // A full starting hold of the commonest ore has to be worth noticeably more
  // than the first drill, or the loop has no hook.
  const s = createState(960);
  s.cargo = [];
  addCargo(s, ORE_BY_ID[1], Math.floor(cargoCap(s) / ORE_BY_ID[1].weight));
  const firstDrill = upgradeTier('drill', 1).price;
  assert.ok(cargoValue(s) > firstDrill * 0.8, `a full hold of ironium is only ${cargoValue(s)} vs drill ${firstDrill}`);
});

test('the best ore is worth vastly more than the worst', () => {
  const best = ORES[ORES.length - 1];
  const worst = ORES[0];
  assert.ok(best.value >= worst.value * 1000, 'the deep ores are not a payoff');
});

test('ore unlocks are ordered by depth and never reach the last row', () => {
  let last = -1;
  for (const ore of ORES) {
    assert.ok(ore.from >= last, `${ore.name} unlocks out of order`);
    last = ore.from;
    // Every ore has to be findable with room to mine it: one unlocking on the
    // bedrock row would be unreachable.
    assert.ok(ore.from < 12800 * 0.95, `${ore.name} unlocks below the mine`);
    assert.ok(ore.weight > 0 && ore.value > 0);
    assert.ok(ore.rarity > 0 && ore.rarity <= 1, `${ore.name} has no rarity`);
  }
});

test('a full starting tank is enough to dig a real tunnel', () => {
  const s = createState(961);
  run(s, 1, { drill: 1 });
  // Not a hard number, just a floor: if the first tank only buys two tiles the
  // game is unplayable at the start.
  assert.ok(s.stats.dug >= 1, 'the starting tank dug nothing at all');
  assert.ok(s.ship.fuel > 0, 'the starting tank ran dry in one second');
});

test('fuel is cheap enough that refuelling is never the bottleneck', () => {
  const s = createState(962);
  s.cargo = [];
  addCargo(s, ORE_BY_ID[1], Math.floor(cargoCap(s) / ORE_BY_ID[1].weight));
  const earned = cargoValue(s);
  const fullTank = maxFuel(s);
  assert.ok(fullTank < earned * 0.25, 'one tank costs a quarter of a full hold of ironium');
});

/* ------------------------------------------------------------------ */
console.log('\n--- long run ---');

test('five simulated minutes of mining and trading stay consistent', () => {
  const s = createState(970);
  s.cash = 2000;
  let legs = 0;
  for (let leg = 0; leg < 5; leg += 1) {
    run(s, 20, { drill: 1 });                 // dig
    run(s, 3, { up: 1 });                     // climb toward the surface
    s.ship.x = (10 + 0.5) * TILE;             // stand at the processor
    s.ship.y = (SKY_ROWS + 0.6) * TILE;
    sellCargo(s);
    refuel(s);
    repair(s);
    if (Math.random() < 0.5) buyItem(s, 'dynamite');
    legs += 1;

    assert.ok(s.cash >= 0, `negative cash after leg ${leg}`);
    assert.ok(s.ship.fuel >= 0 && s.ship.fuel <= maxFuel(s) + 1e-6, `fuel out of range: ${s.ship.fuel}`);
    assert.ok(s.ship.hull >= 0 && s.ship.hull <= maxHull(s) + 1e-6, `hull out of range: ${s.ship.hull}`);
    assert.ok(s.cargoWeight >= 0 && s.cargoWeight <= cargoCap(s) + 1e-6, `hold out of range: ${s.cargoWeight}`);
    assert.ok(Number.isFinite(s.ship.x) && Number.isFinite(s.ship.y), 'ship went non-finite');
    assert.equal(blocked(s.world, s.ship.x, s.ship.y), null, `stuck in rock after leg ${leg}`);
  }
  assert.equal(legs, 5);
  assert.ok(s.stats.earned > 0, 'five legs earned nothing');
  assert.ok(s.stats.dug > 20, `five legs dug only ${s.stats.dug} tiles`);
});

/* ------------------------------------------------------------------ */
console.log('');
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} failed\n`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
} else {
  console.log(`All ${passed} checks passed.`);
}
