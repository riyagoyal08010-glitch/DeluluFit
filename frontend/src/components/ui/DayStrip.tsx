import { Link } from "react-router-dom";

import { cn } from "@/lib/cn";
import { localIsoDate, shiftIsoDate } from "@/lib/format";

/**
 * The current week (Monday–Sunday) as capsule links, like the reference's day
 * selector. Each past day or today opens that day's meal history; future days
 * are shown but not links. Dates use this device's calendar (as meal history does).
 */
export function DayStrip({ today = localIsoDate(), hrefFor, label = "This week" }:
  { today?: string; hrefFor: (isoDate: string) => string; label?: string }) {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;   // Monday = 0
  const monday = shiftIsoDate(today, -weekday);
  const days = Array.from({ length: 7 }, (_, i) => shiftIsoDate(monday, i));
  return (
    <nav aria-label={label}>
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {days.map((d) => {
          const date = new Date(`${d}T00:00:00Z`);
          const name = date.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
          const num = date.getUTCDate();
          const full = date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
          const isToday = d === today;
          const body = (
            <>
              <span className="text-xs">{name}</span>
              <span className={cn("metric grid h-8 w-8 place-items-center rounded-full text-sm font-medium",
                                  isToday ? "bg-action text-ink-inverse" : "bg-transparent text-ink ring-1 ring-inset ring-line")}>{num}</span>
            </>
          );
          const base = "flex flex-col items-center gap-1.5 rounded-full px-1 py-2 text-ink-muted";
          return (
            <li key={d}>
              {d > today ? (
                <span className={cn(base, "opacity-60")} aria-label={`${full} (upcoming)`}>{body}</span>
              ) : (
                <Link to={hrefFor(d)} aria-label={`${full}${isToday ? ", today" : ""}: meals`}
                      aria-current={isToday ? "date" : undefined}
                      className={cn(base, "transition-colors hover:bg-surface-raised",
                                    isToday && "bg-accent-tint text-ink ring-1 ring-inset ring-accent-light")}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
