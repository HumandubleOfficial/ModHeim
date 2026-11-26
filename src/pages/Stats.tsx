import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Globe2, HardDrive, Skull } from "lucide-react";
import { api, formatBytes, timeAgo } from "../api";
import { PageHead } from "../components/Chrome";
import { useUi } from "../store";

function hours(seconds: number) {
  if (seconds < 60) return "0 min";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = seconds / 3600;
  return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
}

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d;
};

/** Time played per day for the last two weeks: one series, so no legend; hover for the value. */
function DaysChart({ days }: { days: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(3600, ...days);
  return (
    <div className="days-chart" role="img" aria-label="Time played per day, last 14 days">
      <div className="bars">
        {days.map((s, i) => {
          const date = day(13 - i);
          return (
            <div
              key={i}
              className="bar-slot"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              aria-label={`${date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${hours(s)}`}
            >
              {hover === i && (
                <div className="tip">
                  <b>{hours(s)}</b>
                  <span>{date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
                </div>
              )}
              <div className={`bar${s ? "" : " zero"}`} style={{ height: s ? `${Math.max(4, (s / max) * 100)}%` : 2 }} />
            </div>
          );
        })}
      </div>
      <div className="axis">
        <span>{day(13).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

export function StatsPage() {
  const q = useQuery({ queryKey: ["stats"], queryFn: api.playStats });
  const toast = useUi((s) => s.toast);
  const s = q.data;

  return (
    <div className="page">
      <PageHead title="Worlds & Play" sub="Your worlds on this PC and the time you've played through ModHeim" />
      {!s ? null : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="grid health-stats">
            <div className="panel stat">
              <div className="label">Played this week</div>
              <div className="value">{hours(s.weekSeconds)}</div>
            </div>
            <div className="panel stat">
              <div className="label">Played in total</div>
              <div className="value">{hours(s.totalSeconds)}</div>
            </div>
            <div className="panel stat">
              <div className="label">Sessions</div>
              <div className="value">{s.sessions}</div>
            </div>
            <div className="panel stat">
              <div className="label">Crashes</div>
              <div className={`value${s.crashes ? " bad-text" : ""}`}>{s.crashes}</div>
            </div>
          </div>

          <div>
            <h2 className="section" style={{ marginTop: 0 }}>
              Time played <span className="muted">last 14 days</span>
            </h2>
            <div className="panel pad">
              {s.sessions === 0 ? (
                <div className="dim">Nothing yet. Sessions are recorded while ModHeim is open and Valheim is running.</div>
              ) : (
                <DaysChart days={s.days} />
              )}
            </div>
          </div>

          <div>
            <h2 className="section" style={{ marginTop: 0 }}>
              Worlds <span className="muted">read from your save folder, never changed</span>
            </h2>
            {s.worlds.length === 0 ? (
              <div className="panel pad dim">No worlds found on this PC.</div>
            ) : (
              <div className="grid cols-3">
                {s.worlds.map((w) => (
                  <div key={w.name} className="panel world-card">
                    <div className="row" style={{ gap: 8 }}>
                      <Globe2 className="world-icon" />
                      <b className="grow">{w.name}</b>
                      {w.cloud && <span className="badge muted">Cloud</span>}
                    </div>
                    {w.seed && (
                      <div className="row small" style={{ gap: 6 }}>
                        <span className="faint">Seed</span>
                        <span className="mono selectable">{w.seed}</span>
                        <button
                          className="btn sm ghost icon"
                          aria-label="Copy seed"
                          title="Copy seed"
                          onClick={() => navigator.clipboard.writeText(w.seed!).then(() => toast("success", "Seed copied"))}
                        >
                          <Copy />
                        </button>
                      </div>
                    )}
                    <div className="faint small row" style={{ gap: 6 }}>
                      <HardDrive style={{ width: 13, height: 13 }} />
                      {formatBytes(w.bytes)} · saved {timeAgo(new Date(w.modified * 1000).toISOString())}
                    </div>
                    {w.cloud && <div className="faint small">Only the map cache is on this PC; the world is in your cloud saves.</div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {s.byProfile.length > 0 && (
            <div>
              <h2 className="section" style={{ marginTop: 0 }}>By profile</h2>
              <div className="panel list">
                {s.byProfile.map((p) => (
                  <div key={p.profile ?? "vanilla"} className="list-row">
                    <b className="grow">{p.profile ?? "Vanilla"}</b>
                    <span className="faint small">
                      {p.sessions} session{p.sessions === 1 ? "" : "s"}
                    </span>
                    {p.crashes > 0 && (
                      <span className="badge bad">
                        <Skull style={{ width: 12, height: 12 }} /> {p.crashes} crash{p.crashes > 1 ? "es" : ""}
                      </span>
                    )}
                    <span style={{ minWidth: 60, textAlign: "right" }}>{hours(p.seconds)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {s.recent.length > 0 && (
            <div>
              <h2 className="section" style={{ marginTop: 0 }}>Recent sessions</h2>
              <div className="panel list">
                {s.recent.map((r) => (
                  <div key={r.start} className="list-row">
                    <span className="grow">
                      {new Date(r.start * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      <span className="faint"> · {r.profile ?? "Vanilla"}</span>
                    </span>
                    {r.crashed && <span className="badge bad">Crashed</span>}
                    {r.errors > 0 && <span className="badge warn">{r.errors} errors</span>}
                    <span style={{ minWidth: 60, textAlign: "right" }}>{hours(r.end - r.start)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
