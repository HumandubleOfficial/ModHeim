/*
 * UI sounds and campfire ambience, all synthesized with WebAudio (no audio files, no game
 * sounds). Browsers only allow audio after a user gesture, so the context is created on the
 * first click or key press.
 */

type Cfg = { sounds: boolean; ambience: boolean; volume: number };

let cfg: Cfg = { sounds: true, ambience: true, volume: 0.6 };
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let wantAmbience = false;
let fire: { stop: () => void } | null = null;
let wantRain = false;
let rain: { stop: () => void } | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = cfg.volume;
    master.connect(ctx.destination);
    // 2 s of white noise, reused by every noisy sound
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noiseSource(c: AudioContext, loop = false) {
  const s = c.createBufferSource();
  s.buffer = noise;
  s.loop = loop;
  return s;
}

/** Short envelope on a gain node: quick attack, exponential decay. */
function env(c: AudioContext, peak: number, attack: number, decay: number, at = c.currentTime) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

export const sfx = {
  /** Soft wooden tick when the pointer moves onto a button. */
  hover() {
    if (!cfg.sounds || !ctx || ctx.state !== "running") return;
    const c = ctx;
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(1900, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(1100, c.currentTime + 0.03);
    const g = env(c, 0.05, 0.002, 0.035);
    o.connect(g).connect(master!);
    o.start();
    o.stop(c.currentTime + 0.06);
  },

  /** A dull "thock", like knocking on a shield. */
  click() {
    if (!cfg.sounds) return;
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
    o.connect(env(c, 0.35, 0.003, 0.11)).connect(master!);
    o.start(t);
    o.stop(t + 0.15);
    const n = noiseSource(c);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    n.connect(bp).connect(env(c, 0.12, 0.002, 0.04)).connect(master!);
    n.start(t);
    n.stop(t + 0.08);
  },

  /** A low war horn when the game launches. */
  horn() {
    if (!cfg.sounds) return;
    const c = audio();
    if (!c) return;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.22, t + 0.35);
    out.gain.setValueAtTime(0.22, t + 1.3);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(1300, t + 0.5);
    lp.frequency.exponentialRampToValueAtTime(600, t + 2.3);
    lp.connect(out).connect(master!);
    const vib = c.createOscillator();
    vib.frequency.value = 5;
    const vibAmt = c.createGain();
    vibAmt.gain.value = 1.4;
    vib.connect(vibAmt);
    for (const [f, a] of [
      [98, 1],
      [147, 0.5],
      [196, 0.25],
    ] as const) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.3);
      vibAmt.connect(o.frequency);
      const g = c.createGain();
      g.gain.value = a;
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + 2.5);
    }
    vib.start(t);
    vib.stop(t + 2.5);
  },

  /** Two-note warning for problems found while playing. */
  warn() {
    if (!cfg.sounds) return;
    const c = audio();
    if (!c) return;
    [0, 0.16].forEach((d, i) => {
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = i ? 330 : 440;
      o.connect(env(c, 0.18, 0.01, 0.22, c.currentTime + d)).connect(master!);
      o.start(c.currentTime + d);
      o.stop(c.currentTime + d + 0.3);
    });
  },
};

