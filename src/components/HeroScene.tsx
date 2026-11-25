import { useEffect, useRef } from "react";

/*
 * The Play screen's backdrop: an original dusk landscape in the spirit of Valheim (world tree
 * across the sky, snowy peaks, pine hills, a longhouse and a campfire). It's drawn as SVG,
 * rendered small to a canvas and scaled up with hard pixels for the game's low-res look, with
 * live embers and fog on top. No game art is used.
 */

const W = 1200;
const H = 360;
const FIRE = { x: 812, y: 322 };
const DOOR = { x: 985, y: 316 };

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const f = (n: number) => n.toFixed(1);

function hillPath(base: number, waves: [number, number, number][], bottom = H) {
  let d = `M0 ${bottom} `;
  for (let x = 0; x <= W; x += 12) {
    const y = base + waves.reduce((s, [a, freq, ph]) => s + a * Math.sin(x * freq + ph), 0);
    d += `L${x} ${f(y)} `;
  }
  return `${d}L${W} ${bottom} Z`;
}

function hillY(x: number, base: number, waves: [number, number, number][]) {
  return base + waves.reduce((s, [a, freq, ph]) => s + a * Math.sin(x * freq + ph), 0);
}

function pine(x: number, y: number, h: number) {
  const w = h * 0.4;
  const p = (dx: number, dy: number) => `${f(x + dx * w)} ${f(y - dy * h)}`;
  return `M${p(0, 1)}L${p(0.26, 0.7)}L${p(0.14, 0.7)}L${p(0.4, 0.4)}L${p(0.24, 0.4)}L${p(0.52, 0.06)}L${p(0.06, 0.06)}L${p(0.06, -0.02)}L${p(-0.06, -0.02)}L${p(-0.06, 0.06)}L${p(-0.52, 0.06)}L${p(-0.24, 0.4)}L${p(-0.4, 0.4)}L${p(-0.14, 0.7)}L${p(-0.26, 0.7)}Z`;
}

function forest(seed: number, base: number, waves: [number, number, number][], count: number, minH: number, maxH: number, x0 = 0, x1 = W) {
  const r = rng(seed);
  let d = "";
  for (let i = 0; i < count; i++) {
    const x = x0 + r() * (x1 - x0);
    d += pine(x, hillY(x, base, waves) + 4, minH + r() * (maxH - minH));
  }
  return d;
}

function peaks(list: [number, number, number][], baseY: number) {
  let rock = "";
  let snow = "";
  for (const [x, h, w] of list) {
    const top = baseY - h;
    rock += `M${x - w} ${baseY}L${x - w * 0.35} ${top + h * 0.35}L${x - w * 0.12} ${top + h * 0.12}L${x} ${top}L${x + w * 0.18} ${top + h * 0.2}L${x + w * 0.4} ${top + h * 0.3}L${x + w} ${baseY}Z`;
    const s = 0.3;
    snow += `M${x} ${top}L${x + w * 0.18} ${top + h * 0.2}L${x + w * 0.26} ${top + h * s}L${x + w * 0.12} ${top + h * (s - 0.07)}L${x + w * 0.02} ${top + h * (s + 0.04)}L${x - w * 0.1} ${top + h * (s - 0.06)}L${x - w * 0.2} ${top + h * (s + 0.02)}L${x - w * 0.12} ${top + h * 0.12}Z`;
  }
  return { rock, snow };
}

function stars(n: number) {
  const r = rng(7);
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = r() * W;
    const y = r() * 120;
    s += `<rect x="${f(x)}" y="${f(y)}" width="1.6" height="1.6" fill="#fff" opacity="${f(0.25 + r() * 0.6)}"/>`;
  }
  return s;
}

const FAR: [number, number, number][] = [[10, 0.006, 1], [6, 0.017, 2], [3, 0.05, 0.5]];
const MID: [number, number, number][] = [[12, 0.004, 3], [7, 0.013, 1], [3, 0.041, 2]];
const NEAR: [number, number, number][] = [[8, 0.003, 0.4], [5, 0.011, 2.2], [2, 0.05, 1]];

