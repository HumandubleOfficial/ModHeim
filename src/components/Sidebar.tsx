import {
  Compass,
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
      { id: "profiles", label: "Profiles", icon: Layers },
    ],
  },
  {
    title: "Game",
    items: [
      { id: "servers", label: "Servers", icon: Server },
      { id: "themes", label: "Game Themes", icon: Palette },
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

  const item = ({ id, label, icon: Icon }: NavItem) => (
    <button key={id} className={`nav-item${page === id ? " active" : ""}`} onClick={() => setPage(id)}>
      <Icon />
      {label}
      {!!counts[id] && <span className="count">{counts[id]}</span>}
    </button>
  );

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
