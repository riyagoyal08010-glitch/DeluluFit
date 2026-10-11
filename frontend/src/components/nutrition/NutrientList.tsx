import { formatAmount, NUTRIENT_LABELS } from "@/lib/format";
import type { ItemNutrientStatus, NutrientKey, NutrientValue } from "@/types/api";

const ORDER: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g", "sugars_g", "sodium_mg"];

const STATUS_TEXT: Record<Exclude<ItemNutrientStatus, "estimated">, string> = {
  unknown: "Unknown",
  not_in_source: "Not in dataset",
  no_estimate: "No estimate",
};

/** One item's nutrients as returned by the API. Missing values say why; they are never shown as 0. */
export function NutrientList({ nutrients, compact = false }:
  { nutrients: Record<NutrientKey, NutrientValue>; compact?: boolean }) {
  const keys = compact ? ORDER.slice(0, 4) : ORDER;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
      {keys.map((k) => {
        const n = nutrients[k];
        return (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-ink-muted">{NUTRIENT_LABELS[k]}</dt>
            <dd className="metric font-medium text-ink">
              {n.status === "estimated" ? formatAmount(n.display, n.unit)
                : <span className="font-normal text-ink-muted">{STATUS_TEXT[n.status]}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
