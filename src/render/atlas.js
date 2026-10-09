/**
 * Every tile in the game, drawn once at startup.
 *
 * Drawing rock tile by tile, every frame, with per-pixel noise, is a way to
 * spend a whole frame on the background. Instead the rock is rendered once into
 * a set of small canvases and blitted: one rock sprite per depth band per
 * variant, one ore sprite per ore per variant, and one crack overlay per
 * damage step.
 *
 * Sprites are rendered at `SS` times tile size and blitted down, so they stay
 * sharp on a high-DPI display or when the whole world is scaled up to fill a
 * wide window. The noise inside them comes from the same position hash the rest
 * of the game uses, so a rock looks the same every time you fly past it.
 */

import { TILE, ORES, ORE_BY_ID } from '../config.js';
import { hash2 } from '../sim/rng.js';
import { rockAt, BAND_DEPTHS, BAND_COUNT, bandIndexAt } from './palette.js';

/** Supersampling factor for the sprites. 2 is enough for a 2x zoom. */
export const SS = 2;
const S = TILE * SS;

function make(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * Speckled rock, quantised.
 *
 * Three tones, whole blocks, no soft edges and no alpha: the texture is a grid
 * of flat squares picked by position hash, so it reads as a tile rather than as
 * a photograph of one. Soft radial mottles and half-transparent grain were what
 * made this look modern, and they also cost more to draw than the blocks do.
 */
/**
 * A usable pixel size.
 *
 * Everything below draws in "pixels" of this size, which is what makes the
 * texture read as pixel art rather than as a low-resolution photograph. The
 * earlier version used 6px blocks, so a 32px tile was five blocks across and a
 * wall of rock was a five-by-five mosaic - it read as flat mush, and no amount
 * of extra colour fixed that.
 */
const PX = SS * 2;
/**
 * The grid, in usable pixels. At `SS = 2` and `TILE = 32` the sprite is 64px
 * across and a usable pixel is 4 of them, so a tile is a 16x16 grid - and each
 * cell is 2 screen pixels at 1x zoom.
 */
const N = S / PX;

/** Fills the whole tile with `color`, snapped to the usable-pixel grid. */
function px(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x) * PX, Math.round(y) * PX, w * PX, h * PX);
}

/**
 * One rock tile.
 *
 * The shape of this matters more than the colours do. Every tile is a chipped
 * block inside its cell: full width, with the corners cut by a depth that comes
 * from the tile's own variant, so a wall reads as stacked boulders instead of as
 * a grid of squares. Everything is then drawn on the 8x8 grid - speckle, a grain
 * patch, veins, a couple of pebbles, and a crack - which is what gives the rock
 * something to look at up close while still being a single blit per tile.
 *
 * All the randomness comes from the position hash keyed on the band and variant,
 * so a given tile looks identical every time you fly past it.
 */
function drawRock(ctx, band, variant, depthFt) {
  const { base, hi, lo } = rockAt(depthFt);
  const R = (x, y, salt) => hash2(x * 31 + variant * 61 + salt, y * 17 + band * 97 + salt);

  // The chipped edges: corners cut 0-2 blocks, mirrored so opposite corners
  // agree and the block looks cut rather than randomly nibbled.
  const nx = 1 + Math.floor(R(1, 2, 5) * 2);
  const ny = 1 + Math.floor(R(2, 3, 11) * 2);
  const shape = [
    [nx, 0, N - nx, 1], [0, ny, 1, N - ny],
    [nx, 0, 1, ny], [0, ny, nx, 1],
    [N - nx, N - 1, nx, 1], [N - 1, ny, 1, N - ny],
    [N - nx, N - ny, nx, 1], [N - 1, ny, 1, ny],
  ];
  for (const [x, y, w, h] of shape) px(ctx, x, y, w, h, base);

  // A second, smaller step on some tiles makes the edge chunky rather than a
  // clean 45-degree cut.
  if (R(4, 1, 23) > 0.5) {
    px(ctx, 0, 0, nx, 1, lo);
    px(ctx, N - nx, 0, nx, 1, lo);
  }

  // Speckle. Three tones rather than two, so the texture has actual depth
  // instead of alternating light and dark checks.
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const h = R(x, y, 0);
      if (h < 0.58) continue;
      if (h > 0.93) px(ctx, x, y, 1, 1, hi);
      else if (h > 0.78) px(ctx, x, y, 1, 1, lo);
      else px(ctx, x, y, 1, 2, lo);
    }
  }

  // A grain patch: a few 2x2 clusters, which at this scale read as the coarse
  // grain of the rock rather than as more speckle.
  for (let i = 0; i < 3; i += 1) {
    const gx = Math.floor(R(i, 7, 3) * (N - 2));
    const gy = Math.floor(R(7, i, 3) * (N - 2));
    px(ctx, gx, gy, 2, 2, R(i, i, 9) > 0.5 ? hi : lo);
  }

  // Mineral veins: two-block dashes running diagonally through about a third of
  // the tiles. Deep rock gets more of them and shallower rock fewer, and they
  // are what stops a wall of rock reading as an even field of noise.
  if (R(5, 5, 13) > 0.62) {
    const vx = Math.floor(R(6, 1, 17) * (N - 3));
    const vy = Math.floor(R(1, 6, 17) * (N - 4));
    const lit = R(2, 8, 19) > 0.5 ? hi : base;
    for (let i = 0; i < 3; i += 1) px(ctx, vx + i, vy + i, 2, 1, lit);
  }

  // A couple of embedded pebbles. Each is a lit top edge and a dark bottom edge
  // rather than a flat blob, so it reads as a stone sitting in the rock.
  const pebbles = R(8, 8, 29) > 0.4 ? 2 : 1;
  for (let i = 0; i < pebbles; i += 1) {
    const qx = Math.floor(R(i, 9, 31) * (N - 3)) + 1;
    const qy = Math.floor(R(9, i, 31) * (N - 3)) + 1;
    px(ctx, qx, qy, 2, 2, lo);
    px(ctx, qx, qy, 2, 1, hi);
  }

  // A hairline crack, on about a quarter of tiles.
  if (R(3, 9, 37) > 0.74) {
    let cx2 = Math.floor(R(1, 1, 41) * (N - 2)) + 1;
    let cy2 = Math.floor(R(2, 2, 41) * (N - 3)) + 1;
    for (let i = 0; i < 4; i += 1) {
      px(ctx, cx2, cy2, 1, 1, lo);
      cx2 += R(i, 3, 43) > 0.5 ? 1 : -1;
      cy2 += 1;
      if (cx2 < 0 || cx2 >= N) break;
    }
  }

  /*
   * The bevel goes on last and only on the *flat* top and left. An earlier
   * version outlined the full cell, which drew a lit border round the cut
   * corners too and put back exactly the square grid the chips were there to
   * break up.
   */
  px(ctx, nx, 0, N - nx * 2, 1, hi);
  px(ctx, 0, ny, 1, N - ny * 2, hi);
  px(ctx, nx, N - 1, N - nx * 2, 1, lo);
  px(ctx, N - 1, ny, 1, N - ny * 2, lo);
}

