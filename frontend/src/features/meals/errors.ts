import { ApiError } from "@/lib/api/client";

/**
 * What to do after the backend refuses a meal linked to a menu (422 codes from
 * backend/app/services/meal_service.py `_check_menu_links`). The server's own message is kept as the headline.
 */
const MENU_LINK_HINTS: Record<string, string> = {
  menu_unavailable: "The menu this dish came from isn't confirmed any more, or was removed. Confirm it on the Mess menu "
    + "page, or remove the dish and add it again from search to log it without the menu link.",
  menu_item_mismatch: "This dish is no longer on that menu meal. Open Suggestions again and start from the current menu.",
};

/**
 * Readable messages for a failed meal request. For a 422 the backend's
 * per-field messages are listed, with item positions made human ("Item 2: ...").
 */
export function describeMealError(err: unknown): { message: string; details: string[] } {
  if (!(err instanceof ApiError)) return { message: "Something unexpected happened. Please try again.", details: [] };
  const details: string[] = [];
  if (MENU_LINK_HINTS[err.code]) details.push(MENU_LINK_HINTS[err.code]!);
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
