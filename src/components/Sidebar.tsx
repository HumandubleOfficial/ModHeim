import {
  Archive,
  Compass,
  Globe2,
  ScrollText,
  Sparkles,
  HeartPulse,
  Layers,
  Newspaper,
  Package,
  Palette,
  Play,
  Server,
  Settings as Cog,
  SlidersHorizontal,
} from "lucide-react";
import { useIndexInfo, useNews, useSettings, useUpdates } from "../hooks";
import { type Page, useUi } from "../store";
import * as N from "./NorseIcons";

/** Hand-drawn icons used by the Norse theme. */
const NORSE: Partial<Record<Page, (p: { className?: string }) => React.ReactElement>> = {
  play: N.HornIcon,
  news: N.ScrollIcon,
  browse: N.MapIcon,
  installed: N.ChestIcon,
  modsettings: N.HammerIcon,
  health: N.HeartRuneIcon,
  log: N.QuillIcon,
  profiles: N.ShieldIcon,
  stats: N.TreeIcon,
  servers: N.LonghouseIcon,
  themes: N.RuneStoneIcon,
  graphics: N.SunIcon,
  backups: N.BarrelIcon,
  settings: N.WheelIcon,
};

type NavItem = { id: Page; label: string; icon: typeof Play };

const GROUPS: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      { id: "play", label: "Play", icon: Play },
      { id: "news", label: "News", icon: Newspaper },
    ],
  },
  {
    title: "Mods",
    items: [
      { id: "browse", label: "Browse Mods", icon: Compass },
      { id: "installed", label: "Installed", icon: Package },
      { id: "modsettings", label: "Mod Settings", icon: SlidersHorizontal },
      { id: "health", label: "Health Check", icon: HeartPulse },
      { id: "log", label: "Game Log", icon: ScrollText },
      { id: "profiles", label: "Profiles", icon: Layers },
    ],
  },
  {
    title: "Game",
    items: [
      { id: "stats", label: "Worlds & Play", icon: Globe2 },
      { id: "servers", label: "Servers", icon: Server },
      { id: "graphics", label: "Graphics", icon: Sparkles },
      { id: "themes", label: "Game Themes", icon: Palette },
      { id: "backups", label: "Backups", icon: Archive },
    ],
  },
];

export function Sidebar() {
  const { page, setPage } = useUi();
  const settings = useSettings().data;
  const index = useIndexInfo().data;
  const updates = useUpdates(settings?.activeProfile, !!index?.loaded).data ?? [];
  const gameUpdate = useNews().data?.updateAvailable ? 1 : undefined;
  const counts: Partial<Record<Page, number | undefined>> = { installed: updates.length, news: gameUpdate };

  const norse = settings?.theme !== "modern";
  const item = ({ id, label, icon: Lucide }: NavItem) => {
    const Icon = (norse && NORSE[id]) || Lucide;
    return (
    <button key={id} className={`nav-item${page === id ? " active" : ""}`} onClick={() => setPage(id)}>
      <Icon />
      {label}
      {!!counts[id] && <span className="count">{counts[id]}</span>}
    </button>
    );
  };

  return (
    <nav className="sidebar">
      {GROUPS.map((g, i) => (
        <div key={i} className="nav-group">
          {g.title && <div className="nav-section">{g.title}</div>}
          {g.items.map(item)}
        </div>
      ))}
      <div className="nav-bottom">{item({ id: "settings", label: "Settings", icon: Cog })}</div>
    </nav>
  );
}