/**
 * An ore tile: solid facets with black outlines.
 *
 * The glow and the soft core are gone. Ore has to be the brightest thing in the
 * rock, and flat saturated colour on a black outline does that at a glance
 * without any blur, which is how a game from this era got your eye.
 */
function drawOre(ctx, ore, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);

  /**
   * The crystal is built out of whole pixels on the same grid as the rock.
   *
   * It is a socket, a fat middle row and a tapered top and bottom, which at this
   * size reads as a cut gem: the shape does the work, so the facets do not need
   * diagonals that would break the pixel grid.
   */
  const cx = N / 2 - 0.5;
  const cy = N / 2 - 0.5;
  const rad = variant % 2 === 0 ? 2.5 : 2;
  const ink = '#0b0d14';

  // The socket: a dark hole the crystal sits in, one pixel bigger all round.
  px(ctx, cx - rad - 1, cy - rad - 1, rad * 2 + 2, rad * 2 + 2, ink);
  px(ctx, cx - rad - 1, cy - rad - 1, rad * 2 + 2, 1, ore.tint);

  // Body: widest in the middle, stepping in at the top and bottom.
  px(ctx, cx - rad, cy - rad + 1, rad * 2 + 1, rad * 2 - 1, ore.color);
  px(ctx, cx - rad + 1, cy - rad, rad * 2 - 1, 1, ore.color);
  px(ctx, cx - rad + 1, cy + rad, rad * 2 - 1, 1, ore.color);

  // Lit upper-left face and a dark lower-right, which is the whole of the
  // shading on a gem this size.
  px(ctx, cx - rad + 1, cy - rad + 2, rad, 1, ore.spark);
  px(ctx, cx - rad + 1, cy + 1, 1, rad - 1, ore.spark);
  px(ctx, cx + rad - 1, cy - rad + 2, 1, rad, ore.tint);
  px(ctx, cx - rad + 2, cy + rad - 1, rad, 1, ore.tint);

  // The glint. One pixel, and only one: at this size a second highlight turns
  // the gem into a blob.
  px(ctx, cx - rad + 1, cy - rad + 2, 1, 1, '#ffffff');
}

/**
 * Gas pockets look like ordinary rock until the drill opens one.
 *
 * This is the one tile that should *not* stand out, so the green cast stays
 * faint and the speckle is the same block grid the rock uses. The seam is the
 * only deliberate tell, and it has to be deniable.
 */
