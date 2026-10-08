# Deepcore

A browser remake of **Motherload** - drill into a procedurally generated mine,
haul the ore home, upgrade the pod, and find out what is at the bottom.

Plain HTML, CSS and JavaScript. **No dependencies. No build step. No bundler.**

![The title screen](docs/screenshot.png)

```bash
npm start          # http://127.0.0.1:8765
```

**Play it:** <https://ribaumorju.github.io/motherload2026/>

Any static host will do; there is nothing to compile. The only reason a local
server is needed at all is that ES modules do not load over `file://`.

> **Fan project.** Not affiliated with, endorsed by, or connected to XGen Studios.
> Motherload is their game; this is an unaffiliated tribute reimplementation
> written from scratch. All code here is original.

---

## The game

The loop is the original's: dig down, come back up, sell, upgrade, go deeper.

- **12,800 feet** of mine, generated from a seed, with ten ores unlocking as you
  descend and three things that want to kill you.
- **Six upgrade ladders** - drill, hull, engine, radiator, fuel tank, cargo bay -
  seven tiers each.
- **Kilograms, not tiles.** The hold is measured by weight, so the heavy cheap
  ore near the surface fills it in a handful of tiles while a ruby barely
  registers. That one choice is what makes the early game about volume and the
  late game about surviving long enough to carry the find home.
- **The drill follows the controls.** Hold a direction and the bit cuts that
  way - sideways to chase a seam, upward to tunnel out of a cavern you fell
  into, downward to descend. Tunnelling up is slower and dearer than flying, so
  it never becomes the way home, only the way out of a trap.
- **Gas pockets** that look exactly like rock until your drill touches one.
  **Lava** that the drill will not cut and that cooks you if you get close, so
  you route around it or blast through it. **Hard landings** that cost hull.
- **Running out of fuel or wrecking the pod costs you the hold, never your
  upgrades.** Dying is a setback measured in one trip, not in the run.
- **Mr. Natas**, at the bottom, behind more rock than any sane person would dig.

Arrow keys or WASD to fly, hold `Space` to drill, `E` to dock at the surface
buildings, `Esc` to pause, `M` to mute. On a phone the left half of the screen is
a stick and the right half drills.

Two rules are worth knowing before you start, because they are the ones the game
does not explain twice:

- **Lava cannot be drilled.** The drill refuses it. Explosives will clear it, so
  a pool is a detour rather than a wall.
- **Falling down your own shaft is safe.** A terminal-velocity landing costs
  about a point and a half of hull. The things that end a run are gas, lava and
  an empty tank.

---

## Layout

```
index.html            the shell: a canvas and a div for the HUD
styles/game.css       the whole interface
src/
  config.js           every tunable number in the game, in one file
  audio.js            procedural sound; there are no audio files
  input.js            keyboard, pointer and touch, reduced to one object
  hud.js              the DOM overlay: meters, depth gauge, radar, toasts
  menus.js            title, help, pause, shop, end screen
  main.js             the loop, and the wiring between sim and screen
  sim/                the game itself - no DOM, no canvas, runs in Node
    rng.js            seeded randomness
    world.js          the mine: tile storage, generation, carving
    physics.js        collision and movement helpers
    game.js           state, step(), digging, economy, hazards
    save.js           save and load
  render/             everything that turns state into pixels
    camera.js         follow, lead and shake
    palette.js        the colour of depth
    atlas.js          every tile sprite, drawn once at startup
    world.js          sky, tiles, facilities, Mr. Natas, lighting
    ship.js           the pod
    fx.js             particles, floating text, vignette, CRT
tests/selftest.mjs    the sim's own test suite, in Node
tools/                dev server, test runners, screenshot sheet
```

### Why it is split this way

**The simulation does not know the browser exists.** `sim/` imports nothing from
`render/`, never touches `document`, and never reads a key. It takes
`step(state, dt, input)` and writes what happened into `state.events`; `main.js`
drains those events and turns them into sound and toasts.

That is not architecture for its own sake. It means the entire game - movement,
digging, economy, hazards, the save file - is testable in Node in a few
milliseconds, with no headless browser and no mocking. `tests/selftest.mjs` runs
five simulated minutes of mining and trading and asserts the run stays
consistent. None of that would be possible if the sim could reach the DOM.

**The sim runs on a fixed timestep, the renderer on the real one.** Physics that
varies with frame rate is physics that behaves differently on a laptop and a
phone, and the drill is a rate over time - the one thing that must not vary.

**The HUD is DOM, not canvas.** It is text and bars that have to stay crisp at
any pixel ratio, respond to hover, and be readable by a screen reader. Canvas is
the wrong tool for all three. The only canvas in the interface is the depth
gauge, which is genuinely a picture.

---

## Verifying it