/** Low rumble plus random crackles and pops. */
function startFire(c: AudioContext) {
  const bed = c.createGain();
  bed.gain.setValueAtTime(0.0001, c.currentTime);
  bed.gain.exponentialRampToValueAtTime(1, c.currentTime + 2.5);
  bed.connect(master!);

  const rumble = noiseSource(c, true);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 320;
  const rg = c.createGain();
  rg.gain.value = 0.07;
  rumble.connect(lp).connect(rg).connect(bed);
  rumble.start();

  // slow "breathing" of the flames
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.23;
  const lfoAmt = c.createGain();
  lfoAmt.gain.value = 0.03;
  lfo.connect(lfoAmt).connect(rg.gain);
  lfo.start();

  let timer = 0;
  const crackle = () => {
    const t = c.currentTime;
    const n = 1 + Math.floor(Math.random() * (Math.random() < 0.2 ? 6 : 2));
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.008 + Math.random() * 0.03);
      const s = noiseSource(c);
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1500 + Math.random() * 4500;
      bp.Q.value = 2 + Math.random() * 3;
      s.connect(bp).connect(env(c, 0.06 + Math.random() * 0.22, 0.001, 0.006 + Math.random() * 0.03, at)).connect(bed);
      s.start(at, Math.random() * 1.5);
      s.stop(at + 0.06);
    }
    timer = window.setTimeout(crackle, 40 + Math.random() * (Math.random() < 0.3 ? 900 : 260));
  };
  crackle();

  return {
    stop() {
      clearTimeout(timer);
      const t = c.currentTime;
      bed.gain.cancelScheduledValues(t);
      bed.gain.setValueAtTime(Math.max(0.0001, bed.gain.value), t);
      bed.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      rumble.stop(t + 0.9);
      lfo.stop(t + 0.9);
    },
  };
}

/** Soft rain: high, gently swelling noise. */
function startRain(c: AudioContext) {
  const bed = c.createGain();
  bed.gain.setValueAtTime(0.0001, c.currentTime);
  bed.gain.exponentialRampToValueAtTime(0.05, c.currentTime + 3);
  bed.connect(master!);
  const n = noiseSource(c, true);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 900;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 7000;
  n.connect(hp).connect(lp).connect(bed);
  n.start();
  return {
    stop() {
      const t = c.currentTime;
      bed.gain.cancelScheduledValues(t);
      bed.gain.setValueAtTime(Math.max(0.0001, bed.gain.value), t);
      bed.gain.exponentialRampToValueAtTime(0.0001, t + 1);
      n.stop(t + 1.1);
    },
  };
}

function syncAmbience() {
  const on = wantAmbience && cfg.ambience && !document.hidden;
  const running = !!ctx && ctx.state === "running";
  if (on && !fire && running) fire = startFire(ctx!);
  if (!on && fire) {
    fire.stop();
    fire = null;
  }
  const rainOn = on && wantRain;
  if (rainOn && !rain && running) rain = startRain(ctx!);
  if (!rainOn && rain) {
    rain.stop();
    rain = null;
  }
}

/** Rain sound under the campfire while the Play scene shows rain. */
export function setRain(on: boolean) {
  wantRain = on;
  syncAmbience();
}

/** The campfire plays while this is on (the Play screen) and the setting allows it. */
export function setAmbience(on: boolean) {
  wantAmbience = on;
  syncAmbience();
}

export function configureSound(next: Cfg) {
  cfg = next;
  if (master && ctx) master.gain.setTargetAtTime(next.volume, ctx.currentTime, 0.05);
  syncAmbience();
}

let installed = false;
/** Hover and click sounds for every button in the app, and the audio unlock on first gesture. */
export function installUiSounds() {
  if (installed) return;
  installed = true;
  let lastHover: Element | null = null;
  const target = (e: Event) =>
    (e.target as Element | null)?.closest?.("button:not(:disabled), [role=button], a[href], .menu-item, input[type=checkbox]");
  document.addEventListener(
    "pointerdown",
    (e) => {
      audio();
      // the context may only now be running
      setTimeout(syncAmbience, 50);
      const el = target(e);
      if (el && !el.closest("[data-silent]")) sfx.click();
    },
    true,
  );
  document.addEventListener("keydown", () => {
    audio();
    setTimeout(syncAmbience, 50);
  }, true);
  document.addEventListener(
    "pointerover",
    (e) => {
      const el = target(e);
      if (el === lastHover) return;
      lastHover = el ?? null;
      if (el && !el.closest("[data-silent]")) sfx.hover();
    },
    true,
  );
  document.addEventListener("visibilitychange", syncAmbience);
}
