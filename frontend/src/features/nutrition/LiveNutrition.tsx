import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, UtensilsCrossed } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { MealTimeline } from "@/components/meals/MealTimeline";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";
import { mealsApi, nutritionApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import { cn } from "@/lib/cn";
import { formatLongDate, localIsoDate, NUTRIENT_LABELS, shiftIsoDate } from "@/lib/format";
import type { DayMeals, NutrientKey } from "@/types/api";

import { buildTrend } from "./analytics";
import { NutrientTotalsGrid } from "./NutrientTotalsGrid";
import { TargetComparison } from "./TargetComparison";
import { DaysTable, TrendChart } from "./TrendChart";

type View = "day" | "7" | "30";
const VIEWS: Array<{ value: View; label: string }> = [
  { value: "day", label: "Day" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" },
];
const CHART_NUTRIENTS: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function message(err: unknown): string {
  return err instanceof ApiError ? err.message : "Please try again.";
}

/**
 * Real-account nutrition history. Dates are the student's profile-timezone dates:
 * when no date is chosen, the server decides what "today" is.
 */
export function LiveNutrition() {
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "7" || params.get("view") === "30" ? (params.get("view") as View) : "day";
  const raw = params.get(view === "day" ? "date" : "end");
  const anchor = raw && ISO_DATE.test(raw) ? raw : null;
  const setView = (v: View) => setParams(v === "day" ? {} : { view: v });
  const setAnchor = (value: string | null) =>
    setParams({ ...(view === "day" ? {} : { view }), ...(value ? { [view === "day" ? "date" : "end"]: value } : {}) });

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Period" className="glass-card inline-flex rounded-full p-1">
        {VIEWS.map((v) => (
          <button key={v.value} type="button" aria-pressed={view === v.value} onClick={() => setView(v.value)}
                  className={cn("min-h-[40px] rounded-full px-4 text-sm font-medium transition-colors",
                                view === v.value ? "bg-action text-ink-inverse shadow-pill" : "text-ink-muted hover:text-ink")}>
            {v.label}
          </button>
        ))}
      </div>
      {view === "day"
        ? <DayAnalytics date={anchor} onDate={setAnchor} />
        : <PeriodAnalytics days={Number(view)} end={anchor} onEnd={setAnchor} />}
      <p className="text-xs text-ink-muted">
        Dates follow the time zone in your profile. Estimates come from public reference foods (USDA FNDDS) and logged
        portions; they won't exactly match your mess's recipes. For general awareness, not medical advice.
      </p>
    </div>
  );
}

function Sources({ day }: { day: DayMeals }) {
  const sources = new Set<string>();
  for (const meal of day.meals) {
    for (const item of meal.items) {
      const p = item.estimate?.provenance;
      if (p?.source_name) sources.add(p.dataset_version ? `${p.source_name} (${p.dataset_version})` : p.source_name);
    }
  }
  const manual = day.meals.flatMap((m) => m.items).filter((i) => i.is_manual).map((i) => i.display_name);
  return (
    <div className="space-y-1 text-xs text-ink-muted">
      {sources.size > 0 && <p>Reference data: {[...sources].join("; ")}.</p>}
      {manual.length > 0 && <p>No nutrition data for: {manual.join(", ")} (not in the food list), so some totals are partial.</p>}
    </div>
  );
}

function DayAnalytics({ date, onDate }: { date: string | null; onDate: (d: string | null) => void }) {
  const day = useQuery({
    // "today" shares the dashboard's cache entry and lets the server pick today in the profile time zone.
    queryKey: liveKeys.mealDay(date ?? "today"),
    queryFn: ({ signal }) => mealsApi.day(date ?? undefined, signal),
  });
  const shown = day.data?.date ?? date;
  const atLatest = date === null || date >= localIsoDate();

  return (
    <>
      <Card aria-labelledby="day-title">
        <CardHeader id="day-title" title={shown ? formatLongDate(shown) : "Today"}
                    description={day.data ? `${day.data.meals.length} meal${day.data.meals.length === 1 ? "" : "s"} logged` : undefined} />
        <div className="mb-5 flex flex-wrap items-end gap-2">
          <Button variant="secondary" size="sm" disabled={!shown} onClick={() => shown && onDate(shiftIsoDate(shown, -1))}
                  icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}>Previous day</Button>
          <div className="w-44">
            <Input label="Date" type="date" value={shown ?? ""} onChange={(e) => e.target.value && onDate(e.target.value)} />
          </div>
          <Button variant="secondary" size="sm" disabled={atLatest || !shown}
                  onClick={() => shown && onDate(shiftIsoDate(shown, 1))}
                  icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}>Next day</Button>
          {date !== null && <Button variant="ghost" size="sm" onClick={() => onDate(null)}>Today</Button>}
        </div>
        {day.isPending ? <LoadingState label="Loading nutrition" />
          : day.isError ? <ErrorState message={message(day.error)} onRetry={() => day.refetch()} />
          : day.data.meals.length === 0
            ? <EmptyState icon={UtensilsCrossed} title="No meals logged on this day"
                          action={<ButtonLink to="/app/meals" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Log a meal</ButtonLink>}>
                Totals appear once you log what you ate.
              </EmptyState>
            : (
              <div className="space-y-4">
                <NutrientTotalsGrid totals={day.data.totals} />
                <Sources day={day.data} />
              </div>
            )}
      </Card>
      {day.data && day.data.meals.length > 0 && (
        <>
          <Card aria-labelledby="by-meal">
            <CardHeader id="by-meal" title="By meal" description="Energy per meal; open Meals to edit." />
            <MealTimeline meals={day.data.meals} />
          </Card>
          <TargetComparison date={day.data.date} totals={day.data.totals} />
        </>
      )}
    </>
  );
}

