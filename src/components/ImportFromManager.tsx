import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowDownToLine, FolderSearch, Loader2 } from "lucide-react";
import { api, errorText, timeAgo, type ExternalProfile, type ImportResult } from "../api";
import { useAction, useSettings } from "../hooks";
import { useUi } from "../store";
import { alertDialog, confirmDialog, Modal } from "./Dialogs";

/** After an import: list anything that didn't go to plan, then offer to switch to it. */
async function afterImport(r: ImportResult, active: string | undefined) {
  if (r.warnings.length) {
    await alertDialog({
      title: `Imported "${r.name}" with ${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""}`,
      body: (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ),
    });
  }
  if (r.name !== active) {
    const ok = await confirmDialog({
      title: `Switch to "${r.name}"?`,
      body: "Make it the active profile, so Play starts with these mods.",
      confirm: "Switch",
    });
    if (ok) {
      await api.setActiveProfile(r.name);
      useUi.getState().toast("success", `"${r.name}" is now active`);
    }
  }
}

export function ImportFromManager({ onClose }: { onClose: () => void }) {
  const active = useSettings().data?.activeProfile;
  const found = useQuery({ queryKey: ["externalProfiles"], queryFn: api.listExternalProfiles });
  const importIt = useAction((path: string) => api.importExternalProfile(path), {
    success: (r) => `Imported "${r.name}" (${r.installed} mods)`,
  });

  const run = async (path: string) => {
    onClose();
    const r = await importIt.mutateAsync([path]).catch(() => null);
    if (r) await afterImport(r, active);
  };

  const chooseFolder = async () => {
    const path = await open({ title: "Choose an r2modman profile folder", directory: true, multiple: false });
    if (typeof path === "string") run(path);
  };

  const list: ExternalProfile[] = found.data ?? [];
  return (
    <Modal onClose={onClose} wide>
      <h3>Import from r2modman</h3>
      <p className="dim" style={{ marginTop: 4 }}>
        Copies a profile from r2modman or the Thunderstore Mod Manager into a new ModHeim profile: the same mods at the
        same versions, which ones are on, and all their config files. Nothing in the other manager is changed.
      </p>
      <div className="ext-list">
        {found.isLoading ? (
          <div className="row" style={{ justifyContent: "center", padding: 20 }}>
            <Loader2 className="spin" />
          </div>
        ) : found.error ? (
          <p className="faint">{errorText(found.error)}</p>
        ) : list.length === 0 ? (
          <p className="faint" style={{ padding: "8px 2px" }}>
            No r2modman or Thunderstore Mod Manager profiles for Valheim were found in their usual folders. If you moved
            r2modman's data folder, choose the profile folder yourself.
          </p>
        ) : (
          list.map((p) => (
            <div key={p.path} className="ext-row">
              <div className="mod-main">
                <div className="mod-name">
                  {p.name}
                  <span className="badge muted">{p.source}</span>
                </div>
                <div className="mod-desc">
                  {p.modCount} mods · {p.enabledCount} on
                  {p.modified ? ` · changed ${timeAgo(new Date(p.modified * 1000).toISOString())}` : ""}
                </div>
              </div>
              <button className="btn primary sm" disabled={importIt.isPending} onClick={() => run(p.path)}>
                <ArrowDownToLine /> Import
              </button>
            </div>
          ))
        )}
      </div>
      <div className="buttons">
        <button className="btn ghost" onClick={chooseFolder} style={{ marginRight: "auto" }}>
          <FolderSearch /> Choose a profile folder…
        </button>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
