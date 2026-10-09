/**
 * The three surface buildings.
 *
 * These used to be one grey box drawn three times with a different coloured
 * strip across it, which is why the surface looked empty: there was nothing to
 * look *at*, and nothing to tell the buildings apart until you were close enough
 * to read the strip.
 *
 * The original never did that. Its buildings each had a shape you could name from
 * across the mine - a tank, a tower, a shopfront - and that is what made the
 * surface a place rather than a row of sheds. So each one here is built around
 * its own silhouette:
 *
 *   - the fuel depot is a squat hut beside a tall tank, with a pump and a hose;
 *   - the processor is a tower with a chimney, a conveyor feeding it and an
 *     auger turning on the front;
 *   - the store is wide and low with a striped awning over a lit shopfront and
 *     crates stacked outside.
 *
 * The colour only confirms which one you are looking at. The outline already
 * told you, which is the whole point.
 *
 * Everything is drawn on whole pixels with hard edges, in the same palette as
 * the rest of the mine. There is no text anywhere on these: a sign rendered in a
 * webfont is a font that might not have loaded, and a drawn icon reads at this
 * size anyway.
 */

import { TILE } from '../config.js';

const INK = '#0b0d14';
const STEEL = '#7d8798';
const STEEL_HI = '#b9c4d4';
const STEEL_LO = '#4c5566';
const PANEL = '#5f6a7c';
const DARK = '#39414f';
const GLASS = '#ffecb4';

