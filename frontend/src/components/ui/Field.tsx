import { AlertCircle, ChevronDown } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const control =
  "w-full rounded-control border bg-canvas/60 px-3.5 text-ink placeholder:text-ink-muted/70 " +
  "transition-colors focus-visible:shadow-focus focus-visible:border-accent/70 disabled:cursor-not-allowed " +
  "disabled:opacity-50";

interface FieldShellProps {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}

/** Label, hint and error message wired to the control with aria attributes. */
function FieldShell({ id, label, hint, error, optional, children }: FieldShellProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-ink">
        {label}
        {optional && <span className="text-xs font-normal text-ink-muted">Optional</span>}
      </label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-ink-muted">{hint}</p>}
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string): string | undefined {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, optional, trailing, id, className, ...rest }, ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <FieldShell id={inputId} label={label} hint={hint} error={error} optional={optional}>
      <div className="relative">
        <input ref={ref} id={inputId} aria-invalid={error ? true : undefined}
               aria-describedby={describedBy(inputId, hint, error)}
               className={cn(control, "h-11", error ? "border-danger/70" : "border-line/50 hover:border-line",
                             trailing ? "pr-12" : undefined, className)}
               {...rest} />
        {trailing && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
    </FieldShell>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
  options: Array<{ value: string; label: string }>;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, id, className, ...rest }, ref,
) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <FieldShell id={selectId} label={label} hint={hint} error={error}>
      <div className="relative">
      <select ref={ref} id={selectId} aria-invalid={error ? true : undefined}
              aria-describedby={describedBy(selectId, hint, error)}
              className={cn(control, "h-11 appearance-none pr-9",
                            error ? "border-danger/70" : "border-line/50 hover:border-line", className)}
              {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
                   aria-hidden="true" />
      </div>
    </FieldShell>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, id, className, ...rest }, ref,
) {
  const auto = useId();
  const boxId = id ?? auto;
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-3">
        <input ref={ref} id={boxId} type="checkbox" aria-invalid={error ? true : undefined}
               aria-describedby={error ? `${boxId}-error` : undefined}
               className={cn("mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded border-line bg-canvas accent-[rgb(var(--color-accent))]",
                             "focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50", className)}
               {...rest} />
        <label htmlFor={boxId} className="cursor-pointer text-sm text-ink-muted">{label}</label>
      </div>
      {error && <p id={`${boxId}-error`} role="alert" className="pl-8 text-xs text-danger">{error}</p>}
    </div>
  );
});
