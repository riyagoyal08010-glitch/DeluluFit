import { Badge } from "@/components/ui/Feedback";
import { formatAmount, NUTRIENT_LABELS } from "@/lib/format";
import type { NutrientKey, Totals } from "@/types/api";

const ORDER: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g", "sugars_g", "sodium_mg"];

/** Every nutrient total with how complete it is. Unknown stays "—", partial totals are marked "at least". */
export function NutrientTotalsGrid({ totals }: { totals: Totals }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {ORDER.map((k) => {
        const t = totals.nutrients[k];
        const items = t.known_items + t.missing_items;
        return (
          <div key={k} className="rounded-control border border-line/70 bg-sheet p-3">
            <dt className="text-xs font-medium text-ink-muted">{NUTRIENT_LABELS[k]}</dt>
            <dd className="metric mt-1 text-lg font-semibold text-ink">
              {t.status === "incomplete" && <span className="sr-only">At least </span>}
              {t.status === "incomplete" && <span aria-hidden="true" className="text-ink-muted">≥ </span>}
              {t.status === "complete" || t.status === "incomplete"
                ? formatAmount(t.display, t.unit)
                : <span className="text-base font-normal text-ink-muted">—</span>}
            </dd>
            <dd className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
              {t.status === "complete" && <Badge tone="success">All items</Badge>}
              {t.status === "incomplete" && <Badge tone="warning">Partial</Badge>}
              {t.status === "unavailable" && <Badge>No data</Badge>}
              {t.status === "empty" && <Badge>Nothing logged</Badge>}
              {items > 0 && t.status !== "complete" && <span>{t.known_items} of {items} items</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
