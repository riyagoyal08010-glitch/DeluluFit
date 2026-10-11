export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden="true">
        <rect width="64" height="64" rx="16" className="fill-surface-raised" />
        <path d="M20 18h12a14 14 0 0 1 0 28H20z" fill="none" className="stroke-accent" strokeWidth="6"
              strokeLinejoin="round" />
      </svg>
      {!compact && <span className="font-display text-lg font-semibold tracking-tight text-ink">DeluluFit</span>}
      <span className="sr-only">{compact ? "DeluluFit" : ""}</span>
    </span>
  );
}
