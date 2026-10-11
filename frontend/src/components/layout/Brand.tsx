export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden="true">
        <rect width="64" height="64" rx="18" className="fill-action" />
        <path d="M12 30h40a20 18 0 0 1-40 0z" className="fill-white/90" />
        <path d="M19 37c4 3 8 3 13 0s9-3 13 0" fill="none" className="stroke-accent-soft" strokeWidth="3" strokeLinecap="round" />
        <ellipse cx="32" cy="30" rx="20" ry="4.5" className="fill-accent-light" />
      </svg>
      {compact ? <span className="sr-only">DeluluFit</span>
        : <span className="font-display text-base font-semibold tracking-[-0.01em] text-heading">DeluluFit</span>}
    </span>
  );
}
