/**
 * Every number that decides how the game feels.
 *
 * Nothing here is read by the renderer alone: the sim reads these too, so
 * tuning gameplay never means touching logic. Distances are feet in the fiction
 * and pixels in the code; `FEET_PER_PX` is the bridge. One tile is one cubic
 * metre of rock, which is what makes the ore weights (kg per m3) and the cargo
 * bay's kilogram capacity add up to something you can feel - the hold fills
 * with a few heavy ore or a lot of cheap rock.
 */

export const TILE = 32;
export const COLS = 24;
export const ROWS = 400;
export const DEPTH_FT = 12800;
export const FEET_PER_PX = DEPTH_FT / (ROWS * TILE);

/**
 * Sky rows above the mine, and the flattened landing strip beneath them.
 * The strip is what the ship starts parked on and what the facilities stand on.
 * The bottom row of the map is unbreakable bedrock.
 */
export const SKY_ROWS = 2;
export const SURFACE_DEPTH = 2;
export const SURFACE_ROW = SKY_ROWS + SURFACE_DEPTH - 1;

export const START_CASH = 5000;
export const FUEL_PRICE = 1;
export const REPAIR_PRICE = 20;

/**
 * The ore table. `weight` is kilograms per tile, `value` is credits per tile,
 * and `from` is the depth in feet it starts appearing at. The spread is
 * deliberate: the shallow ores are heavy and nearly worthless, the deep ones
 * are light and absurd, so early trips are about volume and late ones are about
 * surviving long enough to carry the find home.
 *
 * `rarity` is a relative frequency, not a probability. Without it everything
 * whose depth was unlocked competed equally and the surface held as much
 * diamond as ironium, which flattened the whole progression.
 */
export const ORES = [
  { id: 1, key: 'ironium', name: 'Ironium', value: 30, weight: 10, from: 0, rarity: 1, tier: 1, color: '#b98a6a', tint: '#7d5a41', spark: '#ffd9b0' },
  { id: 2, key: 'bronzium', name: 'Bronzium', value: 60, weight: 10, from: 0, rarity: 0.62, tier: 1, color: '#d08a3c', tint: '#8a5518', spark: '#ffc46b' },
  { id: 3, key: 'silverium', name: 'Silverium', value: 100, weight: 10, from: 0, rarity: 0.36, tier: 1, color: '#cfd6e4', tint: '#7f8899', spark: '#ffffff' },
  { id: 4, key: 'goldium', name: 'Goldium', value: 250, weight: 20, from: 1000, rarity: 0.2, tier: 1, color: '#ffd23f', tint: '#a67c00', spark: '#fff3a8' },
  { id: 5, key: 'platinium', name: 'Platinium', value: 750, weight: 30, from: 3000, rarity: 0.13, tier: 2, color: '#dff4ff', tint: '#7ea3b5', spark: '#ffffff' },
  { id: 6, key: 'einsteinium', name: 'Einsteinium', value: 2000, weight: 40, from: 5000, rarity: 0.08, tier: 2, color: '#7dffb0', tint: '#2f9b62', spark: '#d6ffe8' },
  { id: 7, key: 'emerald', name: 'Emerald', value: 5000, weight: 60, from: 6500, rarity: 0.05, tier: 3, color: '#2fd97a', tint: '#12663a', spark: '#b7ffd4' },
  { id: 8, key: 'ruby', name: 'Ruby', value: 20000, weight: 80, from: 8000, rarity: 0.032, tier: 3, color: '#ff3b5c', tint: '#8c1029', spark: '#ffc2cd' },
  { id: 9, key: 'diamond', name: 'Diamond', value: 100000, weight: 100, from: 9500, rarity: 0.02, tier: 4, color: '#9fefff', tint: '#4a8fa8', spark: '#ffffff' },
  { id: 10, key: 'amazonite', name: 'Amazonite', value: 500000, weight: 120, from: 11000, rarity: 0.013, tier: 4, color: '#3fe0d0', tint: '#0f6f68', spark: '#c4fff8' },
];

