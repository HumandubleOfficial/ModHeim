import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ChevronRight, GitMerge, Keyboard, Loader2 } from "lucide-react";
import { api, type PatchConflict } from "../api";
import { useUi } from "../store";

const KIND: Record<string, string> = { prefix: "runs before", postfix: "runs after", transpiler: "rewrites", finalizer: "catches errors in" };

/** Patch conflicts grouped by the set of mods involved, worst first. */
function groupByMods(list: PatchConflict[]) {
  const groups = new Map<string, { mods: string[]; likely: boolean; items: PatchConflict[] }>();
  for (const c of list) {
    const mods = c.mods.map((m) => m.name).sort();
    const key = mods.join(" + ");
    const g = groups.get(key) ?? { mods, likely: false, items: [] };
    g.items.push(c);
    g.likely ||= c.level === "likely";
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => Number(b.likely) - Number(a.likely) || b.items.length - a.items.length);
}

export function ConflictsSection({ profile }: { profile: string }) {
  const q = useQuery({ queryKey: ["conflicts", profile], queryFn: () => api.profileConflicts(profile), staleTime: 60_000 });
  const openConfig = useUi((s) => s.openConfig);
  const [open, setOpen] = useState<string | null>(null);
  const groups = useMemo(() => groupByMods(q.data?.patches ?? []), [q.data]);

  return (
    <>
      <div>
        <h2 className="section" style={{ marginTop: 0 }}>
          Mods changing the same game code{" "}
          <span className="muted">
            {q.data ? `${q.data.modsScanned} mods patch ${q.data.methodsPatched} game methods` : "reading the mods' DLLs…"}
          </span>
        </h2>
        {q.isLoading ? (
          <div className="panel pad row dim">
            <Loader2 className="spin" /> Checking which game code each mod changes…
          </div>
        ) : groups.length === 0 ? (
          <div className="panel pad row">
            <CheckCircle2 style={{ color: "var(--ok)" }} />
            <span>No mods fight over the same game code.</span>
          </div>
        ) : (
          <div className="panel health-list">
            {groups.map((g) => {
              const key = g.mods.join(" + ");
              const isOpen = open === key;
              return (
                <div key={key} className="conflict-group">
                  <button className="conflict-head" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen}>
                    <ChevronRight className={`chev${isOpen ? " open" : ""}`} />
                    <span className={`badge ${g.likely ? "warn" : "muted"}`}>{g.likely ? "Can cancel out" : "Worth knowing"}</span>
                    <span className="mod-name grow">{g.mods.join(" · ")}</span>
                    <span className="faint small">
                      {g.items.length} game method{g.items.length > 1 ? "s" : ""}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="conflict-body">
                      {g.items.map((c) => (
                        <div key={c.target} className="conflict-item">
                          <div>
                            <GitMerge className="faint" /> <span className="mono">{c.target}</span>
                          </div>
                          <div className="dim small">{c.reason}.</div>
                          <div className="faint small">
                            {c.mods
                              .map((m) => `${m.name} ${m.kinds.map((k) => (k === "prefix" && m.canSkip ? "can replace" : KIND[k])).join(" / ")} it`)
                              .join("; ")}
                          </div>
                        </div>
                      ))}
                      <div className="faint small" style={{ paddingTop: 6 }}>
                        If something these mods do stops working, try turning one of them off. Mods made to work together
                        often handle this themselves, so this isn't always a problem.
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="section" style={{ marginTop: 0 }}>
          Hotkeys used twice <span className="muted">from the mods' settings</span>
        </h2>
        {q.isLoading ? null : (q.data?.hotkeys.length ?? 0) === 0 ? (
          <div className="panel pad row">
            <CheckCircle2 style={{ color: "var(--ok)" }} />
            <span>Every mod hotkey is unique.</span>
          </div>
        ) : (
          <div className="panel health-list">
            {q.data!.hotkeys.map((h) => (
              <div key={h.shortcut + h.uses.length} className="hotkey-row">
                <kbd className="key">{h.shortcut}</kbd>
                <div className="grow stack" style={{ gap: 4 }}>
                  {h.game && <div className="small warn-text">Valheim uses this key for {h.game}</div>}
                  {h.uses.map((u) => (
                    <div key={u.file + u.section + u.key} className="row small" style={{ gap: 8 }}>
                      <Keyboard className="faint" style={{ width: 14, height: 14 }} />
                      <b>{u.owner}</b>
                      <span className="dim grow">{u.key}</span>
                      <button className="btn sm ghost" onClick={() => openConfig(u.file)}>
                        Change
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
