import { useEffect, useRef } from "react";
import type { Backdrop as Kind } from "../api";

/*
 * Live backdrop behind the pages. Everything is drawn at half the display's real resolution and
 * scaled up: still cheap, still soft and hazy, but without the blur a quarter-size canvas gave.
 * It runs at ~30 fps, stops while the window is hidden, and holds still when Windows asks for
 * reduced motion.
 */

/** device pixels per backdrop pixel */
const SCALE = 2;
const FPS = 30;

type Dot = { x: number; y: number; vx: number; vy: number; life: number; max: number; phase: number };

function rand(seed: number) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

/** Dark peaks along the bottom, the same every frame (cached per size). */
function drawPeaks(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number, height: number) {
  const r = rand(seed);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  let x = 0;
  while (x <= w) {
    const peak = h - height * (0.35 + r() * 0.65);
    const half = 18 + r() * 34;
    ctx.lineTo(x + half * 0.5, h - height * 0.2);
    ctx.lineTo(x + half, peak);
    x += half * 2;
    ctx.lineTo(x, h - height * 0.15);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function drawPines(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number, base: number, size: number, count: number) {
  const r = rand(seed);
  ctx.fillStyle = color;
  ctx.fillRect(0, h - base, w, base);
  for (let i = 0; i < count; i++) {
    const x = r() * w;
    const th = size * (0.6 + r() * 0.8);
    const tw = th * 0.32;
    ctx.beginPath();
    ctx.moveTo(x, h - base - th);
    ctx.lineTo(x + tw, h - base + 1);
    ctx.lineTo(x - tw, h - base + 1);
    ctx.closePath();
    ctx.fill();
  }
}

function sky(ctx: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

const scenes = {
  aurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    sky(ctx, w, h, [
      [0, "#050b12"],
      [0.55, "#0b1a22"],
      [1, "#0d1114"],
    ]);
    ctx.globalCompositeOperation = "lighter";
    const ribbons = [
      { y: 0.16, amp: 0.06, len: 0.3, hue: [70, 255, 170], speed: 0.09, freq: 0.012, a: 0.28 },
      { y: 0.24, amp: 0.05, len: 0.24, hue: [60, 200, 255], speed: -0.07, freq: 0.017, a: 0.16 },
      { y: 0.1, amp: 0.04, len: 0.2, hue: [170, 110, 255], speed: 0.05, freq: 0.009, a: 0.12 },
    ];
    for (const rb of ribbons) {
      const top = h * (rb.y - rb.amp);
      const g = ctx.createLinearGradient(0, top, 0, top + h * (rb.len + rb.amp * 2));
      const [r, gg, b] = rb.hue;
      g.addColorStop(0, `rgba(${r},${gg},${b},0)`);
      g.addColorStop(0.25, `rgba(${r},${gg},${b},1)`);
      g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      ctx.fillStyle = g;
      for (let x = 0; x < w; x += 1) {
        const y = h * rb.y + h * rb.amp * Math.sin(x * rb.freq + t * rb.speed * 6) + h * 0.02 * Math.sin(x * rb.freq * 3.1 - t * 0.4);
        const shimmer = 0.55 + 0.45 * Math.sin(x * 0.09 + t * 1.3) * Math.sin(x * 0.023 - t * 0.5);
        ctx.globalAlpha = Math.max(0, rb.a * shimmer);
        ctx.fillRect(x, y, 1, h * rb.len * (0.7 + 0.3 * shimmer));
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    drawPeaks(ctx, w, h, "#121f27", 11, h * 0.34);
    drawPines(ctx, w, h, "#06090b", 5, h * 0.06, h * 0.12, Math.round(w / 3));
  },

  forest(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    sky(ctx, w, h, [
      [0, "#0d1613"],
      [0.6, "#14211c"],
      [1, "#0a0f0d"],
    ]);
    drawPines(ctx, w, h, "#17241f", 21, h * 0.2, h * 0.3, Math.round(w / 2.5));
    // fog banks drifting at two speeds
    for (const [y, speed, a] of [
      [0.62, 4, 0.16],
      [0.78, -6, 0.2],
    ] as const) {
      for (let i = 0; i < 5; i++) {
        const x = ((i * w * 0.3 + t * speed) % (w * 1.5)) - w * 0.25;
        const g = ctx.createRadialGradient(x, h * y, 0, x, h * y, w * 0.22);
        g.addColorStop(0, `rgba(190,210,200,${a})`);
        g.addColorStop(1, "rgba(190,210,200,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }
    drawPines(ctx, w, h, "#0b1210", 33, h * 0.08, h * 0.22, Math.round(w / 4));
  },

  embers(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    sky(ctx, w, h, [
      [0, "#0d0b0a"],
      [0.7, "#140d08"],
      [1, "#1e1008"],
    ]);
    const flick = 0.75 + 0.12 * Math.sin(t * 5.1) + 0.08 * Math.sin(t * 11.7) + 0.05 * Math.sin(t * 23.3);
    const g = ctx.createRadialGradient(w * 0.5, h * 1.08, 0, w * 0.5, h * 1.08, h * 0.95);
    g.addColorStop(0, `rgba(255,140,50,${0.42 * flick})`);
    g.addColorStop(0.5, `rgba(200,80,20,${0.14 * flick})`);
    g.addColorStop(1, "rgba(200,80,20,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  },

  plain() {},
};

function useBackdrop(canvas: React.RefObject<HTMLCanvasElement | null>, stars: React.RefObject<HTMLCanvasElement | null>, kind: Kind) {
  useEffect(() => {
    const c = canvas.current;
    const sc = stars.current;
    if (!c || !sc || kind === "plain") return;
    const ctx = c.getContext("2d")!;
    const sctx = sc.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: Dot[] = [];
    let raf = 0;
    let last = 0;
    let start = performance.now();

    const size = () => {
      const r = c.parentElement!.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round((r.width * dpr) / SCALE));
      const h = Math.max(1, Math.round((r.height * dpr) / SCALE));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        // stars: crisp, full resolution, drawn once per size
        sc.width = Math.round(r.width * dpr);
        sc.height = Math.round(r.height * dpr);
        sctx.clearRect(0, 0, sc.width, sc.height);
        if (kind === "aurora") {
          const rr = rand(3);
          for (let i = 0; i < 220; i++) {
            const x = rr() * sc.width;
            const y = rr() * sc.height * 0.6;
            sctx.fillStyle = `rgba(255,255,255,${0.15 + rr() * 0.6})`;
            const s = rr() < 0.08 ? 2 * dpr : 1 * dpr;
            sctx.fillRect(x, y, s, s);
          }
        }
      }
      return { w, h };
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < 1000 / FPS) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const size2 = size();
      // the scenes are laid out for a quarter-size canvas; draw them in those units, scaled up,
      // so the shapes stay the same but their edges come out at the higher resolution
      const k = Math.max(1, (4 * (window.devicePixelRatio || 1)) / SCALE);
      const w = size2.w / k;
      const h = size2.h / k;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      const t = (now - start) / 1000;
      scenes[kind](ctx, w, h, t);

      // particles: fireflies in the forest, sparks over the embers
      if (kind === "forest" || kind === "embers") {
        const max = kind === "embers" ? 70 : 28;
        if (dots.length < max && Math.random() < dt * (kind === "embers" ? 24 : 6)) {
          dots.push(
            kind === "embers"
              ? { x: w * (0.15 + Math.random() * 0.7), y: h + 2, vx: (Math.random() - 0.5) * 6, vy: -(8 + Math.random() * 14), life: 0, max: 4 + Math.random() * 5, phase: Math.random() * 6 }
              : { x: Math.random() * w, y: h * (0.55 + Math.random() * 0.4), vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, life: 0, max: 5 + Math.random() * 6, phase: Math.random() * 6 },
          );
        }
        dots = dots.filter((d) => d.life < d.max && d.y > -4);
        for (const d of dots) {
          d.life += dt;
          d.x += (d.vx + Math.sin(t * 1.5 + d.phase) * (kind === "embers" ? 4 : 2)) * dt;
          d.y += d.vy * dt;
          const fade = Math.sin((d.life / d.max) * Math.PI);
          const blink = kind === "forest" ? 0.5 + 0.5 * Math.sin(t * 3 + d.phase * 5) : 1;
          ctx.fillStyle = kind === "embers" ? `rgba(255,${150 + Math.round(70 * fade)},60,${fade})` : `rgba(210,255,140,${fade * blink})`;
          ctx.fillRect(d.x, d.y, 1, 1);
        }
      }
      if (still) cancelAnimationFrame(raf);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = 0;
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);
    start = performance.now() - Math.random() * 60000;
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [canvas, stars, kind]);
}

export function Backdrop({ kind }: { kind: Kind }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stars = useRef<HTMLCanvasElement>(null);
  useBackdrop(canvas, stars, kind);
  if (kind === "plain") return null;
  return (
    <div className="backdrop" aria-hidden>
      <canvas ref={canvas} className="backdrop-art" key={`a-${kind}`} />
      <canvas ref={stars} className="backdrop-stars" key={`s-${kind}`} />
    </div>
  );
}

export const BACKDROPS: { id: Kind; label: string; hint: string }[] = [
  { id: "aurora", label: "Aurora", hint: "Northern lights over dark peaks" },
  { id: "forest", label: "Misty forest", hint: "Drifting fog and fireflies" },
  { id: "embers", label: "Embers", hint: "Firelight and rising sparks" },
  { id: "plain", label: "Plain", hint: "The still gradient" },
];
