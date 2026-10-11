import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import type { Unit } from "@/types/api";

import { checkQuantity, UNIT_LABELS } from "./portion";

export interface ManualItem {
  name: string;
  quantity: string;
  unit: Unit;
}

/** A dish that isn't in the food list. It is saved by name; its nutrition stays unknown. */
export function ManualItemForm({ initial, submitLabel, onSubmit, onCancel, busy = false, serverError }:
  { initial: ManualItem; submitLabel: string; onSubmit: (item: ManualItem) => void; onCancel: () => void;
    busy?: boolean; serverError?: string | null }) {
  const [name, setName] = useState(initial.name);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [unit, setUnit] = useState<Unit>(initial.unit);
  const [submitted, setSubmitted] = useState(false);
  const check = checkQuantity(quantity);
  const cleanName = name.trim().replace(/\s+/g, " ");

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!cleanName || cleanName.length > 160 || !check.ok || busy) return;
    onSubmit({ name: cleanName, quantity: check.value, unit });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Food not in the list">
      <p className="rounded-control border border-line/30 bg-canvas/40 p-3 text-sm text-ink-muted">
        This dish isn't in the food list, so DeluluFit can't estimate its nutrition. It will be saved by name and
        shown as “no data” in your totals rather than counted as zero.
      </p>
      <Input label="Food name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)}
             error={submitted && !cleanName ? "Enter the food's name." : undefined} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Amount" inputMode="decimal" autoComplete="off" value={quantity}
               onChange={(e) => setQuantity(e.target.value)}
               error={(submitted || quantity !== "") && !check.ok ? check.error : undefined} />
        <Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}
                options={(["serving", "g", "ml"] as Unit[]).map((u) => ({ value: u, label: UNIT_LABELS[u] }))} />
      </div>
      {serverError && <ErrorState title="Couldn't save" message={serverError} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>{submitLabel}</Button>
      </div>
    </form>
  );
}
