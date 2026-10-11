import { ApiError } from "@/lib/api/client";

/**
 * Readable messages for a failed meal request. For a 422 the backend's
 * per-field messages are listed, with item positions made human ("Item 2: ...").
 */
export function describeMealError(err: unknown): { message: string; details: string[] } {
  if (!(err instanceof ApiError)) return { message: "Something unexpected happened. Please try again.", details: [] };
  const details: string[] = [];
  if (Array.isArray(err.details)) {
    for (const d of err.details as Array<{ loc?: unknown[]; msg?: string }>) {
      if (!d.msg) continue;
      const loc = (d.loc ?? []).filter((p) => p !== "body");
      const itemIndex = loc[0] === "items" && typeof loc[1] === "string" && /^\d+$/.test(loc[1]) ? Number(loc[1]) : null;
      const field = loc.filter((p) => typeof p === "string" && !/^\d+$/.test(p) && p !== "items").join(" ");
      const msg = d.msg.replace(/^Value error, /, "");
      details.push(itemIndex !== null ? `Item ${itemIndex + 1}${field ? ` (${field})` : ""}: ${msg}`
                                      : field ? `${field.replace(/_/g, " ")}: ${msg}` : msg);
    }
  }
  return { message: err.message, details };
}