export const ORE_BY_ID = ORES.reduce((acc, ore) => (acc[ore.id] = ore, acc), {});

/** How much of a row is ore. The rest is rock, gas and lava. */
export const ORE_DENSITY = 0.26;

/** Depth gates, in feet, for the things that want to kill you. */
export const HAZARD = {
  gasFrom: 4750,
  lavaFrom: 3000,
};

/**
 * Upgrade ladders. Prices and tier names are the original's; a few effect
 * values are tightened, because the original's last drill outran the frame rate
 * rather than the player.
 */
const tier = (name, price, value) => ({ name, price, value });

export const UPGRADES = {
  drill: {
    label: 'Drill',
    blurb: 'Rock eaten per second.',
    unit: 'ft/s',
    tiers: [
      tier('Basic Drill', 0, 40),
      tier('Steel Drill', 750, 55),
      tier('Diamond Drill', 2000, 72),
      tier('Tungsten Drill', 5000, 92),
      tier('Emerald Drill', 20000, 118),
      tier('Ruby Drill', 100000, 150),
      tier('Amazonite Drill', 500000, 200),
    ],
  },
  hull: {
    label: 'Hull',
    blurb: 'Structural integrity.',
    unit: 'HP',
    tiers: [
      tier('Basic Hull', 0, 10),
      tier('Reinforced Hull', 750, 17),
      tier('Steel Hull', 2000, 30),
      tier('Titanium Hull', 5000, 50),
      tier('Platinum Hull', 20000, 80),
      tier('Diamond Hull', 100000, 120),
      tier('Amazonite Hull', 500000, 180),
    ],
  },
  engine: {
    label: 'Engine',
    blurb: 'Thrust and top speed.',
    unit: 'hp',
    tiers: [
      tier('Basic Engine', 0, 150),
      tier('Sterling Engine', 750, 162),
      tier('High-Performance Engine', 2000, 175),
      tier('Gasoline Engine', 5000, 188),
      tier('Jet Engine', 20000, 202),
      tier('Plasma Engine', 100000, 218),
      tier('Warp Engine', 500000, 240),
    ],
  },
  radiator: {
    label: 'Radiator',
    blurb: 'Heat and blast shielding.',
    unit: '%',
    tiers: [
      tier('Radiator', 0, 0),
      tier('Copper Radiator', 2000, 10),
      tier('Steel Radiator', 5000, 25),
      tier('Titanium Radiator', 20000, 40),
      tier('Platinum Radiator', 100000, 60),
      tier('Amazonite Radiator', 500000, 80),
    ],
  },
  tank: {
    label: 'Fuel Tank',
    blurb: 'Litres of fuel.',
    unit: 'L',
    tiers: [
      tier('Basic Tank', 0, 22),
      tier('Plastic Tank', 750, 34),
      tier('Aluminium Tank', 2000, 52),
      tier('Stainless Steel Tank', 5000, 78),
      tier('Titanium Tank', 20000, 118),
      tier('Platinum Tank', 100000, 180),
      tier('Amazonite Tank', 500000, 330),
    ],
  },
  cargo: {
    label: 'Cargo Bay',
    blurb: 'Kilograms of ore.',
    unit: 'kg',
    tiers: [
      tier('Basic Cargo Bay', 0, 220),
      tier('Plastic Cargo Bay', 750, 700),
      tier('Aluminium Cargo Bay', 2000, 1500),
      tier('Steel Cargo Bay', 5000, 3000),
      tier('Titanium Cargo Bay', 20000, 6000),
      tier('Platinum Cargo Bay', 100000, 12000),
      tier('Amazonite Cargo Bay', 500000, 26000),
    ],
  },
};

export const UPGRADE_KEYS = Object.keys(UPGRADES);
export const MAX_TIER = 6;

