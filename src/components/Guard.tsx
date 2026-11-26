import { useEffect, useState } from "react";
import { create } from "zustand";
import { AlertTriangle, Flame, ScrollText, ShieldAlert, X } from "lucide-react";
import { api, errorText, type LaunchCheck } from "../api";
import { useUi } from "../store";
import { Modal } from "./Dialogs";

type Answer = { play: boolean; turnOff: string[] };

const useGuard = create<{ check: LaunchCheck | null; resolve: ((a: Answer) => void) | null }>(() => ({
  check: null,
  resolve: null,
}));

function guardDialog(check: LaunchCheck): Promise<Answer> {
  return new Promise((resolve) => useGuard.setState({ check, resolve }));
}

function describe(missing: string[]): string {
  const shown = missing.slice(0, 3).join(", ");
  return missing.length > 3 ? `${shown} and ${missing.length - 3} more` : shown;
}

/**
 * Before a modded launch: check the profile against the installed game, ask what to do about
 * mods likely to break, and turn off the ones the user picks. Resolves false to cancel.
 */
export async function guardLaunch(profile: string, enabled: boolean): Promise<boolean> {
  if (!enabled) return true;
  let check: LaunchCheck;
  try {
    check = await api.launchCheck(profile);
  } catch {
    // a failed check never blocks playing
    return true;
  }
  if (check.issues.length === 0) return true;
  const answer = await guardDialog(check);
  if (!answer.play) return false;
  try {
    for (const full of answer.turnOff) await api.setModEnabled(profile, full, false);
    if (answer.turnOff.length) {
      useUi.getState().toast("success", `Turned off ${answer.turnOff.length} mod${answer.turnOff.length > 1 ? "s" : ""}. Turn them back on from Installed.`);
    }
  } catch (e) {
    useUi.getState().toast("error", errorText(e));
    return false;
  }
  return true;
}

export function LaunchGuardHost() {
  const { check, resolve } = useGuard();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => setPicked(new Set(check?.issues.map((i) => i.fullName) ?? [])), [check]);
  if (!check || !resolve) return null;
  const close = (a: Answer) => {
    useGuard.setState({ check: null, resolve: null });
    resolve(a);
  };
  const toggle = (f: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });

  return (
    <Modal wide onClose={() => close({ play: false, turnOff: [] })}>
      <h3 className="row" style={{ gap: 8 }}>
        <ShieldAlert style={{ color: "var(--warn)" }} />
        {check.issues.length === 1 ? "A mod may not work" : `${check.issues.length} mods may not work`}
        {check.gameVersion ? ` with Valheim ${check.gameVersion.replace(/\.0$/, "")}` : ""}
      </h3>
      <p className="dim" style={{ marginTop: 0 }}>
        Mods built for an older game version can spam errors every frame, which makes Valheim stop responding. The
        picked ones are turned off for this launch; your worlds aren't touched.
      </p>
      <div className="guard-list">
        {check.issues.map((i) => (
          <label key={i.fullName} className={`guard-item${picked.has(i.fullName) ? " on" : ""}`}>
            <input type="checkbox" checked={picked.has(i.fullName)} onChange={() => toggle(i.fullName)} />
            <div className="text">
              <div className="name">{i.name}</div>
              {i.missing.length > 0 && (
                <div className="desc">
                  Uses things this game version doesn't have: <span className="mono">{describe(i.missing)}</span>
                </div>
              )}
              {i.errors > 0 && (
                <div className="desc">
                  <Flame /> {i.errors} errors last time you played
                  {i.example && <span className="mono faint"> · {i.example}</span>}
                </div>
              )}
            </div>
          </label>
        ))}
      </div>
      <div className="buttons">
        <button className="btn ghost" onClick={() => close({ play: false, turnOff: [] })}>
          Cancel
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => close({ play: true, turnOff: [] })}>
          Play anyway
        </button>
        <button className="btn primary" disabled={picked.size === 0} onClick={() => close({ play: true, turnOff: [...picked] })}>
          Turn off {picked.size || ""} and play
        </button>
      </div>
    </Modal>
  );
}

/** Warnings about mods that error nonstop while the game is running. */
export function StormBanner() {
  const { storms, dismissStorm, queueOff, offWhenClosed, setPage } = useUi();
  if (storms.length === 0) return null;
  return (
    <div className="storm-stack">
      {storms.map((s) => {
        const names = s.mods.map(([n]) => n.replace(/_/g, " "));
        const queued = s.mods.length > 0 && s.mods.every(([, f]) => offWhenClosed.some(([p, x]) => p === s.profile && x === f));
        return (
          <div key={s.message} className="panel storm" role="alert">
            <AlertTriangle className="icon" />
            <div className="text">
              <b>{names.length ? `${names.join(", ")} ${names.length > 1 ? "are" : "is"} erroring nonstop` : "A mod is erroring nonstop"}</b>
              <div className="dim">
                {s.count}+ times in 30 seconds. This can make Valheim stutter or stop responding.
              </div>
              <div className="mono faint msg">{s.message}</div>
              <div className="row" style={{ gap: 6, marginTop: 8 }}>
                {s.mods.length > 0 &&
                  (queued ? (
                    <span className="badge ok">Turns off when the game closes</span>
                  ) : (
                    <button className="btn sm primary" onClick={() => queueOff(s.profile, s.mods.map(([, f]) => f))}>
                      Turn off when the game closes
                    </button>
                  ))}
                <button className="btn sm ghost" onClick={() => setPage("log")}>
                  <ScrollText /> Game log
                </button>
              </div>
            </div>
            <button className="btn sm ghost icon" aria-label="Dismiss" onClick={() => dismissStorm(s.message)}>
              <X />
            </button>
          </div>
        );
      })}
    </div>
  );
}
