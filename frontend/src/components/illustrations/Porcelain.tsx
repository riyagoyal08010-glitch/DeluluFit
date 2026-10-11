/**
 * Decorative illustrations in a blue-and-white porcelain style, drawn for DeluluFit.
 * Colours come from design-token utility classes so they follow the palette.
 * All are decorative (aria-hidden); never use them to convey information.
 */
import { cn } from "@/lib/cn";

type Props = { className?: string };

/** Shared floral band: a wavy vine with dots, painted on porcelain. */
function Vine({ y, x1, x2 }: { y: number; x1: number; x2: number }) {
  const w = x2 - x1;
  const d = Array.from({ length: 6 }, (_, i) => {
    const x = x1 + (w / 6) * i;
    return `${i === 0 ? `M${x} ${y}` : ""} q ${w / 24} -7 ${w / 12} 0 t ${w / 12} 0`;
  }).join(" ");
  return (
    <g className="stroke-accent-soft" fill="none" strokeWidth="2.2" strokeLinecap="round">
      <path d={d} />
      {Array.from({ length: 6 }, (_, i) => (
        <circle key={i} cx={x1 + (w / 6) * i + w / 12} cy={y - 7} r="2" className="fill-accent-soft" stroke="none" />
      ))}
    </g>
  );
}

/** A porcelain bowl of rice. */
export function BowlIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 240 170" className={cn("h-auto w-full", className)} aria-hidden="true" focusable="false">
      <ellipse cx="120" cy="150" rx="86" ry="10" className="fill-accent/10" />
      <path d="M38 78h164c0 46-36 70-82 70S38 124 38 78z" className="fill-surface stroke-accent" strokeWidth="2.5" />
      <Vine y={108} x1={52} x2={188} />
      <path d="M92 146c8 3 18 4 28 4s20-1 28-4" className="stroke-accent-soft" fill="none" strokeWidth="2" />
      <path d="M48 78c6-26 38-44 72-44s66 18 72 44z" className="fill-sheet stroke-surface-muted" strokeWidth="1.5" />
      {[[78, 62], [96, 52], [118, 47], [140, 52], [160, 62], [106, 66], [130, 64], [86, 72], [150, 72], [120, 58]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y} l7 -2`} className="stroke-surface-muted" strokeWidth="2.4" strokeLinecap="round" />
      ))}
      <ellipse cx="120" cy="78" rx="82" ry="13" className="fill-accent-tint/60 stroke-accent" strokeWidth="2.5" />
      <path d="M50 78c20 8 120 8 140 0" className="fill-sheet" />
    </svg>
  );
}

/** A thali: a plate with katoris and a roti. */
export function ThaliIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 240 180" className={cn("h-auto w-full", className)} aria-hidden="true" focusable="false">
      <ellipse cx="120" cy="104" rx="104" ry="58" className="fill-accent/10" />
      <ellipse cx="120" cy="96" rx="104" ry="58" className="fill-surface stroke-accent" strokeWidth="2.5" />
      <ellipse cx="120" cy="96" rx="90" ry="48" className="stroke-accent-soft" fill="none" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />
      {[[70, 78, "fill-warning/15"], [120, 66, "fill-accent-tint"], [170, 78, "fill-success/15"]].map(([x, y, fill], i) => (
        <g key={i}>
          <ellipse cx={x as number} cy={(y as number) + 4} rx="24" ry="13" className="fill-accent/10" />
          <ellipse cx={x as number} cy={y as number} rx="24" ry="13" className="fill-surface stroke-accent" strokeWidth="2" />
          <ellipse cx={x as number} cy={(y as number) - 1} rx="18" ry="8" className={fill as string} />
        </g>
      ))}
      <ellipse cx="104" cy="120" rx="38" ry="18" className="fill-warning/20 stroke-warning/40" strokeWidth="1.5" />
      <path d="M86 116c6 4 12 4 18 0M100 124c6 4 12 4 18 0" className="stroke-warning/40" fill="none" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M150 112c10-4 22-4 32 2" className="stroke-accent-soft" fill="none" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="166" cy="122" rx="20" ry="9" className="fill-sheet stroke-surface-muted" strokeWidth="1.5" />
    </svg>
  );
}

/** A cup of chai on a saucer. */
export function ChaiIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 170" className={cn("h-auto w-full", className)} aria-hidden="true" focusable="false">
      <path d="M86 34c-6 8 6 12 0 22M104 30c-6 9 6 13 0 24M122 34c-6 8 6 12 0 22" className="stroke-accent-soft"
            fill="none" strokeWidth="2.2" strokeLinecap="round" />
      <ellipse cx="100" cy="142" rx="76" ry="16" className="fill-surface stroke-accent" strokeWidth="2.5" />
      <ellipse cx="100" cy="140" rx="46" ry="8" className="stroke-accent-soft" fill="none" strokeWidth="1.5" />
      <path d="M150 88c18 0 22 26 2 30" className="stroke-accent" fill="none" strokeWidth="2.5" />
      <path d="M50 70h100c0 44-18 70-50 70s-50-26-50-70z" className="fill-surface stroke-accent" strokeWidth="2.5" />
      <Vine y={102} x1={58} x2={142} />
      <ellipse cx="100" cy="70" rx="50" ry="10" className="fill-warning/20 stroke-accent" strokeWidth="2.5" />
    </svg>
  );
}

/** A jar of coins, for budgets. */
export function CoinJarIllustration({ className }: Props) {
  return (
    <svg viewBox="0 0 200 180" className={cn("h-auto w-full", className)} aria-hidden="true" focusable="false">
      <ellipse cx="100" cy="164" rx="60" ry="8" className="fill-accent/10" />
      <rect x="64" y="24" width="72" height="16" rx="6" className="fill-accent-tint stroke-accent" strokeWidth="2.5" />
      <path d="M56 52c0-8 6-12 14-12h60c8 0 14 4 14 12v94c0 10-8 16-18 16H74c-10 0-18-6-18-16z"
            className="fill-surface/70 stroke-accent" strokeWidth="2.5" />
      {[[82, 140], [112, 142], [96, 126], [124, 122], [76, 112], [104, 106]].map(([x, y], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y} rx="14" ry="6" className="fill-warning/20 stroke-warning/50" strokeWidth="1.5" />
        </g>
      ))}
      <Vine y={70} x1={64} x2={136} />
    </svg>
  );
}
