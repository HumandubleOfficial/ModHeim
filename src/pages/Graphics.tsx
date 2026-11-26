import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Info, Power, Sparkles } from "lucide-react";
import { api, errorText, type Graphics } from "../api";
import { useGameStatus, useSettings } from "../hooks";
import { PageHead, Switch } from "../components/Chrome";
import { useUi } from "../store";

const BASE: Graphics = {
  enabled: true, preset: "Custom", reflections: 0, reflectionProbe: false, probeResolution: 256, fullTextures: false,
  anisotropic: 0, lodBias: 0, shadowDistance: 0, shadowQuality: 0, ambientOcclusion: 0, antiAliasing: 0, sharpen: 0.3,
  tonemapping: "Game", exposure: 0, contrast: 1, saturation: 1, temperature: 0, bloom: 1, vignette: -1, autoExposure: false,
  grassDistance: 0, grade: "Off", gradeStrength: 0.5, clarity: 0, godRays: 0, deband: false, filmGrain: 0, compareKey: "F9",
  lightQuality: 0, grassDensity: 0, grassShadows: false, tessellation: false, textureSharpness: 0,
  water: 0, waterClarity: 1, motionBlur: 0,
};

const ULTRA: Graphics = {
  ...BASE, preset: "Ultra", reflections: 3, reflectionProbe: true, probeResolution: 256, fullTextures: true, anisotropic: 16,
  lodBias: 2.5, shadowDistance: 200, shadowQuality: 2, ambientOcclusion: 2, antiAliasing: 1, sharpen: 0.35,
  tonemapping: "ACES", exposure: 0.1, contrast: 1.08, saturation: 1.08, bloom: 1.15, vignette: 0.2, autoExposure: true,
  grassDistance: 120, godRays: 1, deband: true, lightQuality: 1, grassDensity: 1.3, tessellation: true, textureSharpness: 0.4,
  water: 1, waterClarity: 1.3,
};

/** Everything at once: real world detail first (lights, shadows, ground, grass), then a light film grade. */
const BEYOND: Graphics = {
  ...ULTRA, preset: "Beyond", probeResolution: 512, lodBias: 3, shadowDistance: 250, grassDistance: 150, sharpen: 0.4,
  grade: "Cinematic", gradeStrength: 0.4, clarity: 0.3, godRays: 2, filmGrain: 0.1, contrast: 1.04, saturation: 1.04,
  bloom: 1.2, vignette: 0.2, lightQuality: 2, grassDensity: 1.6, grassShadows: true, textureSharpness: 0.6,
  water: 2, waterClarity: 1.6,
};

const PRESETS: { id: string; label: string; hint: string; cost: string; g: Graphics; star?: boolean }[] = [
  {
    id: "Beyond",
    label: "Beyond",
    hint: "Everything ModHeim can do: mirror-like water that reflects the world, every fire casting shadows, razor-sharp shadows, 3D ground, thick shadowed grass, sharper textures and epic god rays.",
    cost: "Heavy",
    g: BEYOND,
    star: true,
  },
  {
    id: "Balanced",
    label: "Balanced",
    hint: "Sharper textures, light reflections and filmic colour. Little impact on frame rate.",
    cost: "Light",
    g: { ...BASE, preset: "Balanced", reflections: 1, fullTextures: true, anisotropic: 8, lodBias: 1.5, shadowQuality: 1,
      tonemapping: "ACES", contrast: 1.04, saturation: 1.04, textureSharpness: 0.3, lightQuality: 1 },
  },
  {
    id: "Ultra",
    label: "Ultra (AAA)",
    hint: "3D ground, more fires lighting the world, sharp long shadows, denser grass, reflections, strong AO and TAA.",
    cost: "Heavy",
    g: ULTRA,
  },
  {
    id: "Cinematic",
    label: "Cinematic",
    hint: "Ultra with a film look: warmer light, deeper contrast, glowing highlights and a soft vignette.",
    cost: "Heavy",
    g: { ...ULTRA, preset: "Cinematic", temperature: 4, contrast: 1.12, saturation: 0.94, bloom: 1.4, vignette: 0.35, sharpen: 0.2,
      grade: "Golden", gradeStrength: 0.55, godRays: 2, filmGrain: 0.18, motionBlur: 1 },
  },
  {
    id: "Vivid",
    label: "Vivid",
    hint: "Balanced quality with richer colour and punchier contrast.",
    cost: "Light",
    g: { ...BASE, preset: "Vivid", reflections: 2, fullTextures: true, anisotropic: 16, lodBias: 2, shadowQuality: 1,
      ambientOcclusion: 1, tonemapping: "ACES", contrast: 1.12, saturation: 1.25, bloom: 1.1, clarity: 0.25, deband: true,
      textureSharpness: 0.3, lightQuality: 1, grassDensity: 1.2 },
  },
];

