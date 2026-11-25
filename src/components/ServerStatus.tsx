import { Users } from "lucide-react";
import { isNewer, type ServerStatus } from "../api";

/** Online dot, players and ping for a saved server, from the Steam server query. */
export function ServerStatusLine({ status, gameVersion }: { status?: ServerStatus; gameVersion?: string | null }) {
  if (!status) {
    return (
      <span className="srv-status faint">
        <span className="dot" /> Checking…
      </span>
    );
  }
  if (status.state !== "online") {
    return (
      <span
        className="srv-status faint"
        title={`${status.error ?? "No answer"}. Servers that only use a join code (crossplay) can't be checked, but may still be up.`}
      >
        <span className="dot bad" /> No answer
      </span>
    );
  }
  const mismatch =
    status.version && gameVersion && (isNewer(status.version, gameVersion) || isNewer(gameVersion, status.version));
  return (
    <span className="srv-status" title={status.name ?? undefined}>
      <span className="dot ok" /> Online
      <span className="sep">·</span>
      <Users /> {status.players}/{status.maxPlayers}
      {status.pingMs != null && (
        <>
          <span className="sep">·</span>
          {status.pingMs} ms
        </>
      )}
      {status.version && (
        <>
          <span className="sep">·</span>
          <span className={mismatch ? "warn-text" : undefined} title={mismatch ? `You have ${gameVersion}` : undefined}>
            v{status.version}
          </span>
        </>
      )}
    </span>
  );
}

/** "1.0.30.0" -> "1.0.30", to compare with what servers advertise. */
export const shortGameVersion = (v?: string | null) => (v ? v.split(".").slice(0, 3).join(".") : null);
