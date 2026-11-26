import { lazy, Suspense, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { api, errorText, type ErrorStorm, type Progress } from "./api";
import { keys, useGameStatus, useSettings } from "./hooks";
import { useUi } from "./store";
import { ProgressDock, TitleBar, Toasts } from "./components/Chrome";
import { DialogHost } from "./components/Dialogs";
import { Sidebar } from "./components/Sidebar";
import { Backdrop } from "./components/Backdrop";
import { PlayPage } from "./pages/Play";
import { checkForUpdate, UpdateDialog } from "./updater";
import { LaunchGuardHost, StormBanner } from "./components/Guard";
import { configureSound, installUiSounds, setAmbience, sfx } from "./sound";

// Pages other than Play load on first visit, so startup only parses what it shows.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const PackageDrawer = named(() => import("./components/PackageDrawer"), "PackageDrawer");
const NewsPage = named(() => import("./pages/News"), "NewsPage");
const ThemesPage = named(() => import("./pages/Themes"), "ThemesPage");
const BrowsePage = named(() => import("./pages/Browse"), "BrowsePage");
const InstalledPage = named(() => import("./pages/Installed"), "InstalledPage");
const ProfilesPage = named(() => import("./pages/Profiles"), "ProfilesPage");
const ServersPage = named(() => import("./pages/Servers"), "ServersPage");
const ModSettingsPage = named(() => import("./pages/ModSettings"), "ModSettingsPage");
const HealthPage = named(() => import("./pages/Health"), "HealthPage");
const GameLogPage = named(() => import("./pages/GameLog"), "GameLogPage");
const GraphicsPage = named(() => import("./pages/Graphics"), "GraphicsPage");
const StatsPage = named(() => import("./pages/Stats"), "StatsPage");
const BackupsPage = named(() => import("./pages/Backups"), "BackupsPage");
const SettingsPage = named(() => import("./pages/Settings"), "SettingsPage");

/** Mods queued to turn off while the game ran are switched off once it closes. */
async function afterGameClosed() {
  const ui = useUi.getState();
  const queued = ui.offWhenClosed;
  ui.clearOff();
  useUi.setState({ storms: [] });
  if (queued.length === 0) return;
  try {
    // the backend notices the game closed on the same tick; give it a moment
    await new Promise((r) => setTimeout(r, 500));
    for (const [profile, full] of queued) await api.setModEnabled(profile, full, false);
    ui.toast("success", `Turned off ${queued.length} mod${queued.length > 1 ? "s" : ""} that kept erroring`);
  } catch (e) {
    ui.toast("error", errorText(e));
  }
  queryClientRef?.invalidateQueries();
}

let queryClientRef: ReturnType<typeof useQueryClient> | null = null;

function useGameStatusRunning() {
  return useGameStatus().data?.running ?? false;
}

export default function App() {
  const qc = useQueryClient();
  queryClientRef = qc;
  const { page, detail, setProgress, toast, setBusy } = useUi();
  const settingsData = useSettings().data;
  const theme = settingsData?.theme ?? "norse";
  const backdrop = settingsData?.backdrop ?? "aurora";
  const booted = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Sounds
  const sounds = settingsData?.sounds ?? true;
  const ambience = settingsData?.ambience ?? true;
  const volume = settingsData?.volume ?? 0.6;
  const running = useGameStatusRunning();
  useEffect(() => installUiSounds(), []);
  useEffect(() => configureSound({ sounds, ambience, volume }), [sounds, ambience, volume]);
  // the campfire crackles on the Play screen, and goes quiet while the game is running
  useEffect(() => setAmbience(page === "play" && !running), [page, running]);

  // Backend events
  useEffect(() => {
    const offs = [
      listen<Progress>("progress", (e) => setProgress(e.payload.done ? null : e.payload)),
      listen<boolean>("game-running", (e) => {
        qc.invalidateQueries({ queryKey: keys.game });
        if (!e.payload) {
          void afterGameClosed();
          qc.invalidateQueries({ queryKey: ["stats"] });
        }
      }),
      listen<ErrorStorm>("error-storm", (e) => {
        useUi.getState().addStorm(e.payload);
        sfx.warn();
      }),
    ];
    return () => {
      offs.forEach((p) => p.then((off) => off()));
    };
  }, [qc, setProgress]);

  // Launcher updates: shortly after start, then every 6 hours.
  useEffect(() => {
    const first = setTimeout(() => checkForUpdate(), 4000);
    const every = setInterval(() => checkForUpdate(), 6 * 3600 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);

  // First load: mod list, then make sure a profile exists.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        await api.refreshIndex(false);
      } catch (e) {
        toast("error", `Couldn't load the mod list: ${errorText(e)}`);
      }
      qc.invalidateQueries({ queryKey: keys.index });
      qc.invalidateQueries({ queryKey: ["updates"] });
      try {
        const profiles = await api.listProfiles();
        const settings = await api.getSettings();
        if (profiles.length === 0) {
          setBusy("Setting up your first profile");
          await api.createProfile(settings.activeProfile || "Default");
          await api.setActiveProfile(settings.activeProfile || "Default");
          toast("success", "Created the Default profile with BepInEx");
        } else if (!profiles.some((p) => p.name === settings.activeProfile)) {
          await api.setActiveProfile(profiles[0].name);
        }
      } catch (e) {
        toast("error", errorText(e));
      } finally {
        setBusy(null);
        qc.invalidateQueries();
      }
    })();
  }, [qc, toast, setBusy]);

  return (
    <div className="app">
      <TitleBar />
      <div className="body">
        <Sidebar />
        <Backdrop kind={backdrop} />
        <main
          className={`content${page === "play" ? " full" : ""}${
            page === "browse" || page === "installed" || page === "news" || page === "modsettings" || page === "log" ? " no-scroll" : ""
          }`}
        >
          <Suspense fallback={null}>
          {page === "play" && <PlayPage />}
          {page === "news" && <NewsPage />}
          {page === "themes" && <ThemesPage />}
          {page === "browse" && <BrowsePage />}
          {page === "installed" && <InstalledPage />}
          {page === "profiles" && <ProfilesPage />}
          {page === "servers" && <ServersPage />}
          {page === "modsettings" && <ModSettingsPage />}
          {page === "health" && <HealthPage />}
          {page === "log" && <GameLogPage />}
          {page === "backups" && <BackupsPage />}
          {page === "stats" && <StatsPage />}
          {page === "graphics" && <GraphicsPage />}
          {page === "settings" && <SettingsPage />}
          </Suspense>
        </main>
      </div>
      {detail && (
        <Suspense fallback={null}>
          <PackageDrawer />
        </Suspense>
      )}
      <DialogHost />
      <LaunchGuardHost />
      <StormBanner />
      <UpdateDialog />
      <ProgressDock />
      <Toasts />
    </div>
  );
}
