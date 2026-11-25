// Dev-only stand-in for the Tauri backend, so the UI can be previewed in a normal browser
// (`npm run dev`, then open http://localhost:1420). Never bundled into the real app:
// main.tsx only imports it in dev builds when the Tauri runtime is missing.

type Args = Record<string, unknown> | undefined;

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86400000).toISOString();

const settings = {
  game: { platform: "xbox", path: "C:\\XboxGames\\Valheim\\Content", packageFamily: null, version: "1.0.30.0" },
  theme: (localStorage.getItem("mock.theme") as string) || "norse",
  activeProfile: "Default",
  launchMethod: "activate",
  extraArgs: "",
  servers: [{ id: "a1", name: "Friends world", address: "play.example.com:2456", password: "", profile: null, vanilla: false }],
  showNsfw: false,
  showDeprecated: false,
  background: null,
  backdrop: (localStorage.getItem("mock.backdrop") as string) || "aurora",
};

const mod = (fullName: string, version: string, description: string, enabled = true) => {
  const [owner, name] = fullName.split("-");
  return { fullName, owner, name, version, enabled, icon: "", description, dependencies: [], files: [], installedAt: iso(1) };
};

const profile = {
  name: "Default",
  created: iso(2),
  mods: [
    mod("denikson-BepInExPack_Valheim", "5.4.2360", "BepInEx pack for Valheim."),
    mod("ValheimModding-Jotunn", "2.30.1", "The Valheim library for mod developers."),
    mod("shudnal-MyLittleUI", "1.4.2", "Bunch of little UI tweaks.", false),
  ],
};

const packages = [
  ["ValheimModding-Jotunn", "Jötunn, the Valheim Library, makes mod development easier.", 5_000_000, 379],
  ["RandyKnapp-EpicLoot", "Adds loot drops, magic items, and enchanting to Valheim.", 2_500_000, 371],
  ["Advize-PlantEverything", "Plant berry bushes, thistle, mushrooms and more.", 3_000_000, 472],
  ["shudnal-MyLittleUI", "Bunch of little UI tweaks. Tooltips, custom chest names.", 429_000, 120],
  ["ZenDragon-ZenUI", "Crafting panel icons, grouping, sorting, and searching.", 160_000, 88],
  ["Kirtle-KirtleValheim", "A modpack with quality of life and building mods.", 86_000, 12],
].map(([fullName, description, downloads, rating]) => {
  const [owner, name] = (fullName as string).split("-");
  return {
    fullName, owner, name, description, icon: "", latest: "1.0.0", totalDownloads: downloads, rating,
    dateUpdated: iso(3), categories: ["Mods", "Client-side"], deprecated: false, nsfw: false, pinned: false,
  };
});

const news = {
  installedVersion: "1.0.30",
  latestPatch: "1.0.30",
  updateAvailable: false,
  offline: false,
  items: [
    {
      id: "1", title: "Patch 1.0.30", url: "https://store.steampowered.com", author: "Iron Gate", date: now / 1000 - 3600,
      image: null, patch: "1.0.30",
      body: "It's time for a patch! A bunch of fixes and improvements.\n\n#### Patch Notes:\n\n**Forge of Potential:**\n* Returns more materials when failing\n* Idol drop rates rebalanced\n\n**Tweaks:**\n* Snow regenerates over time\n* Music added to Sunken Crypt",
    },
    { id: "2", title: "Patch 1.0.21", url: "", author: "Iron Gate", date: now / 1000 - 86400 * 28, image: null, patch: "1.0.21", body: "A long list of tweaks and bug fixes." },
    { id: "3", title: "Vote For Valheim in the Steam Awards!", url: "", author: "Iron Gate", date: now / 1000 - 600, image: null, patch: null, body: "Nominate us!" },
  ],
};

let gameTheme: unknown = {
  installed: true,
  pluginEnabled: true,
  theme: { name: "Mistlands", enabled: true, panel: "#7A5CC4", button: "#8E73D1", heading: "#C9A6FF", text: "#EEE8FF", panelStrength: 0.7, dumpSprites: true },
  spriteDump: null,
};

