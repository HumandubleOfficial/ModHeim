import { lazy, Suspense, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { ArrowUpCircle, Loader2 } from "lucide-react";
import { create } from "zustand";
import { errorText } from "./api";
import { useUi } from "./store";
import { Modal } from "./components/Dialogs";

const Md = lazy(() => import("./components/Markdown").then((m) => ({ default: m.Md })));

/*
 * Launcher updates come from GitHub releases. The app reads latest.json from the newest
 * release, checks its signature against the public key built into the app, then downloads
 * and runs the new installer.
 */

interface UpdaterState {
  update: Update | null;
  checking: boolean;
  checkedAt: number | null;
  error: string | null;
  installing: boolean;
  open: boolean;
}

export const useUpdater = create<UpdaterState>(() => ({
  update: null,
  checking: false,
  checkedAt: null,
  error: null,
  installing: false,
  open: false,
}));

/** Look for a newer ModHeim. Quiet on failure unless `manual` (then it throws). */
export async function checkForUpdate(manual = false): Promise<Update | null> {
  if (useUpdater.getState().checking || useUpdater.getState().installing) return useUpdater.getState().update;
  useUpdater.setState({ checking: true, error: null });
  try {
    const u = await check({ timeout: 15000 });
    useUpdater.setState({ update: u ?? null, checkedAt: Date.now() });
    return u ?? null;
  } catch (e) {
    useUpdater.setState({ error: errorText(e), checkedAt: Date.now() });
    if (manual) throw e;
    return null;
  } finally {
    useUpdater.setState({ checking: false });
  }
}

async function installUpdate() {
  const u = useUpdater.getState().update;
  if (!u) return;
  const { setProgress, toast } = useUi.getState();
  useUpdater.setState({ installing: true });
  let total = 0;
  let got = 0;
  try {
    await u.downloadAndInstall((ev) => {
      if (ev.event === "Started") total = ev.data.contentLength ?? 0;
      else if (ev.event === "Progress") {
        got += ev.data.chunkLength;
        setProgress({ label: `Downloading ModHeim ${u.version}`, step: 1, steps: 1, bytes: got, total, done: false });
      } else if (ev.event === "Finished") {
        setProgress({ label: "Installing the update", step: 1, steps: 1, bytes: 0, total: 0, done: false });
      }
    });
    // On Windows the installer closes ModHeim itself; this covers the other cases.
    await relaunch();
  } catch (e) {
    toast("error", `Update failed: ${errorText(e)}`);
  } finally {
    setProgress(null);
    useUpdater.setState({ installing: false });
  }
}

/** Titlebar button shown when an update is waiting. */
export function UpdatePill() {
  const { update, installing } = useUpdater();
  if (!update) return null;
  return (
    <button className="update-pill" onClick={() => useUpdater.setState({ open: true })} disabled={installing}>
      {installing ? <Loader2 className="spin" /> : <ArrowUpCircle />}
      {installing ? "Updating…" : `Update to ${update.version}`}
    </button>
  );
}

export function UpdateDialog() {
  const { update, open, installing } = useUpdater();
  const [busy, setBusy] = useState(false);
  if (!open || !update) return null;
  const close = () => useUpdater.setState({ open: false });
  return (
    <Modal onClose={close} wide>
      <h3>ModHeim {update.version} is ready</h3>
      <p className="dim" style={{ marginTop: 4 }}>
        You have {update.currentVersion}.{" "}
        {update.date ? `Released ${new Date(update.date.replace(" ", "T").split(".")[0]).toLocaleDateString()}.` : ""} Your
        profiles, mods and settings stay as they are.
      </p>
      {update.body && (
        <div className="update-notes">
          <Suspense fallback={null}>
            <Md>{update.body}</Md>
          </Suspense>
        </div>
      )}
      <div className="buttons">
        <button className="btn ghost" onClick={close}>
          Later
        </button>
        <button
          className="btn primary"
          disabled={busy || installing}
          onClick={async () => {
            setBusy(true);
            close();
            await installUpdate();
            setBusy(false);
          }}
        >
          <ArrowUpCircle /> Install and restart
        </button>
      </div>
    </Modal>
  );
}
