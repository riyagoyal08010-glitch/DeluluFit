import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "onImage";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,color,box-shadow,transform] " +
  "duration-150 active:scale-[0.98] " +
  "focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 select-none whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "bg-action text-ink-inverse shadow-pill hover:bg-action-strong",
  secondary: "bg-white/85 text-ink border border-white shadow-pill hover:bg-white",
  ghost: "text-ink-muted hover:text-ink hover:bg-white/60",
  danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/15",
  // Over imagery only: dark glass keeps white text ≥ 4.5:1 (see index.css).
  onImage: "glass-dark hover:bg-[rgb(36_55_70/0.72)]",
};
// Every size keeps at least a 40px touch target; md and lg meet 44px.
const sizes: Record<Size, string> = {
  sm: "h-10 px-3 text-sm",
  md: "h-11 px-5 text-sm",
  lg: "h-12 px-7 text-base",
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
