import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

interface ConfirmOpts {
  title: string;
  body?: React.ReactNode;
  confirm?: string;
  danger?: boolean;
}
interface PromptOpts {
  title: string;
  body?: React.ReactNode;
  label?: string;
  initial?: string;
  placeholder?: string;
  confirm?: string;
}

type Dialog =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: "alert"; opts: ConfirmOpts; resolve: (v: boolean) => void };

const useDialogs = create<{ current: Dialog | null; set: (d: Dialog | null) => void }>((set) => ({
  current: null,
  set: (current) => set({ current }),
}));

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: "confirm", opts, resolve }));
}

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: "prompt", opts, resolve }));
}

export function alertDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().set({ kind: "alert", opts, resolve }));
}

export function Modal({
  children,
  onClose,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`panel modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function DialogHost() {
  const { current, set } = useDialogs();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (current?.kind === "prompt") {
      setText(current.opts.initial ?? "");
      setTimeout(() => inputRef.current?.select(), 30);
    }
  }, [current]);

  if (!current) return null;
  const close = (value: boolean | string | null) => {
    set(null);
    (current.resolve as (v: unknown) => void)(value);
  };
  const cancelValue = current.kind === "prompt" ? null : false;

  return (
    <Modal onClose={() => close(cancelValue)}>
      <h3>{current.opts.title}</h3>
      {current.opts.body && <div className="dim" style={{ marginBottom: 12 }}>{current.opts.body}</div>}
      {current.kind === "prompt" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim()) close(text.trim());
          }}
        >
          <label className="field">
            {current.opts.label && <span>{current.opts.label}</span>}
            <input
              ref={inputRef}
              className="input"
              value={text}
              placeholder={current.opts.placeholder}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          </label>
          <div className="buttons">
            <button type="button" className="btn ghost" onClick={() => close(null)}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!text.trim()}>
              {current.opts.confirm ?? "OK"}
            </button>
          </div>
        </form>
      )}
      {current.kind === "confirm" && (
        <div className="buttons">
          <button className="btn ghost" onClick={() => close(false)}>
            Cancel
          </button>
          <button
            className={`btn ${current.opts.danger ? "danger" : "primary"}`}
            onClick={() => close(true)}
            autoFocus
          >
            {current.opts.confirm ?? "OK"}
          </button>
        </div>
      )}
      {current.kind === "alert" && (
        <div className="buttons">
          <button className="btn primary" onClick={() => close(true)} autoFocus>
            {current.opts.confirm ?? "OK"}
          </button>
        </div>
      )}
    </Modal>
  );
}
