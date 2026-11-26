import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ArrowUpCircle, ChevronRight, ExternalLink, Loader2, ScrollText } from "lucide-react";
import { api, errorText, type UpdateInfo } from "../api";
import { Modal } from "./Dialogs";
import { Md } from "./Markdown";

const pretty = (full: string) => (full.split("-").slice(1).join("-") || full).replace(/_/g, " ");

/** What changed in each pending update, with the choice of which to install. */
export function UpdateReview({
  items,
  onClose,
  onUpdate,
}: {
  items: UpdateInfo[];
  onClose: () => void;
  onUpdate: (fullNames: string[]) => void;
}) {
  const [picked, setPicked] = useState(() => new Set(items.map((i) => i.fullName)));
  const [open, setOpen] = useState<string | null>(items.length === 1 ? items[0].fullName : null);
  const logs = useQueries({
    queries: items.map((u) => ({
      queryKey: ["changelog", u.fullName, u.current, u.latest],
      queryFn: () => api.modChangelog(u.fullName, u.current, u.latest),
      staleTime: 30 * 60 * 1000,
      retry: 1,
    })),
  });

  const toggle = (f: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  return (
    <Modal wide onClose={onClose}>
      <h3 className="row" style={{ gap: 8 }}>
        <ScrollText /> {items.length === 1 ? `What's new in ${pretty(items[0].fullName)}` : `${items.length} updates`}
      </h3>
      <p className="dim" style={{ marginTop: 0 }}>
        A restore point is saved before updating, so you can go back from the Profiles page if an update misbehaves.
      </p>
      <div className="changelog-list">
        {items.map((u, i) => {
          const q = logs[i];
          const isOpen = open === u.fullName || items.length === 1;
          return (
            <div key={u.fullName} className="changelog-item">
              <div className="changelog-head">
                {items.length > 1 && (
                  <input
                    type="checkbox"
                    aria-label={`Update ${pretty(u.fullName)}`}
                    checked={picked.has(u.fullName)}
                    onChange={() => toggle(u.fullName)}
                  />
                )}
                <button className="changelog-title" onClick={() => setOpen(isOpen ? null : u.fullName)} disabled={items.length === 1}>
                  {items.length > 1 && <ChevronRight className={`chev${isOpen ? " open" : ""}`} />}
                  <b>{pretty(u.fullName)}</b>
                  <span className="mono faint">
                    {u.current} → {u.latest}
                  </span>
                </button>
                {q.data && !q.data.full && q.data.sections.length > 0 && (
                  <span className="faint small">
                    {q.data.sections.length} release{q.data.sections.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              {isOpen && (
                <div className="changelog-body">
                  {q.isLoading ? (
                    <div className="dim row">
                      <Loader2 className="spin" /> Loading the changelog…
                    </div>
                  ) : q.error ? (
                    <div className="dim">Couldn't load the changelog: {errorText(q.error)}</div>
                  ) : q.data?.sections.length ? (
                    q.data.sections.map((s) => (
                      <div key={s.version} className="changelog-section">
                        <div className="changelog-version">Version {s.version}</div>
                        {s.markdown ? <Md>{s.markdown}</Md> : <div className="faint small">No notes for this version.</div>}
                      </div>
                    ))
                  ) : q.data?.full ? (
                    <Md>{q.data.full}</Md>
                  ) : (
                    <div className="dim row" style={{ gap: 8 }}>
                      This mod doesn't publish a changelog.
                      <button className="btn sm ghost" onClick={() => api.openUrl(`https://thunderstore.io/c/valheim/p/${u.fullName.replace("-", "/")}/changelog/`)}>
                        <ExternalLink /> Thunderstore page
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="buttons">
        <button className="btn ghost" onClick={onClose}>
          Not now
        </button>
        <button
          className="btn primary"
          disabled={picked.size === 0}
          onClick={() => {
            onClose();
            onUpdate(items.filter((i) => picked.has(i.fullName)).map((i) => i.fullName));
          }}
        >
          <ArrowUpCircle /> Update{items.length > 1 ? ` ${picked.size}` : ""}
        </button>
      </div>
    </Modal>
  );
}
