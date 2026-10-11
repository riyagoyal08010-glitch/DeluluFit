import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Card({ className, raised = false, ...rest }: HTMLAttributes<HTMLElement> & { raised?: boolean }) {
  return (
    <section
      className={cn("rounded-card border border-line/30 p-5 shadow-card sm:p-6",
                    raised ? "bg-surface-raised" : "bg-surface/90", className)}
      {...rest}
    />
  );
}

export function CardHeader({ title, description, action, id }:
  { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
