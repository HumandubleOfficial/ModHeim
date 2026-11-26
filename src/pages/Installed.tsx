import { useMemo, useState } from "react";
import { ArrowUpCircle, FileText, FolderOpen, Search, Settings2, Trash2 } from "lucide-react";
import { api, BEPINEX_PACK, type InstalledMod, type UpdateInfo } from "../api";
import { useAction, useIndexInfo, useProfile, useSettings, useUpdates } from "../hooks";
import { useUi } from "../store";
import { ModIcon, PageHead, Switch } from "../components/Chrome";
import { confirmDialog } from "../components/Dialogs";
import { UpdateReview } from "../components/UpdateReview";

const depName = (d: string) => d.split("-").slice(0, -1).join("-");

export function InstalledPage() {
  const settings = useSettings().data;
  const name = settings?.activeProfile;
  const index = useIndexInfo().data;
  const profile = useProfile(name).data;
  const updates = useUpdates(name, !!index?.loaded).data ?? [];
  const { openDetail, setPage } = useUi();
  const [filter, setFilter] = useState("");
  const [show, setShow] = useState<"all" | "on" | "off" | "updates">("all");
  const [review, setReview] = useState<UpdateInfo[] | null>(null);

  const updateMap = useMemo(() => new Map(updates.map((u) => [u.fullName, u.latest])), [updates]);
  /** fullName -> names of installed mods that depend on it */
  const dependents = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of profile?.mods ?? []) {
      for (const d of m.dependencies) {
        const n = depName(d);
        map.set(n, [...(map.get(n) ?? []), m.name.replace(/_/g, " ")]);
      }
    }
    return map;
  }, [profile]);

  const toggle = useAction((m: InstalledMod, on: boolean) => api.setModEnabled(name!, m.fullName, on));
  const remove = useAction((m: InstalledMod) => api.uninstallMod(name!, m.fullName), {
    success: () => "Mod removed",
  });
  const update = useAction((names: string[]) => api.updateMods(name!, names), {
    success: () => "Updated",
  });

  const mods = (profile?.mods ?? []).filter((m) => {
    if (filter && !`${m.name} ${m.owner}`.toLowerCase().includes(filter.toLowerCase())) return false;
    if (show === "on") return m.enabled;
    if (show === "off") return !m.enabled;
    if (show === "updates") return updateMap.has(m.fullName);
    return true;
  });

  const onRemove = async (m: InstalledMod) => {
    const needed = dependents.get(m.fullName);
    const ok = await confirmDialog({
      title: `Uninstall ${m.name.replace(/_/g, " ")}?`,
      body: needed?.length ? (
        <>
          <b>{needed.join(", ")}</b> {needed.length > 1 ? "need" : "needs"} this mod and may stop working. Its config
          files are kept.
        </>
      ) : (
        "Its config files are kept, in case you reinstall it."
      ),
      confirm: "Uninstall",
      danger: true,
    });
    if (ok) remove.mutate([m]);
  };

  const onToggle = async (m: InstalledMod, on: boolean) => {
    if (!on) {
      const needed = (dependents.get(m.fullName) ?? []).filter((n) =>
        profile?.mods.some((x) => x.enabled && x.name.replace(/_/g, " ") === n),
      );
      if (needed.length) {
        const ok = await confirmDialog({
          title: "Other mods need this one",
          body: (
            <>
              <b>{needed.join(", ")}</b> {needed.length > 1 ? "depend" : "depends"} on it. Turn it off anyway?
            </>
          ),
          confirm: "Turn off",
        });
        if (!ok) return;
      }
    }
    toggle.mutate([m, on]);
  };

  return (
    <div className="page fill">
      {review && <UpdateReview items={review} onClose={() => setReview(null)} onUpdate={(names) => update.mutate([names])} />}
      <PageHead
        title="Installed"
        sub={
          profile
            ? `${profile.mods.length} mods in ${profile.name} · ${profile.mods.filter((m) => m.enabled).length} on`
            : "…"
        }
        actions={
          <>
            <button className="btn" onClick={() => setPage("modsettings")}>
              <Settings2 /> Mod settings
            </button>
            <button className="btn" onClick={() => api.openFolder("profile", name)}>
              <FolderOpen /> Folder
            </button>
            <button
              className="btn"
              onClick={() => api.openFolder("log", name).catch((e) => useUi.getState().toast("info", String(e)))}
            >
              <FileText /> Log
            </button>
            {updates.length > 0 && (
              <button
                className="btn primary"
                disabled={update.isPending}
                onClick={() => setReview(updates)}
              >
                <ArrowUpCircle /> Update all ({updates.length})
              </button>
            )}
          </>
        }
      />
      <div className="toolbar">
        <div className="search-box">
          <Search />
          <input className="input" placeholder="Filter installed mods" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="seg" role="tablist">
          {(
            [
              ["all", "All"],
              ["on", "On"],
              ["off", "Off"],
              ["updates", `Updates${updates.length ? ` (${updates.length})` : ""}`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="list-scroll">
        {profile && profile.mods.length <= 1 && (
          <div className="empty">
            <span className="rune">ᚱ</span>
            <h3>No mods yet</h3>
            <p>BepInEx is ready. Add some mods from Thunderstore.</p>
            <button className="btn primary" onClick={() => setPage("browse")}>
              Browse mods
            </button>
          </div>
        )}
        {mods.map((m) => {
          const latest = updateMap.get(m.fullName);
          const isPack = m.fullName === BEPINEX_PACK;
          return (
            <div
              key={m.fullName}
              className={`mod-row plaque${m.enabled ? "" : " disabled"}`}
              onClick={() => (m.fullName.startsWith("ModHeim-") ? setPage("themes") : openDetail(m.fullName))}
            >
              <Switch
                on={m.enabled}
                label={`Turn ${m.name} ${m.enabled ? "off" : "on"}`}
                disabled={isPack || toggle.isPending}
                onChange={(v) => onToggle(m, v)}
              />
              <div className="icon-frame">
                <ModIcon src={m.icon} name={m.name} />
              </div>
              <div className="mod-main">
                <div className="mod-name">
                  {m.name.replace(/_/g, " ")}
                  <span className="owner">by {m.owner}</span>
                  {isPack && <span className="badge">Mod loader</span>}
                </div>
                <div className="mod-desc">{m.description}</div>
              </div>
              <div className="mod-stats">
                <span className="mono">v{m.version}</span>
                {latest && (
                  <button
                    className="badge warn as-button"
                    title="See what changed"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReview(updates.filter((u) => u.fullName === m.fullName));
                    }}
                  >
                    v{latest} · what's new
                  </button>
                )}
              </div>
              <div className="mod-actions">
                {latest && (
                  <button
                    className="btn sm"
                    disabled={update.isPending}
                    onClick={(e) => {
                      e.stopPropagation();
                      setReview(updates.filter((u) => u.fullName === m.fullName));
                    }}
                  >
                    <ArrowUpCircle /> Update
                  </button>
                )}
                {!isPack && (
                  <button
                    className="btn sm icon ghost danger"
                    aria-label={`Uninstall ${m.name}`}
                    title="Uninstall"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(m);
                    }}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
