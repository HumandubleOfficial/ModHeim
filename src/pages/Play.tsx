import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AlertTriangle, Archive, ChevronDown, Package, ShieldOff } from "lucide-react";
import { api, BEPINEX_PACK, type Server } from "../api";
import {
  useAction,
  useBackground,
  useGameStatus,
  useIndexInfo,
  useNews,
  useProfile,
  useProfiles,
  useServerStatus,
  useSettings,
  useUpdates,
} from "../hooks";
import { shortGameVersion } from "../components/ServerStatus";
import { UpdateBanner } from "../components/UpdateBanner";
import { HeroPicture, HeroScene } from "../components/HeroScene";
import { guardLaunch } from "../components/Guard";
import { sfx } from "../sound";
import { useUi } from "../store";

/** Interlaced knot between two fading lines. Original artwork. */
export function Knot({ width = 280 }: { width?: number }) {
  const c = width / 2;
  return (
    <svg className="knot" width={width} height="18" viewBox={`0 0 ${width} 18`} aria-hidden>
      <defs>
        <linearGradient id="knot-l" x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.9" />
        </linearGradient>
        <linearGradient id="knot-r" x1="1" x2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect x="0" y="8.4" width={c - 20} height="1.2" fill="url(#knot-l)" />
      <rect x={c + 20} y="8.4" width={c - 20} height="1.2" fill="url(#knot-r)" />
      <g fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d={`M${c - 16} 9 L${c - 8} 2 L${c} 9 L${c - 8} 16 Z`} />
        <path d={`M${c} 9 L${c + 8} 2 L${c + 16} 9 L${c + 8} 16 Z`} />
        <circle cx={c} cy="9" r="4.2" />
      </g>
      <circle cx={c - 22} cy="9" r="1.6" fill="currentColor" />
      <circle cx={c + 22} cy="9" r="1.6" fill="currentColor" />
    </svg>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  big,
  hint,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  big?: boolean;
  hint?: string;
}) {
  return (
    <button className={`menu-item${big ? " big" : ""}`} disabled={disabled} onClick={onClick} title={hint}>
      <span>{children}</span>
    </button>
  );
}

