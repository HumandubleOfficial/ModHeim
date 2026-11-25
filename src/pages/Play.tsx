import { AlertTriangle, Loader2, Package, Play, Plug, Server as ServerIcon, ShieldOff, Swords } from "lucide-react";
import { api, BEPINEX_PACK } from "../api";
import { useAction, useBackground, useGameStatus, useIndexInfo, useNews, useProfile, useServerStatus, useSettings, useUpdates } from "../hooks";
import { ServerStatusLine, shortGameVersion } from "../components/ServerStatus";
import { UpdateBanner } from "../components/UpdateBanner";
import { HeroPicture, HeroScene } from "../components/HeroScene";
import { useUi } from "../store";

export function PlayPage() {
  const settings = useSettings().data;
  const game = useGameStatus().data;
  const index = useIndexInfo().data;
  const profile = useProfile(settings?.activeProfile).data;
  const updates = useUpdates(settings?.activeProfile, !!index?.loaded).data ?? [];
  const { setPage } = useUi();
  const news = useNews().data;
  const background = useBackground().data;

  const launch = useAction((vanilla: boolean, serverId?: string) => api.launch(vanilla, serverId), {
    busy: "Starting Valheim",
    success: "Valheim is starting…",
  });
  const repair = useAction(() => api.repairProfile(settings!.activeProfile), {
    success: "BepInEx installed",
  });

  const mods = profile?.mods.filter((m) => m.fullName !== BEPINEX_PACK) ?? [];
  const enabled = mods.filter((m) => m.enabled).length;
  const hasBep = profile?.mods.some((m) => m.fullName === BEPINEX_PACK);
  const ready = !!game?.exeFound && !game.running;
  const servers = settings?.servers ?? [];
  const statuses = useServerStatus().data;
  const platform =
    game?.install?.platform === "xbox" ? "Xbox app" : game?.install?.platform === "steam" ? "Steam" : "Custom folder";
  const mode =
    game?.doorstop?.enabled === true ? `Modded · ${game.moddedProfile ?? "?"}` : game?.doorstop ? "Vanilla" : "Never modded";

  return (
    <div className="page">
      <section className="panel hero">
        <div className="hero-art">{background ? <HeroPicture src={background} /> : <HeroScene />}</div>
        <div className="eyebrow">Active profile</div>
        <h1 className="display">{settings?.activeProfile ?? "…"}</h1>
        <div className="chips">
          <span className="chip">
            <Package /> {enabled} of {mods.length} mods on
          </span>
          <span className={`chip ${game?.exeFound ? "ok" : "bad"}`}>{game?.exeFound ? platform : "Game not found"}</span>
          <span className={`chip ${hasBep ? "ok" : "warn"}`}>
            <Plug /> {hasBep ? "BepInEx ready" : "BepInEx missing"}
          </span>
          {game?.doorstop && <span className="chip">Game folder: {mode}</span>}
        </div>
        <div className="launch">
          <button
            className="btn primary play"
            disabled={!ready || !hasBep || launch.isPending}
            onClick={() => launch.mutate([false])}
          >
            {launch.isPending ? <Loader2 className="spin" /> : <Swords />}
            Play Modded
          </button>
          <button
            className="btn play-secondary"
            disabled={!ready || launch.isPending}
            onClick={() => launch.mutate([true])}
            title="Start the game without any mods"
          >
            <Play /> Vanilla
          </button>
          {game?.running && (
            <span className="chip ok">
              <span className="dot live" /> Valheim is running
            </span>
          )}
        </div>
      </section>

      <div className="stack" style={{ marginTop: 16 }}>
        {news && <UpdateBanner news={news} compact />}
        {game && !game.exeFound && (
          <div className="notice bad">
            <AlertTriangle />
            ModHeim couldn't find Valheim. Choose the game folder in Settings.
            <button className="btn sm" onClick={() => setPage("settings")}>
              Open Settings
            </button>
          </div>
        )}
        {game?.exeFound && !game.writable && (
          <div className="notice warn">
            <AlertTriangle />
            The game folder isn't writable, so mods can't be switched on. For Xbox installs, make sure the game is in
            an XboxGames folder.
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
              Review updates
            </button>
          </div>
        )}
        {game?.doorstop?.enabled && game.moddedProfile === "another mod setup" && (
          <div className="notice">
            <ShieldOff style={{ color: "var(--text-faint)" }} />
            <span className="dim">
              The game folder is set up by another mod manager or an older install. ModHeim takes over the next time you
              press Play (the old config is backed up).
            </span>
          </div>
        )}
        {game?.doorstop?.enabled && game.moddedProfile !== "another mod setup" && !game.running && (
          <div className="notice">
            <ShieldOff style={{ color: "var(--text-faint)" }} />
            <span className="dim">
              Starting Valheim outside ModHeim ({game.install?.platform === "steam" ? "from Steam" : "from the Xbox app"}) will
              also load the <b>{game.moddedProfile}</b> mods, until you press Vanilla here.
            </span>
          </div>
        )}
      </div>

      <h2 className="section">
        Quick join <span className="muted">launches with the server's profile and connects</span>
      </h2>
      {servers.length === 0 ? (
        <div className="panel pad row">
          <ServerIcon style={{ color: "var(--text-faint)" }} />
          <span className="dim">Save the servers you play on to join them in one click.</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => setPage("servers")}>
            Add a server
          </button>
        </div>
      ) : (
        <div className="grid cols-3">
          {servers.map((s) => (
            <div key={s.id} className="panel server-card">
              <div className="server-icon">
                <ServerIcon />
              </div>
              <div className="meta">
                <div className="name">{s.name}</div>
                <div className="addr">
                  {s.address} · {s.vanilla ? "Vanilla" : s.profile ?? "Active profile"}
                </div>
                <ServerStatusLine
                  status={statuses?.find((x) => x.id === s.id)}
                  gameVersion={shortGameVersion(game?.install?.version)}
                />
              </div>
              <button
                className="btn sm primary"
                disabled={!ready || launch.isPending}
                onClick={() => launch.mutate([false, s.id])}
              >
                Join
              </button>
            </div>
          ))}
        </div>
      )}

      <h2 className="section">In this profile</h2>
      {mods.length === 0 ? (
        <div className="panel pad row">
          <span className="dim">No mods yet. Find some on Thunderstore.</span>
          <span className="spacer" />
          <button className="btn sm primary" onClick={() => setPage("browse")}>
            Browse mods
          </button>
        </div>
      ) : (
        <div className="panel pad">
          <div className="row wrap" style={{ gap: 6 }}>
            {mods.slice(0, 40).map((m) => (
              <button
                key={m.fullName}
                className={`chip${m.enabled ? "" : " faint"}`}
                style={{ cursor: "pointer", opacity: m.enabled ? 1 : 0.5 }}
                onClick={() => useUi.getState().openDetail(m.fullName)}
              >
                {m.name.replace(/_/g, " ")}
              </button>
            ))}
            {mods.length > 40 && <span className="faint">+{mods.length - 40} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}
