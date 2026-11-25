import { open, save } from "@tauri-apps/plugin-dialog";
import { ArrowDownToLine, Boxes, Check, Copy, FileDown, FileUp, FolderOpen, KeyRound, Pencil, Plus, Share2, Trash2, Wrench } from "lucide-react";
import { api, timeAgo, type ImportResult, type ProfileSummary } from "../api";
import { useState } from "react";
import { ImportFromManager } from "../components/ImportFromManager";
import { useAction, useProfiles, useSettings } from "../hooks";
import { useUi } from "../store";
import { PageHead } from "../components/Chrome";
import { alertDialog, confirmDialog, promptDialog } from "../components/Dialogs";

function importMessage(r: ImportResult) {
  return r.warnings.length
    ? `Imported "${r.name}" with ${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""}`
    : `Imported "${r.name}" (${r.installed} mods)`;
}

async function showWarnings(r: ImportResult) {
  if (r.warnings.length) {
    await alertDialog({
      title: `Imported "${r.name}"`,
      body: (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {r.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ),
    });
  }
}

export function ProfilesPage() {
  const settings = useSettings().data;
  const profiles = useProfiles().data ?? [];
  const { toast, browseIn } = useUi();
  const [fromManager, setFromManager] = useState(false);

  const create = useAction(api.createProfile, { success: (p) => `Created "${p.name}"` });
  const activate = useAction(api.setActiveProfile, { success: (s) => `"${s.activeProfile}" is now active` });
  const rename = useAction(api.renameProfile, { success: "Renamed" });
  const clone = useAction(api.cloneProfile, { success: "Copied" });
  const remove = useAction(api.deleteProfile, { success: "Profile moved to the Recycle Bin" });
  const repair = useAction(api.repairProfile, { success: "BepInEx reinstalled" });
  const exportP = useAction(api.exportProfile, { success: "Profile exported" });
  const importFile = useAction(api.importProfileFile, { success: importMessage });
  const importCode = useAction(api.importProfileCode, { success: importMessage });
  const share = useAction(api.shareProfile, { busy: "Uploading profile" });

  const onNew = async () => {
    const name = await promptDialog({
      title: "New profile",
      body: "A fresh, separate set of mods. BepInEx is installed automatically.",
      label: "Name",
      placeholder: "e.g. Building, Hardcore, Friends server",
      confirm: "Create",
    });
    if (name) create.mutate([name]);
  };

  const onImportFile = async () => {
    const path = await open({
      title: "Import a profile",
      filters: [{ name: "Mod profile", extensions: ["r2z", "zip"] }],
      multiple: false,
    });
    if (typeof path === "string") {
      const r = await importFile.mutateAsync([path]).catch(() => null);
      if (r) await showWarnings(r);
    }
  };

  const onImportCode = async () => {
    const code = await promptDialog({
      title: "Import from a code",
      body: "Paste a profile code from a friend. Codes from r2modman and Thunderstore Mod Manager work too.",
      label: "Profile code",
      placeholder: "0192f3a1-…",
      confirm: "Import",
    });
    if (code) {
      const r = await importCode.mutateAsync([code]).catch(() => null);
      if (r) await showWarnings(r);
    }
  };

  const onShare = async (p: ProfileSummary) => {
    const ok = await confirmDialog({
      title: `Share "${p.name}"?`,
      body: "This uploads the mod list and your config files to Thunderstore and gives you a code. Anyone with the code can download it.",
      confirm: "Upload and get code",
    });
    if (!ok) return;
    const code = await share.mutateAsync([p.name]).catch(() => null);
    if (!code) return;
    await navigator.clipboard.writeText(code).catch(() => {});
    await alertDialog({
      title: "Profile code",
      body: (
        <>
          <div className="input mono selectable" style={{ display: "flex", alignItems: "center", fontSize: 15 }}>
            {code}
          </div>
          <p style={{ marginTop: 10 }}>Copied to your clipboard. Friends can paste it into Import from a code.</p>
        </>
      ),
      confirm: "Done",
    });
  };

  const onExport = async (p: ProfileSummary) => {
    const dest = await save({
      title: "Export profile",
      defaultPath: `${p.name}.r2z`,
      filters: [{ name: "Mod profile", extensions: ["r2z"] }],
    });
    if (dest) exportP.mutate([p.name, dest]);
  };

  const onRename = async (p: ProfileSummary) => {
    const n = await promptDialog({ title: "Rename profile", label: "Name", initial: p.name, confirm: "Rename" });
    if (n && n !== p.name) rename.mutate([p.name, n]);
  };

  const onClone = async (p: ProfileSummary) => {
    const n = await promptDialog({
      title: `Copy "${p.name}"`,
      body: "Makes an independent copy with the same mods and configs.",
      label: "Name for the copy",
      initial: `${p.name} copy`,
      confirm: "Copy",
    });
    if (n) clone.mutate([p.name, n]);
  };

  const onDelete = async (p: ProfileSummary) => {
    const ok = await confirmDialog({
      title: `Delete "${p.name}"?`,
      body: `Its ${p.modCount} mods and config files go to the Recycle Bin, so you can still restore them from there.`,
      confirm: "Delete",
      danger: true,
    });
    if (ok) remove.mutate([p.name]);
  };

  return (
    <div className="page">
      <PageHead
        title="Profiles"
        sub="Each profile is its own set of mods and settings. Switching profiles never touches the others."
        actions={
          <>
            <button className="btn" onClick={() => browseIn("Modpacks")} title="Browse Thunderstore modpacks and install one as a new profile">
              <Boxes /> From a modpack
            </button>
            <button className="btn" onClick={() => setFromManager(true)} title="Copy a profile from r2modman or the Thunderstore Mod Manager">
              <ArrowDownToLine /> From r2modman
            </button>
            <button className="btn" onClick={onImportCode}>
              <KeyRound /> Import from a code
            </button>
            <button className="btn" onClick={onImportFile}>
              <FileUp /> Import file
            </button>
            <button className="btn primary" onClick={onNew}>
              <Plus /> New profile
            </button>
          </>
        }
      />
      {fromManager && <ImportFromManager onClose={() => setFromManager(false)} />}
      <div className="grid cols-3">
        {profiles.map((p) => {
          const active = p.name === settings?.activeProfile;
          return (
            <div key={p.name} className={`panel profile-card${active ? " active" : ""}`}>
              <div className="row between" style={{ alignItems: "flex-start" }}>
                <h3>{p.name}</h3>
                {active ? <span className="badge ok">Active</span> : null}
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className="chip">{p.modCount} mods</span>
                <span className="chip">{p.enabledCount} on</span>
                {!p.hasBepinex && <span className="chip warn">No BepInEx</span>}
              </div>
              {p.created && <div className="faint" style={{ fontSize: 12 }}>Created {timeAgo(p.created)}</div>}
              <div className="row">
                {active ? (
                  <button className="btn sm" disabled>
                    <Check /> In use
                  </button>
                ) : (
                  <button className="btn sm primary" onClick={() => activate.mutate([p.name])}>
                    Use this profile
                  </button>
                )}
                {!p.hasBepinex && (
                  <button className="btn sm" onClick={() => repair.mutate([p.name])}>
                    <Wrench /> Repair
                  </button>
                )}
              </div>
              <div className="actions">
                <button className="btn sm ghost icon" title="Rename" aria-label="Rename" onClick={() => onRename(p)}>
                  <Pencil />
                </button>
                <button className="btn sm ghost icon" title="Copy" aria-label="Copy" onClick={() => onClone(p)}>
                  <Copy />
                </button>
                <button className="btn sm ghost icon" title="Export to file" aria-label="Export" onClick={() => onExport(p)}>
                  <FileDown />
                </button>
                <button className="btn sm ghost icon" title="Share as code" aria-label="Share" onClick={() => onShare(p)}>
                  <Share2 />
                </button>
                <button
                  className="btn sm ghost icon"
                  title="Open folder"
                  aria-label="Open folder"
                  onClick={() => api.openFolder("profile", p.name).catch((e) => toast("error", String(e)))}
                >
                  <FolderOpen />
                </button>
                <span className="spacer" />
                <button
                  className="btn sm ghost icon danger"
                  title="Delete"
                  aria-label="Delete"
                  onClick={() => onDelete(p)}
                >
                  <Trash2 />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
