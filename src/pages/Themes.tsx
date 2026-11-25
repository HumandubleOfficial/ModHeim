import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Paintbrush, Power, ShieldCheck } from "lucide-react";
import { api, type GameTheme } from "../api";
import { useAction, useGameStatus, useSettings } from "../hooks";
import { PageHead } from "../components/Chrome";

type Preset = Omit<GameTheme, "enabled" | "dumpSprites"> & { blurb: string };

/** Biome-inspired palettes. Colors are tints multiplied over Valheim's own textures. */
export const PRESETS: Preset[] = [
  { name: "Classic", blurb: "Valheim's own look", panel: "#FFFFFF", button: "#FFFFFF", heading: "#F0A028", text: "#FFFFFF", panelStrength: 0 },
  { name: "Meadows", blurb: "Sunlit grass and honey", panel: "#9FCB6B", button: "#B8D98A", heading: "#F2E28B", text: "#F4F7E8", panelStrength: 0.55 },
  { name: "Black Forest", blurb: "Deep pine and moss", panel: "#3F6B5A", button: "#5D8A73", heading: "#9FE0B5", text: "#E3F1EA", panelStrength: 0.7 },
  { name: "Swamp", blurb: "Murky bog and ooze", panel: "#6B6B3A", button: "#85804A", heading: "#C8D46A", text: "#E7E8D0", panelStrength: 0.65 },
  { name: "Mountain", blurb: "Frost and silver", panel: "#BFD9F2", button: "#D6E8F7", heading: "#A9E1FF", text: "#F2F8FF", panelStrength: 0.6 },
  { name: "Plains", blurb: "Barley and dry sun", panel: "#E8C77A", button: "#F0D48E", heading: "#FFD35C", text: "#FFF6DD", panelStrength: 0.5 },
  { name: "Mistlands", blurb: "Violet mist and jade", panel: "#7A5CC4", button: "#8E73D1", heading: "#C9A6FF", text: "#EEE8FF", panelStrength: 0.7 },
  { name: "Ashlands", blurb: "Embers and charred stone", panel: "#C2452D", button: "#D45A3A", heading: "#FF8A3D", text: "#FFE9DE", panelStrength: 0.65 },
  { name: "Deep North", blurb: "Glacier ice and aurora", panel: "#8FD3E8", button: "#A8E1EF", heading: "#7FE7FF", text: "#EFFCFF", panelStrength: 0.6 },
];

const CUSTOM_KEY = "modheim.customGameThemes";

