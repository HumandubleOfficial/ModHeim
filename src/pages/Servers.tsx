import { useState } from "react";
import { Eye, EyeOff, Pencil, Plus, RefreshCw, Server as ServerIcon, Trash2 } from "lucide-react";
import { api, type Server } from "../api";
import { useAction, useGameStatus, useProfiles, useServerStatus, useSettings } from "../hooks";
import { ServerStatusLine, shortGameVersion } from "../components/ServerStatus";
import { PageHead } from "../components/Chrome";
import { confirmDialog, Modal } from "../components/Dialogs";

const EMPTY: Server = { id: "", name: "", address: "", password: "", profile: null, vanilla: false };

function ServerForm({ initial, onClose }: { initial: Server; onClose: () => void }) {
  const profiles = useProfiles().data ?? [];
  const [s, setS] = useState<Server>(initial);
  const [showPw, setShowPw] = useState(false);
  const saveServer = useAction(api.saveServer, { success: "Server saved" });
  const set = (patch: Partial<Server>) => setS((x) => ({ ...x, ...patch }));
  const addressOk = /^[^\s:]+:\d{2,5}$/.test(s.address.trim());
  const profileValue = s.vanilla ? "__vanilla" : s.profile ?? "";

  return (
    <Modal onClose={onClose} wide>
      <h3>{initial.id ? "Edit server" : "Add a server"}</h3>
      <form
        className="stack"
        style={{ gap: 14, marginTop: 14 }}
        onSubmit={async (e) => {
          e.preventDefault();
          await saveServer.mutateAsync([{ ...s, name: s.name.trim(), address: s.address.trim() }]);
          onClose();
        }}
      >
        <label className="field">
          <span>Name</span>
          <input className="input" value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="Our world" autoFocus />
        </label>
        <label className="field">
          <span>Address</span>
          <input
            className="input mono"
            value={s.address}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="play.example.com:2456"
          />
          <span className="hint">Host or IP, then a colon and the port. Valheim's default port is 2456.</span>
        </label>
        <label className="field">
          <span>Password</span>
          <div className="row">
            <input
              className="input"
              style={{ flex: 1 }}
              type={showPw ? "text" : "password"}
              value={s.password}
              onChange={(e) => set({ password: e.target.value })}
              placeholder="Leave empty if there isn't one"
              autoComplete="off"
            />
            <button type="button" className="btn icon" aria-label={showPw ? "Hide password" : "Show password"} onClick={() => setShowPw((v) => !v)}>
              {showPw ? <EyeOff /> : <Eye />}
            </button>
          </div>
          <span className="hint">Saved on this PC in ModHeim's settings file, not encrypted.</span>
        </label>
        <label className="field">
          <span>Launch with</span>
          <select
            className="select"
            value={profileValue}
            onChange={(e) => {
              const v = e.target.value;
              set(v === "__vanilla" ? { vanilla: true, profile: null } : { vanilla: false, profile: v || null });
            }}
          >
            <option value="">Whichever profile is active</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                Profile: {p.name}
              </option>
            ))}
            <option value="__vanilla">No mods (vanilla)</option>
          </select>
          <span className="hint">Modded servers usually need the same mods as the server. Ask the host for their profile code.</span>
        </label>
        <div className="buttons">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!s.name.trim() || !addressOk || saveServer.isPending}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ServersPage() {
  const settings = useSettings().data;
  const game = useGameStatus().data;
  const [editing, setEditing] = useState<Server | null>(null);
  const del = useAction(api.deleteServer, { success: "Server removed" });
  const join = useAction((id: string) => api.launch(false, id), { busy: "Starting Valheim", success: "Joining…" });
  const servers = settings?.servers ?? [];
  const canLaunch = !!game?.exeFound && !game.running;
  const status = useServerStatus();

  return (
    <div className="page">
      <PageHead
        title="Servers"
        sub="Saved servers start Valheim with the right profile and connect straight away."
        actions={
          <>
            {servers.length > 0 && (
              <button className="btn" disabled={status.isFetching} onClick={() => status.refetch()}>
                <RefreshCw className={status.isFetching ? "spin" : ""} /> Check status
              </button>
            )}
            <button className="btn primary" onClick={() => setEditing(EMPTY)}>
              <Plus /> Add server
            </button>
          </>
        }
      />
      {servers.length === 0 ? (
        <div className="empty">
          <span className="rune">ᛉ</span>
          <h3>No servers saved</h3>
          <p>Add a dedicated server or a friend's world (host:port) to join it in one click.</p>
          <button className="btn primary" onClick={() => setEditing(EMPTY)}>
            <Plus /> Add server
          </button>
        </div>
      ) : (
        <div className="stack">
          {servers.map((s) => (
            <div key={s.id} className="panel server-card">
              <div className="server-icon">
                <ServerIcon />
              </div>
              <div className="meta">
                <div className="name">{s.name}</div>
                <div className="addr mono">
                  {s.address}
                  {s.password ? " · password saved" : ""}
                </div>
                <ServerStatusLine
                  status={status.data?.find((x) => x.id === s.id)}
                  gameVersion={shortGameVersion(game?.install?.version)}
                />
              </div>
              <span className="chip">{s.vanilla ? "Vanilla" : s.profile ? `Profile: ${s.profile}` : "Active profile"}</span>
              <button className="btn sm ghost icon" aria-label="Edit" title="Edit" onClick={() => setEditing(s)}>
                <Pencil />
              </button>
              <button
                className="btn sm ghost icon danger"
                aria-label="Remove"
                title="Remove"
                onClick={async () => {
                  if (await confirmDialog({ title: `Remove "${s.name}"?`, confirm: "Remove", danger: true })) del.mutate([s.id]);
                }}
              >
                <Trash2 />
              </button>
              <button className="btn primary" disabled={!canLaunch || join.isPending} onClick={() => join.mutate([s.id])}>
                Join
              </button>
            </div>
          ))}
        </div>
      )}
      {editing && <ServerForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
