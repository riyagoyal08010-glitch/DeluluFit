import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "onImage" | "inverse";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-normal transition-[background-color,color,border-color,box-shadow] " +
  "duration-300 ease-glide " +
  "focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 select-none whitespace-nowrap";
const variants: Record<Variant, string> = {
  // Filled black pill: the one solid action on a screen.
  primary: "border border-action bg-action text-ink-inverse hover:bg-action-strong",
  // Ghost pill with a 1px black outline.
  secondary: "border border-ink bg-transparent text-ink hover:bg-surface-raised",
  ghost: "text-ink-muted hover:text-ink hover:bg-surface-raised",
  danger: "border border-danger bg-transparent text-danger hover:bg-danger/5",
  // On black inverse bands: a white-outlined ghost pill.
  onImage: "border border-white/40 bg-transparent text-white hover:border-white hover:bg-white/10",
  // The primary action on a black band: a filled white pill.
  inverse: "border border-white bg-white text-ink hover:bg-white/85",
};
// Every size keeps at least a 40px touch target; md and lg meet 44px.
const sizes: Record<Size, string> = {
  sm: "h-10 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-12 px-8 text-base",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClasses(variant, size, className)} disabled={disabled || loading}
            aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
});

/** A link styled as a button, for navigation actions (keeps correct link semantics). */
export function ButtonLink({ variant = "primary", size = "md", className, icon, children, ...rest }:
  LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
