import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Wallet } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";
import { budgetApi } from "@/lib/api/endpoints";
import { invalidateBudget, liveKeys } from "@/lib/api/queryKeys";
import { formatLongDate, formatMoney } from "@/lib/format";
import type { Budget, BudgetPeriod } from "@/types/api";

import { checkAmount, PERIOD_LABELS, PERIOD_NOUN, PERIOD_OPTIONS } from "./money";

function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something unexpected happened. Please try again.";
  const fields = Object.values(err.fieldErrors());
  return fields.length ? `${err.message} ${fields.join(" ")}` : err.message;
}

function budgetLine(b: Budget): string {
  return `${formatMoney(b.amount, b.currency)} per ${PERIOD_NOUN[b.period]}`;
}

/** Current budget, a form to set or change it, ending it, and past budgets (GET/PUT/DELETE /budget...). */
export function BudgetSettings({ onEditingChange }: { onEditingChange?: (editing: boolean) => void } = {}) {
  const queryClient = useQueryClient();
  const overview = useQuery({ queryKey: liveKeys.budgetOverview, queryFn: ({ signal }) => budgetApi.overview(signal) });
  const [editing, setEditing] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => onEditingChange?.(editing), [editing, onEditingChange]);

  const save = useMutation({
    mutationFn: budgetApi.setActive,
    onSuccess: async (b) => {
      setEditing(false);
      setNotice(`Budget saved: ${budgetLine(b)}, starting ${formatLongDate(b.effective_from)}.`);
      await invalidateBudget(queryClient);
    },
  });
  const end = useMutation({
    mutationFn: budgetApi.endActive,
    onSuccess: async () => {
      setConfirmEnd(false);
      setNotice("Budget ended.");
      await invalidateBudget(queryClient);
    },
  });

  const active = overview.data?.active ?? null;
  const past = (overview.data?.history ?? []).filter((b) => b.effective_to !== null);

  return (
    <Card aria-labelledby="budget-settings">
      <CardHeader id="budget-settings" title="Your budget"
                  description="One budget at a time. Spending is compared with it only for matching periods." />
      {notice && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-control border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />{notice}
        </p>
      )}
      {overview.isPending ? <Skeleton className="h-16 w-full" />
        : overview.isError ? <ErrorState message={errorText(overview.error)} onRetry={() => overview.refetch()} />
        : editing ? (
          <BudgetForm active={active} busy={save.isPending} error={save.isError ? errorText(save.error) : null}
                      onCancel={() => { save.reset(); setEditing(false); }}
                      onSubmit={(body) => { setNotice(null); save.mutate(body); }} />
        ) : (
          <div className="space-y-4">
            {active ? (
              <div>
                <p className="metric text-2xl font-semibold">{budgetLine(active)}</p>
                <p className="text-sm text-ink-muted">
                  {PERIOD_LABELS[active.period]} budget, in effect since {formatLongDate(active.effective_from)}.
                </p>
              </div>
            ) : (
              <EmptyState icon={Wallet} title="No budget set">
                A budget is optional. Without one, DeluluFit still totals what you record.
              </EmptyState>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setNotice(null); setEditing(true); }}>{active ? "Change budget" : "Set a budget"}</Button>
              {active && <Button variant="secondary" onClick={() => setConfirmEnd(true)}>End budget</Button>}
            </div>
            {past.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-ink-muted hover:text-ink">Past budgets ({past.length})</summary>
                <ul className="mt-2 space-y-1 text-ink-muted">
                  {past.map((b) => (
                    <li key={b.id}>{budgetLine(b)} · {formatLongDate(b.effective_from)} – {formatLongDate(b.effective_to!)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

      <Dialog open={confirmEnd} onClose={() => { end.reset(); setConfirmEnd(false); }} title="End this budget?"
              description="If it started before today, it ends yesterday and stays in your past budgets. If it started today or later, it is removed. Your recorded spending is not affected."
              footer={<>
                <Button variant="ghost" onClick={() => setConfirmEnd(false)} disabled={end.isPending}>Keep budget</Button>
                <Button variant="danger" loading={end.isPending} onClick={() => end.mutate()}>End budget</Button>
              </>}>
        {end.isError && <ErrorState title="Couldn't end the budget" message={errorText(end.error)} />}
      </Dialog>
    </Card>
  );
}

function BudgetForm({ active, busy, error, onSubmit, onCancel }:
  { active: Budget | null; busy: boolean; error: string | null; onCancel: () => void;
    onSubmit: (body: { period: BudgetPeriod; amount: string; effective_from: string | null }) => void }) {
  const [period, setPeriod] = useState<BudgetPeriod>(active?.period ?? "weekly");
  const [amount, setAmount] = useState(active ? active.amount : "");
  const [start, setStart] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const check = checkAmount(amount, { allowZero: true });
  // Mirrors the backend rule; the server re-checks it.
  const startTooEarly = active !== null && start !== "" && start < active.effective_from;

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!check.ok || startTooEarly || busy) return;
    onSubmit({ period, amount: check.value, effective_from: start || null });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Budget">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Period" value={period} onChange={(e) => setPeriod(e.target.value as BudgetPeriod)}
                options={PERIOD_OPTIONS} />
        <Input label={`Amount (${active?.currency ?? "your profile currency"})`} inputMode="decimal" autoComplete="off"
               value={amount} onChange={(e) => setAmount(e.target.value)}
               error={(submitted || amount !== "") && !check.ok ? check.error : undefined} />
        <Input label="Starts" type="date" optional value={start} onChange={(e) => setStart(e.target.value)}
               hint="Leave empty to start today."
               error={startTooEarly ? `Can't start before your current budget started (${formatLongDate(active!.effective_from)}).` : undefined} />
      </div>
      <p className="text-xs text-ink-muted">
        {active
          ? "Your current budget stays in place until the day before the new one starts, then moves to past budgets. Starting on the same day as the current budget replaces it."
          : "The budget applies from its start date. Spending recorded before then isn't compared with it."}
        {" "}Budgets use the currency in your profile.
      </p>
      {error && <ErrorState title="Couldn't save the budget" message={error} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>Save budget</Button>
      </div>
    </form>
  );
}
