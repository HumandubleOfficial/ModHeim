import { invoke } from "@tauri-apps/api/core";

export type Platform = "xbox" | "steam" | "manual";
export type LaunchMethod = "activate" | "direct";
export type Theme = "norse" | "modern";

export interface GameInstall {
  platform: Platform;
  path: string;
  packageFamily?: string | null;
  version?: string | null;
}

export interface Server {
  id: string;
  name: string;
  address: string;
  password: string;
  profile?: string | null;
  vanilla: boolean;
}

export interface Settings {
  game: GameInstall | null;
  theme: Theme;
  activeProfile: string;
  launchMethod: LaunchMethod;
  extraArgs: string;
  servers: Server[];
  showNsfw: boolean;
  showDeprecated: boolean;
  /** Custom Play-screen picture (file name in the data folder), or null for the built-in scene. */
  background: string | null;
  backdrop: Backdrop;
  launchGuard: boolean;
  backupBeforeLaunch: boolean;
  backupKeep: number;
  sounds: boolean;
  ambience: boolean;
  /** 0..1 */
  volume: number;
}

export type Prefs = Partial<
  Pick<
    Settings,
    | "theme" | "launchMethod" | "extraArgs" | "showNsfw" | "showDeprecated" | "backdrop"
    | "launchGuard" | "backupBeforeLaunch" | "backupKeep" | "sounds" | "ambience" | "volume"
  >
>;

export type Backdrop = "aurora" | "forest" | "embers" | "plain";

export interface DoorstopStatus {
  proxyInstalled: boolean;
  version: string | null;
  enabled: boolean | null;
  target: string | null;
}

export interface GameStatus {
  install: GameInstall | null;
  exeFound: boolean;
  writable: boolean;
  doorstop: DoorstopStatus | null;
  running: boolean;
  moddedProfile: string | null;
}

export interface IndexInfo {
  loaded: boolean;
  count: number;
  fetchedAt: string;
}

export interface PackageSummary {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  icon: string;
  latest: string;
  totalDownloads: number;
  rating: number;
  dateUpdated: string;
  categories: string[];
  deprecated: boolean;
  nsfw: boolean;
  pinned: boolean;
}

export interface Package extends Omit<PackageSummary, "latest"> {
  url: string;
  website: string;
  /** Version numbers, newest first. */
  versions: string[];
  /** Dependencies of the newest version. */
  dependencies: string[];
  /** Download size of the newest version. */
  size: number;
}

export interface SearchQuery {
  text: string;
  category?: string | null;
  sort: "downloads" | "rating" | "updated" | "name";
  nsfw: boolean;
  deprecated: boolean;
  offset: number;
  limit: number;
}

export interface SearchPage {
  total: number;
  items: PackageSummary[];
}

export interface InstalledMod {
  fullName: string;
  owner: string;
  name: string;
  version: string;
  enabled: boolean;
  icon: string;
  description: string;
  dependencies: string[];
  files: string[];
  installedAt: string;
}

export interface Profile {
  name: string;
  created: string;
  mods: InstalledMod[];
}

export interface ProfileSummary {
  name: string;
  modCount: number;
  enabledCount: number;
  hasBepinex: boolean;
  created: string;
}

export interface UpdateInfo {
  fullName: string;
  current: string;
  latest: string;
}

export interface ImportResult {
  name: string;
  installed: number;
  warnings: string[];
}

export interface Progress {
  label: string;
  step: number;
  steps: number;
  bytes: number;
  total: number;
  done: boolean;
}

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  author: string;
  date: number;
  body: string;
  image: string | null;
  patch: string | null;
}

export interface NewsInfo {
  items: NewsItem[];
  installedVersion: string | null;
  latestPatch: string | null;
  updateAvailable: boolean;
  offline: boolean;
}

export interface GameTheme {
  name: string;
  enabled: boolean;
  panel: string;
  button: string;
  heading: string;
  text: string;
  panelStrength: number;
  dumpSprites: boolean;
}

export interface ThemeState {
  installed: boolean;
  pluginEnabled: boolean;
  theme: GameTheme | null;
  spriteDump: string | null;
}

export type CfgKind = "bool" | "int" | "float" | "enum" | "flags" | "string";

export interface CfgEntry {
  section: string;
  key: string;
  value: string;
  description: string;
  kind: CfgKind;
  typeName: string;
  default: string | null;
  choices: string[];
  min: number | null;
  max: number | null;
}