function drawGas(ctx, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);

  // A faint green cast, one pixel at a time, so a pocket is a *suspicion* rather
  // than a sign. Anything stronger and the hazard stops being one.
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const h = hash2(x * 3 + variant * 71, y * 5 + band * 37);
      if (h < 0.62) continue;
      px(ctx, x, y, 1, 1, h > 0.86 ? '#9ed86a' : '#5f8f45');
    }
  }

  // A seam, and a short second one, so a cluster of pockets looks like a gas
  // line running through the rock rather than like repeated identical tiles.
  const seam = (x0, y0, dir) => {
    let x = x0;
    let y = y0;
    for (let i = 0; i < 5; i += 1) {
      px(ctx, x, y, 1, 1, '#a8e070');
      x += 1;
      y += dir;
      if (x >= N || y < 0 || y >= N) break;
    }
  };
  seam(1, 5, -1);
  if (variant % 2) seam(3, 2, 1);
}

/** Lava is bright and obviously lethal, in three flat tones of hot. */
function drawLava(ctx, band, variant, depthFt) {
  drawRock(ctx, band, variant, depthFt);

  // Molten body, inset by one pixel so the rock rim stays visible and a pool
  // reads as something sitting *in* the mine rather than as a hole through it.
  px(ctx, 1, 1, N - 2, N - 2, '#e8641a');
  for (let y = 1; y < N - 1; y += 1) {
    for (let x = 1; x < N - 1; x += 1) {
      const h = hash2(x * 7 + variant * 31, y * 11 + band * 13);
      if (h < 0.55) continue;
      // Hot cores and cooling edges, two tones either side of the body colour.
      px(ctx, x, y, 1, 1, h > 0.82 ? '#ffd24a' : h > 0.68 ? '#ff9a2e' : '#b81c04');
    }
  }

  // Crust: irregular plates floating on the surface, lit on top and dark
  // underneath, so the lava has a surface rather than a texture.
  for (let i = 0; i < 3; i += 1) {
    const h = hash2(variant * 31 + i, band * 13 + 7);
    const h2 = hash2(band * 19 + i, variant * 11);
    const cx2 = 2 + Math.floor(h * (N - 5));
    const cy2 = 2 + Math.floor(h2 * (N - 5));
    px(ctx, cx2, cy2, 3, 2, '#5c1406');
    px(ctx, cx2, cy2, 3, 1, '#7d2a10');
  }
}

/**
 * The crack overlay. Drawn on top of a tile while it is being drilled, with
 * alpha driven by progress, so rock visibly gives way instead of blinking out.
 */
function drawCrack(ctx, step) {
  /**
   * Fractures stepped out one pixel at a time.
   *
   * Stepped rather than stroked: a canvas line is anti-aliased, which puts grey
   * half-pixels into a tile that is otherwise exact colours, and that is visible
   * as soon as it sits next to the rock. A crack in rock also does not run in a
   * straight line, so each segment jogs sideways.
   */
  const cracks = 1 + step;
  for (let i = 0; i < cracks; i += 1) {
    let x = 1 + Math.floor(hash2(i * 17 + step * 101, step * 53 + i) * (N - 2));
    let y = 1 + Math.floor(hash2(step * 7 + i, i * 29) * (N - 4));
    for (let seg = 0; seg < 4 + step; seg += 1) {
      const dark = seg % 2 === 0 ? '#0b0d14' : '#241d26';
      px(ctx, x, y, 1, 1, dark);
      // A lit pixel on one side of the crack, so it reads as a gap rather than
      // as a scribble: light catches the edge it opens.
      if (seg % 2 === 0 && x + 1 < N) px(ctx, x + 1, y, 1, 1, '#c8ccd8');
      x += hash2(i * 7 + seg, step * 31 + seg) > 0.5 ? 1 : -1;
      y += 1;
      if (x < 0 || x >= N || y >= N) break;
    }
  }
}

/**
 * Builds the whole atlas. Called once. Returns flat arrays indexed by
 * `band * 4 + variant`, which keeps the per-tile lookup to one multiply.
 */
export function buildAtlas() {
  const rock = [];
  const ore = new Map();
  const gas = [];
  const lava = [];
  const crack = [];

  for (let band = 0; band < BAND_COUNT; band += 1) {
    for (let variant = 0; variant < 4; variant += 1) {
      const depth = BAND_DEPTHS[band];
      const rk = make(S);
      drawRock(rk.getContext('2d'), band, variant, depth);
      rock[band * 4 + variant] = rk;

      const g = make(S);
      drawGas(g.getContext('2d'), band, variant, depth);
      gas[band * 4 + variant] = g;

      const l = make(S);
      drawLava(l.getContext('2d'), band, variant, depth);
      lava[band * 4 + variant] = l;
    }
  }

  for (const def of ORES) {
    const variants = [];
    for (let variant = 0; variant < 4; variant += 1) {
      const c = make(S);
      // Ore sits in the rock of its own depth, so a deep gem in shallow rock
      // does not exist and never gets drawn.
      const band = bandIndexAt(def.from);
      drawOre(c.getContext('2d'), def, band, variant, def.from);
      variants[variant] = c;
    }
    ore.set(def.id, variants);
  }

  for (let step = 0; step < 4; step += 1) {
    const c = make(S);
    drawCrack(c.getContext('2d'), step);
    crack[step] = c;
  }

  return { rock, ore, gas, lava, crack };
}
