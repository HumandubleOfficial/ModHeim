import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api, formatBytes, timeAgo } from "../api";
import { useAction, useGameStatus } from "../hooks";
import { confirmDialog, Modal } from "./Dialogs";

/** A profile's restore points: taken automatically before updates and uninstalls. */
export function RestorePoints({ profile, onClose }: { profile: string; onClose: () => void }) {
  const qc = useQueryClient();
  const running = useGameStatus().data?.running ?? false;
  const list = useQuery({ queryKey: ["snapshots", profile], queryFn: () => api.listSnapshots(profile) });
  const reload = () => qc.invalidateQueries({ queryKey: ["snapshots", profile] });
  const create = useAction(() => api.createSnapshot(profile), { success: "Restore point saved" });
  const restore = useAction((id: string) => api.restoreSnapshot(profile, id), {
    busy: "Restoring the profile",
    success: (s) => `${profile} is back to how it was ${timeAgo(s.created)}`,
  });
  const remove = useAction((id: string) => api.deleteSnapshot(profile, id));

  const onRestore = async (id: string, created: string) => {
    const ok = await confirmDialog({
      title: "Go back to this restore point?",
      body: `${profile}'s mods and mod settings go back to how they were ${timeAgo(created)}. A restore point of how it is now is saved first, so you can undo this. Worlds and characters aren't affected.`,
      confirm: "Restore",
    });
    if (ok) restore.mutate([id], { onSettled: reload });
  };

  return (
    <Modal wide onClose={onClose}>
      <h3 className="row" style={{ gap: 8 }}>
        <History /> Restore points · {profile}
      </h3>
      <p className="dim" style={{ marginTop: 0 }}>
        Saved automatically before updates, uninstalls and reinstalls, so a bad update is easy to undo. The last 10 are
        kept.
      </p>
      <div className="snap-list">
        {list.isLoading && <div className="dim">Loading…</div>}
        {list.data?.length === 0 && <div className="dim">No restore points yet. One is made before your next update.</div>}
        {list.data?.map((s) => (
          <div key={s.id} className="list-row">
            <div className="grow">
              <b>{s.reason}</b>
              <div className="faint small">
                {new Date(s.created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · {timeAgo(s.created)} ·{" "}
                {s.modCount} mods · {formatBytes(s.bytes)}
              </div>
            </div>
            <button className="btn sm" disabled={running || restore.isPending} title={running ? "Close Valheim first" : undefined} onClick={() => onRestore(s.id, s.created)}>
              <RotateCcw /> Restore
            </button>
            <button className="btn sm ghost icon" aria-label="Delete restore point" title="Delete" onClick={() => remove.mutate([s.id], { onSettled: reload })}>
              <Trash2 />
            </button>
          </div>
        ))}
      </div>
      <div className="buttons">
        <button className="btn" disabled={create.isPending} onClick={() => create.mutate([], { onSettled: reload })}>
          {create.isPending ? <Loader2 className="spin" /> : <Plus />} Save one now
        </button>
        <span className="spacer" />
        <button className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
