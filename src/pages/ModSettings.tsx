import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Loader2, RotateCcw, Save, Search, SlidersHorizontal, Undo2 } from "lucide-react";
import { api, errorText, timeAgo, type CfgChange, type CfgEntry, type CfgFile } from "../api";
import { useGameStatus, useSettings } from "../hooks";
import { useUi } from "../store";
import { PageHead, Switch } from "../components/Chrome";
import { confirmDialog } from "../components/Dialogs";
import { RuneLoader } from "../components/RuneLoader";

const keyOf = (e: { section: string; key: string }) => `${e.section}\u0000${e.key}`;
const pretty = (s: string) => s.replace(/_/g, " ");

/** Display name for a config file: the plugin name if the file says, else the file name. */
const label = (c: { plugin: string | null; file: string }) => c.plugin ?? c.file.replace(/\.cfg$/i, "");

function numberOk(e: CfgEntry, v: string) {
  if (v.trim() === "") return false;
  const n = Number(v.replace(",", "."));
  if (!Number.isFinite(n)) return false;
  if (e.kind === "int" && !Number.isInteger(n)) return false;
  if (e.min != null && n < e.min) return false;
  if (e.max != null && n > e.max) return false;
  return true;
}

function Editor({ e, value, onChange }: { e: CfgEntry; value: string; onChange: (v: string) => void }) {
  switch (e.kind) {
    case "bool":
      return <Switch on={value.toLowerCase() === "true"} label={e.key} onChange={(v) => onChange(v ? "true" : "false")} />;
    case "enum":
      return (
        <select className="select" value={value} onChange={(x) => onChange(x.target.value)} aria-label={e.key}>
          {!e.choices.includes(value) && <option value={value}>{value}</option>}
          {e.choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      );
    case "flags": {
      const on = new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
      return (
        <div className="cfg-flags">
          {e.choices.map((c) => (
            <label key={c} className="check">
              <input
                type="checkbox"
                checked={on.has(c)}
                onChange={(x) => {
                  const next = new Set(on);
                  if (x.target.checked) next.add(c);
                  else next.delete(c);
                  onChange(e.choices.filter((k) => next.has(k)).join(", ") || "None");
                }}
              />
              {c}
            </label>
          ))}
        </div>
      );
    }
    case "int":
    case "float": {
      const bad = !numberOk(e, value);
      const ranged = e.min != null && e.max != null;
      const step = e.kind === "int" ? 1 : ranged ? (e.max! - e.min!) / 100 : "any";
      return (
        <div className="row" style={{ gap: 10 }}>
          {ranged && (
            <input
              type="range"
              className="range"
              min={e.min!}
              max={e.max!}
              step={step}
              value={bad ? e.min! : Number(value.replace(",", "."))}
              onChange={(x) => {
                const n = Number(x.target.value);
                onChange(e.kind === "int" ? String(Math.round(n)) : String(Math.round(n * 1000) / 1000));
              }}
              aria-label={e.key}
            />
          )}
          <input
            className={`input mono cfg-num${bad ? " invalid" : ""}`}
            value={value}
            inputMode="decimal"
            onChange={(x) => onChange(x.target.value)}
            aria-label={e.key}
            title={bad ? `Needs ${e.kind === "int" ? "a whole number" : "a number"}${ranged ? ` from ${e.min} to ${e.max}` : ""}` : undefined}
          />
        </div>
      );
    }
    default:
      return (
        <input className="input mono cfg-text" value={value} onChange={(x) => onChange(x.target.value)} aria-label={e.key} />
      );
  }
}

function FileEditor({
  profile,
  cfg,
  running,
  onDirty,
}: {
  profile: string;
  cfg: CfgFile;
  running: boolean;
  onDirty: (n: number) => void;
}) {
  const qc = useQueryClient();
  const toast = useUi((s) => s.toast);
  const [draft, setDraft] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(new Map()), [cfg.file]);

  const original = useMemo(() => {
    const m = new Map<string, string>();
    cfg.sections.forEach((s) => s.entries.forEach((e) => m.set(keyOf(e), e.value)));
    return m;
  }, [cfg]);
  const changes: CfgChange[] = [...draft].filter(([k, v]) => original.get(k) !== v).map(([k, value]) => {
    const [section, key] = k.split("\u0000");
    return { section, key, value };
  });
  useEffect(() => onDirty(changes.length), [changes.length, onDirty]);
  const entryOf = (k: string) => cfg.sections.flatMap((s) => s.entries).find((e) => keyOf(e) === k)!;
  const invalid = changes.filter((c) => {
    const e = entryOf(keyOf(c));
    return (e.kind === "int" || e.kind === "float") && !numberOk(e, c.value);
  });

  const set = (e: CfgEntry, v: string) => setDraft((d) => new Map(d).set(keyOf(e), v));
  const q = filter.trim().toLowerCase();

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.saveModConfig(
        profile,
        cfg.file,
        changes.map((c) => ({ ...c, value: (() => { const e = entryOf(keyOf(c)); return e.kind === "float" ? c.value.replace(",", ".") : c.value; })() })),
      );
      qc.setQueryData(["config", profile, cfg.file], updated);
      qc.invalidateQueries({ queryKey: ["configs", profile] });
      setDraft(new Map());
      toast("success", `Saved ${label(cfg)} settings`);
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    const ok = await confirmDialog({
      title: `Reset ${label(cfg)} to defaults?`,
      body: "Every setting in this file goes back to the mod's default value. Nothing is saved until you press Save.",
      confirm: "Reset",
    });
    if (!ok) return;
    const d = new Map<string, string>();
    cfg.sections.forEach((s) => s.entries.forEach((e) => e.default != null && d.set(keyOf(e), e.default)));
    setDraft(d);
  };

  const sections = cfg.sections
    .map((s) => ({
      ...s,
      entries: s.entries.filter(
        (e) => !q || `${e.key} ${e.description} ${s.name}`.toLowerCase().includes(q),
      ),
    }))
    .filter((s) => s.entries.length > 0);

  return (
    <div className="cfg-editor panel">
      <div className="cfg-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="display">{pretty(label(cfg))}</h2>
          <div className="faint mono" style={{ fontSize: 12 }}>
            {cfg.file}
            {cfg.version ? ` · v${cfg.version}` : ""}
          </div>
        </div>
        <span className="spacer" />
        <div className="search-box sm">
          <Search />
          <input className="input" placeholder="Find a setting" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <button className="btn sm" onClick={resetAll} title="Set every value back to its default">
          <RotateCcw /> Defaults
        </button>
      </div>
      {running && (
        <div className="notice warn" style={{ margin: "0 20px 10px" }}>
          Valheim is running. Many mods only read their settings at startup, and some write them back on exit, so
          changes may not stick until you restart the game.
        </div>
      )}
      <div className="cfg-body">
        {sections.length === 0 && <p className="faint">No settings match.</p>}
        {sections.map((s) => (
          <section key={s.name} className="cfg-section">
            <h3>{pretty(s.name)}</h3>
            {s.entries.map((e) => {
              const k = keyOf(e);
              const value = draft.get(k) ?? e.value;
              const changed = value !== e.value;
              const isDefault = e.default != null && value === e.default;
              return (
                <div key={k} className={`cfg-entry${changed ? " changed" : ""}`}>
                  <div className="cfg-label">
                    <div className="cfg-key">
                      {e.key}
                      {changed && <span className="badge warn">Changed</span>}
                    </div>
                    {e.description && <div className="cfg-desc">{e.description}</div>}
                    {e.default != null && !isDefault && (
                      <button className="link-btn" onClick={() => set(e, e.default!)}>
                        <Undo2 /> Default: <span className="mono">{e.default || "(empty)"}</span>
                      </button>
                    )}
                  </div>
                  <div className="cfg-control">
                    <Editor e={e} value={value} onChange={(v) => set(e, v)} />
                  </div>
                </div>
              );
            })}
          </section>
        ))}
      </div>
      {changes.length > 0 && (
        <div className="cfg-savebar">
          <span>
            {changes.length} unsaved change{changes.length > 1 ? "s" : ""}
            {invalid.length > 0 && <span className="warn-text"> · fix {invalid.length} invalid number{invalid.length > 1 ? "s" : ""}</span>}
          </span>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => setDraft(new Map())}>
            Discard
          </button>
          <button className="btn primary" disabled={saving || invalid.length > 0} onClick={save}>
            {saving ? <Loader2 className="spin" /> : <Save />} Save
          </button>
        </div>
      )}
    </div>
  );
}

