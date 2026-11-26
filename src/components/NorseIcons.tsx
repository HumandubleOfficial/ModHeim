/*
 * Hand-drawn Norse sidebar icons (original artwork), drawn like the standard icon set: 24x24,
 * stroked with the current text colour, so they drop in wherever a lucide icon goes.
 */

type P = { className?: string; size?: number };

function Icon({ d, className, size = 24, extra }: P & { d: string; extra?: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
      {extra}
    </svg>
  );
}

/** War horn: Play */
export const HornIcon = (p: P) => (
  <Icon {...p} d="M3.5 17.5c5-.5 10.5-4 14-11l2.5 1.5c-2.5 7.5-8 11.5-15.5 12.5zM8.5 15.6l1.6 2.6M12.6 12.4l1.8 2.4M20 8 21.5 3.5" />
);

/** Scroll: News */
export const ScrollIcon = (p: P) => (
  <Icon {...p} d="M7 4h11a2 2 0 0 1 2 2v1h-3M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7M7 4a2 2 0 0 1 2 2v0M9.5 10h6M9.5 13h6M9.5 16h4" />
);

/** Folded map: Browse */
export const MapIcon = (p: P) => (
  <Icon {...p} d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20zM9 4v13.5M15 6.5V20M5.5 9.5l1.5 1.5M7 9.5 5.5 11M17 12l1.6 1.6M18.6 12 17 13.6" />
);

/** Iron-bound chest: Installed */
export const ChestIcon = (p: P) => (
  <Icon {...p} d="M4 11h16v8.5H4zM4 11c0-3.3 3.6-6 8-6s8 2.7 8 6M4 14h16M10.8 14v2.6h2.4V14M8 5.8V11M16 5.8V11" />
);

/** Smith's hammer: Mod Settings */
export const HammerIcon = (p: P) => (
  <Icon {...p} d="M5 4.5h14v5.5H5zM12 10v10.5M9.5 20.5h5M8 7.2h8" />
);

/** Heart with a life rune: Health Check */
export const HeartRuneIcon = (p: P) => (
  <Icon {...p} d="M12 20.5s-7.5-4.6-7.5-10.4A4.2 4.2 0 0 1 12 7.4a4.2 4.2 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4zM12 9.5V17M12 12l2.6-2.6M12 12 9.4 9.4" />
);

/** Quill: Game Log */
export const QuillIcon = (p: P) => (
  <Icon {...p} d="M4.5 19.5 16.5 7.5c1.8-1.8 3.5-3.5 3.5-3.5s-.6 3-3 5.5L9.5 17M4.5 19.5l1-3.2M14 4.5c-4.2.8-7.6 4.1-8.5 11.8M3.5 21h8" />
);

/** Round shield with boss: Profiles */
export const ShieldIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 3v6.5M12 14.5V21M3 12h6.5M14.5 12H21"
    extra={<circle cx="12" cy="12" r="2.5" />}
  />
);

/** World tree: Worlds & Play */
export const TreeIcon = (p: P) => (
  <Icon {...p} d="M12 21v-8.5M12 12.5c-3.5 0-6.5-2.3-6.5-5.4a6.5 6.5 0 0 1 13 0c0 3.1-3 5.4-6.5 5.4zM8.5 21h7M12 16.5l-3.2 3M12 16.5l3.2 3M9.5 8.5 12 10.5l2.5-2" />
);

/** Longhouse: Servers */
export const LonghouseIcon = (p: P) => (
  <Icon {...p} d="M2.5 12.5 12 5.5l9.5 7M5 11v8.5h14V11M10 19.5v-4.5h4v4.5M7 7.6 4.5 4.5M17 7.6l2.5-3.1" />
);

/** Sun over water, with its reflection: Graphics */
export const SunIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 2.5v2M5.3 5.3l1.4 1.4M18.7 5.3l-1.4 1.4M2.5 12h2M19.5 12h2M3 15.5h18M6 18.5h12M9 21h6"
    extra={<path d="M7.5 12a4.5 4.5 0 0 1 9 0" />}
  />
);

/** Painted rune stone: Game Themes */
export const RuneStoneIcon = (p: P) => (
  <Icon {...p} d="M7 21V8.5C7 5.5 9.2 3 12 3s5 2.5 5 5.5V21zM4.5 21h15M10 9l2 2.5L14 9M12 11.5V17" />
);

/** Barrel: Backups */
export const BarrelIcon = (p: P) => (
  <Icon {...p} d="M7 3.5h10c1.5 2.8 1.5 14.2 0 17H7c-1.5-2.8-1.5-14.2 0-17zM5.9 8.5h12.2M5.9 15.5h12.2M12 3.5v17" />
);

/** Way-finder wheel: Settings */
export const WheelIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M18.7 5.3l-2.8 2.8M8.1 15.9l-2.8 2.8M10.6 2.5h2.8M10.6 21.5h2.8M2.5 10.6v2.8M21.5 10.6v2.8"
    extra={<circle cx="12" cy="12" r="3.2" />}
  />
);
