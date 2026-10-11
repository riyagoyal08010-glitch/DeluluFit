import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Surfaces (all opaque and lifted, F39):
 *   glass     white with a hairline border and a soft shadow, for most cards (default)
 *   solid     the same, for dense lists and long forms
 *   elevated  a deeper shadow for content that floats above other surfaces
 * `raised` is kept as an alias of `elevated`.
 */
export type Surface = "glass" | "solid" | "elevated";
const SURFACES: Record<Surface, string> = { glass: "glass-card", solid: "surface-solid", elevated: "glass-elevated" };

export function Card({ className, raised = false, surface, ...rest }:
  HTMLAttributes<HTMLElement> & { raised?: boolean; surface?: Surface }) {
  return (
    <section className={cn("rounded-card p-5 sm:p-6", SURFACES[surface ?? (raised ? "elevated" : "glass")], className)} {...rest} />
  );
}

export function CardHeader({ title, description, action, id }:
  { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-medium">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** A section title outside a card, with an optional trailing link ("Explore all" in the reference). */
export function SectionTitle({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
      <h2 id={id} className="text-lg font-medium">{children}</h2>
      {action}
    </div>
  );
}