function sceneSvg() {
  const mtn = peaks(
    [
      [120, 120, 170],
      [330, 165, 210],
      [560, 110, 160],
      [760, 185, 230],
      [1010, 140, 200],
      [1170, 95, 140],
    ],
    250,
  );
  const ridge = 296;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#08131c"/>
      <stop offset="0.45" stop-color="#173444"/>
      <stop offset="0.75" stop-color="#3c5a5c"/>
      <stop offset="0.92" stop-color="#b8743a"/>
      <stop offset="1" stop-color="#e09a4a"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.78" cy="0.72" r="0.45">
      <stop offset="0" stop-color="#ffcf7a" stop-opacity="0.75"/>
      <stop offset="0.35" stop-color="#f0903a" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#f0903a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fireglow" cx="${FIRE.x / W}" cy="${FIRE.y / H}" r="0.22">
      <stop offset="0" stop-color="#ffb45a" stop-opacity="0.75"/>
      <stop offset="0.4" stop-color="#ff7a20" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ff7a20" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fc0c0" stop-opacity="0"/>
      <stop offset="1" stop-color="#c8d6cf" stop-opacity="0.35"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="2.2"/></filter>
    <filter id="softer"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars(90)}
  <rect width="${W}" height="${H}" fill="url(#sun)"/>

  <!-- the world tree: huge pale branches across the sky -->
  <g fill="none" stroke="#bcd8d2" stroke-linecap="round" opacity="0.2" filter="url(#soft)">
    <path d="M250 260 C 240 190, 230 120, 270 40 S 330 -40, 300 -80" stroke-width="46"/>
    <path d="M262 120 C 360 70, 520 60, 700 20 S 980 -30, 1260 10" stroke-width="22"/>
    <path d="M268 80 C 180 40, 90 30, -40 50" stroke-width="18"/>
    <path d="M520 62 C 600 100, 700 110, 820 90" stroke-width="9"/>
    <path d="M700 20 C 760 60, 860 70, 980 50 S 1120 60, 1210 90" stroke-width="10"/>
    <path d="M150 40 C 120 70, 70 80, 10 100" stroke-width="7"/>
    <path d="M880 0 C 920 30, 990 30, 1060 10" stroke-width="6"/>
    <path d="M400 70 C 430 110, 480 130, 540 140" stroke-width="5"/>
  </g>
  <g fill="#bcd8d2" opacity="0.1" filter="url(#softer)">
    <ellipse cx="760" cy="40" rx="260" ry="34"/>
    <ellipse cx="250" cy="70" rx="160" ry="30"/>
  </g>

  <!-- far mountains -->
  <path d="${mtn.rock}" fill="#2f4a55"/>
  <path d="${mtn.snow}" fill="#dfe9ea" opacity="0.85"/>
  <rect y="150" width="${W}" height="110" fill="url(#haze)"/>

  <!-- far forest -->
  <path d="${hillPath(262, FAR)}" fill="#1d3134"/>
  <path d="${forest(11, 262, FAR, 150, 14, 30)}" fill="#1d3134"/>
  <rect y="220" width="${W}" height="80" fill="url(#haze)" opacity="0.7"/>

  <!-- mid forest -->
  <path d="${hillPath(290, MID)}" fill="#142224"/>
  <path d="${forest(23, 290, MID, 90, 26, 54)}" fill="#142224"/>

  <!-- near ground -->
  <path d="${hillPath(ridge + 26, NEAR)}" fill="#0b1112"/>
  <path d="${forest(41, ridge + 26, NEAR, 16, 60, 110, 0, 600)}" fill="#0b1112"/>
  <path d="${forest(43, ridge + 26, NEAR, 4, 70, 120, 1110, 1200)}" fill="#0b1112"/>

  <rect width="${W}" height="${H}" fill="url(#fireglow)"/>

  <!-- longhouse -->
  <g>
    <path d="M900 330 L900 300 L1080 300 L1080 330 Z" fill="#160f0a"/>
    <path d="M884 304 L922 258 L1058 258 L1096 304 Z" fill="#20160e"/>
    <path d="M884 304 L922 258 L1058 258 L1096 304" fill="none" stroke="#3a2a1a" stroke-width="2"/>
    <g stroke="#20160e" stroke-width="5" stroke-linecap="round" fill="none">
      <path d="M914 268 L934 236 Q 938 228 946 232"/>
      <path d="M930 268 L910 236 Q 906 228 898 232"/>
      <path d="M1050 268 L1070 236 Q 1074 228 1082 232"/>
      <path d="M1066 268 L1046 236 Q 1042 228 1034 232"/>
    </g>
    <rect x="${DOOR.x - 9}" y="${DOOR.y - 20}" width="18" height="20" fill="#ffb24d"/>
    <rect x="${DOOR.x - 9}" y="${DOOR.y - 20}" width="18" height="20" fill="#ff8a2a" opacity="0.7" filter="url(#soft)"/>
    <rect x="930" y="306" width="8" height="6" fill="#f0a040" opacity="0.85"/>
    <rect x="1040" y="306" width="8" height="6" fill="#f0a040" opacity="0.85"/>
    <path d="M${DOOR.x - 30} 330 L${DOOR.x + 30} 330 L${DOOR.x + 12} ${DOOR.y} L${DOOR.x - 12} ${DOOR.y} Z" fill="#ffae50" opacity="0.18"/>
    <g fill="#8f9592" opacity="0.18" filter="url(#softer)">
      <ellipse cx="992" cy="236" rx="10" ry="16"/>
      <ellipse cx="1004" cy="206" rx="14" ry="20"/>
      <ellipse cx="1022" cy="170" rx="20" ry="24"/>
    </g>
  </g>

  <!-- campfire -->
  <g>
    <path d="M${FIRE.x - 14} ${FIRE.y + 4} L${FIRE.x + 14} ${FIRE.y - 2} M${FIRE.x - 14} ${FIRE.y - 2} L${FIRE.x + 14} ${FIRE.y + 4}" stroke="#2a1a10" stroke-width="4"/>
    <path d="M${FIRE.x - 9} ${FIRE.y} Q ${FIRE.x - 6} ${FIRE.y - 14} ${FIRE.x} ${FIRE.y - 24} Q ${FIRE.x + 5} ${FIRE.y - 12} ${FIRE.x + 9} ${FIRE.y} Z" fill="#ff8a1e"/>
    <path d="M${FIRE.x - 4} ${FIRE.y} Q ${FIRE.x - 2} ${FIRE.y - 8} ${FIRE.x + 1} ${FIRE.y - 14} Q ${FIRE.x + 3} ${FIRE.y - 6} ${FIRE.x + 4} ${FIRE.y} Z" fill="#ffd27a"/>
    <g fill="#2b2622">
      <ellipse cx="${FIRE.x - 18}" cy="${FIRE.y + 5}" rx="5" ry="3"/>
      <ellipse cx="${FIRE.x + 18}" cy="${FIRE.y + 5}" rx="5" ry="3"/>
    </g>
  </g>

  <!-- a standing rune stone -->
  <path d="M700 334 L702 300 Q 708 288 716 292 L720 334 Z" fill="#0e1414"/>
  <path d="M707 300 L712 312 L707 322 M712 312 L714 304" stroke="#3a6a6a" stroke-width="1.2" fill="none" opacity="0.7"/>
