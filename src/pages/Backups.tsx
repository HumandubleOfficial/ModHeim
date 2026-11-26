import { useQuery } from "@tanstack/react-query";
import { Archive, FolderOpen, Info, Loader2, Trash2 } from "lucide-react";
import { api, formatBytes, timeAgo } from "../api";
import { useAction, useGameStatus, useSettings } from "../hooks";
import { PageHead, Switch } from "../components/Chrome";
import { confirmDialog } from "../components/Dialogs";

const SOURCE_NAMES: Record<string, string> = {
  worlds_local: "Worlds",
  characters_local: "Characters",
  worlds: "Worlds (cloud copy)",
  characters: "Characters (cloud copy)",
  xbox_saves: "Xbox app saves (characters and cloud sync)",
};

export function BackupsPage() {
  const settings = useSettings().data;
  const running = useGameStatus().data?.running ?? false;
  const info = useQuery({ queryKey: ["backups"], queryFn: api.listBackups });
  const refresh = () => info.refetch();
  const backup = useAction(api.createBackup, { success: (b) => (b ? "Backed up your worlds and characters" : null) });
  const remove = useAction(api.deleteBackup, { success: "Backup deleted" });
  const prefs = useAction(api.savePrefs);

  const onDelete = async (file: string) => {
    if (await confirmDialog({ title: "Delete this backup?", body: file, confirm: "Delete", danger: true })) {
      remove.mutate([file], { onSettled: refresh });
    }
  };

  const total = info.data?.backups.reduce((n, b) => n + b.bytes, 0) ?? 0;

  return (
    <div className="page">
      <PageHead
        title="Backups"
        sub="Copies of your worlds and characters, kept in ModHeim's own folder"
        actions={
          <>
            <button className="btn ghost" onClick={() => api.openFolder("backups")}>
              <FolderOpen /> Open folder
            </button>
            <button
              className="btn primary"
              disabled={running || backup.isPending}
              title={running ? "Close Valheim first" : undefined}
              onClick={() => backup.mutate([], { onSettled: refresh })}
            >
              {backup.isPending ? <Loader2 className="spin" /> : <Archive />} Back up now
            </button>
          </>
        }
      />

      <div className="notice info">
        <Info />
        <span>
          ModHeim only <b>reads</b> your save files and never changes them. To restore a backup, close Valheim, open
          the zip and copy its folders back yourself (worlds go in{" "}
          <span className="mono">AppData\LocalLow\IronGate\Valheim</span>).
        </span>
      </div>

      <h2 className="section">Your backups {total > 0 && <span className="muted">{formatBytes(total)}</span>}</h2>
      {info.isLoading ? (
        <div className="panel pad dim">Loading…</div>
      ) : (info.data?.backups.length ?? 0) === 0 ? (
        <div className="panel pad dim">No backups yet. One is made before your next modded launch, or press Back up now.</div>
      ) : (
        <div className="panel list">
          {info.data!.backups.map((b) => (
            <div key={b.file} className="list-row">
              <Archive className="faint" />
              <div className="grow">
                <div>
                  <b>{new Date(b.created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</b>
                  <span className="faint"> · {timeAgo(b.created)}</span>
                </div>
                <div className="dim small">
                  {b.reason}
                  {b.worlds.length > 0 && ` · ${b.worlds.join(", ")}`}
                </div>
              </div>
              <span className="faint small">
                {b.files} files · {formatBytes(b.bytes)}
              </span>
              <button className="btn sm ghost icon" aria-label="Delete backup" title="Delete" onClick={() => onDelete(b.file)}>
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      )}

      <h2 className="section">What gets backed up</h2>
      <div className="panel list">
        {(info.data?.sources ?? []).map((s) => (
          <div key={s.label} className="list-row">
            <div className="grow">
              <b>{SOURCE_NAMES[s.label] ?? s.label}</b>
              <div className="mono faint small selectable" style={{ wordBreak: "break-all" }}>
                {s.path}
              </div>
            </div>
            <span className="faint small">
              {s.files} files · {formatBytes(s.bytes)}
            </span>
          </div>
        ))}
        {info.data && info.data.sources.length === 0 && <div className="list-row dim">Couldn't find Valheim's save folders.</div>}
      </div>

      {settings && (
        <>
          <h2 className="section">Options</h2>
          <div className="panel pad">
            <div className="setting-row">
              <div className="text">
                <div className="title">Back up before modded play</div>
                <div className="desc">Only when something changed since the last backup, so it's usually instant.</div>
              </div>
              <Switch
                label="Back up before modded play"
                on={settings.backupBeforeLaunch}
                onChange={(v) => prefs.mutate([{ backupBeforeLaunch: v }])}
              />
            </div>
            <div className="setting-row">
              <div className="text">
                <div className="title">Backups to keep</div>
                <div className="desc">Older ones are deleted from ModHeim's folder.</div>
              </div>
              <div className="seg">
                {[5, 10, 20, 50].map((n) => (
                  <button key={n} className={settings.backupKeep === n ? "on" : ""} onClick={() => prefs.mutate([{ backupKeep: n }])}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div className="faint small" style={{ marginTop: 6 }}>
              Stored in <span className="mono selectable">{info.data?.folder}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