/** Consumables from the supply station. `max` is how many you can carry. */
export const ITEMS = [
  { key: 'fuel', name: 'Reserve Fuel', price: 2000, max: 1, blurb: '+33% tank, anywhere.', tone: 'fuel' },
  { key: 'nanobots', name: 'Nanobots', price: 7500, max: 1, blurb: 'Repair 60% hull, anywhere.', tone: 'repair' },
  { key: 'dynamite', name: 'Dynamite', price: 2000, max: 8, blurb: 'Blasts a 4x4 pocket.', tone: 'blast' },
  { key: 'c4', name: 'Plastic Explosives', price: 5000, max: 8, blurb: 'Blasts a 6x6 pocket.', tone: 'blast' },
  { key: 'teleporter', name: 'Quantum Teleporter', price: 2000, max: 4, blurb: 'Untested. Loses most of the hold.', tone: 'jump' },
  { key: 'transmitter', name: 'Matter Transmitter', price: 10000, max: 4, blurb: 'Instant trip up, ore intact.', tone: 'jump' },
];

export const ITEM_BY_KEY = ITEMS.reduce((acc, item) => (acc[item.key] = item, acc), {});

/**
 * Physics. Tuned by playing, not by physics.
 *
 * The fall numbers are a matched set and only make sense together.
 *
 * The ship reaches terminal velocity at `gravity / (drag * verticalDrag)`, which
 * is about 520 px/s, and `maxSpeedY` is above that so the clamp never masks it.
 * `fallSafe` then has to sit just under terminal velocity - not far under it.
 * With `fallSafe` at 300, every fall in the game reached 520 and cost 20 hull
 * against a starting hull of 10, so digging a hole and dropping into it was
 * instant death. Falling down your own shaft is the most common thing that
 * happens in this game; it cannot be the thing that kills you.
 *
 * So a terminal-velocity slam costs about a point and a half, which reads as
 * "that hurt" rather than "start again". The real threats are gas, lava and an
 * empty tank.
 */
export const PHYS = {
  gravity: 620,
  drag: 3.4,
  drillDrag: 7.5,
  verticalDrag: 0.35,
  turnAccel: 900,
  maxSpeedX: 220,
  maxSpeedY: 560,
  cargoSlowdown: 0.55,
  fuelIdle: 0.05,
  fuelThrust: 0.42,
  // Fuel burn in litres per second. The drill is the expensive one by design -
  // depth costs fuel, hovering does not - but it has to be small enough that a
  // 22 litre starting tank buys a real first trip rather than a slow death.
  fuelDrill: 0.4,
  /**
   * How fast the drill steers the pod back over the column it is cutting.
   * Without it the pod drifts until its hull straddles two columns and jams in
   * the one-tile tunnel it just made.
   */
  drillTrack: 110,
  fallSafe: 480,
  fallScale: 0.035,
};

/**
 * Gas and lava, both tuned against the hull ladder.
 *
 * Gas is a one-off hit that grows with depth: about a third of the hull you
 * would plausibly have when it first appears, rising to about a third of the
 * hull you would have at the bottom. So a pocket is a serious cost and never a
 * formality, and it is survivable at every depth - you can always lose the hull
 * instead of the run. It is the one hazard you cannot see coming, which is why
 * it does not simply kill you.
 *
 * Lava is a rate, and the rate is set so a brush is survivable but a bath is
 * not, and so that the hull and radiator ladders are what let you work near it:
 * at 22 per second a basic 10-point hull dies in under half a second, and a
 * late hull lasts long enough to back out.
 */
export const GAS = { damageBase: 10, damagePerFt: 0.0048, radius: 2 };
export const LAVA = { dps: 22, proximity: 1 };

/** Surface facilities, in tile columns, left to right. */
export const FACILITIES = [
  { key: 'fuel', col: 3, name: 'Fuel Depot', color: '#ffd23f' },
  { key: 'sell', col: 10, name: 'Mineral Processor', color: '#4dd4ff' },
  { key: 'shop', col: 20, name: 'Supply & Repair', color: '#a78bfa' },
];

/** The last thing on the map. */
export const ENDGAME = {
  row: ROWS - 6,
  col: 11,
  reward: 50000000,
  name: 'Mr. Natas',
};

export const SAVE_KEY = 'deepcore.save.v1';
export const BEST_KEY = 'deepcore.best.v1';