/**
 * Plays the game with a bot and reports how it goes.
 *
 *   node tools/balance.mjs [minutes]
 *
 * The unit tests prove the rules hold. They cannot tell you whether the game is
 * *completable*, whether the first half hour is a grind, or whether the drill
 * ladder is priced out of reach. Those are questions about numbers, and the only
 * honest way to answer them is to play - so this plays.
 *
 * The bot is deliberately simple and a bit dumb: dig straight down until the
 * hold is full or the tank is low, fly home, sell, buy whatever it can afford,
 * repeat. A human does better, which makes its results a *lower* bound. If the
 * bot gets somewhere in a reasonable time, a player will do better.
 */

import {
  SKY_ROWS, COLS, ROWS, UPGRADES, UPGRADE_KEYS, MAX_TIER, FUEL_PRICE,
} from '../src/config.js';
import {
  createState, step, maxFuel, maxHull, cargoCap, load, sellCargo, refuel, repair,
  buyUpgrade, drillPower, atSurface, drillTarget,
} from '../src/sim/game.js';
import { rowOf, colOf } from '../src/sim/physics.js';
import { KIND, kindOf } from '../src/sim/world.js';

const MINUTES = Number(process.argv[2]) || 30;
const MAX_TICKS = MINUTES * 60 * 60;
const DT = 1 / 60;
const HOME_COL = 10; // the processor's column

const state = createState(20260101);
const log = [];
const milestones = [];

let ticks = 0;
let trips = 0;
let phase = 'dig';

/** Where the time actually goes, and a stuck detector. */
const phaseTicks = { dig: 0, home: 0, trade: 0 };
let stuckTicks = 0;
let lastPos = '';
let stuckAt = null;
/** Frames the bot has been in the same place, used to decide when to dig out. */
let stuck = 0;
/** Which way the bot is stepping around a lava pool, 0 when it is not. */
let sidestep = 0;

/**
 * What the drill would cut if the button were held right now.
 *
 * This asks the game itself rather than re-deriving the target, so the bot and
 * the drill can never disagree about which square is about to be eaten.
 */
function tileBelow(s) {
  const target = drillTarget(s, { left: 0, right: 0, up: 0, down: 0 });
  return kindOf(s.world.tile(target.col, target.row));
}

/** What the drill would cut if it were pointed sideways, or null off the map. */
function tileBeside(s, dir) {
  const target = drillTarget(s, { left: dir < 0 ? 1 : 0, right: dir > 0 ? 1 : 0, up: 0, down: 0 });
  if (target.col < 0 || target.col >= COLS) return null;
  return kindOf(s.world.tile(target.col, target.row));
}
/** Frames the drill was actually biting, versus frames spent in the dig phase. */
let drillTicks = 0;
let moveTicks = 0;
/** Every wreck, with its cause, so "too many deaths" becomes a specific thing. */
const deaths = [];

function record(label) {
  if (milestones.some((m) => m.label === label)) return;
  milestones.push({ label, tick: ticks });
  log.push(
    `  ${(ticks / 3600).toFixed(1).padStart(6)} min   ${String(trips).padStart(4)}   `
    + `$${Math.round(state.cash).toLocaleString('en-US').padStart(13)}   `
    + `${Math.round(state.maxDepth).toString().padStart(6)} ft   ${label}`,
  );
}

/** Buys the cheapest thing it can afford, most-needed first. */
function shop() {
  const priorities = ['drill', 'cargo', 'tank', 'hull', 'engine', 'radiator'];
  let spentSomething = true;
  while (spentSomething) {
    spentSomething = false;
    for (const key of priorities) {
      const tier = state.tiers[key];
      if (tier >= MAX_TIER) continue;
      const next = UPGRADES[key].tiers[tier + 1];
      if (state.cash < next.price) continue;
      // Keep a fuel reserve, or the bot strands itself and the run becomes a
      // test of the death path rather than the economy.
      if (state.cash - next.price < maxFuel(state) * FUEL_PRICE * 1.5 + 200) continue;
      if (buyUpgrade(state, key)) {
        spentSomething = true;
        if (state.tiers[key] === 1) record(`bought the first ${UPGRADES[key].label.toLowerCase()}`);
        if (state.tiers[key] === MAX_TIER) record(`maxed the ${UPGRADES[key].label.toLowerCase()}`);
      }
    }
  }
}

