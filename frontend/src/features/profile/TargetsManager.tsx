import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Target } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { targetsApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import { formatAmount, formatLongDate, localIsoDate, NUTRIENT_LABELS } from "@/lib/format";
import type { NutritionTarget, TargetInput } from "@/types/api";

import { TARGET_SOURCE_LABELS } from "./options";
import { targetSchema, type TargetFormValues } from "./schemas";
import { apiMessage, applyFieldErrors, SavedNotice } from "./shared";

const NUTRIENTS = [
  { key: "energy_kcal", field: "energyKcal", unit: "kcal", hint: "500–8000" },
  { key: "protein_g", field: "proteinG", unit: "g", hint: "0–500" },
  { key: "carbohydrate_g", field: "carbohydrateG", unit: "g", hint: "0–1500" },
  { key: "fat_g", field: "fatG", unit: "g", hint: "0–400" },
  { key: "fibre_g", field: "fibreG", unit: "g", hint: "0–150" },
] as const;

const trim = (v: string | null) => (v === null ? "" : String(Number(v)));

function toForm(t: NutritionTarget | null): TargetFormValues {
  return {
    source: t && t.source !== "reference_estimate" ? t.source : "self_set",
    energyKcal: trim(t?.energy_kcal ?? null), proteinG: trim(t?.protein_g ?? null),
    carbohydrateG: trim(t?.carbohydrate_g ?? null), fatG: trim(t?.fat_g ?? null), fibreG: trim(t?.fibre_g ?? null),
    effectiveFrom: "", notes: t?.notes ?? "",
  };
}

function TargetValues({ t }: { t: NutritionTarget }) {
  const rows = NUTRIENTS.filter((n) => t[n.key] !== null);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-5">
      {rows.map((n) => (
        <div key={n.key}>
          <dt className="text-xs text-ink-muted">{NUTRIENT_LABELS[n.key]}</dt>
          <dd className="metric font-medium">{formatAmount(trim(t[n.key]), n.unit)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Daily nutrition targets via GET /targets, PUT /targets/active and DELETE /targets/active.
 * Targets are the student's own numbers; DeluluFit never suggests one or judges progress against it.
 */
export function TargetsManager({ onEditingChange }: { onEditingChange?: (editing: boolean) => void } = {}) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: liveKeys.targets, queryFn: ({ signal }) => targetsApi.list(signal) });
  const [editing, setEditing] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => onEditingChange?.(editing), [editing, onEditingChange]);
  const active = list.data?.find((t) => t.effective_to === null) ?? null;
  const past = list.data?.filter((t) => t.effective_to !== null) ?? [];

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: liveKeys.targets }),   // Nutrition page target comparison
    queryClient.invalidateQueries({ queryKey: liveKeys.profile }),   // profile bundle's active_target
  ]);
  const end = useMutation({
    mutationFn: targetsApi.endActive,
    onSuccess: async () => { setConfirmEnd(false); setNotice("Target ended."); await refresh(); },
  });

  return (
    <Card aria-labelledby="targets-title" id="targets" surface="solid">
      <CardHeader id="targets-title" title="Nutrition targets"
                  description="Optional daily amounts you choose. They're shown next to your logged estimates on the Nutrition page." />
      <div className="space-y-4">
        {notice && <SavedNotice>{notice}</SavedNotice>}
        {list.isPending ? <Skeleton className="h-20 w-full" />
          : list.isError ? <ErrorState message={apiMessage(list.error)} onRetry={() => list.refetch()} />
          : editing ? (
            <TargetForm active={active} onCancel={() => setEditing(false)}
                        onSaved={async (t) => {
                          setEditing(false);
                          setNotice(`Target saved, starting ${formatLongDate(t.effective_from)}.`);
                          await refresh();
                        }} />
          ) : (
            <>
              {active ? (
                <div className="space-y-2 rounded-control border border-line/70 bg-sheet p-4">
                  <p className="text-sm font-medium">{TARGET_SOURCE_LABELS[active.source]}</p>
                  <p className="text-xs text-ink-muted">
                    {active.effective_from > localIsoDate() ? "Starts" : "In effect since"} {formatLongDate(active.effective_from)}
                  </p>
                  <TargetValues t={active} />
                  {active.notes && <p className="text-xs text-ink-muted">Note: {active.notes}</p>}
                </div>
              ) : (
                <EmptyState icon={Target} title="No target set">
                  Targets are optional. DeluluFit doesn't pick one for you.
                </EmptyState>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { setNotice(null); setEditing(true); }}>{active ? "Change target" : "Set a target"}</Button>
                {active && <Button variant="secondary" onClick={() => setConfirmEnd(true)}>End target</Button>}
              </div>
              {past.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-ink-muted hover:text-ink">Past targets ({past.length})</summary>
                  <ul className="mt-2 space-y-3">
                    {past.map((t) => (
                      <li key={t.id} className="space-y-1">
                        <p className="text-xs text-ink-muted">
                          {TARGET_SOURCE_LABELS[t.source]} · {formatLongDate(t.effective_from)} – {formatLongDate(t.effective_to!)}
                        </p>
                        <TargetValues t={t} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
      </div>

      <Dialog open={confirmEnd} onClose={() => { end.reset(); setConfirmEnd(false); }} title="End this target?"
              description="If it started before today, it ends yesterday and stays in your past targets. If it started today or later, it is removed. Your logged meals aren't affected."
              footer={<>
                <Button variant="ghost" onClick={() => setConfirmEnd(false)} disabled={end.isPending}>Keep target</Button>
                <Button variant="danger" loading={end.isPending} onClick={() => end.mutate()}>End target</Button>
              </>}>
        {end.isError && <ErrorState title="Couldn't end the target" message={apiMessage(end.error)} />}
      </Dialog>
    </Card>
  );
}

const FIELD_MAP = { energy_kcal: "energyKcal", protein_g: "proteinG", carbohydrate_g: "carbohydrateG", fat_g: "fatG",
                    fibre_g: "fibreG", effective_from: "effectiveFrom", notes: "notes", source: "source" } as const;

function TargetForm({ active, onCancel, onSaved }:
  { active: NutritionTarget | null; onCancel: () => void; onSaved: (t: NutritionTarget) => Promise<void> }) {
  const { register, handleSubmit, setError, watch, formState: { errors } } =
    useForm<TargetFormValues>({ resolver: zodResolver(targetSchema), defaultValues: toForm(active) });
  const save = useMutation({
    mutationFn: (body: TargetInput) => targetsApi.setActive(body),
    onSuccess: onSaved,
    onError: (err) => { applyFieldErrors(err, setError, FIELD_MAP); },
  });
  const startTooEarly = (start: string) => active !== null && start !== "" && start < active.effective_from;

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return;
    if (startTooEarly(v.effectiveFrom)) {
      setError("effectiveFrom", { message: `Can't start before your current target started (${formatLongDate(active!.effective_from)}).` });
      return;
    }
    const n = (s: string) => (s.trim() === "" ? null : s.trim());
    save.mutate({ source: v.source, energy_kcal: n(v.energyKcal), protein_g: n(v.proteinG), carbohydrate_g: n(v.carbohydrateG),
                  fat_g: n(v.fatG), fibre_g: n(v.fibreG), effective_from: v.effectiveFrom || null, notes: v.notes.trim() || null });
  });
  const source = watch("source");

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Nutrition target">
      <Select label="Where does this target come from?" {...register("source")}
              options={[{ value: "self_set", label: TARGET_SOURCE_LABELS.self_set },
                        { value: "professional", label: "A professional (doctor, dietitian) gave it to me" }]}
              hint={source === "professional"
                ? "Stored as you enter it. DeluluFit can't verify it and doesn't treat it as a prescription."
                : "A number you chose yourself."} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Daily amounts <span className="font-normal text-ink-muted">(fill in at least one)</span></legend>
        <div className="grid gap-3 sm:grid-cols-5">
          {NUTRIENTS.map((x) => (
            <Input key={x.key} label={`${NUTRIENT_LABELS[x.key]} (${x.unit})`} optional inputMode="decimal" autoComplete="off"
                   hint={x.hint} error={errors[x.field]?.message} {...register(x.field)} />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Starts" type="date" optional hint="Leave empty to start today." error={errors.effectiveFrom?.message}
               {...register("effectiveFrom")} />
        <Input label="Note" optional maxLength={300} error={errors.notes?.message} {...register("notes")} />
      </div>
      <p className="text-xs text-ink-muted">
        {active
          ? "Your current target stays until the day before the new one starts, then moves to past targets. Starting on the same day replaces it."
          : "Sugars and sodium targets aren't supported."}
      </p>
      {save.isError && <ErrorState title="Couldn't save the target" message={`${apiMessage(save.error)} Your entries are still here.`} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={save.isPending}>Cancel</Button>
        <Button type="submit" loading={save.isPending}>Save target</Button>
      </div>
    </form>
  );
}