</svg>`;
}

/** Map a scene coordinate to the element, with the same "cover from the bottom" crop as the art. */
function mapper(w: number, h: number) {
  const s = Math.max(w / W, h / H);
  const ox = (w - W * s) / 2;
  const oy = h - H * s;
  return { s, x: (x: number) => ox + x * s, y: (y: number) => oy + y * s };
}

export function HeroScene() {
  const box = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLCanvasElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);

  // Pixel-art render of the landscape, redone when the hero changes size.
  useEffect(() => {
    const el = box.current;
    const canvas = art.current;
    if (!el || !canvas) return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([sceneSvg()], { type: "image/svg+xml" }));
    let raf = 0;
    const draw = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height || !img.complete) return;
      const px = 3; // one game "pixel" = 3 screen pixels
      canvas.width = Math.ceil(width / px);
      canvas.height = Math.ceil(height / px);
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      const m = mapper(canvas.width, canvas.height);
      ctx.drawImage(img, m.x(0), m.y(0), W * m.s, H * m.s);
    };
    img.onload = draw;
    img.src = url;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      URL.revokeObjectURL(url);
    };
  }, []);

  // Embers from the fire and the longhouse door, plus a flickering firelight.
  useEffect(() => {
    const el = box.current;
    const canvas = fx.current;
    if (!el || !canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d")!;
    type Ember = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number };
    let embers: Ember[] = [];
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { width, height } = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const m = mapper(width, height);

      // firelight flicker
      const t = now / 1000;
      const flick = 0.55 + 0.2 * Math.sin(t * 7.3) + 0.12 * Math.sin(t * 13.1) + 0.08 * Math.sin(t * 23.7);
      const g = ctx.createRadialGradient(m.x(FIRE.x), m.y(FIRE.y - 8), 0, m.x(FIRE.x), m.y(FIRE.y - 8), 70 * m.s);
      g.addColorStop(0, `rgba(255,170,80,${0.32 * flick})`);
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      // spawn
      if (embers.length < 60 && Math.random() < dt * 22) {
        const fromDoor = Math.random() < 0.15;
        const src = fromDoor ? { x: 1000, y: 252 } : { x: FIRE.x, y: FIRE.y - 16 };
        embers.push({
          x: m.x(src.x) + (Math.random() - 0.5) * 8 * m.s,
          y: m.y(src.y),
          vx: (Math.random() - 0.3) * 14 * m.s,
          vy: -(22 + Math.random() * 30) * m.s,
          life: 0,
          max: 1.6 + Math.random() * 2.2,
          size: Math.max(1.5, (1 + Math.random() * 1.4) * m.s * 1.6),
        });
      }
      embers = embers.filter((e) => e.life < e.max);
      for (const e of embers) {
        e.life += dt;
        e.x += (e.vx + Math.sin(t * 2 + e.max * 9) * 10 * m.s) * dt;
        e.y += e.vy * dt;
        const a = 1 - e.life / e.max;
        ctx.fillStyle = `rgba(255,${Math.round(150 + 80 * a)},70,${a})`;
        const s = Math.round(e.size);
        ctx.fillRect(Math.round(e.x), Math.round(e.y), s, s);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="hero-scene" ref={box} aria-hidden>
      <canvas ref={art} className="hero-pixels" />
      <div className="hero-fog" />
      <canvas ref={fx} className="hero-fx" />
    </div>
  );
}

/** The user's own picture instead of the scene. */
export function HeroPicture({ src }: { src: string }) {
  return (
    <div className="hero-scene" aria-hidden>
      <img className="hero-photo" src={src} alt="" draggable={false} />
    </div>
  );
}