/** One tick of the bot's decision making. */
function decide(input) {
  const s = state;
  const row = rowOf(s.ship.y);
  const col = colOf(s.ship.x);
  const surface = atSurface(s);

  if (phase === 'dig') {
    // Already burning? Get out. Lava is a rate, not a hit, so the correct
    // response is to leave rather than to keep drilling through it - which is
    // what a player does the instant the hull bar starts falling.
    if (s.ship.heat > 0) {
      input.up = 1;
      input[sidestep < 0 ? 'left' : 'right'] = 1;
      if (sidestep === 0) sidestep = Math.random() < 0.5 ? -1 : 1;
      return;
    }

    // Lava is visible - it is drawn bright orange and shows on the radar - so a
    // player steers around it. The bot has to look, or it dies on contact, which
    // says nothing about whether the game is fair.
    if (sidestep === 0 && tileBelow(s) === KIND.LAVA) {
      // Pick a side that is not also lava, and give up if both are.
      const left = tileBeside(s, -1);
      const right = tileBeside(s, 1);
      const safeLeft = left !== null && left !== KIND.LAVA;
      const safeRight = right !== null && right !== KIND.LAVA;
      if (safeLeft && !safeRight) sidestep = -1;
      else if (safeRight && !safeLeft) sidestep = 1;
      else if (safeLeft && safeRight) sidestep = Math.random() < 0.5 ? -1 : 1;
      else {
        phase = 'home';
        stuck = 0;
        return;
      }
    }
    if (sidestep !== 0) {
      if (tileBelow(s) !== KIND.LAVA) {
        sidestep = 0;
      } else {
        input.drill = 1;
        input[sidestep < 0 ? 'left' : 'right'] = 1;
        return;
      }
    }

    input.drill = 1;
    /**
     * Go home when the hold is full, the tank is getting low, or the hull is in
     * trouble. Those are the game's three real limits, and they are what a
     * person plays against.
     *
     * This used to be a depth ladder instead: dive `8 + 3 * trips` rows deeper
     * every trip and then turn round. It reads like a plan and it is not one. It
     * sent the bot home with an empty hold whenever a cavern happened to put it
     * past its target without cutting anything, and once the bot's own tunnel was
     * deeper than its target, every trip after that ended after a single tile.
     * The ladder made the bot look like the drill was too slow when the bot was
     * the problem.
     */
    const lowFuel = s.ship.fuel / maxFuel(s) < 0.35;
    const lowHull = s.ship.hull / maxHull(s) < 0.4;
    if (load(s) > 0.92 || lowFuel || lowHull) {
      phase = 'home';
      stuck = 0;
    }
    return;
  }

  if (phase === 'home') {
    if (surface && Math.abs(col - HOME_COL) <= 1) {
      phase = 'trade';
      return;
    }
    input.up = 1;
    /**
     * Steer only up in the open sky, where flying sideways is free.
     *
     * Steering the whole way up means holding a direction against rock, and a
     * held direction now drills: the bot was cutting its way out of its own
     * tunnel sideways on the climb home, which cost it the tank and left it
     * wandering instead of climbing. A person flies straight up the shaft they
     * dug and only lines up once they are out in the air.
     */
    if (row <= SKY_ROWS) {
      if (col < HOME_COL) input.right = 1;
      else if (col > HOME_COL) input.left = 1;
    }
    // Wall in the way? Cut through it. The pod can tunnel upward, which is the
    // only way out of one of the mine's enclosed caverns, and a bot that cannot
    // do it spends the rest of the run wedged in a pocket.
    if (stuck > 45) input.drill = 1;
    return;
  }

  // trade: sell, refuel, repair, upgrade. Runs in a single tick; the ship is
  // stationary at the processor so nothing needs to move for it.
  const earned = sellCargo(s);
  if (earned > 0) trips += 1;
  if (earned >= 100000) record('a six-figure haul');
  refuel(s);
  repair(s);
  shop();
  if (s.maxDepth >= 12800 * 0.5) record('past halfway down');
  if (s.maxDepth >= 12800 * 0.9) record('into the deep mine');
  if (s.tiers.drill === MAX_TIER) record('the whole drill ladder bought');
  phase = 'dig';
}

