import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { mealsApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import { formatLongDate, formatMoney, formatTime, localIsoDate, MEAL_LABELS } from "@/lib/format";
import type { SpendingCategory, Transaction } from "@/types/api";

import { CATEGORY_LABELS, CATEGORY_OPTIONS, checkAmount } from "./money";

export interface TransactionValues {
  amount: string;
  category: SpendingCategory;
  occurredOn: string;
  description: string | null;
  mealLogId: string | null;
}

type Mode =
  | { kind: "expense" }
  | { kind: "refund"; of: Transaction | null }
  | { kind: "edit"; txn: Transaction };

/** Optional link from an expense to a meal logged on the same day. It connects records; it adds nothing to totals. */
function MealLinkSelect({ date, value, onChange }: { date: string; value: string; onChange: (v: string) => void }) {
  const day = useQuery({ queryKey: liveKeys.mealDay(date), queryFn: ({ signal }) => mealsApi.day(date, signal),
                         enabled: /^\d{4}-\d{2}-\d{2}$/.test(date) });
  const meals = day.data?.meals ?? [];
  return (
    <Select label="Meal (optional)" value={value} onChange={(e) => onChange(e.target.value)}
            hint={day.isError ? "Couldn't load that day's meals; you can still save without a link."
                  : meals.length === 0 ? "No meals logged on this date." : "Linking just connects the two records."}
            disabled={meals.length === 0}
            options={[{ value: "", label: "Not linked to a meal" },
                      ...meals.map((m) => ({ value: m.id,
                        label: `${MEAL_LABELS[m.meal_type]} · ${formatTime(m.consumed_at)}${m.items.length ? ` (${m.items.map((i) => i.display_name).slice(0, 2).join(", ")})` : ""}` }))]} />
  );
}

export function TransactionForm({ mode, currency, busy, error, onSubmit, onCancel }:
  { mode: Mode; currency: string; busy: boolean; error: string | null; onCancel: () => void;
    onSubmit: (values: TransactionValues) => void }) {
  const existing = mode.kind === "edit" ? mode.txn : null;
  const refundOf = mode.kind === "refund" ? mode.of : null;
  const [amount, setAmount] = useState(existing?.amount ?? "");
  const [category, setCategory] = useState<SpendingCategory>(existing?.category ?? refundOf?.category ?? "outside_food");
  const [occurredOn, setOccurredOn] = useState(existing?.occurred_on ?? localIsoDate());
  const [description, setDescription] = useState(existing?.description ?? "");
  const [mealLogId, setMealLogId] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const check = checkAmount(amount);
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(occurredOn);
  const isRefund = mode.kind === "refund" || existing?.kind === "refund";

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!check.ok || !dateValid || busy) return;
    onSubmit({ amount: check.value, category, occurredOn, description: description.trim() || null,
               mealLogId: mode.kind === "expense" && mealLogId ? mealLogId : null });
  }

  const title = mode.kind === "expense" ? "Add an expense" : mode.kind === "refund" ? "Record a refund" : "Edit transaction";
  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label={title}>
      <h3 className="text-base font-semibold">{title}</h3>
      {refundOf && (
        <p className="rounded-control border border-line/70 bg-sheet p-3 text-sm text-ink-muted">
          Refund for “{refundOf.description ?? CATEGORY_LABELS[refundOf.category]}”, {formatMoney(refundOf.amount, refundOf.currency)} on{" "}
          {formatLongDate(refundOf.occurred_on)}. Refunds for an expense can't add up to more than the expense.
        </p>
      )}
      {mode.kind === "refund" && !refundOf && (
        <p className="text-sm text-ink-muted">For money returned to you that isn't tied to one recorded expense, like a mess rebate.</p>
      )}
      {existing && (
        <p className="text-sm text-ink-muted">
          {existing.kind === "refund" ? "Refund" : "Expense"} · type and links can't be changed; delete and re-add it instead.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label={`Amount (${currency})`} inputMode="decimal" autoComplete="off" value={amount}
               onChange={(e) => setAmount(e.target.value)}
               error={(submitted || amount !== "") && !check.ok ? check.error : undefined} />
        <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as SpendingCategory)}
                options={CATEGORY_OPTIONS} />
        <Input label="Date" type="date" value={occurredOn} max={localIsoDate()}
               onChange={(e) => setOccurredOn(e.target.value)}
               error={submitted && !dateValid ? "Choose a date." : undefined} />
      </div>
      <Input label="Note" optional maxLength={200} value={description} placeholder={isRefund ? "e.g. Mess rebate" : "e.g. Samosa at canteen"}
             onChange={(e) => setDescription(e.target.value)} />
      {mode.kind === "expense" && <MealLinkSelect date={occurredOn} value={mealLogId} onChange={setMealLogId} />}
      {error && <ErrorState title="Couldn't save" message={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>{mode.kind === "edit" ? "Save changes" : mode.kind === "refund" ? "Save refund" : "Save expense"}</Button>
      </div>
    </form>
  );
}
