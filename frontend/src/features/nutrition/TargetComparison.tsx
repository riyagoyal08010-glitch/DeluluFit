import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { ApiError } from "@/lib/api/client";
import { targetsApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import { formatAmount, formatLongDate, NUTRIENT_LABELS } from "@/lib/format";
import type { Totals } from "@/types/api";

import { TARGET_NUTRIENTS, TARGET_SOURCE_TEXT, targetOn } from "./analytics";

const UNIT: Record<string, string> = { energy_kcal: "kcal", protein_g: "g", carbohydrate_g: "g", fat_g: "g", fibre_g: "g" };

/**
 * Shows the student's own target (if any) for one day next to that day's
 * recorded estimate. Targets are daily amounts; they are never scaled to
 * longer periods, and no judgement is made about meeting them.
 */
export function TargetComparison({ date, totals }: { date: string; totals: Totals }) {
  const targets = useQuery({ queryKey: liveKeys.targets, queryFn: ({ signal }) => targetsApi.list(signal) });

  return (
    <Card aria-labelledby="target-title">
      <CardHeader id="target-title" title="Your targets"
                  description="Compared with what you logged on this day. Estimates are approximate." />
      {targets.isPending ? <Skeleton className="h-16 w-full" />
        : targets.isError ? <ErrorState message={targets.error instanceof ApiError ? targets.error.message : "Please try again."}
                                        onRetry={() => targets.refetch()} />
        : (() => {
            const target = targetOn(targets.data, date);
            if (!target) {
              return (
                <EmptyState icon={Target} title="No target set for this day">
                  Targets are optional. Setting one in the app isn't available yet; DeluluFit never picks one for you.
                </EmptyState>
              );
            }
            const rows = TARGET_NUTRIENTS.filter((k) => target[k] !== null);
            return (
              <div className="space-y-3">
                <p className="text-sm text-ink-muted">
                  {TARGET_SOURCE_TEXT[target.source]} · in effect from {formatLongDate(target.effective_from)}
                  {target.effective_to ? ` to ${formatLongDate(target.effective_to)}` : ""}
                </p>
                <ul className="divide-y divide-line/30">
                  {rows.map((k) => {
                    const t = totals.nutrients[k];
                    const known = t.status === "complete" || t.status === "incomplete";
                    return (
                      <li key={k} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                        <span className="font-medium">{NUTRIENT_LABELS[k]}</span>
                        <span className="metric text-ink-muted">
                          Recorded{" "}
                          <span className="text-ink">
                            {known ? `${t.status === "incomplete" ? "≥ " : ""}${formatAmount(t.display, t.unit)}` : "no data"}
                          </span>
                          {" · "}target <span className="text-ink">{formatAmount(target[k], UNIT[k]!)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {target.notes && <p className="text-xs text-ink-muted">Your note: {target.notes}</p>}
                <p className="text-xs text-ink-muted">
                  Partial totals are lower bounds, and estimates come from reference foods rather than your mess's recipes.
                  This is for general awareness, not medical advice.
                </p>
              </div>
            );
          })()}
    </Card>
  );
}
