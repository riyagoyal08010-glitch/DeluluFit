import { CheckCircle2 } from "lucide-react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { ApiError } from "@/lib/api/client";

/** A safe, user-facing message: the server's own message for API errors, never internals. */
export function apiMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something unexpected happened. Please try again.";
}

/** Put server field errors on the matching inputs; returns false if none matched. */
export function applyFieldErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>,
                                                        map: Record<string, Path<T>>): boolean {
  if (!(err instanceof ApiError)) return false;
  let applied = false;
  for (const [field, message] of Object.entries(err.fieldErrors())) {
    const target = map[field];
    if (target) {
      setError(target, { message });
      applied = true;
    }
  }
  return applied;
}

export function SavedNotice({ children }: { children: string }) {
  return (
    <p role="status" className="flex items-center gap-2 rounded-control border border-success/30 bg-success/10 p-3 text-sm text-success">
      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{children}
    </p>
  );
}

/** Normalization used only to warn about duplicates before saving (the server does the real de-duplication). */
export function looseKey(value: string): string {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
