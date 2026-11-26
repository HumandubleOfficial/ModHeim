import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { videoDir } from "@tauri-apps/api/path";
import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowUpCircle, FolderOpen, FolderSearch, ImageIcon, Mountain, RefreshCw, ShieldOff, Trash2 } from "lucide-react";
import { api, errorText, formatBytes, formatCount, timeAgo, type Settings, type Theme } from "../api";
import { useAction, useGameStatus, useIndexInfo, useSettings } from "../hooks";
import { PageHead, Switch } from "../components/Chrome";
import { confirmDialog } from "../components/Dialogs";
import { checkForUpdate, useUpdater } from "../updater";
import { BACKDROPS } from "../components/Backdrop";
import { useUi } from "../store";
import { configureSound, sfx } from "../sound";

const platformName = (p?: string) => (p === "xbox" ? "Xbox app" : p === "steam" ? "Steam" : "Custom folder");

function ThemeCard({ id, label, current, onPick }: { id: Theme; label: string; current: Theme; onPick: (t: Theme) => void }) {
  const look =
    id === "norse"
      ? { side: "#1d150e", main: "linear-gradient(180deg,#2a2119,#1a130d)", bar: "#e39a3c", bar2: "#4b3a28" }
      : { side: "#111318", main: "#151820", bar: "#5b8cff", bar2: "#262b37" };
  return (
    <button className={`theme-card${current === id ? " on" : ""}`} onClick={() => onPick(id)} aria-pressed={current === id}>
      <div className="preview">
        <div className="side" style={{ background: look.side }} />
        <div className="main" style={{ background: look.main }}>
          <div className="bar" style={{ background: look.bar, width: "55%" }} />
          <div className="bar" style={{ background: look.bar2, width: "85%" }} />
          <div className="bar" style={{ background: look.bar2, width: "70%" }} />
        </div>
      </div>
      <span className="label">{label}</span>
    </button>
  );
}

