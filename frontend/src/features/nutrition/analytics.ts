/**
 * Shapes API data for display. Values are taken as the server sent them
 * (already rounded for display); nothing here calculates nutrition. A day with
 * no known value becomes a gap (null), never a zero.
 */
import type { DayTotals, NutrientKey, NutritionTarget, TotalStatus } from "@/types/api";

export interface TrendPoint {
  date: string;
  label: string;
  /** Plotted height; null leaves a gap for days with nothing known. */
  value: number | null;
  display: string | null;
  status: TotalStatus;
  unit: string;
  mealCount: number;
  knownItems: number;
  missingItems: number;
}

export function shortDate(isoDate: string, withWeekday: boolean): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", withWeekday ? { weekday: "short", day: "numeric", timeZone: "UTC" }
                                                   : { day: "numeric", month: "short", timeZone: "UTC" });
}

export function buildTrend(days: DayTotals[], nutrient: NutrientKey): TrendPoint[] {
  const withWeekday = days.length <= 7;
  return days.map((d) => {
    const t = d.totals.nutrients[nutrient];
    const known = (t.status === "complete" || t.status === "incomplete") && t.display !== null;
    return {
      date: d.date, label: shortDate(d.date, withWeekday), value: known ? Number(t.display) : null,
      display: known ? t.display : null, status: t.status, unit: t.unit, mealCount: d.meal_count,
      knownItems: t.known_items, missingItems: t.missing_items,
    };
  });
}

/** True when the chart would show nothing at all (no day has a known value). */
export function hasAnyValue(points: TrendPoint[]): boolean {
  return points.some((p) => p.value !== null);
}

export type TargetNutrient = "energy_kcal" | "protein_g" | "carbohydrate_g" | "fat_g" | "fibre_g";
export const TARGET_NUTRIENTS: TargetNutrient[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g"];

/** The target in effect on a date (ISO date strings compare correctly as text). */
export function targetOn(targets: NutritionTarget[], isoDate: string): NutritionTarget | null {
  return targets.find((t) => t.effective_from <= isoDate && (t.effective_to === null || t.effective_to >= isoDate)) ?? null;
}

export const TARGET_SOURCE_TEXT: Record<NutritionTarget["source"], string> = {
  self_set: "Set by you",
  professional: "From a professional, as you entered it",
  reference_estimate: "General reference estimate (not personalised)",
};