const GRADES = [
  { id: "Off", label: "Off", desc: "" },
  { id: "Cinematic", label: "Cinematic", desc: "Teal shadows, warm skin and firelight: the blockbuster look." },
  { id: "Golden", label: "Golden", desc: "Low sun on everything: honey highlights and warm mid-tones." },
  { id: "Nordic", label: "Nordic", desc: "Cold northern light: steel-blue shadows and clean whites." },
  { id: "Moody", label: "Moody", desc: "Deep blacks, green-teal shadows and muted highlights." },
];

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} className={value === v ? "on" : ""} role="radio" aria-checked={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Slider({ value, min, max, step, onChange, format, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; label: string }) {
  return (
    <div className="row" style={{ gap: 10 }}>
      <input type="range" className="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="mono small" style={{ minWidth: 54, textAlign: "right" }}>{format(value)}</span>
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="text">
        <div className="title">{title}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

export function GraphicsPage() {
  const profile = useSettings().data?.activeProfile;
  const running = useGameStatus().data?.running ?? false;
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const q = useQuery({ queryKey: ["graphics", profile], queryFn: () => api.getGraphics(profile!), enabled: !!profile });
  const [g, setG] = useState<Graphics>(BEYOND);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (q.data?.settings && !dirty) setG({ ...BASE, ...q.data.settings });
  }, [q.data, dirty]);

  const on = !!q.data?.settings?.enabled && !!q.data.pluginEnabled;
  const set = (patch: Partial<Graphics>) => {
    setG((x) => ({ ...x, ...patch, preset: "Custom" }));
    setDirty(true);
  };
  const save = async (next: Graphics, msg: string) => {
    if (!profile) return;
    setSaving(true);
    try {
      await api.applyGraphics(profile, next);
      setG(next);
      setDirty(false);
      toast("success", msg);
      qc.invalidateQueries({ queryKey: ["graphics"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const apply = (next: Graphics) =>
    save({ ...next, enabled: true }, running ? "Applied: switch back to the game to see it" : `Applied to ${profile}. It takes effect when you play modded.`);

  const pct = (v: number) => `${Math.round(v * 100)}%`;

  return (
    <div className="page">
      <PageHead
        title="Graphics"
        sub={`Push Valheim's renderer past its own settings, for ${profile ?? "…"}`}
        actions={
          on ? (
            <button className="btn" disabled={saving} onClick={() => save({ ...g, enabled: false }, "Graphics back to Valheim's own")}>
              <Power /> Turn off
            </button>
          ) : null
        }
      />

      <div className="notice info">
        <Info />
        <span>
          Works inside the game's renderer, not on top of the finished picture like a ReShade preset. So it changes the world
          itself: 3D tessellated ground, fires and torches that light and shadow everything around them, crisp long
          shadows, thicker grass with shadows and sharper textures. The film grade and god rays go on top. It can't add
          textures sharper than the ones Valheim ships with.{" "}
          {running ? "Changes apply live while you play." : "Changes apply the next time you play modded."} Press{" "}
          <kbd>{g.compareKey}</kbd> in game to compare with Valheim's own look.
        </span>
      </div>

      <h2 className="section">Presets</h2>
      <div className="grid cols-4 gfx-presets">
        {PRESETS.map((p) => {
          const active = on && q.data?.settings?.preset === p.id && !dirty;
          return (
            <button key={p.id} className={`panel gfx-preset${active ? " on" : ""}${p.star ? " star" : ""}`} disabled={saving} onClick={() => apply({ ...p.g, compareKey: g.compareKey })}>
              <div className="row" style={{ gap: 8 }}>
                <Sparkles className={p.star ? "" : "faint"} />
                <b className="grow">{p.label}</b>
                {p.star && !active && <span className="badge accent">Best</span>}
                {active && <Check style={{ color: "var(--ok)" }} />}
              </div>
              <div className="dim small">{p.hint}</div>
              <span className={`badge ${p.cost === "Heavy" ? "warn" : "ok"}`}>{p.cost === "Heavy" ? "Needs a strong GPU" : "Light on FPS"}</span>
            </button>
          );
        })}
      </div>

      {q.data?.lastReport && (
        <div className="faint small" style={{ marginTop: 10 }}>
          Last time in game: <span className="mono">{q.data.lastReport}</span>
        </div>
      )}

      <h2 className="section row">
        Fine tuning {g.preset === "Custom" && <span className="badge muted">Custom</span>}
        <span className="spacer" />
        <button className="btn sm primary" disabled={!dirty || saving} onClick={() => apply(g)}>
          Apply changes
        </button>
      </h2>
      <div className="panel pad">
        <h3 className="gfx-h">Reflections</h3>
        <Row title="Screen-space reflections" desc="Water, ice, metal and wet stone reflect what's on screen. Higher steps trace further.">
          <Seg label="Reflections" value={g.reflections} onChange={(v) => set({ reflections: v })} options={[[0, "Off"], [1, "Medium"], [2, "High"], [3, "Ultra"]]} />
        </Row>
        <Row title="Live environment reflections" desc="A reflection probe that follows you, so shiny things reflect the real sky, trees and fires around you, not just a fixed sky.">
          <Switch label="Live environment reflections" on={g.reflectionProbe} onChange={(v) => set({ reflectionProbe: v })} />
        </Row>
        {g.reflectionProbe && (
          <Row title="Probe resolution">
            <Seg label="Probe resolution" value={g.probeResolution} onChange={(v) => set({ probeResolution: v })} options={[[128, "128"], [256, "256"], [512, "512"]]} />
          </Row>
        )}

        <h3 className="gfx-h">World detail</h3>
        <Row title="3D ground (tessellation)" desc="Valheim's own terrain tessellation: stones, roots and mud get real depth instead of a flat painted texture.">
          <Switch label="3D ground (tessellation)" on={g.tessellation} onChange={(v) => set({ tessellation: v })} />
        </Row>
        <Row title="Fires & torches" desc="More lights glow at once and more of them cast shadows, from further away, so camps and halls are lit for real.">
          <Seg label="Fires and torches" value={g.lightQuality} onChange={(v) => set({ lightQuality: v })} options={[[0, "Game"], [1, "More"], [2, "Ultra"]]} />
        </Row>
        <Row title="Grass amount" desc="Thicker meadows and forest floors. 0 keeps the game's setting.">
          <Slider label="Grass amount" value={g.grassDensity} min={0} max={2.5} step={0.1} onChange={(v) => set({ grassDensity: v })} format={(v) => (v ? `${v.toFixed(1)}×` : "Game")} />
        </Row>
        <Row title="Grass shadows" desc="Grass and plants cast shadows on the ground. Heavy on the GPU.">
          <Switch label="Grass shadows" on={g.grassShadows} onChange={(v) => set({ grassShadows: v })} />
        </Row>
        <Row title="Texture sharpness" desc="Ground, walls and armour keep their detail further away instead of turning to mush.">
          <Slider label="Texture sharpness" value={g.textureSharpness} min={0} max={1} step={0.05} onChange={(v) => set({ textureSharpness: v })} format={(v) => (v ? pct(v) : "Game")} />
        </Row>

        <h3 className="gfx-h">Water</h3>
        <Row title="Water" desc="Realistic: a glassy surface that mirrors the actual mountains, trees, boats and sky, with stronger refraction and smoother waves. Ultra sharpens the reflections. Wave heights stay the game's, so boats sail the same.">
          <Seg label="Water" value={g.water} onChange={(v) => set({ water: v })} options={[[0, "Game"], [1, "Realistic"], [2, "Ultra"]]} />
        </Row>
        {g.water > 0 && (
          <Row title="Water clarity" desc="How far you can see down into lakes and shallows.">
            <Slider label="Water clarity" value={g.waterClarity} min={0.5} max={2.5} step={0.1} onChange={(v) => set({ waterClarity: v })} format={(v) => (Math.abs(v - 1) < 0.01 ? "Game" : `${v.toFixed(1)}×`)} />
          </Row>
        )}

        <h3 className="gfx-h">Textures & detail</h3>
        <Row title="Full-resolution textures" desc="Always load every texture at full size, ignoring the game's texture quality and streaming.">
          <Switch label="Full-resolution textures" on={g.fullTextures} onChange={(v) => set({ fullTextures: v })} />
        </Row>
        <Row title="Texture filtering" desc="Keeps ground and walls sharp at steep angles.">
          <Seg label="Anisotropic filtering" value={g.anisotropic} onChange={(v) => set({ anisotropic: v })} options={[[0, "Game"], [4, "4×"], [8, "8×"], [16, "16×"]]} />
        </Row>
        <Row title="Model detail distance" desc="How far away objects keep their detailed models. 0 keeps the game's setting.">
          <Slider label="Model detail distance" value={g.lodBias} min={0} max={4} step={0.25} onChange={(v) => set({ lodBias: v })} format={(v) => (v ? `${v.toFixed(2)}×` : "Game")} />
        </Row>
        <Row title="Grass distance" desc="How far grass and plants are drawn. 0 keeps the game's setting.">
          <Slider label="Grass distance" value={g.grassDistance} min={0} max={200} step={10} onChange={(v) => set({ grassDistance: v })} format={(v) => (v ? `${v} m` : "Game")} />
        </Row>

        <h3 className="gfx-h">Shadows & light</h3>
        <Row title="Shadow quality" desc="Sharper shadow maps, soft edges, and cascades laid out so the shadows right around you stay crisp even with a long shadow distance.">
          <Seg label="Shadow quality" value={g.shadowQuality} onChange={(v) => set({ shadowQuality: v })} options={[[0, "Game"], [1, "High"], [2, "Very high"]]} />
        </Row>
        <Row title="Shadow distance" desc="0 keeps the game's setting.">
          <Slider label="Shadow distance" value={g.shadowDistance} min={0} max={400} step={10} onChange={(v) => set({ shadowDistance: v })} format={(v) => (v ? `${v} m` : "Game")} />
        </Row>
        <Row title="Ambient occlusion" desc="Soft contact shadows in corners, under roofs and between trees.">
          <Seg label="Ambient occlusion" value={g.ambientOcclusion} onChange={(v) => set({ ambientOcclusion: v })} options={[[0, "Game"], [1, "Strong"], [2, "Ultra"]]} />
        </Row>
        <Row title="Auto exposure" desc="Your eyes adjust: caves and nights open up, bright snow calms down.">
          <Switch label="Auto exposure" on={g.autoExposure} onChange={(v) => set({ autoExposure: v })} />
        </Row>

        <h3 className="gfx-h">Colour</h3>
        <Row title="Tone mapping" desc="ACES is the filmic curve most modern games use.">
          <Seg label="Tone mapping" value={g.tonemapping} onChange={(v) => set({ tonemapping: v })} options={[["Game", "Game"], ["ACES", "ACES filmic"], ["Neutral", "Neutral"]]} />
        </Row>
        <Row title="Brightness">
          <Slider label="Brightness" value={g.exposure} min={-1} max={1} step={0.05} onChange={(v) => set({ exposure: v })} format={(v) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2))} />
        </Row>
        <Row title="Contrast">
          <Slider label="Contrast" value={g.contrast} min={0.7} max={1.4} step={0.01} onChange={(v) => set({ contrast: v })} format={pct} />
        </Row>
        <Row title="Saturation">
          <Slider label="Saturation" value={g.saturation} min={0.5} max={1.6} step={0.01} onChange={(v) => set({ saturation: v })} format={pct} />
        </Row>
        <Row title="Warmth">
          <Slider label="Warmth" value={g.temperature} min={-30} max={30} step={1} onChange={(v) => set({ temperature: v })} format={(v) => (v > 0 ? `+${v}` : String(v))} />
        </Row>
        <Row title="Bloom" desc="Glow around fires, sun and magic.">
          <Slider label="Bloom" value={g.bloom} min={0} max={2.5} step={0.05} onChange={(v) => set({ bloom: v })} format={pct} />
        </Row>
        <Row title="Vignette" desc="Darker screen edges. Off keeps the game's.">
          <Slider label="Vignette" value={g.vignette} min={-0.05} max={0.5} step={0.05} onChange={(v) => set({ vignette: v < 0 ? -1 : v })} format={(v) => (v < 0 ? "Game" : pct(v))} />
        </Row>

        <h3 className="gfx-h">Film look</h3>
        <Row title="Colour grade" desc="Tints shadows, mid-tones and highlights separately, the way films are graded.">
          <Seg label="Colour grade" value={g.grade} onChange={(v) => set({ grade: v })} options={GRADES.map((x) => [x.id, x.label] as [string, string])} />
        </Row>
        {g.grade !== "Off" && (
          <Row title="Grade strength" desc={GRADES.find((x) => x.id === g.grade)?.desc}>
            <Slider label="Grade strength" value={g.gradeStrength} min={0.1} max={1} step={0.05} onChange={(v) => set({ gradeStrength: v })} format={pct} />
          </Row>
        )}
        <Row title="God rays" desc="Light shafts through trees, fog and clouds when you look towards the sun.">
          <Seg label="God rays" value={g.godRays} onChange={(v) => set({ godRays: v })} options={[[0, "Game"], [1, "Strong"], [2, "Epic"]]} />
        </Row>
        <Row title="Clarity" desc="Local contrast: bark, stone and armour detail stand out without oversharpening.">
          <Slider label="Clarity" value={g.clarity} min={0} max={0.8} step={0.05} onChange={(v) => set({ clarity: v })} format={(v) => (v ? pct(v) : "Off")} />
        </Row>
        <Row title="Smooth skies" desc="Dithering that removes the colour banding in skies, fog and dark caves.">
          <Switch label="Smooth skies" on={g.deband} onChange={(v) => set({ deband: v })} />
        </Row>
        <Row title="Film grain" desc="A fine grain, mostly in mid-tones, that makes the picture feel less digital.">
          <Slider label="Film grain" value={g.filmGrain} min={0} max={0.4} step={0.02} onChange={(v) => set({ filmGrain: v })} format={(v) => (v ? pct(v) : "Off")} />
        </Row>
        <Row title="Motion blur" desc="Blur on fast camera turns, like a real camera's shutter. Subtle is the film standard.">
          <Seg label="Motion blur" value={g.motionBlur} onChange={(v) => set({ motionBlur: v })} options={[[0, "Game"], [1, "Subtle"], [2, "Cinematic"]]} />
        </Row>

        <h3 className="gfx-h">Compare</h3>
        <Row title="Before / after key" desc="Press it in game to flip between ModHeim's look and Valheim's own, with a note at the top of the screen.">
          <Seg label="Before / after key" value={g.compareKey} onChange={(v) => set({ compareKey: v })} options={[["F9", "F9"], ["F11", "F11"], ["Insert", "Insert"], ["Home", "Home"]]} />
        </Row>

        <h3 className="gfx-h">Anti-aliasing</h3>
        <Row title="Temporal anti-aliasing" desc="Smooths jagged edges and shimmering grass, like modern AAA games.">
          <Switch label="Temporal anti-aliasing" on={g.antiAliasing === 1} onChange={(v) => set({ antiAliasing: v ? 1 : 0 })} />
        </Row>
        {g.antiAliasing === 1 && (
          <Row title="Sharpening" desc="Counters the slight softness TAA adds.">
            <Slider label="Sharpening" value={g.sharpen} min={0} max={1} step={0.05} onChange={(v) => set({ sharpen: v })} format={pct} />
          </Row>
        )}
      </div>
    </div>
  );
}