```bash
npm test           # everything: syntax, sim, then the real browser
npm run test:sim   # the sim alone, in Node - fast
npm run shots      # render the visual sheet to tools/shots/sheet.png
npm run fuel       # can a tank reach the bottom and get home?
npm run balance    # play 30 simulated minutes with a bot and report
```

`npm test` runs three layers:

1. **Syntax** - every module parses.
2. **Sim** (69 checks) - generation is deterministic per seed, the sky is never
   breached, the pod never ends up inside rock, ore respects its depth gate,
   gas detonates, lava burns and refuses the drill, explosives clear it anyway,
   the economy never overdraws, every event the sim emits is handled, the save
   round-trips, and five simulated minutes of play stay consistent.
3. **Browser** (47 checks) - the real page in headless Chrome: every module
   imports, the atlas builds, real frames draw into a real canvas, the HUD
   mounts, every menu opens, every sound cue plays, and a save survives a real
   `localStorage` round trip. A second pass boots the real `src/main.js` and
   drives its loop, because a test of the parts says nothing about the wiring.

The browser layer also samples **actual pixels**, because the things that break
silently in a renderer are visual and no assertion about state catches them: the
headlight has to actually light the rock, the mine has to get darker with depth,
the palette has to interpolate, ore has to be brighter than the rock around it,
and the frame must not be blank.

`npm run shots` writes a sheet rendering the game at six depths, which is how
the look gets reviewed without playing to 9,000 feet.

### The two tools that are not tests

`npm run fuel` answers the single most important number in the game - can a full
tank dig a hole and get home again - for every tank tier. It is not obvious from
the config, and a tank that cannot pay for a round trip makes the first minute
unwinnable while looking like a difficulty problem.

`npm run balance` plays the game with a bot and reports what happened: trips,
earnings, how far it got, where its time went, and the cause of every wreck. The
bot digs straight down and dodges lava by looking one square ahead, which is a
much worse miner than a person with a radar and a hull bar. Its results are
therefore a *lower* bound, and its wrecks are not treated as a balance failure -
tuning the hazards until a blind digger survives them would be the opposite of
what makes them hazards. What it is good for is the shape of the run, and it
found most of the real bugs in this project.

---

## Notes on the implementation

**The mine is stored in flat typed arrays.** A `Uint8Array` for the tile kind and
variant, a second for ore ids, a `Float32Array` for drill progress. Only the
tiles on screen are drawn, which is what keeps a 400-row mine at a steady frame
rate. Ore ids live in their own array because packing them into the same byte
worked right up until the tenth ore arrived and there was no room left.

**The drill does not cut a square until that square is gone.** An earlier version
pushed the pod into the tile while it was still cutting, so the target advanced
before the current square was finished, the drill spread its damage across a run
of half-cut tiles and finished almost none of them. It looked like a very slow
drill rather than a bug, and it took a bot playing for thirty minutes to make it
visible.

**The pod is 26px wide in a 32px tunnel, so the drill steers it.** Left alone it
drifts until its hull straddles two columns, and then the one-tile tunnel it just
dug is too narrow for it to enter. The bit centring the pod reads as the drill
steering the ship, which is also what it is.

**The tiles are pre-rendered.** Every rock, ore, gas and lava sprite is drawn
once at startup at 2x and blitted. Per-pixel noise per tile per frame is a way to
spend an entire frame on the background.

**The darkness is a separate canvas at quarter resolution.** Build the dark,
punch holes in it with `destination-out` for the headlight and every glow, then
composite once. Per-tile alpha would look like a grid; a per-pixel JS pass would
cost more than the rest of the frame combined.

**Saving is a seed and a list of holes.** The terrain is fully determined by its
seed, so the only thing worth storing is what the player changed. A deep run
saves in a few kilobytes.

**Sound is synthesised.** No audio files, so nothing to download and nothing to
licence - and the drill can be a continuous voice whose pitch tracks how hard
the rock is, rather than a sample that has to be crossfaded.

**The depth palette interpolates between eight bands** rather than switching at
depths, because a hard colour change reads as a rendering bug. The rock goes
warm brown, grey, cold slate, near-black purple, and finally black lit from
within by red.

### Deliberate simplifications

- The mine is one screen wide. The original scrolled horizontally too; a single
  column makes the depth gauge honest and the trip home a real decision.
- There is no shop restocking, no day cycle, and no random events. The pressure
  comes from fuel, hull and depth.
- The engine's effect on speed is smaller than the original's, because the
  original's top tier outran the frame rate rather than the player.
- The pod can dig upward, which the original did not allow. Without it, a pod
  that falls into one of the mine's enclosed caverns can never get out, and the
  only escape is to be wrecked on purpose.

---

## Credits

Motherload was made by **XGen Studios** in 2004. This is an unaffiliated tribute
built from scratch: no original assets, code or data are used. Ore values, tier
prices and tier names follow the original's tables so the progression feels
familiar; everything else - the generation, the physics, the rendering, the
audio - is new.
