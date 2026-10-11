import { useId } from "react";

/**
 * Compact brand mark, derived from the DeluluFit logo (src/assets/brand/delulu-logo.webp) for
 * sizes where the full lockup can't be read: the logo's dark ground, four tilted letter stems
 * in its sky → indigo → lavender gradient, and the frosted plate with bracket corners. The full
 * logo is used wherever it's shown large (BrandLogo).
 */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#95B5E5" />
          <stop offset="0.48" stopColor="#3B4872" />
          <stop offset="1" stopColor="#A09FC7" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="#28282A" />
      <g fill={`url(#${id}-g)`}>
        <rect x="9" y="8" width="8" height="42" transform="rotate(-5 13 29)" />
        <rect x="22" y="13" width="8" height="44" transform="rotate(3 26 35)" />
        <rect x="35" y="7" width="8" height="46" transform="rotate(-3 39 30)" />
        <rect x="48" y="11" width="8" height="40" transform="rotate(4 52 31)" />
      </g>
      <rect x="5" y="23" width="54" height="18" fill="#FFFFFF" fillOpacity="0.22" stroke="#FFFFFF" strokeOpacity="0.35" />
      <path d="M8 29v-3h3M56 29v-3h-3M8 35v3h3M56 35v3h-3" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark />
      {compact ? <span className="sr-only">DeluluFit</span>
        : <span className="text-lg font-normal tracking-[-0.01em] text-heading">DeluluFit</span>}
    </span>
  );
}