export interface CfgFile {
  file: string;
  plugin: string | null;
  version: string | null;
  guid: string | null;
  sections: { name: string; entries: CfgEntry[] }[];
}

export interface CfgSummary {
  file: string;
  plugin: string | null;
  guid: string | null;
  entries: number;
  modified: number;
}

export interface CfgChange {
  section: string;
  key: string;
  value: string;
}

export interface LogIssue {
  level: "error" | "warning";
  source: string;
  message: string;
  detail: string;
  count: number;
  modName: string | null;
  modFullName: string | null;
}

export interface ModIssue {
  fullName: string;
  name: string;
  kind: "missingDep" | "disabledDep" | "update" | "deprecated" | "outdated";
  detail: string;
  fix: "install" | "enable" | "update" | null;
  fixTarget: string | null;
}

export interface HealthReport {
  logFound: boolean;
  logTime: number | null;
  logErrors: number;
  logWarnings: number;
  logIssues: LogIssue[];
  modIssues: ModIssue[];
}

export interface ServerStatus {
  id: string;
  state: "online" | "offline" | "unknown";
  name: string | null;
  players: number | null;
  maxPlayers: number | null;
  pingMs: number | null;
  version: string | null;
  error: string | null;
}

export interface ExternalProfile {
  source: string;
  name: string;
  path: string;
  modCount: number;
  enabledCount: number;
  modified: number;
}

export interface GuardIssue {
  fullName: string;
  name: string;
  /** Things the mod uses that this game version doesn't have. */
  missing: string[];
  /** Errors traced to it in the last launch. */
  errors: number;
  example: string | null;
}

export interface LaunchCheck {
  profile: string;
  gameVersion: string | null;
  issues: GuardIssue[];
}

export interface ErrorStorm {
  profile: string;
  message: string;
  count: number;
  /** [name, fullName] */
  mods: [string, string][];
}

export interface LogChunk {
  text: string;
  next: number;
  reset: boolean;
  exists: boolean;
}

export interface Snapshot {
  id: string;
  profile: string;
  created: string;
  reason: string;
  modCount: number;
  bytes: number;
}

export interface Backup {
  file: string;
  created: string;
  reason: string;
  bytes: number;
  files: number;
  worlds: string[];
}

export interface SaveSource {
  label: string;
  path: string;
  files: number;
  bytes: number;
}

export interface BackupInfo {
  backups: Backup[];
  sources: SaveSource[];
  folder: string;
}

