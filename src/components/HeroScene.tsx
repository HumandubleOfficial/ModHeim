import { useEffect, useRef, useState } from "react";

/*
 * The Play screen: an original night landscape in the spirit of a Norse main menu (world tree
 * and northern lights across the sky, snowy peaks, pine hills, a longhouse and a campfire at the
 * bottom centre). It's drawn as SVG,
 * rendered small to a canvas and scaled up with hard pixels for the game's low-res look, with
 * live embers and fog on top. No game art is used.
 */

const W = 1600;
const H = 900;
/** Everything that matters sits within x 300..1300, so it survives the side crop of a narrow window. */
const FIRE = { x: 800, y: 842 };
const HOUSE = { x: 1140, y: 800 };
const DOOR = { x: HOUSE.x + 60, y: HOUSE.y - 4 };
const CHIMNEY = { x: HOUSE.x + 30, y: HOUSE.y - 110 };

function rng(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

const f = (n: number) => n.toFixed(1);

type Waves = [number, number, number][];

function hillY(x: number, base: number, waves: Waves) {
  return base + waves.reduce((s, [a, freq, ph]) => s + a * Math.sin(x * freq + ph), 0);
}

function hillPath(base: number, waves: Waves, bottom = H) {
  let d = `M0 ${bottom} `;
  for (let x = 0; x <= W; x += 12) d += `L${x} ${f(hillY(x, base, waves))} `;
  return `${d}L${W} ${bottom} Z`;
}

function pine(x: number, y: number, h: number) {
  const w = h * 0.4;
  const p = (dx: number, dy: number) => `${f(x + dx * w)} ${f(y - dy * h)}`;
  return `M${p(0, 1)}L${p(0.26, 0.7)}L${p(0.14, 0.7)}L${p(0.4, 0.4)}L${p(0.24, 0.4)}L${p(0.52, 0.06)}L${p(0.06, 0.06)}L${p(0.06, -0.02)}L${p(-0.06, -0.02)}L${p(-0.06, 0.06)}L${p(-0.52, 0.06)}L${p(-0.24, 0.4)}L${p(-0.4, 0.4)}L${p(-0.14, 0.7)}L${p(-0.26, 0.7)}Z`;
}

function forest(seed: number, base: number, waves: Waves, count: number, minH: number, maxH: number, x0 = 0, x1 = W) {
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
    const y = r() * r() * 560;
    s += `<rect x="${f(x)}" y="${f(y)}" width="2" height="2" fill="#fff" opacity="${f(0.2 + r() * 0.65)}"/>`;
  }
  return s;
}

const FAR: Waves = [[14, 0.005, 1], [8, 0.015, 2], [3, 0.05, 0.5]];
const MID: Waves = [[16, 0.0035, 3], [9, 0.011, 1], [4, 0.04, 2]];
const NEAR: Waves = [[10, 0.0028, 0.4], [6, 0.009, 2.2], [2, 0.05, 1]];

export type Phase = "dawn" | "day" | "dusk" | "night";
export type Weather = "clear" | "rain" | "snow";

interface Palette {
  sky: string[];
  stars: number;
  /** [x, y, radius, colour, glow opacity] of the sun or moon */
  orb: [number, number, number, string, number];
  moon: boolean;
  aurora: number;
  horizon: string;
  horizonAlpha: number;
  rock: string;
  snow: string;
  far: string;
  mid: string;
  near: string;
  haze: string;
  tree: number;
  fire: number;
}

