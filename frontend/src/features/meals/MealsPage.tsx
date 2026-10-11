import { useSearchParams } from "react-router-dom";

import { DemoTag } from "@/components/layout/DemoTag";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, PageHeader } from "@/components/ui/Feedback";
import { useDataMode } from "@/features/auth/session";
import { cn } from "@/lib/cn";
import { formatAmount, formatTime, localIsoDate, MEAL_LABELS } from "@/lib/format";
import { demoDay } from "@/mocks/demoData";

import { MealComposer } from "./MealComposer";
import { MealHistory } from "./MealHistory";

type View = "log" | "history";

export function MealsPage() {
  const isDemo = useDataMode() === "demo";
  return (
    <>
      <PageHeader title="Meals" description="Log what you actually ate. A planned menu isn't counted until you log it." />
      {isDemo ? <DemoMeals /> : <LiveMeals />}
    </>
  );
}

/** Real account: log meals and browse history through the API. View and date live in the URL. */
function LiveMeals() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "history" ? "history" : "log";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : localIsoDate();
  const go = (next: View, nextDate = date) =>
    setParams(next === "history" ? { view: "history", date: nextDate } : {}, { replace: next === view });

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Meals view" className="inline-flex rounded-control border border-line/40 bg-surface p-1">
        {(["log", "history"] as View[]).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => go(v)}
                  className={cn("min-h-[40px] rounded-[0.6rem] px-4 text-sm font-medium transition-colors",
                                view === v ? "bg-surface-raised text-ink" : "text-ink-muted hover:text-ink")}>
            {v === "log" ? "Log a meal" : "History"}
          </button>
        ))}
      </div>
      {view === "log"
        ? <MealComposer onViewHistory={(d) => go("history", d)} />
        : <MealHistory date={date} onDateChange={(d) => go("history", d)} />}
    </div>
  );
}

function DemoMeals() {
  const day = demoDay(localIsoDate());
  return (
    <div className="space-y-4">
      {day.meals.map((meal) => (
        <Card key={meal.id} aria-labelledby={`${meal.id}-title`}>
          <CardHeader id={`${meal.id}-title`}
                      title={<span className="flex items-center gap-2">{MEAL_LABELS[meal.meal_type]}<DemoTag /></span>}
                      description={formatTime(meal.consumed_at, "Asia/Kolkata")} />
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Items in {MEAL_LABELS[meal.meal_type]} (demo data)</caption>
              <thead className="text-xs text-ink-muted">
                <tr><th className="px-2 py-2 font-medium">Food</th><th className="px-2 py-2 font-medium">Portion</th>
                  <th className="px-2 py-2 text-right font-medium">Energy</th><th className="px-2 py-2 text-right font-medium">Protein</th></tr>
              </thead>
              <tbody className="divide-y divide-line/30">
                {meal.items.map((it) => {
                  const n = it.estimate?.nutrients;
                  return (
                    <tr key={it.id}>
                      <td className="px-2 py-2.5">
                        <span className="text-ink">{it.display_name}</span>
                        {it.is_manual && <Badge className="ml-2">Not in food list</Badge>}
                      </td>
                      <td className="px-2 py-2.5 text-ink-muted">
                        {it.serving ? `${it.quantity} × ${it.serving.label}` : `${it.quantity} ${it.unit}`}
                      </td>
                      <td className="metric px-2 py-2.5 text-right">{formatAmount(n?.energy_kcal.display ?? null, "kcal")}</td>
                      <td className="metric px-2 py-2.5 text-right">{formatAmount(n?.protein_g.display ?? null, "g")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {meal.totals.note && <p className="mt-3 text-xs text-ink-muted">{meal.totals.note}</p>}
        </Card>
      ))}
      <p className="text-xs text-ink-muted">Sample meals; amounts computed from USDA FNDDS reference values (2024-10-31).</p>
    </div>
  );
}