function hexToRgb(h: string): [number, number, number] {
  const v = h.replace("#", "").slice(0, 6).padEnd(6, "f");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

/** What the plugin does: lerp(white, color, strength), multiplied over the texture. */
function tint(hex: string, strength: number): string {
  const [r, g, b] = hexToRgb(hex);
  const l = (c: number) => Math.round(255 + (c - 255) * strength);
  return `rgb(${l(r)}, ${l(g)}, ${l(b)})`;
}

/**
 * An original stand-in for an in-game settings panel (drawn with CSS, not the game's art),
 * tinted the way the plugin tints the real thing: wood panels, stone buttons, orange labels
 * (the "Titles & labels" color) and white values (the "Values" color).
 */
function GamePreview({ t, small }: { t: Preset; small?: boolean }) {
  const panelTint = tint(t.panel, t.panelStrength);
  const buttonTint = tint(t.button, t.panelStrength);
  const button = (label: string, wide?: boolean) => (
    <span className={`gp-button${wide ? " wide" : ""}`} style={{ backgroundColor: buttonTint, color: t.heading }}>
      {label}
    </span>
  );
  return (
    <div className={`game-preview${small ? " small" : ""}`}>
      <div className="gp-panel" style={{ backgroundColor: panelTint }}>
        <div className="gp-frame" style={{ borderColor: t.heading }} />
        <div className="gp-title" style={{ color: t.heading }}>
          Settings
        </div>
        {!small && (
          <div className="gp-rows">
            <div className="gp-row">
              <span className="gp-label" style={{ color: t.heading }}>Language</span>
              <span className="gp-arrow" style={{ backgroundColor: buttonTint, color: t.heading }}>‹</span>
              <span className="gp-value" style={{ color: t.text }}>English</span>
              <span className="gp-arrow" style={{ backgroundColor: buttonTint, color: t.heading }}>›</span>
            </div>
            <div className="gp-row">
              <span className="gp-label" style={{ color: t.heading }}>Show button hints</span>
              <span className="gp-toggle on" style={{ ["--dot" as string]: t.heading }} />
            </div>
            <div className="gp-row">
              <span className="gp-label" style={{ color: t.heading }}>Skip intro cinematic</span>
              <span className="gp-toggle" />
            </div>
            <div className="gp-row">
              <span className="gp-label" style={{ color: t.heading }}>Auto-backup history</span>
              <span className="gp-slider">
                <span style={{ background: t.text }} />
                <i style={{ background: t.heading }} />
              </span>
              <span className="gp-value" style={{ color: t.text }}>4</span>
            </div>
          </div>
        )}
        <div className="gp-buttons">
          {button("Back")}
          {!small && button("Start", true)}
          {button("OK")}
        </div>
      </div>
    </div>
  );
}

function loadCustom(): Preset[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function ThemesPage() {
  const settings = useSettings().data;
  const profile = settings?.activeProfile;
  const game = useGameStatus().data;
  const state = useQuery({
    queryKey: ["gameTheme", profile],
    queryFn: () => api.getGameTheme(profile!),
    enabled: !!profile,
  });
  const [custom, setCustom] = useState<Preset[]>(loadCustom);
  const all = useMemo(() => [...PRESETS, ...custom], [custom]);
  const active = state.data?.theme?.enabled ? state.data.theme : null;
  const [draft, setDraft] = useState<Preset>(PRESETS[6]);

  // start the editor on whatever is applied right now
  useEffect(() => {
    if (state.data?.theme) {
      const t = state.data.theme;
      setDraft({ ...t, blurb: all.find((p) => p.name === t.name)?.blurb ?? "Custom" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.data?.theme?.name, profile]);

  const apply = useAction(
    (t: Preset) => api.applyGameTheme(profile!, { ...t, enabled: true, dumpSprites: true }),
    {
      success: () =>
        game?.running
          ? `Applied "${draft.name}". It updates live if Valheim is running with ${profile}.`
          : `Applied "${draft.name}" to ${profile}. You'll see it next time you play modded.`,
    },
  );
  const off = useAction(() => api.turnOffGameTheme(profile!), { success: "Back to Valheim's own look" });

  const saveCustom = () => {
    const name = draft.name.trim() || "My theme";
    const entry = { ...draft, name, blurb: "Custom" };
    const next = [...custom.filter((c) => c.name !== name), entry];
    setCustom(next);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
  };
  const removeCustom = (name: string) => {
    const next = custom.filter((c) => c.name !== name);
    setCustom(next);
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
  };
  const set = (patch: Partial<Preset>) => setDraft((d) => ({ ...d, ...patch }));
  const isPreset = PRESETS.some((p) => p.name === draft.name);

  return (
    <div className="page">
      <PageHead
        title="Game Themes"
        sub="Recolor Valheim's in-game menus, panels and text. Each profile keeps its own theme."
        actions={
          active && (
            <button className="btn" disabled={off.isPending} onClick={() => off.mutate([])}>
              <Power /> Turn off theme
            </button>
          )
        }
      />

      <div className="notice" style={{ marginBottom: 16 }}>
        <ShieldCheck style={{ color: "var(--ok)" }} />
        <span className="dim">
          Visual only, using ModHeim's own small mod. It never touches your worlds or characters, and it only runs when you
          play <b>modded</b>. In {profile}: {active ? <b>{active.name}</b> : "Valheim's own look"}.
        </span>
      </div>

      <div className="theme-grid">
        {all.map((p) => {
          const on = active?.name === p.name;
          return (
            <button
              key={p.name}
              className={`panel theme-tile${draft.name === p.name ? " selected" : ""}`}
              onClick={() => setDraft(p)}
            >
              <GamePreview t={p} small />
              <div className="row" style={{ marginTop: 10 }}>
                <b>{p.name}</b>
                {on && (
                  <span className="badge ok">
                    <Check size={10} /> On
                  </span>
                )}
              </div>
              <div className="faint" style={{ fontSize: 12 }}>{p.blurb}</div>
            </button>
          );
        })}
      </div>

      <h2 className="section">
        <Paintbrush size={18} /> Customize <span className="muted">start from any theme and make it yours</span>
      </h2>
      <div className="panel pad theme-editor">
        <GamePreview t={draft} />
        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          <label className="field">
            <span>Name</span>
            <input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
          </label>
          <div className="color-grid">
            {(
              [
                ["panel", "Panels"],
                ["button", "Buttons"],
                ["heading", "Titles & labels"],
                ["text", "Values"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="color-field">
                <input type="color" value={draft[k].slice(0, 7)} onChange={(e) => set({ [k]: e.target.value.toUpperCase() })} />
                <span>{label}</span>
                <span className="mono faint">{draft[k].slice(0, 7)}</span>
              </label>
            ))}
          </div>
          <label className="field">
            <span>Tint strength: {Math.round(draft.panelStrength * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={draft.panelStrength}
              onChange={(e) => set({ panelStrength: Number(e.target.value) })}
            />
            <span className="hint">How strongly panels and buttons take the color. 0% keeps the game's wood.</span>
          </label>
          <div className="row wrap">
            <button className="btn primary" disabled={!profile || apply.isPending} onClick={() => apply.mutate([draft])}>
              <Check /> Apply to {profile}
            </button>
            {!isPreset && (
              <button className="btn" onClick={saveCustom}>
                Save as my theme
              </button>
            )}
            {custom.some((c) => c.name === draft.name) && (
              <button className="btn ghost danger" onClick={() => removeCustom(draft.name)}>
                Delete my theme
              </button>
            )}
          </div>
          {isPreset && <span className="faint" style={{ fontSize: 12 }}>Rename it to save your own version.</span>}
        </div>
      </div>
    </div>
  );
}