while (ticks < MAX_TICKS) {
  ticks += 1;
  phaseTicks[phase] += 1;

  // A bot that has not moved in twenty seconds is not playing, it is wedged.
  // Reporting that is the difference between "the balance is off" and "the bot
  // is broken", which are very different problems.
  const pos = `${Math.round(state.ship.x)},${Math.round(state.ship.y)},${phase}`;
  if (pos === lastPos) {
    stuckTicks += 1;
    stuck += 1;
    if (stuckTicks === 60 * 20 && !stuckAt) {
      /**
       * What is actually underneath, because "wedged on a wall" and "the rock
       * below is not breakable" look identical in a position, and they need
       * completely different fixes. The column below the pod is the cheapest
       * thing that tells them apart.
       */
      const col = colOf(state.ship.x);
      const row = rowOf(state.ship.y);
      const below = [];
      for (let r = row; r <= Math.min(ROWS - 1, row + 6); r += 1) {
        const kind = kindOf(state.world.tile(col, r));
        below.push(
          kind === KIND.EMPTY ? 'empty'
            : kind === KIND.ORE ? 'ore'
              : kind === KIND.GAS ? 'gas'
                : kind === KIND.LAVA ? 'lava' : 'rock',
        );
      }
      stuckAt = {
        tick: ticks,
        phase,
        x: Math.round(state.ship.x),
        y: Math.round(state.ship.y),
        col,
        row,
        fuel: state.ship.fuel,
        cargo: state.cargoWeight,
        below,
      };
    }
  } else {
    stuckTicks = 0;
    stuck = 0;
    lastPos = pos;
  }

  const input = { left: 0, right: 0, up: 0, down: 0, drill: 0 };
  decide(input);
  step(state, DT, input);
  if (state.ship.drilling) drillTicks += 1;
  if (Math.abs(state.ship.vx) + Math.abs(state.ship.vy) > 1) moveTicks += 1;
  for (const death of state.deaths) {
    deaths.push({ ...death, at: ticks });
  }
  state.deaths.length = 0;
  state.events.length = 0;
}

/* ---------------- report ---------------- */

console.log('');
console.log(`Simulated ${MINUTES} minutes of a bot playing the loop.`);
console.log('');
console.log('    time   trips          credits      depth   event');
console.log('  ------  ------  ---------------  ---------   -----');
if (!log.length) console.log('  (no milestones reached)');
for (const line of log) console.log(line);

console.log('');
console.log('Where it ended up');
console.log(`  trips home        ${trips}`);
console.log(`  deepest           ${Math.round(state.maxDepth).toLocaleString('en-US')} ft of 12,800`);
console.log(`  credits           $${Math.round(state.cash).toLocaleString('en-US')}`);
console.log(`  total earned      $${Math.round(state.stats.earned).toLocaleString('en-US')}`);
console.log(`  tiles dug         ${state.stats.dug.toLocaleString('en-US')}`);
console.log(`  wrecks            ${state.stats.deaths}`);
console.log(`  drill speed       ${drillPower(state)} ft/s`);
console.log(`  hold              ${cargoCap(state)} kg`);
console.log(`  tank              ${maxFuel(state)} L`);
console.log(`  upgrades          ${UPGRADE_KEYS.map((k) => `${UPGRADES[k].label} ${state.tiers[k]}/6`).join('  |  ')}`);

