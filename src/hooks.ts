import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "./api";
import { useUi } from "./store";

export const keys = {
  settings: ["settings"] as const,
  game: ["game"] as const,
  index: ["index"] as const,
  profiles: ["profiles"] as const,
  profile: (name: string) => ["profile", name] as const,
  updates: (name: string) => ["updates", name] as const,
  categories: ["categories"] as const,
};

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: api.getSettings, staleTime: Infinity });
}

export function useGameStatus() {
  return useQuery({ queryKey: keys.game, queryFn: api.gameStatus, refetchInterval: 30000 });
}

export function useIndexInfo() {
  return useQuery({ queryKey: keys.index, queryFn: api.indexInfo, staleTime: Infinity });
}

export function useNews() {
  return useQuery({ queryKey: ["news"], queryFn: () => api.getNews(false), staleTime: 10 * 60 * 1000 });
}

export function useProfiles() {
  return useQuery({ queryKey: keys.profiles, queryFn: api.listProfiles });
}

export function useProfile(name: string | undefined) {
  return useQuery({
    queryKey: keys.profile(name ?? ""),
    queryFn: () => api.getProfile(name!),
    enabled: !!name,
    retry: false,
  });
}

export function useUpdates(name: string | undefined, indexLoaded: boolean) {
  return useQuery({
    queryKey: [...keys.updates(name ?? ""), indexLoaded],
    queryFn: () => api.checkUpdates(name!),
    enabled: !!name,
  });
}

/** Live status of saved servers; refreshed every 30s while a page using it is open. */
export function useServerStatus() {
  const servers = useSettings().data?.servers ?? [];
  return useQuery({
    queryKey: ["serverStatus", servers.map((s) => `${s.id}=${s.address}`).join(",")],
    queryFn: api.serverStatuses,
    refetchInterval: 30000,
    enabled: servers.length > 0,
  });
}

/** The custom Play-screen picture as a data URL (null = built-in scene). Keyed by file name. */
export function useBackground() {
  const name = useSettings().data?.background ?? null;
  return useQuery({ queryKey: ["background", name], queryFn: api.getBackground, staleTime: Infinity, gcTime: 60_000 });
}

export function useActiveProfileName(): string | undefined {
  return useSettings().data?.activeProfile;
}

/** Refresh everything that depends on profile contents. */
export function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["profile"] });
    qc.invalidateQueries({ queryKey: ["updates"] });
    qc.invalidateQueries({ queryKey: keys.profiles });
    qc.invalidateQueries({ queryKey: keys.settings });
    qc.invalidateQueries({ queryKey: keys.game });
    qc.invalidateQueries({ queryKey: ["gameTheme"] });
    qc.invalidateQueries({ queryKey: ["health"] });
    qc.invalidateQueries({ queryKey: ["configs"] });
  };
}

/**
 * Run a backend action with a busy label, toast on error, and a cache refresh afterwards.
 */
export function useAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  opts: { busy?: string; success?: string | ((r: TResult) => string | null) } = {},
) {
  const invalidate = useInvalidate();
  const { toast, setBusy } = useUi();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      if (opts.busy) setBusy(opts.busy);
      try {
        return await fn(...args);
      } finally {
        if (opts.busy) setBusy(null);
      }
    },
    onSuccess: (r) => {
      const msg = typeof opts.success === "function" ? opts.success(r) : opts.success;
      if (msg) toast("success", msg);
    },
    onError: (e) => toast("error", errorText(e)),
    onSettled: () => invalidate(),
  });
}