const cfgEntry = (section: string, key: string, value: string, kind: string, description: string, extra: Record<string, unknown> = {}) => ({
  section, key, value, kind, description, typeName: kind === "bool" ? "Boolean" : kind === "int" ? "Int32" : kind === "float" ? "Single" : "String",
  default: value, choices: [], min: null, max: null, ...extra,
});

const configs: Record<string, { plugin: string; version: string; guid: string; sections: { name: string; entries: ReturnType<typeof cfgEntry>[] }[] }> = {
  "shudnal.MyLittleUI.cfg": {
    plugin: "My Little UI", version: "1.4.2", guid: "shudnal.MyLittleUI",
    sections: [
      { name: "General", entries: [
        cfgEntry("General", "Enabled", "true", "bool", "Turn the whole mod on or off."),
        cfgEntry("General", "Logging", "false", "bool", "Write extra debug lines to the log."),
      ] },
      { name: "Tooltips", entries: [
        cfgEntry("Tooltips", "Show durability", "true", "bool", "Show item durability as a bar and number."),
        cfgEntry("Tooltips", "Font scale", "1.1", "float", "Tooltip text size.", { min: 0.5, max: 2, default: "1" }),
        cfgEntry("Tooltips", "Position", "Cursor", "enum", "Where tooltips appear.", { choices: ["Cursor", "TopLeft", "TopRight", "BottomRight"] }),
        cfgEntry("Tooltips", "Show stats", "Weight, Value", "flags", "Extra item stats to list.", { choices: ["Weight", "Value", "Teleportable", "Quality"], default: "Weight" }),
      ] },
      { name: "Chests", entries: [
        cfgEntry("Chests", "Max name length", "24", "int", "Longest custom chest name.", { min: 4, max: 64 }),
        cfgEntry("Chests", "Hotkey", "LeftAlt + C", "string", "Shortcut to rename the chest you're looking at."),
      ] },
    ],
  },
  "com.jotunn.jotunn.cfg": {
    plugin: "Jotunn", version: "2.30.1", guid: "com.jotunn.jotunn",
    sections: [{ name: "Server", entries: [cfgEntry("Server", "ModVersionCheck", "true", "bool", "Check mod versions when joining a server.")] }],
  },
};

