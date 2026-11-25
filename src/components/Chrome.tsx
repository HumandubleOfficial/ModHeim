import { getCurrentWindow } from "@tauri-apps/api/window";
import { CheckCircle2, Info, Loader2, Minus, Square, X, XCircle } from "lucide-react";
import { formatBytes } from "../api";
import { useUi } from "../store";
import { UpdatePill } from "../updater";

/** ModHeim mark: a simple longship prow inside a shield ring (original artwork). */
export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} fill="none" aria-hidden>
      <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="2" opacity="0.9" />
      <path
        d="M7 19c3 3.2 15 3.2 18 0l-1.2 3.4c-.5 1.4-1.8 2.3-3.3 2.3h-9c-1.5 0-2.8-.9-3.3-2.3L7 19Z"
        fill="currentColor"
      />
      <path d="M16 6v12" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16.6 7.2 23 15.4H16.6Z" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

export function TitleBar() {
  const win = getCurrentWindow();
  return (
    <header className="titlebar">
      <div className="drag" data-tauri-drag-region onDoubleClick={() => win.toggleMaximize()}>
        <span className="brand">
          <Mark />
          MODHEIM
        </span>
      </div>
      <UpdatePill />
      <div className="win-controls">
        <button aria-label="Minimize" onClick={() => win.minimize()}>
          <Minus size={16} />
        </button>
        <button aria-label="Maximize" onClick={() => win.toggleMaximize()}>
          <Square size={13} />
        </button>
        <button aria-label="Close" className="close" onClick={() => win.close()}>
          <X size={17} />
        </button>
      </div>
    </header>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useUi();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === "success" ? <CheckCircle2 /> : t.kind === "error" ? <XCircle /> : <Info />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function ProgressDock() {
  const { progress, busy } = useUi();
  if (!progress && !busy) return null;
  const label = progress?.label || busy || "Working…";
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.bytes / progress.total) * 100) : null;
  const sub = [
    progress && progress.steps > 1 ? `Step ${progress.step} of ${progress.steps}` : null,
    progress && progress.bytes > 0
      ? progress.total > 0
        ? `${formatBytes(progress.bytes)} / ${formatBytes(progress.total)}`
        : formatBytes(progress.bytes)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="panel progress-dock" role="status">
      <div className="row">
        <Loader2 size={16} className="spin" style={{ color: "var(--accent)" }} />
        <div className="label">{label}</div>
      </div>
      {sub && <div className="sub">{sub}</div>}
      <div className="bar-track">
        <div className={`bar-fill${pct === null ? " indeterminate" : ""}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
    </div>
  );
}

export function ModIcon({ src, name, large }: { src?: string; name: string; large?: boolean }) {
  if (!src) {
    return <div className={`mod-icon placeholder${large ? " lg" : ""}`}>{name.slice(0, 1).toUpperCase()}</div>;
  }
  return <img className={`mod-icon${large ? " lg" : ""}`} src={src} alt="" loading="lazy" draggable={false} />;
}

export function Switch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch${on ? " on" : ""}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
    />
  );
}

/** Orange divider with a small interlaced knot in the middle (original drawing). */
export function RuneRule() {
  return (
    <div className="knot-rule" aria-hidden>
      <svg viewBox="0 0 44 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <path d="M4 7 10 2l6 5-6 5Z" />
        <path d="M16 7l6-5 6 5-6 5Z" />
        <path d="M28 7l6-5 6 5-6 5Z" />
      </svg>
    </div>
  );
}

export function PageHead({
  title,
  sub,
  actions,
}: {
  title: string;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="display">{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {actions && <div className="actions">{actions}</div>}
      </div>
      <RuneRule />
    </>
  );
}
