import { ArrowUpCircle, CheckCircle2 } from "lucide-react";
import { api, type NewsInfo } from "../api";
import { useAction } from "../hooks";

/** "Valheim x.y.z is out" with a button to the store page that installs it. */
export function UpdateBanner({ news, compact }: { news: NewsInfo; compact?: boolean }) {
  const open = useAction(api.openGameUpdates, { success: "Opened Valheim in the Xbox app. Install the update there." });
  if (!news.installedVersion) return null;
  if (news.updateAvailable) {
    return (
      <div className="notice warn">
        <ArrowUpCircle />
        <span>
          <b>Valheim {news.latestPatch}</b> is out. You have {news.installedVersion}.
          {!compact && " Mods may need updating too after a game patch."}
        </span>
        <button className="btn sm primary" disabled={open.isPending} onClick={() => open.mutate([])}>
          Get the update
        </button>
      </div>
    );
  }
  if (compact) return null;
  return (
    <div className="notice">
      <CheckCircle2 style={{ color: "var(--ok)" }} />
      <span>
        Valheim is up to date (<b>{news.installedVersion}</b>).
      </span>
    </div>
  );
}
