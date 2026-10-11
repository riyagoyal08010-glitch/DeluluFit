import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useState, type FormEvent } from "react";

import { NutrientList } from "@/components/nutrition/NutrientList";
import { Button } from "@/components/ui/Button";
import { Badge, ErrorState, LoadingState, Skeleton } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";
import { foodsApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import type { ItemPreview, Unit } from "@/types/api";

import { checkQuantity, UNIT_LABELS, useDebouncedValue } from "./portion";

export interface Portion {
  quantity: string;
  unit: Unit;
  servingId: string | null;
}

const CONFIDENCE_TEXT: Record<string, string> = {
  HIGH: "Higher confidence", MEDIUM: "Medium confidence", LOW: "Low confidence",
};

const REASON_TEXT: Record<string, string> = {
  serving_not_selected: "Choose a serving size to see an estimate.",
  no_volume_reference: "This food has no volume reference, so millilitres can't be converted. Use grams or servings.",
  no_reference_data: "This food has no nutrient data in the reference dataset.",
};

function PreviewPanel({ preview }: { preview: ItemPreview }) {
  if (preview.method === "unavailable") {
    return (
      <p className="flex items-start gap-2 rounded-control border border-line/30 bg-canvas/40 p-3 text-sm text-ink-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {REASON_TEXT[preview.reason ?? ""] ?? "An estimate isn't available for this portion."}
      </p>
    );
  }
  const partial = Object.values(preview.nutrients).some((n) => n.status !== "estimated");
  return (
    <div className="space-y-3 rounded-control border border-line/30 bg-canvas/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>About {Number(preview.estimated_mass_g)} g · estimate, not a measurement</span>
        {/* Confidence combines how well the food matches and how the portion was given (grams vs. a typical serving). */}
        <Badge tone={preview.confidence === "HIGH" ? "success" : "neutral"}>
          {CONFIDENCE_TEXT[preview.confidence] ?? "Unknown confidence"}
        </Badge>
      </div>
      <NutrientList nutrients={preview.nutrients} />
      {partial && <p className="text-xs text-ink-muted">Some nutrients aren't in the dataset for this food; they are left out rather than counted as zero.</p>}
      {preview.provenance.dataset_version && (
        <p className="text-xs text-ink-muted">
          Source: {preview.provenance.source_name} ({preview.provenance.dataset_version})
          {preview.provenance.source_reference ? ` · ${preview.provenance.source_reference}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * Choose an amount of a selected food. The estimate shown is computed by the
 * backend (GET /foods/{id}/estimate) with the same rules used when saving.
 */
export function PortionEditor({ foodId, initial, submitLabel, onSubmit, onCancel, busy = false, serverError }:
  { foodId: string; initial?: Portion; submitLabel: string; onSubmit: (portion: Portion) => void;
    onCancel: () => void; busy?: boolean; serverError?: string | null }) {
  const detail = useQuery({ queryKey: liveKeys.food(foodId), queryFn: ({ signal }) => foodsApi.detail(foodId, signal),
                            staleTime: 5 * 60_000 });
  const [quantity, setQuantity] = useState(initial?.quantity ?? "");
  const [unit, setUnit] = useState<Unit | null>(initial?.unit ?? null);
  const [servingId, setServingId] = useState<string | null>(initial?.servingId ?? null);
  const [submitted, setSubmitted] = useState(false);

  const food = detail.data;
  const chosenUnit: Unit = unit ?? (food && food.servings.length > 0 ? "serving" : "g");
  const check = checkQuantity(quantity);
  const servingMissing = chosenUnit === "serving" && !servingId;
  const ready = check.ok && !servingMissing;
  const portion = useDebouncedValue(ready && check.ok ? `${check.value}|${chosenUnit}|${servingId ?? ""}` : "", 250);
  const [pq, pu, ps] = portion.split("|");
  const preview = useQuery({
    queryKey: liveKeys.estimate(foodId, pq ?? "", pu ?? "", ps || null),
    queryFn: ({ signal }) => foodsApi.estimate(foodId, { quantity: pq!, unit: pu as Unit, servingId: ps || null }, signal),
    enabled: portion !== "",
    staleTime: 60_000,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!check.ok || servingMissing || busy) return;
    onSubmit({ quantity: check.value, unit: chosenUnit, servingId: chosenUnit === "serving" ? servingId : null });
  }

  if (detail.isPending) return <div className="space-y-3" aria-hidden="true"><Skeleton className="h-6 w-1/2" /><Skeleton className="h-11" /></div>;
  if (detail.isError) {
    return <ErrorState title="Couldn't load this food"
                       message={detail.error instanceof ApiError ? detail.error.message : "Please try again."}
                       onRetry={() => detail.refetch()} />;
  }
  const f = detail.data;
  const units = f.supported_units.filter((u) => u !== "serving" || f.servings.length > 0);

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={`Portion of ${f.canonical_name}`}>
      <div>
        <h3 className="text-base font-semibold">{f.canonical_name}</h3>
        {f.preparation_notes && <p className="text-xs text-ink-muted">{f.preparation_notes}</p>}
        {f.known_allergens.length > 0 && (
          <p className="mt-1 text-xs text-warning">
            The reference recipe contains {f.known_allergens.map((a) => a.replace("_", " ")).join(", ")}. Your mess's
            version may differ, so check the ingredients if this matters to you.
          </p>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <Input label="Amount" inputMode="decimal" autoComplete="off" value={quantity}
               onChange={(e) => setQuantity(e.target.value)}
               error={(submitted || quantity !== "") && !check.ok ? check.error : undefined} />
        <Select label="Unit" value={chosenUnit} onChange={(e) => { setUnit(e.target.value as Unit); }}
                options={units.map((u) => ({ value: u, label: UNIT_LABELS[u] }))} />
      </div>
      {chosenUnit === "serving" && (
        <Select label="Serving size" value={servingId ?? ""} onChange={(e) => setServingId(e.target.value || null)}
                error={submitted && servingMissing ? "Choose a serving size." : undefined}
                hint="Sizes come from the reference dataset; pick the closest."
                options={[{ value: "", label: "Choose a serving…" },
                          ...f.servings.map((s) => ({ value: s.id, label: `${s.label} (${Number(s.mass_g)} g)` }))]} />
      )}

      <section aria-label="Estimate" aria-live="polite">
        {!ready ? (
          <p className="text-sm text-ink-muted">Enter an amount{chosenUnit === "serving" ? " and serving size" : ""} to see an estimate.</p>
        ) : preview.isError ? (
          <ErrorState title="Couldn't calculate an estimate"
                      message={preview.error instanceof ApiError ? preview.error.message : "Please try again."}
                      onRetry={() => preview.refetch()} />
        ) : preview.isPending || portion === "" ? (
          <LoadingState label="Calculating estimate" />
        ) : (
          <PreviewPanel preview={preview.data} />
        )}
      </section>

      <p className="text-xs text-ink-muted">{f.caveat}</p>
      {serverError && <ErrorState title="Couldn't save" message={serverError} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