/** A hard-edged panel: flat face, lit top-left, dark bottom-right, black outline. */
function panel(ctx, x, y, w, h, face = STEEL) {
  const px = Math.round(x);
  const py = Math.round(y);
  const pw = Math.round(w);
  const ph = Math.round(h);
  if (pw <= 0 || ph <= 0) return;

  ctx.fillStyle = face;
  ctx.fillRect(px, py, pw, ph);
  if (pw > 4 && ph > 4) {
    ctx.fillStyle = STEEL_HI;
    ctx.fillRect(px, py, pw, 2);
    ctx.fillRect(px, py, 2, ph);
    ctx.fillStyle = STEEL_LO;
    ctx.fillRect(px, py + ph - 2, pw, 2);
    ctx.fillRect(px + pw - 2, py, 2, ph);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
}

/** A lit window: dark frame, warm pane, one white pixel of reflection. */
function pane(ctx, x, y, w, h, lit = GLASS) {
  const px = Math.round(x);
  const py = Math.round(y);
  ctx.fillStyle = INK;
  ctx.fillRect(px - 1, py - 1, w + 2, h + 2);
  ctx.fillStyle = lit;
  ctx.fillRect(px, py, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(px + 1, py + 1, 2, 1);
  ctx.fillRect(px + 1, py + 1, 1, 2);
}

/** A signboard with a drawn icon on it, so it needs no font. */
function signboard(ctx, cx, y, w, accent, icon) {
  const x = Math.round(cx - w / 2);
  ctx.fillStyle = INK;
  ctx.fillRect(x - 1, y - 1, w + 2, 13);
  ctx.fillStyle = accent;
  ctx.fillRect(x, y, w, 11);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(x, y, w, 2);

  // The icon, in ink, centred on the board.
  const mx = Math.round(cx);
  const my = y + 5;
  ctx.fillStyle = INK;
  if (icon === 'drop') {
    // A fuel drop.
    ctx.fillRect(mx - 1, my - 3, 2, 2);
    ctx.fillRect(mx - 2, my - 1, 4, 2);
    ctx.fillRect(mx - 2, my + 1, 4, 1);
  } else if (icon === 'gem') {
    // An ore chunk.
    ctx.fillRect(mx - 3, my - 2, 6, 3);
    ctx.fillRect(mx - 2, my + 1, 4, 1);
    ctx.fillRect(mx - 3, my - 2, 1, 3);
  } else {
    // A wrench, for the store.
    ctx.fillRect(mx - 3, my - 2, 3, 2);
    ctx.fillRect(mx - 1, my - 2, 2, 6);
    ctx.fillRect(mx - 3, my + 1, 3, 2);
  }
}

/** The concrete apron the building stands on, with hazard stripes at the edge. */
function apron(ctx, cx, groundY, w, accent) {
  const x = Math.round(cx - w / 2);
  const y = Math.round(groundY - 7);
  ctx.fillStyle = '#2b303b';
  ctx.fillRect(x, y, w, 7);
  ctx.fillStyle = '#464e5d';
  ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(x, y + 7, w, 1);
  // Diagonal hazard stripes, stepped one pixel at a time so they stay hard-edged.
  ctx.fillStyle = accent;
  for (let i = 0; i < w; i += 9) {
    for (let k = 0; k < 4; k += 1) {
      const sx = x + i + k * 2;
      if (sx > x + w - 2) break;
      ctx.fillRect(sx, y + 3 + k, 2, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The fuel depot: a squat hut beside a tall tank                      */
/* ------------------------------------------------------------------ */

function drawFuel(ctx, cx, groundY, time, accent) {
  apron(ctx, cx, groundY, 118, accent);

  // The tank. A cylinder is a body, a stepped cap and two shadowed bands.
  const tx = Math.round(cx - 36);
  const tBase = Math.round(groundY - 7);
  const tH = 58;
  const tTop = tBase - tH;
  ctx.fillStyle = '#c8d0dc';
  ctx.fillRect(tx, tTop + 6, 26, tH - 6);
  ctx.fillStyle = '#eef3fa';
  ctx.fillRect(tx, tTop + 6, 6, tH - 6);
  ctx.fillStyle = '#8d97a6';
  ctx.fillRect(tx + 20, tTop + 6, 6, tH - 6);
  // Stepped cap, so the curve is drawn in whole pixels.
  ctx.fillStyle = '#c8d0dc';
  ctx.fillRect(tx + 4, tTop + 3, 18, 3);
  ctx.fillRect(tx + 8, tTop, 10, 3);
  ctx.fillStyle = '#8d97a6';
  ctx.fillRect(tx + 4, tTop + 4, 18, 2);
  // Bands and the gauge.
  ctx.fillStyle = '#6f7889';
  ctx.fillRect(tx, tTop + 20, 26, 3);
  ctx.fillRect(tx, tBase - 12, 26, 3);
  ctx.fillStyle = INK;
  ctx.fillRect(tx + 10, tTop + 30, 5, 16);
  ctx.fillStyle = accent;
  ctx.fillRect(tx + 11, tTop + 37, 3, 8);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(tx + 0.5, tTop + 6.5, 25, tH - 7);
  ctx.strokeRect(tx + 3.5, tTop + 2.5, 19, 4);

  // A blinking lamp on the cap.
  if (Math.sin(time * 2.6) > 0) {
    ctx.fillStyle = '#ff5a5a';
    ctx.fillRect(tx + 11, tTop - 6, 4, 4);
    ctx.strokeStyle = INK;
    ctx.strokeRect(tx + 11.5, tTop - 5.5, 3, 3);
  }

  // The pipe from the tank into the hut.
  ctx.fillStyle = '#5a6373';
  ctx.fillRect(tx + 26, tBase - 30, 14, 5);
  ctx.fillStyle = STEEL_HI;
  ctx.fillRect(tx + 26, tBase - 30, 14, 2);
  ctx.fillStyle = INK;
  ctx.strokeRect(tx + 26.5, tBase - 29.5, 13, 4);

  // The hut.
  const hx = Math.round(cx - 8);
  const hW = 52;
  const hH = 38;
  panel(ctx, hx, groundY - 7 - hH, hW, hH, PANEL);
  // Roof lip.
  panel(ctx, hx - 3, groundY - 11 - hH, hW + 6, 5, DARK);
  // Door and window.
  ctx.fillStyle = '#2b3242';
  ctx.fillRect(hx + 8, groundY - 7 - 22, 12, 22);
  ctx.strokeStyle = INK;
  ctx.strokeRect(hx + 8.5, groundY - 6.5 - 22, 11, 21);
  ctx.fillStyle = accent;
  ctx.fillRect(hx + 17, groundY - 18, 2, 2);
  pane(ctx, hx + 26, groundY - 7 - 26, 16, 11);

  // The pump, out in front of the hut.
  const px2 = Math.round(cx + 34);
  const py2 = Math.round(groundY - 7);
  panel(ctx, px2, py2 - 22, 14, 22, DARK);
  pane(ctx, px2 + 3, py2 - 18, 8, 6, accent);
  // The hose, curving off the pump and down to the ground.
  ctx.strokeStyle = '#1b2230';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(px2 + 14, py2 - 16);
  ctx.lineTo(px2 + 20, py2 - 16);
  ctx.lineTo(px2 + 22, py2 - 6);
  ctx.lineTo(px2 + 20, py2 - 1);
  ctx.stroke();
  ctx.fillStyle = '#1b2230';
  ctx.fillRect(px2 + 18, py2 - 3, 4, 3);

  signboard(ctx, hx + hW / 2, groundY - 11 - hH - 15, 30, accent, 'drop');
}

/* ------------------------------------------------------------------ */
/* The processor: a tower, a chimney and a conveyor                    */
/* ------------------------------------------------------------------ */

function drawProcessor(ctx, cx, groundY, time, accent) {
  apron(ctx, cx, groundY, 126, accent);

  const bx = Math.round(cx - 30);
  const bW = 58;
  const bH = 66;
  const bTop = groundY - 7 - bH;
  panel(ctx, bx, bTop, bW, bH, PANEL);

  // Panel seams, so the tower reads as plate steel rather than a slab.
  ctx.fillStyle = STEEL_LO;
  for (let y = bTop + 12; y < groundY - 9; y += 16) ctx.fillRect(bx + 2, y, bW - 4, 1);

  // The hopper roof: a stepped trapezoid.
  ctx.fillStyle = DARK;
  for (let i = 0; i < 5; i += 1) {
    ctx.fillRect(bx + 8 + i * 3, bTop - 5 - i * 3, bW - 16 - i * 6, 3);
  }
  ctx.strokeStyle = INK;
  ctx.strokeRect(bx + 7.5, bTop - 5.5, bW - 15, 6);

  // Lit windows up the tower.
  pane(ctx, bx + 8, bTop + 14, 14, 9);
  pane(ctx, bx + 8, bTop + 34, 14, 9);
  pane(ctx, bx + 36, bTop + 14, 14, 9);

  // The auger on the front: eight discrete orientations, so it reads as turning
  // without an anti-aliased arc putting grey pixels in a flat-coloured scene.
  const ax = bx + bW - 16;
  const ay = bTop + 44;
  const step = Math.floor(time * 3) % 8;
  ctx.fillStyle = '#1b2230';
  ctx.fillRect(ax - 10, ay - 10, 20, 20);
  ctx.strokeStyle = INK;
  ctx.strokeRect(ax - 9.5, ay - 9.5, 19, 19);
  ctx.fillStyle = accent;
  for (let i = 0; i < 4; i += 1) {
    const a = ((i * 2 + step) / 8) * Math.PI * 2;
    const tx2 = Math.round(ax + Math.cos(a) * 6);
    const ty2 = Math.round(ay + Math.sin(a) * 6);
    ctx.fillRect(tx2 - 2, ty2 - 2, 4, 4);
  }
  ctx.fillStyle = STEEL_HI;
  ctx.fillRect(ax - 3, ay - 3, 6, 6);
  ctx.strokeStyle = INK;
  ctx.strokeRect(ax - 2.5, ay - 2.5, 5, 5);

  // The chimney, with puffs rising out of it.
  const chx = bx + bW - 8;
  const chTop = bTop - 34;
  panel(ctx, chx, chTop, 12, bTop - chTop, '#6a7284');
  ctx.fillStyle = INK;
  ctx.fillRect(chx - 2, chTop - 3, 16, 3);
  for (let i = 0; i < 3; i += 1) {
    // Each puff rises on its own cycle and drifts right as it goes.
    const t = (time * 0.55 + i / 3) % 1;
    const pxx = chx + 4 + Math.round(t * 14);
    const pyy = chTop - 8 - Math.round(t * 26);
    const size = 3 + Math.round(t * 4);
    ctx.fillStyle = t > 0.7 ? '#6d7688' : '#9aa4b4';
    ctx.fillRect(pxx, pyy, size, size);
  }

  // The conveyor: a ramp from the ground up into the tower, with legs, rollers
  // and a couple of ore chunks riding it.
  const c0x = Math.round(cx - 62);
  const c1x = Math.round(bx + 6);
  const c0y = Math.round(groundY - 8);
  const c1y = Math.round(bTop + 30);
  ctx.strokeStyle = '#4a5262';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(c0x, c0y);
  ctx.lineTo(c1x, c1y);
  ctx.stroke();
  ctx.strokeStyle = STEEL_HI;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(c0x, c0y - 1);
  ctx.lineTo(c1x, c1y - 1);
  ctx.stroke();
  // Legs.
  ctx.fillStyle = DARK;
  for (const f of [0.3, 0.7]) {
    const lx = Math.round(c0x + (c1x - c0x) * f);
    const ly = Math.round(c0y + (c1y - c0y) * f);
    ctx.fillRect(lx, ly, 3, Math.round(groundY - 8 - ly));
  }
  // Ore chunks on the belt, moving with the same cycle as the auger.
  ctx.fillStyle = accent;
  for (let i = 0; i < 3; i += 1) {
    const f = ((time * 0.25 + i / 3) % 1);
    const ox = Math.round(c0x + (c1x - c0x) * f);
    const oy = Math.round(c0y + (c1y - c0y) * f);
    ctx.fillRect(ox - 2, oy - 6, 5, 5);
  }

  signboard(ctx, cx + 22, bTop - 30, 34, accent, 'gem');
}

/* ------------------------------------------------------------------ */
/* The store: wide, low, with an awning and crates                     */
/* ------------------------------------------------------------------ */

function drawStore(ctx, cx, groundY, time, accent) {
  apron(ctx, cx, groundY, 132, accent);

  const bx = Math.round(cx - 40);
  const bW = 74;
  const bH = 40;
  const bTop = groundY - 7 - bH;
  panel(ctx, bx, bTop, bW, bH, PANEL);

  /*
   * A stepped pitched roof with a raised central gable.
   *
   * The store is meant to read as the wide, low one of the three, but a flat
   * parapet made its outline almost featureless - eight distinct heights across
   * its whole width, against the processor's thirty-two. A pitched roof drawn in
   * whole-pixel steps gives it a shape you can name from across the mine while
   * keeping it the shortest of the three buildings.
   */
  const eave = 3;
  const ridge = 13;
  /*
   * The taper is measured as an inset *per side*, growing one pixel per row.
   *
   * The first version scaled the inset by `bW / 2 - gable + eave`, which here is
   * `37 - 40 + 3` - zero - so every step spanned the full width and the "pitched
   * roof" came out as a plain rectangle. The taper has to be a function of the
   * row alone; the eave overhang is already in the x0/x1 bounds.
   */
  const taper = Math.round(bW * 0.34 + eave);
  for (let i = 0; i < ridge; i += 1) {
    const inset = Math.round((i / (ridge - 1)) * taper);
    const x0 = bx - eave + inset;
    const x1 = bx + bW + eave - inset;
    ctx.fillStyle = i % 2 === 0 ? '#3b4351' : '#4a5464';
    ctx.fillRect(x0, bTop - 2 - i, x1 - x0, 1);
  }
  // The ridge cap, drawn to the same width as the topmost step.
  ctx.fillStyle = INK;
  ctx.fillRect(bx - eave + taper, bTop - ridge - 2, bW + eave * 2 - taper * 2, 2);
  // The roof edge, so the tiles do not float.
  ctx.fillStyle = DARK;
  ctx.fillRect(bx - eave, bTop - 3, bW + eave * 2, 3);

  // The gable tower: a raised box carrying the sign, which is the store's
  // landmark the way the tank and the chimney are the others'.
  const gw = 30;
  const gTop = bTop - 16;
  panel(ctx, cx - gw / 2, gTop, gw, 18, '#6a7284');
  ctx.fillStyle = DARK;
  for (let i = 0; i < 4; i += 1) {
    ctx.fillRect(Math.round(cx - gw / 2 - 3 + i * 2), gTop - 4 - i * 2, gw + 6 - i * 4, 2);
  }
  ctx.strokeStyle = INK;
  ctx.strokeRect(cx - gw / 2 - 3.5, gTop - 4.5, gw + 6, 3);
  pane(ctx, cx - 5, gTop + 5, 10, 8);

  // A chimney on the left shoulder, so the two ends of the roofline differ.
  ctx.fillStyle = '#6a7284';
  ctx.fillRect(bx + 4, bTop - 20, 9, 18);
  ctx.fillStyle = STEEL_HI;
  ctx.fillRect(bx + 4, bTop - 20, 9, 2);
  ctx.fillStyle = INK;
  ctx.strokeRect(bx + 4.5, bTop - 19.5, 8, 17);
  ctx.fillRect(bx + 3, bTop - 22, 11, 3);

  /*
   * The shopfront, laid out under the awning rather than behind it.
   *
   * The wall is only 40px tall, so the awning, the windows and the door have to
   * be stacked in that order and not overlap: awning across the top, windows
   * below it, door at street level. Drawing them independently put the awning
   * over the top of both windows and hid their highlights.
   */
  const ax = bx + 4;
  const aw = bW - 8;
  const ay = groundY - 7 - 34;
  ctx.fillStyle = accent;
  ctx.fillRect(ax, ay, aw, 9);
  ctx.fillStyle = '#e8eef8';
  for (let i = 0; i < aw; i += 10) ctx.fillRect(ax + i, ay, 5, 9);
  ctx.fillStyle = INK;
  ctx.fillRect(ax, ay - 1, aw, 1);
  // Scalloped bottom edge, and the valance line above it.
  for (let i = 0; i < aw; i += 10) {
    ctx.fillStyle = accent;
    ctx.fillRect(ax + i, ay + 9, 5, 3);
    ctx.fillStyle = '#e8eef8';
    ctx.fillRect(ax + i + 5, ay + 9, 5, 3);
  }
  // Support struts back to the wall, so the awning is attached to something.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  for (const sx of [ax + 2, ax + aw - 3]) {
    ctx.beginPath();
    ctx.moveTo(sx + 0.5, ay);
    ctx.lineTo(sx + 0.5, ay - 7);
    ctx.lineTo(bx + 6.5, ay - 7);
    ctx.stroke();
  }

  // Windows and door, all clear of the awning above them.
  pane(ctx, bx + 7, ay + 15, 18, 13);
  pane(ctx, bx + bW - 25, ay + 15, 18, 13);
  ctx.fillStyle = '#2b3242';
  ctx.fillRect(bx + 30, groundY - 7 - 20, 14, 20);
  ctx.strokeStyle = INK;
  ctx.strokeRect(bx + 30.5, groundY - 6.5 - 20, 13, 19);
  ctx.fillStyle = accent;
  ctx.fillRect(bx + 41, groundY - 17, 2, 3);

  // Crates stacked against the wall.
  const crate = (x, y, s) => {
    ctx.fillStyle = '#8a6234';
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = '#a87c46';
    ctx.fillRect(x, y, s, 2);
    ctx.fillRect(x, y, 2, s);
    ctx.fillStyle = '#5f4122';
    ctx.fillRect(x, y + s - 2, s, 2);
    ctx.fillRect(x + s - 2, y, 2, s);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
    // Bracing.
    ctx.beginPath();
    ctx.moveTo(x + 1, y + 1);
    ctx.lineTo(x + s - 1, y + s - 1);
    ctx.moveTo(x + s - 1, y + 1);
    ctx.lineTo(x + 1, y + s - 1);
    ctx.stroke();
  };
  const gx = Math.round(cx + 54);
  crate(gx, groundY - 8 - 16, 16);
  crate(gx + 17, groundY - 8 - 16, 16);
  crate(gx + 8, groundY - 8 - 32, 16);

  // A vent puffing on the roof, so the store is not the only still building.
  const vx = bx + bW - 12;
  ctx.fillStyle = DARK;
  ctx.fillRect(vx, bTop - 12, 8, 10);
  const t = (time * 0.4) % 1;
  ctx.fillStyle = t > 0.6 ? '#6d7688' : '#9aa4b4';
  ctx.fillRect(vx + 2 + Math.round(t * 6), bTop - 19 - Math.round(t * 14), 3 + Math.round(t * 3), 3 + Math.round(t * 3));

  // The sign, on the gable tower rather than on a gantry in mid-air.
  signboard(ctx, cx, gTop - 20, 38, accent, 'wrench');
}

const RENDERERS = { fuel: drawFuel, sell: drawProcessor, shop: drawStore };

/**
 * Draws every facility. `groundY` is the screen y of the grass line.
 */
export function drawFacilities(ctx, facilities, origin, groundY, time) {
  for (const facility of facilities) {
    const draw = RENDERERS[facility.key];
    if (!draw) continue;
    draw(ctx, facility.col * TILE - origin.x, groundY, time, facility.color);
  }
}