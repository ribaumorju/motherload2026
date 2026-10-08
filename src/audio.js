/**
 * Sound, synthesised at runtime.
 *
 * There are no audio files in this project. Everything is oscillators and noise
 * buffers through the Web Audio graph, which means nothing to download, nothing
 * to licence, and - more usefully - the drill can be a continuous voice whose
 * pitch tracks how hard it is working, rather than a looping sample that has to
 * be crossfaded at the seams.
 *
 * Two rules keep this from leaking:
 *
 *   - The drill, the thruster and the depth rumble are *persistent* voices,
 *     started once and left running, with their gain and filter modulated from
 *     game state. Creating and starting a source every frame is the classic Web
 *     Audio leak, and a drill that is on for minutes at a time makes it fatal.
 *   - One-shots are fire-and-forget with an explicit stop time, so nothing is
 *     left scheduled after the game is over.
 *
 * The whole thing is inert until `unlock()` runs from a real user gesture, which
 * is what browsers require; before that every method is a no-op rather than a
 * throw, so the game runs silently instead of dying.
 */

export function createAudio() {
  let ctx = null;
  let master = null;
  let ready = false;
  let muted = false;
  let voices = null;

  /** Builds the graph. Called on the first gesture; browsers require one. */
  function unlock() {
    if (ready) return true;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return false;
    try {
      ctx = new Ctor();
    } catch {
      return false;
    }

    // A gentle limiter, so an explosion on top of a running drill does not clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;

    master = ctx.createGain();
    master.gain.value = 0.55;
    comp.connect(master).connect(ctx.destination);

    voices = {
      drill: makeDrill(comp),
      thrust: makeThrust(comp),
      rumble: makeRumble(comp),
    };
    ready = true;
    return true;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /** One and a half seconds of white noise, reused by every noise voice. */
  function noiseBuffer() {
    const len = Math.floor(ctx.sampleRate * 1.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * The drill: a sawtooth whose pitch follows the rock's hardness, through a
   * bandpass that opens as it bites, plus filtered noise for the grinding. A
   * square LFO on the saw's gain gives it the stutter of a real motor.
   */
  function makeDrill(dest) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 2.5;
    filter.connect(out);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 90;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.35;
    osc.connect(oscGain).connect(filter);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer();
    noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.5;
    noise.connect(noiseGain).connect(filter);

    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 22;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.28;
    lfo.connect(lfoGain).connect(oscGain.gain);

    osc.start();
    noise.start();
    lfo.start();
    return { out, filter, osc, oscGain, noiseGain };
  }

  /** The thruster: filtered noise, brighter the harder you push. */
  function makeThrust(dest) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.connect(out);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer();
    noise.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.8;
    noise.connect(gain).connect(filter);
    noise.start();
    return { out, filter, gain };
  }

  /**
   * A low rumble that tracks depth. At twelve thousand feet the room should feel
   * like it is pressing in; at the surface it is silent.
   */
  function makeRumble(dest) {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(dest);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 90;
    filter.connect(out);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer();
    noise.loop = true;
    noise.connect(filter);
    noise.start();
    return { out, filter };
  }

  /** A one-shot tone with an envelope. The workhorse for every event sound. */
  function blip({
    type = 'square', freq = 440, freqTo = null, dur = 0.12, gain = 0.25,
    attack = 0.005, filterType = 'lowpass', filterFreq = 3000,
  }) {
    if (!ready) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFreq;

    osc.connect(filter).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Filtered noise burst, for anything that should sound like matter moving. */
  function thud({ dur = 0.3, gain = 0.5, freq = 200, freqTo = 40, q = 1 }) {
    if (!ready) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, freqTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /**
   * A short arpeggio, used for money and for the ending. Three or four notes is
   * enough to feel like a reward and cheap enough to fire on every sale.
   */
  function arpeggio(notes, { step = 0.07, gain = 0.2, type = 'triangle' } = {}) {
    if (!ready) return;
    notes.forEach((freq, i) => {
      const t = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  /* ---------------- public surface ---------------- */

  return {
    unlock,
    resume,
    get ready() { return ready; },
    get muted() { return muted; },

    setMuted(value) {
      muted = Boolean(value);
      if (master) master.gain.value = muted ? 0 : 0.55;
    },

    /**
     * Drives the continuous voices from game state. Called once a frame.
     * `hardness` is the rock's resistance at the drill, 1 at the surface and
     * rising with depth, so the drill audibly struggles the deeper you go.
     */
    update(state, hardness) {
      if (!ready) return;
      const t = ctx.currentTime;
      const { drill, thrust, rumble } = voices;

      const drilling = state.ship.drilling;
      drill.out.gain.setTargetAtTime(drilling ? 0.3 : 0, t, drilling ? 0.02 : 0.06);
      drill.osc.frequency.setTargetAtTime(72 + hardness * 46, t, 0.05);
      drill.filter.frequency.setTargetAtTime(360 + hardness * 300, t, 0.08);

      // Loudest when pushing up hard against gravity.
      const pushing = Math.max(0, -state.ship.vy / 400);
      thrust.out.gain.setTargetAtTime(state.ship.thrust * 0.22 + pushing * 0.12, t, 0.05);
      thrust.filter.frequency.setTargetAtTime(400 + state.ship.thrust * 900, t, 0.06);

      // Depth pressure.
      rumble.out.gain.setTargetAtTime(Math.min(0.16, (state.depth / 12800) * 0.2), t, 0.4);
    },

    /* ---- one-shots ---- */

    orePickup(tier) {
      // Higher tiers get a higher, brighter chime. The pitch *is* the value.
      const base = [523, 587, 659, 784, 880][Math.min(4, Math.max(0, tier - 1))] || 523;
      blip({ type: 'triangle', freq: base, freqTo: base * 2, dur: 0.1, gain: 0.16 });
    },

    holdFull() {
      blip({ type: 'square', freq: 200, freqTo: 140, dur: 0.14, gain: 0.14 });
    },

    blast() {
      thud({ dur: 0.55, gain: 0.85, freq: 420, freqTo: 30, q: 2 });
      blip({ type: 'sawtooth', freq: 160, freqTo: 40, dur: 0.4, gain: 0.22 });
    },

    gasBurst() {
      thud({ dur: 0.7, gain: 0.9, freq: 900, freqTo: 60, q: 1 });
      blip({ type: 'sawtooth', freq: 300, freqTo: 60, dur: 0.5, gain: 0.2 });
    },

    damage() {
      thud({ dur: 0.25, gain: 0.6, freq: 260, freqTo: 60, q: 3 });
      blip({ type: 'square', freq: 120, freqTo: 70, dur: 0.18, gain: 0.16 });
    },

    sale(value = 0) {
      arpeggio([523, 659, 784, 1047], { step: 0.06, gain: 0.18 });
      if (value > 50000) arpeggio([1047, 1319], { step: 0.09, gain: 0.14 });
    },

    purchase() {
      blip({ type: 'triangle', freq: 660, freqTo: 990, dur: 0.1, gain: 0.18 });
      blip({ type: 'triangle', freq: 990, freqTo: 1320, dur: 0.12, gain: 0.14 });
    },

    deny() {
      blip({ type: 'square', freq: 180, freqTo: 120, dur: 0.16, gain: 0.16 });
    },

    dock() {
      blip({ type: 'sine', freq: 880, freqTo: 1320, dur: 0.12, gain: 0.14 });
    },

    teleport() {
      blip({ type: 'sine', freq: 1200, freqTo: 120, dur: 0.5, gain: 0.22 });
      thud({ dur: 0.4, gain: 0.3, freq: 1200, freqTo: 200 });
    },

    death() {
      blip({ type: 'sawtooth', freq: 400, freqTo: 30, dur: 1.1, gain: 0.3 });
      thud({ dur: 1.0, gain: 0.9, freq: 500, freqTo: 25, q: 1 });
    },

    win() {
      arpeggio([523, 659, 784, 1047, 1319, 1568], { step: 0.13, gain: 0.22 });
    },

    click() {
      blip({ type: 'square', freq: 520, freqTo: 700, dur: 0.04, gain: 0.1 });
    },

    alarm() {
      blip({ type: 'square', freq: 880, freqTo: 660, dur: 0.22, gain: 0.13 });
    },
  };
}