const PALETTES: Record<Phase, Palette> = {
  night: {
    sky: ["#02060b", "#071420", "#0d2232", "#16303c", "#1f3c44", "#28474c"],
    stars: 1, orb: [1150, 190, 26, "#e9f4ee", 0.35], moon: true, aurora: 0.6,
    horizon: "#5a7a8a", horizonAlpha: 0.12,
    rock: "#1f333d", snow: "#aebfc6", far: "#13221f", mid: "#0d1817", near: "#070b0c",
    haze: "#7e9aa0", tree: 0.15, fire: 0.9,
  },
  dawn: {
    sky: ["#1b2442", "#3a4670", "#76668a", "#c4857a", "#efaa74", "#f6c88e"],
    stars: 0.2, orb: [430, 560, 34, "#ffe2b0", 0.55], moon: false, aurora: 0,
    horizon: "#ffb58a", horizonAlpha: 0.4,
    rock: "#4b4c66", snow: "#f3dcd2", far: "#2c3144", mid: "#1d2232", near: "#0f1118",
    haze: "#f0c3b0", tree: 0.13, fire: 0.6,
  },
  day: {
    sky: ["#2f6fa8", "#4d8bc0", "#79a9cf", "#a9c8da", "#cfe0e2", "#e2ebe4"],
    stars: 0, orb: [1160, 150, 30, "#fff8e0", 0.5], moon: false, aurora: 0,
    horizon: "#fff3d6", horizonAlpha: 0.25,
    rock: "#5d7682", snow: "#f4f8f8", far: "#2f4b43", mid: "#21362d", near: "#121a16",
    haze: "#e8f0ea", tree: 0.12, fire: 0.35,
  },
  dusk: {
    sky: ["#050b11", "#0c1d2a", "#1b3a44", "#3d5653", "#9a6a3c", "#c98444"],
    stars: 0.6, orb: [1150, 190, 26, "#e9f4ee", 0.3], moon: true, aurora: 0.35,
    horizon: "#ffb35a", horizonAlpha: 0.45,
    rock: "#2f4a55", snow: "#dfe9ea", far: "#1d3134", mid: "#142224", near: "#0b1112",
    haze: "#c8d6cf", tree: 0.17, fire: 0.8,
  },
};

export function phaseAt(d = new Date()): Phase {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 5.5 && h < 8.5) return "dawn";
  if (h >= 8.5 && h < 17.5) return "day";
  if (h >= 17.5 && h < 20.5) return "dusk";
  return "night";
}

/** Weather for this hour: mostly clear, sometimes rain, snow more often in winter. Stable within the hour. */
export function weatherAt(d = new Date()): Weather {
  const seed = d.getFullYear() * 1_000_000 + (d.getMonth() + 1) * 10_000 + d.getDate() * 100 + d.getHours();
  const r = rng(seed)();
  const winter = [11, 0, 1].includes(d.getMonth());
  if (r < (winter ? 0.2 : 0.04)) return "snow";
  if (r < (winter ? 0.28 : 0.2)) return "rain";
  return "clear";
}