function PeriodAnalytics({ days, end, onEnd }: { days: number; end: string | null; onEnd: (d: string | null) => void }) {
  const [nutrient, setNutrient] = useState<NutrientKey>("energy_kcal");
  const summary = useQuery({
    queryKey: liveKeys.nutritionSummary(days, end ?? "today"),
    queryFn: ({ signal }) => nutritionApi.summary({ days, end: end ?? undefined }, signal),
  });
  const data = summary.data;
  const atLatest = end === null || end >= localIsoDate();
  const title = NUTRIENT_LABELS[nutrient];
  const points = data ? buildTrend(data.days, nutrient) : [];

  return (
    <>
      <Card aria-labelledby="period-title">
        <CardHeader id="period-title" title={`Last ${days} days`}
                    description={data ? `${formatLongDate(data.start)} – ${formatLongDate(data.end)}` : undefined} />
        <div className="mb-5 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={!data} onClick={() => data && onEnd(shiftIsoDate(data.end, -days))}
                  icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}>Previous {days} days</Button>
          <Button variant="secondary" size="sm" disabled={!data || atLatest}
                  onClick={() => data && onEnd(shiftIsoDate(data.end, days))}
                  icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}>Next {days} days</Button>
          {end !== null && <Button variant="ghost" size="sm" onClick={() => onEnd(null)}>Up to today</Button>}
        </div>
        {summary.isPending ? <LoadingState label="Loading nutrition history" />
          : summary.isError ? <ErrorState message={message(summary.error)} onRetry={() => summary.refetch()} />
          : summary.data.days_with_meals === 0
            ? <EmptyState icon={UtensilsCrossed} title="No meals logged in these days">
                Log meals and this period will show daily totals.
              </EmptyState>
            : (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  Meals logged on {summary.data.days_with_meals} of {summary.data.days.length} days. Totals below add up
                  everything logged in the period; days without logs aren't estimated.
                </p>
                <NutrientTotalsGrid totals={summary.data.totals} />
              </div>
            )}
      </Card>
      {data && data.days_with_meals > 0 && (
        <Card aria-labelledby="trend-title">
          <CardHeader id="trend-title" title="Daily totals"
                      action={<div className="w-44"><Select label="Nutrient" value={nutrient}
                        onChange={(e) => setNutrient(e.target.value as NutrientKey)}
                        options={CHART_NUTRIENTS.map((k) => ({ value: k, label: NUTRIENT_LABELS[k] }))} /></div>} />
          <TrendChart points={points} title={title} />
          <div className="mt-4"><DaysTable points={points} title={title} /></div>
        </Card>
      )}
    </>
  );
}
