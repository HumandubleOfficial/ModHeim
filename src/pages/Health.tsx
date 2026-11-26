import { useQuery } from "@tanstack/react-query";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Power,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { api, errorText, timeAgo, type LogIssue, type ModIssue } from "../api";
import { useAction, useGameStatus, useIndexInfo, useSettings } from "../hooks";
import { useUi } from "../store";
import { RuneLoader } from "../components/RuneLoader";
import { PageHead } from "../components/Chrome";
import { ConflictsSection } from "../components/Conflicts";

const pretty = (s: string) => s.replace(/_/g, " ");

const KIND_LABEL: Record<ModIssue["kind"], string> = {
  missingDep: "Missing requirement",
  disabledDep: "Requirement turned off",
  update: "Update available",
  deprecated: "Deprecated",
  outdated: "Possibly outdated",
};

const FIX_LABEL = { install: "Install", enable: "Turn on", update: "Update" } as const;
const FIX_ICON = { install: Download, enable: Power, update: ArrowUpCircle } as const;

export function HealthPage() {
  const profile = useSettings().data?.activeProfile;
  const index = useIndexInfo().data;
  const running = !!useGameStatus().data?.running;
  const toast = useUi((s) => s.toast);
  const report = useQuery({
    queryKey: ["health", profile, index?.fetchedAt],
    queryFn: () => api.profileHealth(profile!),
    enabled: !!profile,
  });

  const runFix = async (i: ModIssue) => {
    const target = i.fixTarget!;
    if (i.fix === "install") return api.installMod(profile!, target);
    if (i.fix === "enable") return api.setModEnabled(profile!, target, true);
    return api.updateMods(profile!, [target]);
  };
  const fix = useAction(runFix, { success: () => "Fixed" });
  const fixAll = useAction(
    async (issues: ModIssue[]) => {
      // De-duplicate: several mods can need the same missing requirement.
      const seen = new Set<string>();
      for (const i of issues) {
        const k = `${i.fix}:${i.fixTarget}`;
        if (seen.has(k)) continue;
        seen.add(k);
        await runFix(i);
      }
      return seen.size;
    },
    { busy: "Fixing mods", success: (n) => `Applied ${n} fix${n === 1 ? "" : "es"}` },
  );
  const turnOff = useAction((fullName: string) => api.setModEnabled(profile!, fullName, false), {
    success: () => "Mod turned off. Launch again to see if the errors are gone.",
  });

  const r = report.data;
  const fixable = r?.modIssues.filter((i) => i.fix && i.fixTarget) ?? [];
  const busy = fix.isPending || fixAll.isPending || turnOff.isPending || running;

  return (
    <div className="page">
      <PageHead
        title="Health Check"
        sub={`Problems in ${profile ?? "…"}: missing requirements, old mods, and errors from the last launch`}
        actions={
          <>
            <button
              className="btn"
              onClick={() => api.openFolder("log", profile).catch((e) => toast("info", errorText(e)))}
            >
              <FileText /> Open log
            </button>
            <button className="btn" disabled={report.isFetching} onClick={() => report.refetch()}>
              <RefreshCw className={report.isFetching ? "spin" : ""} /> Check again
            </button>
          </>
        }
      />
      {report.isLoading ? (
        <div className="empty">
          <RuneLoader label="Checking your mods…" />
        </div>
      ) : report.error ? (
        <div className="empty">
          <h3>Couldn't check this profile</h3>
          <p>{errorText(report.error)}</p>
        </div>
      ) : r ? (
        <div className="stack" style={{ gap: 18 }}>
          <div className="grid health-stats">
            <div className="panel stat">
              <div className="label">Last modded launch</div>
              <div className="value">
                {r.logTime ? timeAgo(new Date(r.logTime * 1000).toISOString()) : "Never"}
              </div>
            </div>
            <div className="panel stat">
              <div className="label">Errors in log</div>
              <div className={`value${r.logErrors ? " bad-text" : ""}`}>{r.logErrors}</div>
            </div>
            <div className="panel stat">
              <div className="label">Warnings in log</div>
              <div className={`value${r.logWarnings ? " warn-text" : ""}`}>{r.logWarnings}</div>
            </div>
            <div className="panel stat">
              <div className="label">Mod problems</div>
              <div className={`value${r.modIssues.length ? " warn-text" : ""}`}>{r.modIssues.length}</div>
            </div>
          </div>

          {running && (
            <div className="notice warn">
              <AlertTriangle /> Valheim is running. Close it before fixing mods, since the files are in use.
            </div>
          )}

          <div>
            <h2 className="section row" style={{ marginTop: 0 }}>
              Mods
              <span className="spacer" />
              {fixable.length > 1 && (
                <button className="btn sm primary" disabled={busy} onClick={() => fixAll.mutate([fixable])}>
                  <Wrench /> Fix all ({fixable.length})
                </button>
              )}
            </h2>
            {r.modIssues.length === 0 ? (
              <div className="panel pad row">
                <CheckCircle2 style={{ color: "var(--ok)" }} />
                <span>Every mod has what it needs and is up to date.</span>
              </div>
            ) : (
              <div className="panel health-list">
                {r.modIssues.map((i, n) => {
                  const Icon = i.fix ? FIX_ICON[i.fix] : null;
                  return (
                    <div key={`${i.fullName}-${i.kind}-${n}`} className="health-row">
                      <span className={`badge ${i.kind === "missingDep" || i.kind === "disabledDep" ? "bad" : i.kind === "update" ? "" : "warn"}`}>
                        {KIND_LABEL[i.kind]}
                      </span>
                      <div className="mod-main">
                        <div className="mod-name">{pretty(i.name)}</div>
                        <div className="mod-desc" style={{ WebkitLineClamp: 3 }}>{i.detail}</div>
                      </div>
                      {i.fix && i.fixTarget && Icon ? (
                        <button className="btn sm" disabled={busy} onClick={() => fix.mutate([i])}>
                          <Icon /> {FIX_LABEL[i.fix]}
                        </button>
                      ) : (
                        <button className="btn sm ghost" onClick={() => useUi.getState().openDetail(i.fullName)}>
                          Details
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {profile && <ConflictsSection profile={profile} />}

          <div>
            <h2 className="section" style={{ marginTop: 0 }}>
              Last launch log{" "}
              <span className="muted">
                {r.logFound ? "BepInEx's LogOutput.log, grouped by problem" : ""}
              </span>
            </h2>
            {!r.logFound ? (
              <div className="panel pad row">
                <Clock style={{ color: "var(--text-faint)" }} />
                <span className="dim">No log yet. Play modded once and ModHeim can read what went wrong.</span>
              </div>
            ) : r.logIssues.length === 0 ? (
              <div className="panel pad row">
                <CheckCircle2 style={{ color: "var(--ok)" }} />
                <span>No mod errors or warnings in the last launch.</span>
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {r.logIssues.map((i, n) => (
                  <LogRow key={n} issue={i} busy={busy} onTurnOff={(f) => turnOff.mutate([f])} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LogRow({ issue: i, busy, onTurnOff }: { issue: LogIssue; busy: boolean; onTurnOff: (fullName: string) => void }) {
  const Icon = i.level === "error" ? AlertOctagon : AlertTriangle;
  return (
    <details className={`panel log-issue ${i.level}`}>
      <summary>
        <Icon className="lvl" />
        <div className="mod-main">
          <div className="log-msg selectable">{i.message}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            {i.source}
            {i.count > 1 ? ` · ${i.count} times` : ""}
            {i.modName ? ` · likely from ${pretty(i.modName)}` : ""}
          </div>
        </div>
        {i.modFullName && (
          <button
            className="btn sm ghost"
            disabled={busy}
            title="Turn this mod off to see if it's the cause"
            onClick={(e) => {
              e.preventDefault();
              onTurnOff(i.modFullName!);
            }}
          >
            <Power /> Turn off
          </button>
        )}
      </summary>
      {i.detail && <pre className="log-detail selectable">{i.detail}</pre>}
    </details>
  );
}