function sceneSvg(phase: Phase, weather: Weather) {
  const P = PALETTES[phase];
  // clouds dim the sky in bad weather
  const overcast = weather === "clear" ? 0 : 0.35;
  const mtn = peaks(
    [
      [90, 170, 220],
      [360, 250, 280],
      [640, 170, 220],
      [900, 300, 300],
      [1200, 210, 260],
      [1480, 160, 220],
    ],
    650,
  );
  const ground = 800;
  const hx = HOUSE.x;
  const hy = HOUSE.y;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      ${P.sky.map((c, i) => `<stop offset="${[0, 0.3, 0.55, 0.68, 0.75, 0.8][i]}" stop-color="${c}"/>`).join("")}
    </linearGradient>
    <radialGradient id="moonglow" cx="${P.orb[0] / W}" cy="${P.orb[1] / H}" r="0.25">
      <stop offset="0" stop-color="${P.orb[3]}" stop-opacity="${P.orb[4]}"/>
      <stop offset="1" stop-color="${P.orb[3]}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="dusk" cx="0.5" cy="0.76" r="0.6">
      <stop offset="0" stop-color="${P.horizon}" stop-opacity="${P.horizonAlpha}"/>
      <stop offset="0.5" stop-color="${P.horizon}" stop-opacity="${P.horizonAlpha * 0.27}"/>
      <stop offset="1" stop-color="${P.horizon}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fireglow" cx="${FIRE.x / W}" cy="${FIRE.y / H}" r="0.3">
      <stop offset="0" stop-color="#ffb45a" stop-opacity="${P.fire}"/>
      <stop offset="0.35" stop-color="#ff7a20" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#ff7a20" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${P.haze}" stop-opacity="0"/>
      <stop offset="1" stop-color="${P.haze}" stop-opacity="0.35"/>
    </linearGradient>
    <linearGradient id="aurora" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5ff2b0" stop-opacity="0"/>
      <stop offset="0.3" stop-color="#5ff2b0" stop-opacity="0.5"/>
      <stop offset="0.65" stop-color="#58c9e8" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#58c9e8" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
    <filter id="softer"><feGaussianBlur stdDeviation="7"/></filter>
    <filter id="haze-blur"><feGaussianBlur stdDeviation="16"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <g opacity="${P.stars * (1 - overcast * 2)}">${stars(260)}</g>
  <rect width="${W}" height="${H}" fill="url(#moonglow)" opacity="${1 - overcast}"/>
  <circle cx="${P.orb[0]}" cy="${P.orb[1]}" r="${P.orb[2]}" fill="${P.orb[3]}" opacity="${0.9 - overcast * 1.5}"/>
  ${P.moon ? `<circle cx="${P.orb[0] + 10}" cy="${P.orb[1] - 6}" r="${P.orb[2] - 2}" fill="${P.sky[1]}" opacity="${0.55 - overcast}"/>` : ""}

  <!-- northern lights -->
  <g filter="url(#haze-blur)" opacity="${P.aurora * (1 - overcast * 2)}">
    <path d="M120 250 C 380 120, 620 300, 880 170 S 1300 110, 1520 210" stroke="url(#aurora)" stroke-width="46" fill="none"/>
    <path d="M260 330 C 520 230, 760 360, 1040 260 S 1380 230, 1560 300" stroke="url(#aurora)" stroke-width="22" fill="none" opacity="0.6"/>
  </g>

  <!-- the world tree: pale branches across the sky -->
  <g fill="none" stroke="#bcd8d2" stroke-linecap="round" opacity="${P.tree}" filter="url(#soft)">
    <path d="M360 640 C 345 520, 330 380, 380 220 S 460 20, 420 -60" stroke-width="64"/>
    <path d="M378 330 C 520 250, 720 230, 960 170 S 1300 110, 1680 150" stroke-width="30"/>
    <path d="M384 260 C 260 200, 130 190, -40 220" stroke-width="24"/>
    <path d="M720 230 C 820 280, 940 290, 1100 260" stroke-width="11"/>
    <path d="M960 170 C 1040 220, 1160 230, 1320 200 S 1500 220, 1620 260" stroke-width="12"/>
    <path d="M220 200 C 180 240, 110 260, 20 290" stroke-width="9"/>
    <path d="M1180 120 C 1230 160, 1320 160, 1420 130" stroke-width="8"/>
    <path d="M560 250 C 600 300, 660 330, 740 345" stroke-width="6"/>
    <path d="M400 80 C 520 40, 700 30, 880 -20" stroke-width="14"/>
  </g>

  <rect width="${W}" height="${H}" fill="url(#dusk)"/>

  <!-- far mountains -->
  <path d="${mtn.rock}" fill="${P.rock}"/>
  <path d="${mtn.snow}" fill="${P.snow}" opacity="0.85"/>
  <rect y="500" width="${W}" height="160" fill="url(#haze)"/>

  <!-- forests, far to near -->
  <path d="${hillPath(660, FAR)}" fill="${P.far}"/>
  <path d="${forest(11, 660, FAR, 220, 18, 40)}" fill="${P.far}"/>
  <rect y="610" width="${W}" height="100" fill="url(#haze)" opacity="0.7"/>
  <path d="${hillPath(718, MID)}" fill="${P.mid}"/>
  <path d="${forest(23, 718, MID, 130, 34, 74)}" fill="${P.mid}"/>
  <rect y="690" width="${W}" height="70" fill="url(#haze)" opacity="0.35"/>

  <!-- near ground and the tall pines that frame the camp -->
  <path d="${hillPath(ground, NEAR)}" fill="${P.near}"/>
  <path d="${forest(41, ground, NEAR, 26, 140, 300, 0, 470)}" fill="${P.near}"/>
  <path d="${forest(43, ground, NEAR, 18, 160, 320, 1290, W)}" fill="${P.near}"/>
  <path d="${forest(47, ground, NEAR, 5, 90, 150, 480, 560)}" fill="${P.near}"/>

  <rect width="${W}" height="${H}" fill="url(#fireglow)"/>

  ${weather === "snow" ? `<path d="${hillPath(ground + 3, NEAR)}" fill="#dfe7ea" opacity="0.18"/>` : ""}
  ${overcast ? `<rect width="${W}" height="${H}" fill="#4a5560" opacity="${phase === "day" ? 0.3 : 0.18}"/>` : ""}

  <!-- longhouse -->
  <g>
    <path d="M${hx - 110} ${hy + 30} L${hx - 110} ${hy - 6} L${hx + 110} ${hy - 6} L${hx + 110} ${hy + 30} Z" fill="#160f0a"/>
    <path d="M${hx - 130} ${hy} L${hx - 82} ${hy - 58} L${hx + 82} ${hy - 58} L${hx + 130} ${hy} Z" fill="#20160e"/>
    <path d="M${hx - 130} ${hy} L${hx - 82} ${hy - 58} L${hx + 82} ${hy - 58} L${hx + 130} ${hy}" fill="none" stroke="#3a2a1a" stroke-width="2.5"/>
    <g stroke="#20160e" stroke-width="6" stroke-linecap="round" fill="none">
      <path d="M${hx - 96} ${hy - 46} L${hx - 72} ${hy - 86} Q ${hx - 67} ${hy - 96} ${hx - 57} ${hy - 91}"/>
      <path d="M${hx - 76} ${hy - 46} L${hx - 100} ${hy - 86} Q ${hx - 105} ${hy - 96} ${hx - 115} ${hy - 91}"/>
      <path d="M${hx + 76} ${hy - 46} L${hx + 100} ${hy - 86} Q ${hx + 105} ${hy - 96} ${hx + 115} ${hy - 91}"/>
      <path d="M${hx + 96} ${hy - 46} L${hx + 72} ${hy - 86} Q ${hx + 67} ${hy - 96} ${hx + 57} ${hy - 91}"/>
    </g>
    <rect x="${DOOR.x - 11}" y="${DOOR.y - 24}" width="22" height="24" fill="#ffb24d"/>
    <rect x="${DOOR.x - 11}" y="${DOOR.y - 24}" width="22" height="24" fill="#ff8a2a" opacity="0.7" filter="url(#soft)"/>
    <rect x="${hx - 70}" y="${hy + 4}" width="10" height="7" fill="#f0a040" opacity="0.85"/>
    <rect x="${hx - 20}" y="${hy + 4}" width="10" height="7" fill="#f0a040" opacity="0.7"/>
    <path d="M${DOOR.x - 36} ${hy + 30} L${DOOR.x + 36} ${hy + 30} L${DOOR.x + 14} ${DOOR.y} L${DOOR.x - 14} ${DOOR.y} Z" fill="#ffae50" opacity="0.18"/>
    <g fill="#8f9592" opacity="0.16" filter="url(#softer)">
      <ellipse cx="${CHIMNEY.x}" cy="${CHIMNEY.y + 30}" rx="12" ry="20"/>
      <ellipse cx="${CHIMNEY.x + 16}" cy="${CHIMNEY.y - 6}" rx="18" ry="26"/>
      <ellipse cx="${CHIMNEY.x + 40}" cy="${CHIMNEY.y - 52}" rx="26" ry="32"/>
    </g>
  </g>

  <!-- a standing rune stone -->
  <path d="M520 818 L523 768 Q 531 752 542 757 L547 818 Z" fill="#0e1414"/>
  <path d="M531 770 L538 786 L531 800 M538 786 L541 776" stroke="#3a6a6a" stroke-width="1.6" fill="none" opacity="0.7"/>

  <!-- lit ground around the fire -->
  <ellipse cx="${FIRE.x}" cy="${FIRE.y + 12}" rx="190" ry="26" fill="#3a2414" opacity="0.55"/>
  <ellipse cx="${FIRE.x}" cy="${FIRE.y + 10}" rx="90" ry="12" fill="#6a3c1a" opacity="0.45"/>

  <!-- seats: two logs and a stump -->
  <g fill="#120c08">
    <rect x="${FIRE.x - 170}" y="${FIRE.y - 2}" width="80" height="16" rx="8"/>
    <rect x="${FIRE.x + 96}" y="${FIRE.y + 2}" width="70" height="15" rx="7"/>
    <rect x="${FIRE.x - 30}" y="${FIRE.y + 30}" width="22" height="18" rx="3"/>
  </g>
  <g fill="#ff9a40" opacity="0.35">
    <rect x="${FIRE.x - 100}" y="${FIRE.y}" width="10" height="12" rx="5"/>
    <rect x="${FIRE.x + 96}" y="${FIRE.y + 4}" width="8" height="11" rx="4"/>
  </g>

  <!-- campfire -->
  <g>
    <path d="M${FIRE.x - 20} ${FIRE.y + 6} L${FIRE.x + 20} ${FIRE.y - 3} M${FIRE.x - 20} ${FIRE.y - 3} L${FIRE.x + 20} ${FIRE.y + 6}" stroke="#2a1a10" stroke-width="6"/>
    <path d="M${FIRE.x - 13} ${FIRE.y} Q ${FIRE.x - 9} ${FIRE.y - 20} ${FIRE.x} ${FIRE.y - 36} Q ${FIRE.x + 7} ${FIRE.y - 18} ${FIRE.x + 13} ${FIRE.y} Z" fill="#ff8a1e"/>
    <path d="M${FIRE.x - 6} ${FIRE.y} Q ${FIRE.x - 3} ${FIRE.y - 12} ${FIRE.x + 1} ${FIRE.y - 21} Q ${FIRE.x + 4} ${FIRE.y - 9} ${FIRE.x + 6} ${FIRE.y} Z" fill="#ffd27a"/>
    <g fill="#2b2622">
      <ellipse cx="${FIRE.x - 26}" cy="${FIRE.y + 7}" rx="7" ry="4"/>
      <ellipse cx="${FIRE.x + 26}" cy="${FIRE.y + 7}" rx="7" ry="4"/>
      <ellipse cx="${FIRE.x}" cy="${FIRE.y + 10}" rx="7" ry="4"/>
    </g>
  </g>
</svg>`;
}

/** Map a scene coordinate to the element, with the same "cover from the bottom" crop as the art. */
function mapper(w: number, h: number) {
  const s = Math.max(w / W, h / H);
  const ox = (w - W * s) / 2;
  const oy = h - H * s;
  return { s, x: (x: number) => ox + x * s, y: (y: number) => oy + y * s };
}

/** Time of day and weather, rechecked every minute. Dev override: localStorage "modheim.scene" = "day/rain". */
export function useSky(): { phase: Phase; weather: Weather } {
  const read = () => {
    const o = localStorage.getItem("modheim.scene")?.split("/");
    return {
      phase: (o?.[0] as Phase) in PALETTES ? (o![0] as Phase) : phaseAt(),
      weather: ["clear", "rain", "snow"].includes(o?.[1] ?? "") ? (o![1] as Weather) : weatherAt(),
    };
  };
  const [sky, setSky] = useState(read);
  useEffect(() => {
    const t = setInterval(() => {
      const n = read();
      setSky((o) => (o.phase === n.phase && o.weather === n.weather ? o : n));
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  return sky;
}

export function HeroScene({ phase, weather }: { phase: Phase; weather: Weather }) {
  const box = useRef<HTMLDivElement>(null);
  const art = useRef<HTMLCanvasElement>(null);
  const fx = useRef<HTMLCanvasElement>(null);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;

  // Pixel-art render of the landscape, redone when the hero changes size.
  useEffect(() => {
    const el = box.current;
    const canvas = art.current;
    if (!el || !canvas) return;
    const img = new Image();
    // a data URL, not a blob URL: nothing to revoke, so a quick unmount/remount can't
    // leave the image loading from a dead URL
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sceneSvg(phase, weather))}`;
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
      img.onload = null;
    };
  }, [phase, weather]);

  // Embers from the fire and the longhouse door, plus a flickering firelight.
  useEffect(() => {
    const el = box.current;
    const canvas = fx.current;
    if (!el || !canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d")!;
    type Ember = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number };
    let embers: Ember[] = [];
    type Drop = { x: number; y: number; v: number; s: number; ph: number };
    let drops: Drop[] = [];
    let dropKind: Weather = "clear";
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
      const g = ctx.createRadialGradient(m.x(FIRE.x), m.y(FIRE.y - 12), 0, m.x(FIRE.x), m.y(FIRE.y - 12), 150 * m.s);
      g.addColorStop(0, `rgba(255,170,80,${0.3 * flick})`);
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);

      // spawn
      if (embers.length < 80 && Math.random() < dt * 28) {
        const fromChimney = Math.random() < 0.12;
        const src = fromChimney ? CHIMNEY : { x: FIRE.x, y: FIRE.y - 24 };
        embers.push({
          x: m.x(src.x) + (Math.random() - 0.5) * 8 * m.s,
          y: m.y(src.y),
          vx: (Math.random() - 0.3) * 14 * m.s,
          vy: -(30 + Math.random() * 45) * m.s,
          life: 0,
          max: 2 + Math.random() * 3,
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

      // rain streaks or pixel snowflakes over everything
      const kind = weatherRef.current;
      if (kind !== dropKind) {
        dropKind = kind;
        drops = [];
      }
      if (kind !== "clear") {
        const want = kind === "rain" ? 170 : 130;
        while (drops.length < want) {
          drops.push({
            x: Math.random() * (width + 200) - 100,
            // the first batch fills the screen; later ones start above it
            y: Math.random() * height - (drops.length > want ? height : 0),
            v: kind === "rain" ? 650 + Math.random() * 350 : 28 + Math.random() * 40,
            s: kind === "rain" ? 10 + Math.random() * 12 : 2 + Math.round(Math.random() * 2),
            ph: Math.random() * 6.28,
          });
        }
        if (kind === "rain") {
          ctx.strokeStyle = "rgba(190,210,230,0.32)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (const d of drops) {
            d.y += d.v * dt;
            d.x -= d.v * 0.18 * dt;
            ctx.moveTo(d.x, d.y);
            ctx.lineTo(d.x + d.s * 0.18, d.y - d.s);
          }
          ctx.stroke();
        } else {
          ctx.fillStyle = "rgba(240,246,250,0.85)";
          for (const d of drops) {
            d.y += d.v * dt;
            d.x += Math.sin(t * 0.8 + d.ph) * 18 * dt - 8 * dt;
            ctx.fillRect(Math.round(d.x), Math.round(d.y), d.s, d.s);
          }
        }
        for (const d of drops) {
          if (d.y > height + 20) {
            d.y = -20 - Math.random() * 60;
            d.x = Math.random() * (width + 200) - 100;
          }
        }
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
