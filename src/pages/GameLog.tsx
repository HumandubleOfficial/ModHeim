import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowDownToLine, ClipboardCopy, FileDown, FolderOpen, Search } from "lucide-react";
import { api, errorText } from "../api";
import { useGameStatus, useProfiles, useSettings } from "../hooks";
import { PageHead } from "../components/Chrome";
import { useUi } from "../store";

type Level = "fatal" | "error" | "warning" | "message" | "info" | "debug";
interface Line {
  level: Level;
  text: string;
}

const HEAD = /^\[(Fatal|Error|Warning|Message|Info|Debug)\s*:/;
const MAX_LINES = 200_000;

/** BepInEx lines start with "[Level : Source]"; lines without one (stack traces) belong to the line above. */
function parse(text: string, prev: Level): Line[] {
  const out: Line[] = [];
  let level = prev;
  for (const raw of text.split("\n")) {
    const t = raw.replace(/\r$/, "");
    if (!t) continue;
    const m = HEAD.exec(t);
    if (m) level = m[1].toLowerCase() as Level;
    out.push({ level, text: t });
  }
  return out;
}

const rank: Record<Level, number> = { fatal: 3, error: 2, warning: 1, message: 0, info: 0, debug: 0 };

export function GameLogPage() {
  const settings = useSettings().data;
  const game = useGameStatus().data;
  const profiles = useProfiles().data ?? [];
  const toast = useUi((s) => s.toast);
  const defaultProfile =
    game?.moddedProfile && profiles.some((p) => p.name === game.moddedProfile) ? game.moddedProfile : settings?.activeProfile;
  const [profile, setProfile] = useState<string | undefined>(undefined);
  const current = profile ?? defaultProfile;

  const lines = useRef<Line[]>([]);
  const [version, setVersion] = useState(0);
  const [exists, setExists] = useState(true);
  const [min, setMin] = useState(0);
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);

  // follow the file: read what's new every 1.5 s
  useEffect(() => {
    if (!current) return;
    let next = 0;
    let stop = false;
    let timer = 0;
    lines.current = [];
    setVersion((v) => v + 1);
    const tick = async () => {
      try {
        const chunk = await api.readLog(current, next);
        if (stop) return;
        setExists(chunk.exists);
        if (chunk.reset) lines.current = [];
        if (chunk.text) {
          const prev = lines.current[lines.current.length - 1]?.level ?? "info";
          lines.current.push(...parse(chunk.text, prev));
          if (lines.current.length > MAX_LINES) lines.current.splice(0, lines.current.length - MAX_LINES);
        }
        if (chunk.text || chunk.reset) setVersion((v) => v + 1);
        next = chunk.next;
      } catch {
        // try again next tick
      }
      if (!stop) timer = window.setTimeout(tick, 1500);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [current]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.current.filter((l) => rank[l.level] >= min && (!q || l.text.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, min, query]);
  const counts = useMemo(() => {
    let e = 0;
    let w = 0;
    for (const l of lines.current) {
      if (!HEAD.test(l.text)) continue;
      if (rank[l.level] >= 2) e++;
      else if (l.level === "warning") w++;
    }
    return { e, w };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 19,
    overscan: 30,
  });
  useEffect(() => {
    if (follow && shown.length) virt.scrollToIndex(shown.length - 1, { align: "end" });
  }, [shown.length, follow, virt]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atEnd !== follow) setFollow(atEnd);
  };

  const report = async () => {
    if (!current) return null;
    try {
      return await api.crashReport(current);
    } catch (e) {
      toast("error", errorText(e));
      return null;
    }
  };
  const copyReport = async () => {
    const r = await report();
    if (r) {
      await navigator.clipboard.writeText(r);
      toast("success", "Crash report copied. Paste it wherever you ask for help.");
    }
  };
  const saveReport = async () => {
    const dest = await save({
      title: "Save crash report",
      defaultPath: `ModHeim crash report ${new Date().toISOString().slice(0, 10)}.txt`,
      filters: [{ name: "Text", extensions: ["txt"] }],
    });
    if (!dest) return;
    const r = await report();
    if (!r) return;
    try {
      await api.saveTextFile(dest, r);
      toast("success", "Crash report saved");
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  return (
    <div className="page fill">
      <PageHead
        title="Game Log"
        sub={
          game?.running
            ? "Live: new lines appear as the game writes them"
            : "What BepInEx and your mods wrote during the last modded launch"
        }
        actions={
          <>
            <button className="btn" onClick={copyReport} title="Mods, versions, top errors and the end of the log, with your user name hidden">
              <ClipboardCopy /> Copy crash report
            </button>
            <button className="btn ghost" onClick={saveReport}>
              <FileDown /> Save…
            </button>
          </>
        }
      />
      <div className="toolbar">
        {profiles.length > 1 && (
          <select className="input" value={current ?? ""} onChange={(e) => setProfile(e.target.value)} aria-label="Profile">
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="seg" role="radiogroup" aria-label="Show">
          {(
            [
              [0, "Everything"],
              [1, `Warnings & errors`],
              [2, `Errors (${counts.e})`],
            ] as const
          ).map(([v, label]) => (
            <button key={v} className={min === v ? "on" : ""} onClick={() => setMin(v)}>
              {label}
            </button>
          ))}
        </div>
        {/* narrower minimum than other searches, so the folder button stays on the row at the smallest window size */}
        <div className="search-box" style={{ flex: 1, minWidth: 150 }}>
          <Search />
          <input className="input" placeholder="Search the log" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn ghost" onClick={() => current && api.openFolder("log", current)} title="Open the log's folder">
          <FolderOpen />
        </button>
      </div>

      <div className="panel log-view" ref={scrollRef} onScroll={onScroll}>
        {!exists ? (
          <div className="empty">
            No log yet for this profile. It's written the next time you play modded.
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">{lines.current.length ? "Nothing matches." : "Reading the log…"}</div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {virt.getVirtualItems().map((v) => {
              const l = shown[v.index];
              return (
                <div
                  key={v.key}
                  className={`log-line ${l.level}`}
                  style={{ transform: `translateY(${v.start}px)` }}
                  title={l.text.length > 160 ? l.text : undefined}
                >
                  {l.text}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {!follow && shown.length > 0 && (
        <button className="btn sm log-jump" onClick={() => setFollow(true)}>
          <ArrowDownToLine /> Jump to newest
        </button>
      )}
      <div className="faint log-foot">
        {lines.current.length.toLocaleString()} lines · {counts.e} errors · {counts.w} warnings
      </div>
    </div>
  );
}