export function ModSettingsPage() {
  const profile = useSettings().data?.activeProfile;
  const running = !!useGameStatus().data?.running;
  const { configFile, openConfig } = useUi();
  const [selected, setSelected] = useState<string | null>(configFile);
  const [filter, setFilter] = useState("");
  const [dirty, setDirty] = useState(0);

  const choose = async (file: string) => {
    if (file === current) return;
    if (dirty) {
      const ok = await confirmDialog({
        title: "Discard unsaved changes?",
        body: `You have ${dirty} unsaved change${dirty > 1 ? "s" : ""} in this file.`,
        confirm: "Discard",
        danger: true,
      });
      if (!ok) return;
    }
    setDirty(0);
    setSelected(file);
  };

  useEffect(() => {
    if (configFile) {
      setSelected(configFile);
      useUi.setState({ configFile: null });
    }
  }, [configFile, openConfig]);

  const list = useQuery({
    queryKey: ["configs", profile],
    queryFn: () => api.listModConfigs(profile!),
    enabled: !!profile,
  });
  const files = (list.data ?? []).filter((c) =>
    !filter || `${label(c)} ${c.file}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const current = selected ?? list.data?.[0]?.file ?? null;
  const cfg = useQuery({
    queryKey: ["config", profile, current],
    queryFn: () => api.readModConfig(profile!, current!),
    enabled: !!profile && !!current,
  });

  return (
    <div className="page fill">
      <PageHead
        title="Mod Settings"
        sub={`Config files in ${profile ?? "…"}. Mods create theirs the first time the game starts with them.`}
        actions={
          <button className="btn" onClick={() => api.openFolder("config", profile)}>
            <FolderOpen /> Config folder
          </button>
        }
      />
      {list.isLoading ? (
        <div className="empty">
          <RuneLoader />
        </div>
      ) : list.error ? (
        <div className="empty">
          <h3>Couldn't read the configs</h3>
          <p>{errorText(list.error)}</p>
        </div>
      ) : (list.data ?? []).length === 0 ? (
        <div className="empty">
          <SlidersHorizontal style={{ width: 34, height: 34, color: "var(--text-faint)" }} />
          <h3>No mod settings yet</h3>
          <p>Launch the game modded once. Each mod writes its config file on first start, and it shows up here.</p>
        </div>
      ) : (
        <div className="news-layout cfg-layout">
          <div className="news-list">
            <div className="search-box sm" style={{ marginBottom: 6 }}>
              <Search />
              <input className="input" placeholder="Filter mods" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            {files.map((c) => (
              <button
                key={c.file}
                className={`news-item${c.file === current ? " selected" : ""}`}
                onClick={() => choose(c.file)}
              >
                <div className="news-title" style={{ marginTop: 0 }}>{pretty(label(c))}</div>
                <div className="news-snippet">
                  {c.entries} setting{c.entries === 1 ? "" : "s"} · changed {timeAgo(new Date(c.modified * 1000).toISOString())}
                </div>
              </button>
            ))}
          </div>
          {cfg.isLoading ? (
            <div className="empty">
              <Loader2 className="spin" />
            </div>
          ) : cfg.error ? (
            <div className="empty">
              <h3>Couldn't open this file</h3>
              <p>{errorText(cfg.error)}</p>
            </div>
          ) : cfg.data ? (
            <FileEditor profile={profile!} cfg={cfg.data} running={running} onDirty={setDirty} />
          ) : null}
        </div>
      )}
    </div>
  );
}
