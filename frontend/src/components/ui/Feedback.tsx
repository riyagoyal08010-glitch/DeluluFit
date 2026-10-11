import { AlertTriangle, Loader2, type LucideIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Button } from "./Button";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-muted text-ink-muted border-line",
  accent: "bg-accent-tint text-accent-strong border-accent/25",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  info: "bg-info/10 text-info border-info/30",
};

/** Small status label. Always carries text, so meaning never depends on colour alone. */
export function Badge({ tone = "neutral", icon: Icon, children, className }:
  { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        tones[tone], className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Tooltip on hover and keyboard focus. The trigger is a real button so it is
 * reachable by keyboard and touch; the tip is linked with aria-describedby.
 */
export function Tooltip({ label, content, children }: { label: string; content: ReactNode; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" aria-label={label} aria-describedby={open ? id : undefined}
              onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
              onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
              onClick={() => setOpen((v) => !v)}
              onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
              className="inline-flex rounded-full text-ink-muted hover:text-ink focus-visible:shadow-focus">
        {children}
      </button>
      {open && (
        <span id={id} role="tooltip"
              className="glass-elevated absolute bottom-full left-1/2 z-40 mb-2 w-64 -translate-x-1/2 rounded-control
                         px-3 py-2 text-xs leading-snug text-ink">
          {content}
        </span>
      )}
    </span>
  );
}

export function Progress({ value, max = 1, label, tone = "accent" }:
  { value: number; max?: number; label: string; tone?: "accent" | "warning" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
         aria-valuenow={Math.round(pct)} className="h-2 w-full overflow-hidden rounded-full bg-sheet ring-1 ring-inset ring-line">
      <div className={cn("h-full rounded-full transition-[width] duration-500",
                         tone === "warning" ? "bg-warning" : "bg-action")}
           style={{ width: `${pct}%` }} />
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-8 text-sm text-ink-muted">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      {label}…
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-control bg-surface-raised", className)} />;
}

export function EmptyState({ icon: Icon, title, children, action }:
  { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-4 py-8 text-center">
      <div className="mb-3 rounded-full border border-line p-3.5">
        <Icon className="h-6 w-6 text-accent" aria-hidden="true" />
      </div>
      <h3 className="text-xl font-light tracking-[-0.015em]">{title}</h3>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }:
  { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-danger/25
                                 bg-danger/5 p-4 shadow-card sm:flex-row sm:items-center">
      <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{message}</p>
      </div>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function PageHeader({ title, description, actions }:
  { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 border-b border-line pb-8 sm:mb-12 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[2.25rem] leading-[1.02] tracking-[-0.03em] sm:text-[3.25rem]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-ink-muted sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
