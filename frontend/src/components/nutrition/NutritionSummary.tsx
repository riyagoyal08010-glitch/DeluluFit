import { Info } from "lucide-react";

import { Badge, Tooltip } from "@/components/ui/Feedback";
import { formatAmount, NUTRIENT_LABELS, TOTAL_STATUS_TEXT } from "@/lib/format";
import type { NutrientKey, Totals } from "@/types/api";

const SHOWN: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g"];

/** Totals with their completeness. Unknown is shown as "—", never as 0. */
export function NutritionSummary({ totals }: { totals: Totals }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SHOWN.map((key) => {
          const t = totals.nutrients[key];
          return (
            <div key={key} className="rounded-control border border-line/70 bg-sheet p-3">
              <dt className="flex items-center justify-between gap-1 text-xs font-medium text-ink-muted">
                {NUTRIENT_LABELS[key]}
                <Tooltip label={`About the ${NUTRIENT_LABELS[key].toLowerCase()} total`}
                         content={`${TOTAL_STATUS_TEXT[t.status]} ${t.known_items} of ${t.known_items + t.missing_items} items have data.`}>
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                </Tooltip>
              </dt>
              <dd className="metric mt-1 text-xl font-semibold text-ink">
                {t.status === "incomplete" && <span className="sr-only">At least </span>}
                {t.status === "incomplete" && <span aria-hidden="true" className="text-ink-muted">≥ </span>}
                {formatAmount(t.display, t.unit)}
              </dd>
              <dd className="mt-1.5">
                {t.status === "incomplete" && <Badge tone="warning">Partial</Badge>}
                {t.status === "unavailable" && <Badge>No data</Badge>}
                {t.status === "complete" && <Badge tone="success">All items</Badge>}
              </dd>
            </div>
          );
        })}
      </dl>
      {totals.note && <p className="mt-3 text-xs text-ink-muted">{totals.note}</p>}
      <p className="mt-2 text-xs text-ink-muted">
        Estimates from reference foods, not lab measurements of your mess's recipes.
      </p>
    </div>
  );
}
