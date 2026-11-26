import { useEffect, useRef } from "react";

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

function sceneSvg() {
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
      <stop offset="0" stop-color="#050b11"/>
      <stop offset="0.3" stop-color="#0c1d2a"/>
      <stop offset="0.55" stop-color="#1b3a44"/>
      <stop offset="0.68" stop-color="#3d5653"/>
      <stop offset="0.75" stop-color="#9a6a3c"/>
      <stop offset="0.8" stop-color="#c98444"/>
    </linearGradient>
    <radialGradient id="moonglow" cx="${1150 / W}" cy="${190 / H}" r="0.25">
      <stop offset="0" stop-color="#d8f0ea" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#d8f0ea" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="dusk" cx="0.5" cy="0.76" r="0.6">
      <stop offset="0" stop-color="#ffb35a" stop-opacity="0.45"/>
      <stop offset="0.5" stop-color="#f0903a" stop-opacity="0.12"/>
      <stop offset="1" stop-color="#f0903a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="fireglow" cx="${FIRE.x / W}" cy="${FIRE.y / H}" r="0.3">
      <stop offset="0" stop-color="#ffb45a" stop-opacity="0.8"/>
      <stop offset="0.35" stop-color="#ff7a20" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#ff7a20" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fc0c0" stop-opacity="0"/>
      <stop offset="1" stop-color="#c8d6cf" stop-opacity="0.35"/>
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
  ${stars(260)}
  <rect width="${W}" height="${H}" fill="url(#moonglow)"/>
  <circle cx="1150" cy="190" r="26" fill="#e9f4ee" opacity="0.85"/>
  <circle cx="1160" cy="184" r="24" fill="#0c1d2a" opacity="0.5"/>

  <!-- northern lights -->
  <g filter="url(#haze-blur)" opacity="0.55">
    <path d="M120 250 C 380 120, 620 300, 880 170 S 1300 110, 1520 210" stroke="url(#aurora)" stroke-width="46" fill="none"/>
    <path d="M260 330 C 520 230, 760 360, 1040 260 S 1380 230, 1560 300" stroke="url(#aurora)" stroke-width="22" fill="none" opacity="0.6"/>
  </g>

  <!-- the world tree: pale branches across the sky -->
  <g fill="none" stroke="#bcd8d2" stroke-linecap="round" opacity="0.17" filter="url(#soft)">
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
  <path d="${mtn.rock}" fill="#2f4a55"/>
  <path d="${mtn.snow}" fill="#dfe9ea" opacity="0.85"/>
  <rect y="500" width="${W}" height="160" fill="url(#haze)"/>

  <!-- forests, far to near -->
  <path d="${hillPath(660, FAR)}" fill="#1d3134"/>
  <path d="${forest(11, 660, FAR, 220, 18, 40)}" fill="#1d3134"/>
  <rect y="610" width="${W}" height="100" fill="url(#haze)" opacity="0.7"/>
  <path d="${hillPath(718, MID)}" fill="#142224"/>
  <path d="${forest(23, 718, MID, 130, 34, 74)}" fill="#142224"/>
  <rect y="690" width="${W}" height="70" fill="url(#haze)" opacity="0.35"/>

  <!-- near ground and the tall pines that frame the camp -->
  <path d="${hillPath(ground, NEAR)}" fill="#0b1112"/>
  <path d="${forest(41, ground, NEAR, 26, 140, 300, 0, 470)}" fill="#0b1112"/>
  <path d="${forest(43, ground, NEAR, 18, 160, 320, 1290, W)}" fill="#0b1112"/>
  <path d="${forest(47, ground, NEAR, 5, 90, 150, 480, 560)}" fill="#0b1112"/>

  <rect width="${W}" height="${H}" fill="url(#fireglow)"/>

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