export function SettingsPage() {
  const settings = useSettings().data;
  const game = useGameStatus().data;
  const index = useIndexInfo().data;
  const detected = useQuery({ queryKey: ["detect"], queryFn: api.detectGames });
  const prefs = useAction((p: Partial<Settings>) => api.savePrefs(p));
  const setGame = useAction(api.setGame, { success: (g) => `Using ${platformName(g.platform)} install` });
  const refresh = useAction(() => api.refreshIndex(true), { success: (i) => `Mod list updated (${i.count} mods)` });
  const vanilla = useAction(api.disableModsInGame, { success: "Mods are off for the next launch" });
  const clear = useAction(api.clearDownloadCache, { success: (n) => `Freed ${formatBytes(n)}` });
  const [args, setArgs] = useState("");
  const [vol, setVol] = useState<number | null>(null);
  useEffect(() => setArgs(settings?.extraArgs ?? ""), [settings?.extraArgs]);

  if (!settings) return null;
  const pickFolder = async () => {
    const dir = await open({ directory: true, title: "Choose the folder that contains Valheim.exe" });
    if (typeof dir === "string") setGame.mutate([dir]);
  };
  const isXbox = settings.game?.platform === "xbox";
  const ds = game?.doorstop;

  return (
    <div className="page">
      <PageHead title="Settings" />

      <h2 className="section" style={{ marginTop: 0 }}>Game</h2>
      <div className="panel pad stack" style={{ gap: 14 }}>
        {settings.game ? (
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <b>{platformName(settings.game.platform)}</b>
                {settings.game.version && <span className="badge muted">v{settings.game.version}</span>}
                <span className={`badge ${game?.exeFound ? "ok" : "bad"}`}>{game?.exeFound ? "Valheim.exe found" : "Missing"}</span>
                <span className={`badge ${game?.writable ? "ok" : "bad"}`}>{game?.writable ? "Writable" : "Read-only"}</span>
              </div>
              <div className="mono dim selectable" style={{ wordBreak: "break-all" }}>{settings.game.path}</div>
            </div>
            <button className="btn sm" onClick={() => api.openFolder("game")}>
              <FolderOpen /> Open
            </button>
          </div>
        ) : (
          <div className="notice bad">Valheim isn't set up. Pick a detected install below or choose its folder.</div>
        )}

        {(detected.data?.length ?? 0) > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="faint" style={{ fontSize: 12 }}>Detected installs</span>
            {detected.data!.map((g) => {
              const on = g.path === settings.game?.path;
              return (
                <div key={g.path} className={`install-option${on ? " on" : ""}`}>
                  <b style={{ minWidth: 90 }}>{platformName(g.platform)}</b>
                  <span className="mono dim" style={{ flex: 1, wordBreak: "break-all" }}>{g.path}</span>
                  {on ? <span className="badge ok">In use</span> : (
                    <button className="btn sm" onClick={() => setGame.mutate([g.path])}>Use this</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={pickFolder}>
            <FolderSearch /> Choose folder…
          </button>
          <button className="btn ghost" onClick={() => detected.refetch()}>
            <RefreshCw className={detected.isFetching ? "spin" : ""} /> Detect again
          </button>
        </div>
      </div>

      <h2 className="section">Launching</h2>
      <div className="panel pad">
        <div className="setting-row">
          <div className="text">
            <div className="title">How to start the game</div>
            <div className="desc">
              {isXbox
                ? "Xbox app launch is the normal way Windows starts the game. If Quick join doesn't connect you, try Run Valheim.exe directly."
                : "Through Steam is recommended for Steam installs."}
            </div>
          </div>
          <div className="seg">
            <button className={settings.launchMethod === "activate" ? "on" : ""} onClick={() => prefs.mutate([{ launchMethod: "activate" }])}>
              {isXbox ? "Xbox app" : "Steam"}
            </button>
            <button className={settings.launchMethod === "direct" ? "on" : ""} onClick={() => prefs.mutate([{ launchMethod: "direct" }])}>
              Run Valheim.exe directly
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Extra launch options</div>
            <div className="desc">Added to every launch, for example <span className="mono">-console</span>.</div>
          </div>
          <input
            className="input mono"
            style={{ width: 260 }}
            value={args}
            placeholder="-console"
            onChange={(e) => setArgs(e.target.value)}
            onBlur={() => args !== settings.extraArgs && prefs.mutate([{ extraArgs: args }])}
          />
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Mods in the game folder</div>
            <div className="desc">
              {ds?.proxyInstalled
                ? `Doorstop ${ds.version ?? ""} is installed. Right now the game starts ${
                    ds.enabled ? `modded with "${game?.moddedProfile}"` : "vanilla"
                  } when launched from anywhere.`
                : "The BepInEx loader isn't in the game folder yet. ModHeim adds it the first time you play modded."}
            </div>
          </div>
          <button className="btn" disabled={!ds?.enabled || vanilla.isPending} onClick={() => vanilla.mutate([])}>
            <ShieldOff /> Switch to vanilla
          </button>
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Check mods before playing</div>
            <div className="desc">
              Before a modded launch, looks for mods built for an older game version (the kind that make Valheim stop
              responding) and offers to turn them off. While you play, warns when a mod errors nonstop.
            </div>
          </div>
          <Switch label="Check mods before playing" on={settings.launchGuard} onChange={(v) => prefs.mutate([{ launchGuard: v }])} />
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Back up worlds before modded play</div>
            <div className="desc">
              Copies your worlds and characters into ModHeim's backups folder first, only when they changed since the
              last backup. Your save files are only read, never changed.
            </div>
          </div>
          <Switch
            label="Back up worlds before modded play"
            on={settings.backupBeforeLaunch}
            onChange={(v) => prefs.mutate([{ backupBeforeLaunch: v }])}
          />
        </div>
      </div>

      <h2 className="section">Appearance</h2>
      <div className="panel pad">
        <div className="theme-cards">
          <ThemeCard id="norse" label="Norse" current={settings.theme} onPick={(t) => prefs.mutate([{ theme: t }])} />
          <ThemeCard id="modern" label="Modern dark" current={settings.theme} onPick={(t) => prefs.mutate([{ theme: t }])} />
        </div>
        <div className="setting-row" style={{ marginTop: 14 }}>
          <div className="text">
            <div className="title">Background</div>
            <div className="desc">{BACKDROPS.find((b) => b.id === settings.backdrop)?.hint ?? ""}. Moves gently behind every page.</div>
          </div>
          <div className="seg" role="radiogroup" aria-label="Background">
            {BACKDROPS.map((b) => (
              <button
                key={b.id}
                role="radio"
                aria-checked={settings.backdrop === b.id}
                className={settings.backdrop === b.id ? "on" : ""}
                onClick={() => prefs.mutate([{ backdrop: b.id }])}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
        <BackgroundRow current={settings.background} />
      </div>

      <h2 className="section">Sound</h2>
      <div className="panel pad">
        <div className="setting-row">
          <div className="text">
            <div className="title">Menu sounds</div>
            <div className="desc">Soft clicks on buttons and a horn when the game starts.</div>
          </div>
          <Switch label="Menu sounds" on={settings.sounds} onChange={(v) => prefs.mutate([{ sounds: v }])} />
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Campfire</div>
            <div className="desc">A crackling fire on the Play screen. Goes quiet while the game is running.</div>
          </div>
          <Switch label="Campfire" on={settings.ambience} onChange={(v) => prefs.mutate([{ ambience: v }])} />
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Volume</div>
          </div>
          <input
            type="range"
            className="range"
            min={0}
            max={100}
            aria-label="Volume"
            value={Math.round((vol ?? settings.volume) * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              setVol(v);
              configureSound({ sounds: settings.sounds, ambience: settings.ambience, volume: v });
            }}
            onPointerUp={() => {
              if (vol !== null && vol !== settings.volume) prefs.mutate([{ volume: vol }]);
              sfx.click();
            }}
            onKeyUp={() => vol !== null && vol !== settings.volume && prefs.mutate([{ volume: vol }])}
          />
        </div>
      </div>

      <h2 className="section">ModHeim updates</h2>
      <div className="panel pad">
        <UpdateRow />
      </div>

      <h2 className="section">Mod list</h2>
      <div className="panel pad">
        <div className="setting-row">
          <div className="text">
            <div className="title">Thunderstore</div>
            <div className="desc">
              {index?.loaded ? `${formatCount(index.count)} mods, updated ${timeAgo(index.fetchedAt)}.` : "Not loaded yet."} Refreshes
              automatically when it's over an hour old.
            </div>
          </div>
          <button className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate([])}>
            <RefreshCw className={refresh.isPending ? "spin" : ""} /> Refresh now
          </button>
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Show deprecated mods</div>
            <div className="desc">Mods their authors have marked as no longer maintained.</div>
          </div>
          <Switch label="Show deprecated mods" on={settings.showDeprecated} onChange={(v) => prefs.mutate([{ showDeprecated: v }])} />
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Show NSFW mods</div>
            <div className="desc">Mods flagged as having adult content.</div>
          </div>
          <Switch label="Show NSFW mods" on={settings.showNsfw} onChange={(v) => prefs.mutate([{ showNsfw: v }])} />
        </div>
      </div>

      <h2 className="section">Storage</h2>
      <div className="panel pad">
        <div className="setting-row">
          <div className="text">
            <div className="title">ModHeim data folder</div>
            <div className="desc">Profiles, settings and downloaded mods.</div>
          </div>
          <button className="btn" onClick={() => api.openFolder("data")}>
            <FolderOpen /> Open
          </button>
        </div>
        <div className="setting-row">
          <div className="text">
            <div className="title">Download cache</div>
            <div className="desc">Mod zips kept to make reinstalling fast. Installed mods aren't affected.</div>
          </div>
          <button
            className="btn danger"
            disabled={clear.isPending}
            onClick={async () => {
              if (await confirmDialog({ title: "Clear the download cache?", body: "Mods will be downloaded again the next time they're installed.", confirm: "Clear", danger: true }))
                clear.mutate([]);
            }}
          >
            <Trash2 /> Clear
          </button>
        </div>
      </div>
      <p className="faint" style={{ fontSize: 12, marginTop: 24 }}>
        ModHeim is a fan-made launcher. It isn't affiliated with Iron Gate, Coffee Stain or Thunderstore.
      </p>
    </div>
  );
}

function BackgroundRow({ current }: { current: string | null }) {
  const setBg = useAction(api.setBackground, { success: (s) => (s.background ? "Play screen picture set" : "Back to the ModHeim scene") });
  const choose = async () => {
    // Xbox Game Bar saves screenshots to Videos\Captures, so start there.
    const start = await videoDir().then((v) => `${v}\\Captures`).catch(() => undefined);
    const path = await open({
      title: "Choose a picture for the Play screen",
      defaultPath: start,
      filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
      multiple: false,
    });
    if (typeof path === "string") setBg.mutate([path]);
  };
  return (
    <div className="setting-row" style={{ marginTop: 14 }}>
      <div className="text">
        <div className="title">Play screen picture</div>
        <div className="desc">
          {current
            ? "Using your own picture."
            : "Using the ModHeim scene. Pick one of your own Valheim screenshots to put it behind the Play menu instead (Win+Alt+PrtScn takes one in game)."}
        </div>
      </div>
      <div className="row">
        {current && (
          <button className="btn" disabled={setBg.isPending} onClick={() => setBg.mutate([null])}>
            <Mountain /> Use the scene
          </button>
        )}
        <button className="btn" disabled={setBg.isPending} onClick={choose}>
          <ImageIcon /> {current ? "Change picture" : "Choose picture"}
        </button>
      </div>
    </div>
  );
}

function UpdateRow() {
  const { update, checking, checkedAt, error } = useUpdater();
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const status = checking
    ? "Checking…"
    : update
      ? `Version ${update.version} is available.`
      : error
        ? `Couldn't check: ${error}`
        : checkedAt
          ? "You're on the latest version."
          : "Checks automatically when ModHeim starts.";
  return (
    <div className="setting-row">
      <div className="text">
        <div className="title">ModHeim {version}</div>
        <div className="desc">{status} Updates are downloaded from ModHeim's GitHub releases and checked against its signature before installing.</div>
      </div>
      {update ? (
        <button className="btn primary" onClick={() => useUpdater.setState({ open: true })}>
          <ArrowUpCircle /> Update to {update.version}
        </button>
      ) : (
        <button
          className="btn"
          disabled={checking}
          onClick={() =>
            checkForUpdate(true)
              .then((u) => !u && useUi.getState().toast("info", "ModHeim is up to date"))
              .catch((e) => useUi.getState().toast("error", `Couldn't check for updates: ${errorText(e)}`))
          }
        >
          <RefreshCw className={checking ? "spin" : ""} /> Check for updates
        </button>
      )}
    </div>
  );
}
