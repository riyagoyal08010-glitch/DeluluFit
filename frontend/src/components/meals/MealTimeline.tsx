import { Badge } from "@/components/ui/Feedback";
import { formatAmount, formatTime, MEAL_LABELS } from "@/lib/format";
import type { Meal } from "@/types/api";

/** `timeZone` is the profile timezone, so times match the dates the server grouped meals by. */
export function MealTimeline({ meals, timeZone }: { meals: Meal[]; timeZone?: string }) {
  return (
    <ol className="relative space-y-4 border-l border-line/40 pl-5">
      {meals.map((meal) => {
        const energy = meal.totals.nutrients.energy_kcal;
        return (
          <li key={meal.id} className="relative">
            <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {MEAL_LABELS[meal.meal_type]} <span className="font-normal text-ink-muted">· {formatTime(meal.consumed_at, timeZone)}</span>
              </h3>
              <span className="metric text-sm text-ink-muted">
                {energy.status === "incomplete" ? "≥ " : ""}{formatAmount(energy.display, energy.unit)}
              </span>
            </div>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {meal.items.map((it) => (
                <li key={it.id}>
                  <Badge tone={it.is_manual ? "neutral" : "info"}>
                    {it.display_name}{it.is_manual ? " · no data" : ""}
                  </Badge>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ol>
  );
}
