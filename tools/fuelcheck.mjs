/**
 * Answers one question: can the starting pod dig a hole and get home again?
 *
 *   node tools/fuelcheck.mjs
 *
 * This is the single most important number in the game and it is not obvious
 * from the config. A tank that cannot pay for a round trip makes the first
 * minute unwinnable, and it looks like a difficulty problem rather than a
 * budget problem.
 *
 * It simulates a straight descent with the drill held, finds how deep the tank
 * allows before the fuel would not cover the climb back, and prints the budget
 * for each tank tier.
 */

import { PHYS, SKY_ROWS, TILE, FEET_PER_PX, UPGRADES, FUEL_PRICE } from '../src/config.js';
import { createState, step, maxFuel, drillPower } from '../src/sim/game.js';
import { rowDepth } from '../src/sim/world.js';

const DT = 1 / 60;

/** Litres burned per second while drilling, from the sim's own formula. */
const drillBurn = (hardness) => PHYS.fuelDrill * (0.6 + 0.4 * hardness);
const tileHardness = (row) => 1 + Math.min(1.5, rowDepth(row) / 6000);

/**
 * How deep a full tank can take you and still come back.
 *
 * Descending costs the drill's burn plus the *idle* burn, because drilling
 * straight down involves no thrust: the drill pulls you into the hole. The
 * climb costs thrusting the whole way, and it is fast - `maxSpeedY` covers the
 * whole depth in seconds - so the return leg is cheap and the drill is what
 * actually sets the range.
 */
function rangeOf(tier) {
  const tank = UPGRADES.tank.tiers[tier].value;
  const drill = UPGRADES.drill.tiers[tier].value;
  const climbBurn = PHYS.fuelThrust * 1.2; // generous: thrusting the whole way up

  let fuel = tank;
  let depth = 0; // feet
  let seconds = 0;
  // Walk down in one-foot steps, paying the drill and the flight burn, and stop
  // when what is left would not cover the climb back from this depth.
  while (fuel > 0 && depth < 12000) {
    const row = SKY_ROWS + depth / FEET_PER_PX / TILE;
    const hardness = tileHardness(row);
    const drillSeconds = 1 / drill; // one foot of rock at this drill speed
    const descentBurn = (drillBurn(hardness) + PHYS.fuelIdle) * drillSeconds;
    const climbSeconds = (depth + 1) / (PHYS.maxSpeedY / FEET_PER_PX);
    const climbCost = climbBurn * climbSeconds;
    if (fuel - descentBurn < climbCost) break;
    fuel -= descentBurn;
    depth += 1;
    seconds += drillSeconds;
  }
  return { tank, drill, depth, seconds, fuel };
}

console.log('');
console.log('Round-trip range on a full tank, digging straight down');
console.log('');
console.log('  tier  tank      drill   max depth   drill time   fuel left   full tank costs');
console.log('  ----  ------  -------  ----------  -----------  ----------  --------------');

for (let tier = 0; tier < UPGRADES.tank.tiers.length; tier += 1) {
  const r = rangeOf(tier);
  console.log(
    `  ${String(tier).padStart(4)}  ${String(r.tank).padStart(4)} L  `
    + `${String(r.drill).padStart(5)}   ${String(Math.round(r.depth)).padStart(8)} ft  `
    + `${r.seconds.toFixed(0).padStart(9)} s  ${r.fuel.toFixed(1).padStart(8)} L  `
    + `$${String(Math.round(r.tank * FUEL_PRICE)).padStart(12)}`,
  );
}

/* ---------------- the first trip, actually played ---------------- */

const s = createState(4242);
const startFuel = s.ship.fuel;
const input = { left: 0, right: 0, up: 0, down: 0, drill: 1 };

let ticks = 0;
while (ticks < 60 * 240 && !s.ended && s.ship.fuel > 0) {
  ticks += 1;
  step(s, DT, input);
  s.events.length = 0;
}

const fuelUsed = startFuel - s.ship.fuel;

console.log('');
console.log('The opening move: hold the drill down and never stop');
console.log('');
console.log(`  tank at the start     ${startFuel.toFixed(1)} L`);
  console.log(`  depth reached         ${Math.round(s.maxDepth).toLocaleString('en-US')} ft`);
console.log(`  tiles dug             ${s.stats.dug}`);
console.log(`  fuel burned           ${fuelUsed.toFixed(1)} L`);
console.log(`  ore in the hold       ${Math.round(s.cargoWeight)} kg of ${UPGRADES.cargo.tiers[0].value} kg`);
  console.log(`  outcome               ${s.ended ? s.ended.cause : 'still going'}`);

console.log('');
if (s.maxDepth < 800) {
  console.log(`  PROBLEM: a full starting tank only buys ${Math.round(s.maxDepth)} ft of descent.`);
  console.log('  The first trip should reach at least the first depth gate with fuel to spare.');
  process.exit(1);
}
console.log(`  The starting tank buys ${Math.round(s.maxDepth)} ft of descent with a ${(100 * (1 - fuelUsed / startFuel)).toFixed(0)}% reserve.`);
