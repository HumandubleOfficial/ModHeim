import { create } from "zustand";
import type { Progress } from "./api";

export type Page = "play" | "news" | "themes" | "browse" | "installed" | "profiles" | "servers" | "settings" | "modsettings" | "health";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface UiState {
  page: Page;
  setPage: (p: Page) => void;
  /** Config file to open when going to Mod Settings (e.g. from the Installed page). */
  configFile: string | null;
  openConfig: (file: string | null) => void;
  /** Category preset for Browse (e.g. "Modpacks" from the Profiles page). */
  browseCategory: string | null;
  browseIn: (category: string | null) => void;
  /** Package shown in the detail drawer. */
  detail: string | null;
  openDetail: (fullName: string | null) => void;
  progress: Progress | null;
  setProgress: (p: Progress | null) => void;
  busy: string | null;
  setBusy: (label: string | null) => void;
  toasts: Toast[];
  toast: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
}

let nextToast = 1;

export const useUi = create<UiState>((set) => ({
  page: "play",
  setPage: (page) => set({ page }),
  configFile: null,
  openConfig: (configFile) => set({ configFile, page: "modsettings" }),
  browseCategory: null,
  browseIn: (browseCategory) => set({ browseCategory, page: "browse" }),
  detail: null,
  openDetail: (detail) => set({ detail }),
  progress: null,
  setProgress: (progress) => set({ progress }),
  busy: null,
  setBusy: (busy) => set({ busy }),
  toasts: [],
  toast: (kind, text) => {
    const id = nextToast++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 9000 : 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
