/*
 * A ring of Elder Futhark runes that light up one after another around a slowly turning
 * knot: the app's loading indicator. Original design; runes are Unicode text.
 */

const RUNES = ["ᚠ", "ᚢ", "ᚦ", "ᚨ", "ᚱ", "ᚲ", "ᚷ", "ᚹ"];

export function RuneLoader({ size = 56, label }: { size?: number; label?: string }) {
  const r = size / 2 - size * 0.13;
  return (
    <div className="rune-loader" role="status" aria-live="polite" aria-label={label ?? "Loading"}>
      <div className="ring" style={{ width: size, height: size }}>
        {RUNES.map((g, i) => {
          const a = (i / RUNES.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <span
              key={i}
              className="rune-glyph"
              style={{
                left: size / 2 + Math.cos(a) * r,
                top: size / 2 + Math.sin(a) * r,
                fontSize: size * 0.2,
                animationDelay: `${(i / RUNES.length) * 1.6}s`,
              }}
            >
              {g}
            </span>
          );
        })}
        <svg className="knot-core" viewBox="0 0 20 20" width={size * 0.34} height={size * 0.34} aria-hidden>
          <g fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M10 2 L17 10 L10 18 L3 10 Z" />
            <circle cx="10" cy="10" r="3.6" />
          </g>
        </svg>
      </div>
      {label && <div className="rune-label">{label}</div>}
    </div>
  );
}