function handle(cmd: string, args: Args): unknown {
  switch (cmd) {
    case "get_settings":
      return { ...settings };
    case "save_prefs": {
      const prefs = (args?.prefs ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(prefs)) if (v !== null && v !== undefined) (settings as Record<string, unknown>)[k] = v;
      if (prefs.theme) localStorage.setItem("mock.theme", prefs.theme as string);
      if (prefs.backdrop) localStorage.setItem("mock.backdrop", prefs.backdrop as string);
      return { ...settings };
    }
    case "game_status":
      return {
        install: settings.game, exeFound: true, writable: true, running: false, moddedProfile: null,
        doorstop: { proxyInstalled: true, version: "4.6.0", enabled: false, target: null },
      };
    case "detect_games":
      return [settings.game];
    case "get_index_info":
    case "refresh_index":
      return { loaded: true, count: 14991, fetchedAt: iso(0.01) };
    case "search_packages":
      return { total: packages.length, items: packages };
    case "get_categories":
      return ["Building", "Client-side", "Modpacks", "Mods", "Tweaks", "Utility"];
    case "get_package": {
      const base = packages.find((x) => x.fullName === args?.fullName) ?? packages[0];
      const pack = String(base.fullName).startsWith("Kirtle-");
      return {
        ...base, url: "", website: "", versions: ["1.0.0", "0.9.0"], size: 800000,
        categories: pack ? ["Modpacks"] : base.categories,
        dependencies: pack ? ["denikson-BepInExPack_Valheim-5.4.2333", "ValheimModding-Jotunn-2.30.1", "Advize-PlantEverything-1.19.0"] : [],
      };
    }
    case "get_readme":
      return "# Readme\n\nSome **markdown** here.";
    case "list_profiles":
      return [
        { name: "Default", modCount: 2, enabledCount: 1, hasBepinex: true, created: iso(2) },
        { name: "Building", modCount: 7, enabledCount: 7, hasBepinex: true, created: iso(10) },
      ];
    case "get_profile":
      return profile;
    case "check_updates":
      return [{ fullName: "ValheimModding-Jotunn", current: "2.30.1", latest: "2.30.2" }];
    case "get_news":
      return news;
    case "get_game_theme":
      return gameTheme;
    case "apply_game_theme":
      gameTheme = { installed: true, pluginEnabled: true, theme: args?.theme, spriteDump: null };
      return gameTheme;
    case "turn_off_game_theme":
      gameTheme = { ...(gameTheme as object), theme: { ...((gameTheme as { theme: object }).theme), enabled: false } };
      return gameTheme;
    case "list_mod_configs":
      return Object.entries(configs).map(([file, c]) => ({
        file, plugin: c.plugin, guid: c.guid, entries: c.sections.reduce((n, s) => n + s.entries.length, 0), modified: now / 1000 - 7200,
      }));
    case "read_mod_config":
    case "save_mod_config": {
      const file = args?.file as string;
      const c = configs[file];
      for (const ch of (args?.changes as { section: string; key: string; value: string }[] | undefined) ?? []) {
        const e = c.sections.find((s) => s.name === ch.section)?.entries.find((x) => x.key === ch.key);
        if (e) e.value = ch.value;
      }
      return { file, plugin: c.plugin, version: c.version, guid: c.guid, sections: c.sections };
    }
    case "profile_health":
      return {
        logFound: true, logTime: now / 1000 - 5400, logErrors: 2, logWarnings: 1,
        logIssues: [
          { level: "error", source: "MyLittleUI", message: "NullReferenceException: Object reference not set to an instance of an object", detail: "  at MyLittleUI.InventoryPatch.Postfix (InventoryGui __instance)\n  at (wrapper dynamic-method) InventoryGui.DMD<InventoryGui::UpdateInventory>", count: 14, modName: "MyLittleUI", modFullName: "shudnal-MyLittleUI" },
          { level: "error", source: "Unity Log", message: "Failed to load sprite 'icon_frost'", detail: "", count: 1, modName: null, modFullName: null },
          { level: "warning", source: "BepInEx", message: "Skipping [ZenUI 1.2.0] because a newer version exists", detail: "", count: 1, modName: null, modFullName: null },
        ],
        modIssues: [
          { fullName: "RandyKnapp-EpicLoot", name: "EpicLoot", kind: "missingDep", detail: "Needs Jotunn, which isn't installed.", fix: "install", fixTarget: "ValheimModding-Jotunn" },
          { fullName: "ValheimModding-Jotunn", name: "Jotunn", kind: "update", detail: "Version 2.30.2 is out (you have 2.30.1).", fix: "update", fixTarget: "ValheimModding-Jotunn" },
          { fullName: "Someone-OldMod", name: "OldMod", kind: "outdated", detail: "Last updated before Patch 1.0.30. It may not work with the current game.", fix: null, fixTarget: null },
        ],
      };
    case "list_external_profiles":
      return [{ source: "r2modman", name: "Mods", path: "C:\r2\Mods", modCount: 22, enabledCount: 22, modified: now / 1000 - 86400 * 2 }];
    case "import_external_profile":
      return { name: "Mods", installed: 22, warnings: [] };
    case "get_background":
      return null;
    case "server_statuses":
      return [{ id: "a1", state: "online", name: "Friends world", players: 2, maxPlayers: 10, pingMs: 4, version: "1.0.30", error: null }];
    case "install_modpack":
      return { name: (args?.name as string) || "Modpack", installed: 23, warnings: [] };
    case "set_active_profile":
      return settings;
    case "plugin:event|listen":
      return 1;
    default:
      return null;
  }
}

let cb = 0;
(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  transformCallback: () => ++cb,
  invoke: async (cmd: string, args: Args) => {
    await new Promise((r) => setTimeout(r, 60));
    return handle(cmd, args);
  },
  convertFileSrc: (p: string) => p,
};
(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
  unregisterListener: () => {},
};

export {};