export const BEPINEX_PACK = "denikson-BepInExPack_Valheim";

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  savePrefs: (prefs: Prefs) => invoke<Settings>("save_prefs", { prefs }),

  detectGames: () => invoke<GameInstall[]>("detect_games"),
  setGame: (path: string) => invoke<GameInstall>("set_game", { path }),
  gameStatus: () => invoke<GameStatus>("game_status"),
  getNews: (force: boolean) => invoke<NewsInfo>("get_news", { force }),
  openGameUpdates: () => invoke<void>("open_game_updates"),

  indexInfo: () => invoke<IndexInfo>("get_index_info"),
  refreshIndex: (force: boolean) => invoke<IndexInfo>("refresh_index", { force }),
  search: (query: SearchQuery) => invoke<SearchPage>("search_packages", { query }),
  categories: () => invoke<string[]>("get_categories"),
  getPackage: (fullName: string) => invoke<Package>("get_package", { fullName }),
  getReadme: (fullName: string, version: string) => invoke<string>("get_readme", { fullName, version }),

  listProfiles: () => invoke<ProfileSummary[]>("list_profiles"),
  getProfile: (name: string) => invoke<Profile>("get_profile", { name }),
  setActiveProfile: (name: string) => invoke<Settings>("set_active_profile", { name }),
  createProfile: (name: string) => invoke<Profile>("create_profile", { name }),
  repairProfile: (name: string) => invoke<Profile>("repair_profile", { name }),
  renameProfile: (old: string, newName: string) => invoke<void>("rename_profile", { old, new: newName }),
  cloneProfile: (src: string, newName: string) => invoke<void>("clone_profile", { src, new: newName }),
  deleteProfile: (name: string) => invoke<Settings>("delete_profile", { name }),

  installMod: (profile: string, fullName: string, version?: string) =>
    invoke<Profile>("install_mod", { profile, fullName, version: version ?? null }),
  updateMods: (profile: string, fullNames: string[]) => invoke<Profile>("update_mods", { profile, fullNames }),
  uninstallMod: (profile: string, fullName: string) => invoke<Profile>("uninstall_mod", { profile, fullName }),
  setModEnabled: (profile: string, fullName: string, enabled: boolean) =>
    invoke<Profile>("set_mod_enabled", { profile, fullName, enabled }),
  checkUpdates: (profile: string) => invoke<UpdateInfo[]>("check_updates", { profile }),

  exportProfile: (name: string, dest: string) => invoke<void>("export_profile", { name, dest }),
  importProfileFile: (path: string, name?: string) =>
    invoke<ImportResult>("import_profile_file", { path, name: name ?? null }),
  shareProfile: (name: string) => invoke<string>("share_profile", { name }),
  importProfileCode: (code: string, name?: string) =>
    invoke<ImportResult>("import_profile_code", { code, name: name ?? null }),

  getGameTheme: (profile: string) => invoke<ThemeState>("get_game_theme", { profile }),
  applyGameTheme: (profile: string, theme: GameTheme) => invoke<ThemeState>("apply_game_theme", { profile, theme }),
  turnOffGameTheme: (profile: string) => invoke<ThemeState>("turn_off_game_theme", { profile }),

  listModConfigs: (profile: string) => invoke<CfgSummary[]>("list_mod_configs", { profile }),
  readModConfig: (profile: string, file: string) => invoke<CfgFile>("read_mod_config", { profile, file }),
  saveModConfig: (profile: string, file: string, changes: CfgChange[]) =>
    invoke<CfgFile>("save_mod_config", { profile, file, changes }),
  profileHealth: (profile: string) => invoke<HealthReport>("profile_health", { profile }),
  serverStatuses: () => invoke<ServerStatus[]>("server_statuses"),
  installModpack: (fullName: string, name?: string) =>
    invoke<ImportResult>("install_modpack", { fullName, name: name ?? null }),

  setBackground: (path: string | null) => invoke<Settings>("set_background", { path }),
  getBackground: () => invoke<string | null>("get_background"),

  listExternalProfiles: () => invoke<ExternalProfile[]>("list_external_profiles"),
  importExternalProfile: (path: string, name?: string) =>
    invoke<ImportResult>("import_external_profile", { path, name: name ?? null }),

  launchCheck: (profile?: string) => invoke<LaunchCheck>("launch_check", { profile: profile ?? null }),
  readLog: (profile: string, from: number) => invoke<LogChunk>("read_log", { profile, from }),
  crashReport: (profile: string) => invoke<string>("crash_report", { profile }),
  saveTextFile: (path: string, text: string) => invoke<void>("save_text_file", { path, text }),

  listSnapshots: (profile: string) => invoke<Snapshot[]>("list_snapshots", { profile }),
  createSnapshot: (profile: string) => invoke<Snapshot>("create_snapshot", { profile }),
  restoreSnapshot: (profile: string, id: string) => invoke<Snapshot>("restore_snapshot", { profile, id }),
  deleteSnapshot: (profile: string, id: string) => invoke<void>("delete_snapshot", { profile, id }),

  listBackups: () => invoke<BackupInfo>("list_backups"),
  createBackup: () => invoke<Backup | null>("create_backup"),
  deleteBackup: (file: string) => invoke<void>("delete_backup", { file }),

  saveServer: (server: Server) => invoke<Settings>("save_server", { server }),
  deleteServer: (id: string) => invoke<Settings>("delete_server", { id }),

  launch: (vanilla: boolean, serverId?: string) =>
    invoke<void>("launch_game", { vanilla, serverId: serverId ?? null }),
  disableModsInGame: () => invoke<void>("disable_mods_in_game"),

  openFolder: (kind: "game" | "profile" | "config" | "plugins" | "log" | "data" | "backups", profile?: string) =>
    invoke<void>("open_folder", { kind, profile: profile ?? null }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  clearDownloadCache: () => invoke<number>("clear_download_cache"),
};

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1 << 10) return `${Math.round(n / (1 << 10))} KB`;
  return `${n} B`;
}

/** Newer-than for "x.y.z" strings. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

export function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  const units: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, unit] of units) {
    const v = Math.floor(s / size);
    if (v >= 1) return `${v} ${unit}${v > 1 ? "s" : ""} ago`;
  }
  return "just now";
}