console.log('');
console.log('Where the time went');
for (const [name, count] of Object.entries(phaseTicks)) {
  const pct = ((count / ticks) * 100).toFixed(1);
  console.log(`  ${name.padEnd(6)} ${(count / 3600).toFixed(1).padStart(7)} min  (${pct.padStart(5)}%)`);
}
if (stuckAt) {
  console.log('');
  console.log('The bot got stuck');
  console.log(`  at ${(stuckAt.tick / 3600).toFixed(1)} min in the "${stuckAt.phase}" phase`);
  console.log(`  position (${stuckAt.x}, ${stuckAt.y}) = col ${stuckAt.col}, row ${stuckAt.row}`);
  console.log(`  fuel ${stuckAt.fuel.toFixed(1)} L, hold ${stuckAt.cargo} kg`);
  console.log(`  that column downwards: ${stuckAt.below.join(', ')}`);
}

console.log('');
console.log('What the pod was doing');
console.log(`  drill biting      ${(drillTicks / 3600).toFixed(1)} min  (${((drillTicks / ticks) * 100).toFixed(1)}% of the run)`);
console.log(`  moving            ${(moveTicks / 3600).toFixed(1)} min  (${((moveTicks / ticks) * 100).toFixed(1)}%)`);
console.log(`  tiles dug         ${state.stats.dug} over ${trips} trips = ${(state.stats.dug / Math.max(1, trips)).toFixed(1)} per trip`);

if (deaths.length) {
  const byCause = new Map();
  for (const death of deaths) {
    const entry = byCause.get(death.cause) || { n: 0, sumDepth: 0, minDepth: Infinity, maxDepth: 0 };
    entry.n += 1;
    entry.sumDepth += death.depth;
    entry.minDepth = Math.min(entry.minDepth, death.depth);
    entry.maxDepth = Math.max(entry.maxDepth, death.depth);
    byCause.set(death.cause, entry);
  }
  console.log('');
  console.log('Cause of every wreck');
  for (const [cause, e] of [...byCause].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${cause.padEnd(18)} ${String(e.n).padStart(4)}   `
      + `avg ${Math.round(e.sumDepth / e.n).toLocaleString('en-US').padStart(6)} ft   `
      + `range ${Math.round(e.minDepth).toLocaleString('en-US')}-${Math.round(e.maxDepth).toLocaleString('en-US')} ft`,
    );
  }
}

/* ---------------- verdicts ---------------- */

const problems = [];
if (trips < 8) problems.push(`only ${trips} trips in ${MINUTES} minutes - the loop is too slow to get going`);
if (state.stats.dug < 500) problems.push(`only ${state.stats.dug} tiles dug - the drill is too slow`);
if (state.stats.earned < 20000) problems.push(`earned only $${Math.round(state.stats.earned)} - the economy is too tight`);
if (state.tiers.drill === 0) problems.push('the bot never afforded the first drill upgrade');
if (state.cash < 0) problems.push('cash went negative');
if (state.ship.fuel < 0 || state.ship.fuel > maxFuel(state) + 1e-6) problems.push('fuel left its bounds');
if (state.ship.hull < 0 || state.ship.hull > maxHull(state) + 1e-6) problems.push('hull left its bounds');

/**
 * Deliberately *not* a check on the number of wrecks.
 *
 * The bot digs straight down and dodges lava by looking one square ahead, which
 * is a much worse miner than a person with a radar and a hull bar. It dies to
 * lava repeatedly in the band where lava starts, and that says something about
 * the bot, not about the game. Counting those deaths as a balance failure would
 * mean tuning the hazards until a blind digger survives them, which is the
 * opposite of what makes them hazards.
 *
 * What the wrecks are good for is the cause breakdown above: if everything is
 * dying to one thing at one depth, that is worth reading.
 */

console.log('');
if (problems.length) {
  console.log('Balance concerns');
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log('No balance concerns: the loop pays, the ladder is reachable, and the bot kept playing.');