function ProfileSwitch({ current }: { current: string }) {
  const profiles = useProfiles().data ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activate = useAction(api.setActiveProfile, { success: (s) => `"${s.activeProfile}" is now active` });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className="profile-switch" ref={ref}>
      <button className="profile-name" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={profiles.length < 2}>
        <h1 className="display">{current}</h1>
        {profiles.length > 1 && <ChevronDown />}
      </button>
      {open && (
        <div className="panel profile-menu" role="menu">
          {profiles.map((p) => (
            <button
              key={p.name}
              role="menuitem"
              className={`profile-option${p.name === current ? " on" : ""}`}
              onClick={() => {
                setOpen(false);
                if (p.name !== current) activate.mutate([p.name]);
              }}
            >
              <b>{p.name}</b>
              <span className="faint">{p.enabledCount} mods on</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlayPage() {
  const settings = useSettings().data;
  const game = useGameStatus().data;
  const index = useIndexInfo().data;
  const profile = useProfile(settings?.activeProfile).data;
  const updates = useUpdates(settings?.activeProfile, !!index?.loaded).data ?? [];
  const { setPage } = useUi();
  const news = useNews().data;
  const background = useBackground().data;
  const statuses = useServerStatus().data;
  const [menu, setMenu] = useState<"main" | "join">("main");
  const [appVersion, setAppVersion] = useState("");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  const launch = useAction((vanilla: boolean, serverId?: string) => api.launch(vanilla, serverId), {
    busy: "Starting Valheim",
    success: "Valheim is starting…",
  });
  const repair = useAction(() => api.repairProfile(settings!.activeProfile), { success: "BepInEx installed" });

  const mods = profile?.mods.filter((m) => m.fullName !== BEPINEX_PACK) ?? [];
  const enabled = mods.filter((m) => m.enabled).length;
  const hasBep = profile?.mods.some((m) => m.fullName === BEPINEX_PACK);
  const ready = !!game?.exeFound && !game.running && !launch.isPending && !checking;
  const servers = settings?.servers ?? [];
  const platform =
    game?.install?.platform === "xbox" ? "Xbox app" : game?.install?.platform === "steam" ? "Steam" : "Custom folder";
  const gameVersion = shortGameVersion(game?.install?.version);

  const start = async (vanilla: boolean, server?: Server) => {
    if (!settings) return;
    const modded = server ? !server.vanilla : !vanilla;
    if (modded) {
      setChecking(true);
      const go = await guardLaunch(server?.profile ?? settings.activeProfile, settings.launchGuard).finally(() => setChecking(false));
      if (!go) return;
    }
    sfx.horn();
    launch.mutate([vanilla, server?.id]);
  };

  return (
    <div className="menu-screen">
      <div className="menu-art">{background ? <HeroPicture src={background} /> : <HeroScene />}</div>

      <header className="menu-top">
        <div className="eyebrow">Active profile</div>
        <ProfileSwitch current={settings?.activeProfile ?? "…"} />
        <Knot />
      </header>

      <nav className="menu" aria-label="Play">
        {game?.running ? (
          <div className="menu-running">
            <span className="dot live" /> Valheim is running
          </div>
        ) : menu === "main" ? (
          <>
            <MenuItem big disabled={!ready || !hasBep} onClick={() => start(false)}>
              {checking ? "Checking mods…" : launch.isPending ? "Starting…" : "Play modded"}
            </MenuItem>
            <MenuItem disabled={!ready} onClick={() => start(true)} hint="Start the game without any mods">
              Vanilla
            </MenuItem>
            <MenuItem disabled={!ready} onClick={() => setMenu("join")}>
              Join server
            </MenuItem>
            <MenuItem onClick={() => setPage("installed")}>Mods</MenuItem>
            <MenuItem onClick={() => setPage("profiles")}>Profiles</MenuItem>
          </>
        ) : (
          <>
            {servers.length === 0 && <div className="menu-note">No saved servers yet.</div>}
            {servers.map((s) => {
              const st = statuses?.find((x) => x.id === s.id);
              return (
                <button key={s.id} className="menu-item server" disabled={!ready} onClick={() => start(false, s)}>
                  <span>{s.name}</span>
                  <small>
                    <i className={`dot ${st?.state === "online" ? "ok" : st?.state === "offline" ? "bad" : ""}`} />
                    {st?.state === "online"
                      ? `${st.players ?? "?"}/${st.maxPlayers ?? "?"} players${st.pingMs != null ? ` · ${st.pingMs} ms` : ""}`
                      : st?.state === "offline"
                        ? "Offline"
                        : s.address}
                    {" · "}
                    {s.vanilla ? "Vanilla" : s.profile ?? "Active profile"}
                  </small>
                </button>
              );
            })}
            <MenuItem onClick={() => setPage("servers")}>{servers.length ? "Manage servers" : "Add a server"}</MenuItem>
            <MenuItem onClick={() => setMenu("main")}>Back</MenuItem>
          </>
        )}
        <Knot width={220} />
      </nav>

      <aside className="menu-notices">
        {news && <UpdateBanner news={news} compact />}
        {game && !game.exeFound && (
          <div className="notice bad">
            <AlertTriangle />
            ModHeim couldn't find Valheim.
            <button className="btn sm" onClick={() => setPage("settings")}>
              Open Settings
            </button>
          </div>
        )}
        {game?.exeFound && !game.writable && (
          <div className="notice warn">
            <AlertTriangle />
            The game folder isn't writable, so mods can't be switched on.
          </div>
        )}
        {profile && !hasBep && (
          <div className="notice warn">
            <AlertTriangle />
            This profile doesn't have BepInEx, the loader that runs mods.
            <button className="btn sm primary" disabled={repair.isPending} onClick={() => repair.mutate([])}>
              Install BepInEx
            </button>
          </div>
        )}
        {updates.length > 0 && (
          <div className="notice info">
            <Package />
            {updates.length} mod{updates.length > 1 ? "s have" : " has"} an update.
            <button className="btn sm" onClick={() => setPage("installed")}>
              Review
            </button>
          </div>
        )}
        {game?.doorstop?.enabled && game.moddedProfile !== "another mod setup" && !game.running && (
          <div className="notice">
            <ShieldOff style={{ color: "var(--text-faint)" }} />
            <span className="dim">
              Starting Valheim {game.install?.platform === "steam" ? "from Steam" : "from the Xbox app"} also loads the{" "}
              <b>{game.moddedProfile}</b> mods, until you press Vanilla here.
            </span>
          </div>
        )}
      </aside>

      <footer className="menu-status">
        <div>
          {game?.exeFound ? `Valheim ${gameVersion ?? ""} · ${platform}` : "Game not found"}
        </div>
        <div>
          {enabled} of {mods.length} mods on · {hasBep ? "BepInEx ready" : "BepInEx missing"}
        </div>
        {settings?.backupBeforeLaunch && (
          <button className="link" onClick={() => setPage("backups")}>
            <Archive /> Worlds backed up before modded play
          </button>
        )}
        {appVersion && <div className="faint">ModHeim {appVersion}</div>}
      </footer>
    </div>
  );
}
