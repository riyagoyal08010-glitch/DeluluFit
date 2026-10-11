import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, ReceiptText, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, EmptyState, ErrorState, LoadingState, Progress } from "@/components/ui/Feedback";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api/client";
import { budgetApi } from "@/lib/api/endpoints";
import { invalidateBudget, liveKeys } from "@/lib/api/queryKeys";
import { formatLongDate, formatMoney, localIsoDate, shiftIsoDate } from "@/lib/format";
import type { BudgetPeriod, BudgetSummary, SpendingCategory, Transaction, TransactionInput } from "@/types/api";

import { BudgetSettings } from "./BudgetSettings";
import { absText, CATEGORY_LABELS, isNegative, PERIOD_LABELS, PERIOD_NOUN } from "./money";
import { TransactionForm, type TransactionValues } from "./TransactionForm";

const PERIODS: BudgetPeriod[] = ["daily", "weekly", "monthly"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 20;

function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something unexpected happened. Please try again.";
  const fields = Object.values(err.fieldErrors());
  return fields.length ? `${err.message} ${fields.join(" ")}` : err.message;
}

/** Real-account budget page: overview, transactions, recent spending and budget settings. */
export function LiveBudget() {
  const [params, setParams] = useSearchParams();
  const period = PERIODS.includes(params.get("period") as BudgetPeriod) ? (params.get("period") as BudgetPeriod) : null;
  const date = ISO_DATE.test(params.get("date") ?? "") ? params.get("date") : null;
  const summary = useQuery({
    queryKey: liveKeys.budgetSummary(period, date),
    // No period/date: the server uses its own today and the active budget's period.
    queryFn: ({ signal }) => budgetApi.summary({ period: period ?? undefined, date: date ?? undefined }, signal),
  });
  const go = (p: BudgetPeriod, d: string | null) => setParams({ period: p, ...(d ? { date: d } : {}) });
  const s = summary.data;

  return (
    <div className="space-y-4">
      <Card aria-labelledby="overview-title">
        <CardHeader id="overview-title" title={s ? `${PERIOD_LABELS[s.period]} spending` : "Spending"}
                    description={s ? (s.start === s.end ? formatLongDate(s.start) : `${formatLongDate(s.start)} – ${formatLongDate(s.end)}`) : undefined} />
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Period" className="inline-flex rounded-control border border-line/40 bg-surface p-1">
            {PERIODS.map((p) => (
              <button key={p} type="button" aria-pressed={s?.period === p} onClick={() => go(p, date)}
                      className={cn("min-h-[36px] rounded-[0.6rem] px-3 text-sm font-medium transition-colors",
                                    s?.period === p ? "bg-surface-raised text-ink" : "text-ink-muted hover:text-ink")}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" disabled={!s} aria-label={s ? `Previous ${PERIOD_NOUN[s.period]}` : "Previous period"}
                  onClick={() => s && go(s.period, shiftIsoDate(s.start, -1))}
                  icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}>Previous</Button>
          <Button variant="secondary" size="sm" disabled={!s || s.end >= localIsoDate()}
                  aria-label={s ? `Next ${PERIOD_NOUN[s.period]}` : "Next period"}
                  onClick={() => s && go(s.period, shiftIsoDate(s.end, 1))}
                  icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}>Next</Button>
          {date && <Button variant="ghost" size="sm" onClick={() => s && go(s.period, null)}>Current</Button>}
        </div>
        {summary.isPending ? <LoadingState label="Loading spending" />
          : summary.isError ? <ErrorState message={errorText(summary.error)} onRetry={() => summary.refetch()} />
          : <SummaryBody s={summary.data} />}
      </Card>
      {s && <TransactionsCard start={s.start} end={s.end} currency={s.currency} />}
      {s && <RecentSpending currency={s.currency} />}
      <BudgetSettings />
    </div>
  );
}

function SummaryBody({ s }: { s: BudgetSummary }) {
  const categories = Object.entries(s.by_category) as Array<[SpendingCategory, string]>;
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-ink-muted">Net spending</p>
          <p className="metric text-3xl font-semibold">{isNegative(s.net_spending) ? "− " : ""}{formatMoney(absText(s.net_spending), s.currency)}</p>
          <p className="text-xs text-ink-muted">{s.transaction_count} transaction{s.transaction_count === 1 ? "" : "s"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-ink-muted">Expenses</p>
          <p className="metric text-lg font-semibold">{formatMoney(s.expenses, s.currency)}</p>
          <p className="text-xs font-medium text-ink-muted">Refunds</p>
          <p className="metric text-lg font-semibold">{formatMoney(s.refunds, s.currency)}</p>
        </div>
        <div>
          {s.has_budget && s.budget_amount !== null && s.remaining !== null ? (
            <>
              <p className="text-xs font-medium text-ink-muted">Budget for this {PERIOD_NOUN[s.period as BudgetPeriod]}</p>
              <p className="metric text-lg font-semibold">{formatMoney(s.budget_amount, s.currency)}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {s.over_budget ? `${formatMoney(absText(s.remaining), s.currency)} over this budget`
                               : `${formatMoney(s.remaining, s.currency)} left`}
              </p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              No {PERIOD_LABELS[s.period as BudgetPeriod].toLowerCase()} budget applies to this period, so there's nothing to compare against.
            </p>
          )}
        </div>
      </div>
      {s.has_budget && s.utilization !== null && (
        <Progress value={Math.min(Number(s.utilization), 1)} label="Share of budget used" tone={s.over_budget ? "warning" : "accent"} />
      )}
      {categories.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">By category (net of refunds)</h3>
          <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {categories.map(([cat, amount]) => (
              <li key={cat} className="flex justify-between gap-2">
                <span className="text-ink-muted">{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="metric">{isNegative(amount) ? "− " : ""}{formatMoney(absText(amount), s.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.excluded_other_currency > 0 && (
        <p className="text-sm text-warning">
          {s.excluded_other_currency} transaction{s.excluded_other_currency === 1 ? " is" : "s are"} in a different currency
          and not included. Amounts are never converted.
        </p>
      )}
      <p className="text-xs text-ink-muted">
        {s.explanation} Logging a meal never adds an expense; only what you record here counts.
      </p>
    </div>
  );
}

type FormMode = { kind: "expense" } | { kind: "refund"; of: Transaction | null } | { kind: "edit"; txn: Transaction };

function TransactionsCard({ start, end, currency }: { start: string; end: string; currency: string }) {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(PAGE);
  const [form, setForm] = useState<FormMode | null>(null);
  const [deleting, setDeleting] = useState<Transaction | null>(null);
  const lastAttempt = useRef<{ payload: string; key: string } | null>(null);
  const list = useQuery({
    queryKey: liveKeys.transactions(start, end, limit),
    queryFn: ({ signal }) => budgetApi.transactions({ start, end, limit }, signal),
  });
  const done = async () => {
    setForm(null);
    await invalidateBudget(queryClient);
  };
  const create = useMutation({
    mutationFn: (body: TransactionInput) => budgetApi.createTransaction(body),
    onSuccess: async () => { lastAttempt.current = null; await done(); },
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body: Parameters<typeof budgetApi.updateTransaction>[1] }) =>
      budgetApi.updateTransaction(v.id, v.body),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: string) => budgetApi.deleteTransaction(id),
    onSuccess: async () => { setDeleting(null); await invalidateBudget(queryClient); },
  });

  function submit(values: TransactionValues) {
    if (!form) return;
    if (form.kind === "edit") {
      update.mutate({ id: form.txn.id, body: { amount: values.amount, category: values.category,
                                               occurred_on: values.occurredOn, description: values.description } });
      return;
    }
    if (create.isPending) return;
    const body: Omit<TransactionInput, "idempotency_key"> = {
      kind: form.kind, amount: values.amount, category: values.category, occurred_on: values.occurredOn,
      description: values.description, meal_log_id: values.mealLogId,
      refund_of_id: form.kind === "refund" ? form.of?.id ?? null : null,
    };
    // Same idea as meal logging: an identical retry reuses its key so the server returns the original.
    const payload = JSON.stringify(body);
    const key = lastAttempt.current?.payload === payload ? lastAttempt.current.key : globalThis.crypto.randomUUID();
    lastAttempt.current = { payload, key };
    create.mutate({ ...body, idempotency_key: key });
  }

  const mutation = form?.kind === "edit" ? update : create;
  const items = list.data?.items ?? [];
  const byId = new Map(items.map((t) => [t.id, t]));

  return (
    <Card aria-labelledby="txn-title">
      <CardHeader id="txn-title" title="Transactions" description="Recorded in this period, newest first."
                  action={!form && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setForm({ kind: "expense" })} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Add expense</Button>
                      <Button size="sm" variant="secondary" onClick={() => setForm({ kind: "refund", of: null })}
                              icon={<Undo2 className="h-4 w-4" aria-hidden="true" />}>Record refund</Button>
                    </div>
                  )} />
      {form && (
        <div className="mb-5 rounded-control border border-line/30 bg-canvas/30 p-4">
          <TransactionForm key={form.kind === "edit" ? form.txn.id : form.kind} mode={form} currency={currency}
                           busy={mutation.isPending} error={mutation.isError ? errorText(mutation.error) : null}
                           onCancel={() => { create.reset(); update.reset(); setForm(null); }} onSubmit={submit} />
        </div>
      )}
      {list.isPending ? <LoadingState label="Loading transactions" />
        : list.isError ? <ErrorState message={errorText(list.error)} onRetry={() => list.refetch()} />
        : items.length === 0
          ? <EmptyState icon={ReceiptText} title="No transactions in this period">
              Record food you buy, like canteen snacks or groceries, and refunds you receive.
            </EmptyState>
          : (
            <>
              <ul className="divide-y divide-line/30">
                {items.map((t) => {
                  const original = t.refund_of_id ? byId.get(t.refund_of_id) : undefined;
                  const label = t.description ?? CATEGORY_LABELS[t.category];
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-ink">{label}</p>
                        <p className="text-xs text-ink-muted">
                          {[CATEGORY_LABELS[t.category], formatLongDate(t.occurred_on),
                            t.meal_log_id ? "linked to a meal" : null,
                            t.refund_of_id ? `refund of ${original ? `“${original.description ?? CATEGORY_LABELS[original.category]}”` : "an earlier expense"}` : null,
                            t.currency !== currency ? `${t.currency}, not included in totals` : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {t.kind === "refund" && <Badge tone="success">Refund</Badge>}
                        <span className="metric font-medium">{t.kind === "refund" ? "− " : ""}{formatMoney(t.amount, t.currency)}</span>
                        <Button variant="ghost" size="sm" aria-label={`Edit ${label}`} onClick={() => setForm({ kind: "edit", txn: t })}>Edit</Button>
                        {t.kind === "expense" && (
                          <Button variant="ghost" size="sm" aria-label={`Record refund for ${label}`}
                                  onClick={() => setForm({ kind: "refund", of: t })}>Refund</Button>
                        )}
                        <Button variant="ghost" size="sm" aria-label={`Delete ${label}`} onClick={() => setDeleting(t)}>Delete</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {list.data.total > items.length && (
                limit < 100
                  ? <Button variant="secondary" size="sm" className="mt-3" loading={list.isFetching}
                            onClick={() => setLimit((l) => Math.min(l + PAGE, 100))}>
                      Show more ({items.length} of {list.data.total})
                    </Button>
                  : <p className="mt-3 text-xs text-ink-muted">Showing the latest 100 of {list.data.total}. Choose a shorter period to see the rest.</p>
              )}
            </>
          )}

      <Dialog open={deleting !== null} onClose={() => { remove.reset(); setDeleting(null); }}
              title="Delete this transaction?"
              description={deleting ? `${deleting.kind === "refund" ? "Refund" : "Expense"} of ${formatMoney(deleting.amount, deleting.currency)} on ${formatLongDate(deleting.occurred_on)} will be removed from your spending. An expense with refunds can only be deleted after its refunds.` : undefined}
              footer={<>
                <Button variant="ghost" onClick={() => setDeleting(null)} disabled={remove.isPending}>Keep it</Button>
                <Button variant="danger" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting.id)}>Delete</Button>
              </>}>
        {remove.isError && <ErrorState title="Couldn't delete" message={errorText(remove.error)} />}
      </Dialog>
    </Card>
  );
}

function RecentSpending({ currency }: { currency: string }) {
  const trend = useQuery({ queryKey: liveKeys.budgetTrend(14), queryFn: ({ signal }) => budgetApi.trend(14, signal) });
  return (
    <Card aria-labelledby="recent-title">
      <CardHeader id="recent-title" title="Last 14 days" description="Net spending recorded each day." />
      {trend.isPending ? <LoadingState label="Loading" />
        : trend.isError ? <ErrorState message={errorText(trend.error)} onRetry={() => trend.refetch()} />
        : (() => {
            // Bar widths are visual only; every number shown is the server's string.
            const max = Math.max(...trend.data.map((p) => Number(p.net_spending)), 0);
            const anything = trend.data.some((p) => p.net_spending !== "0.00");
            if (!anything) return <p className="text-sm text-ink-muted">Nothing recorded in the last 14 days.</p>;
            return (
              <ul className="space-y-2" aria-label="Daily net spending">
                {[...trend.data].reverse().map((p) => (
                  <li key={p.date} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
                    <span className="truncate text-ink-muted">{new Date(`${p.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span>
                    <Progress value={max > 0 && !isNegative(p.net_spending) ? Number(p.net_spending) : 0} max={max || 1}
                              label={`Spending on ${formatLongDate(p.date)}`} />
                    <span className="metric w-24 text-right">{isNegative(p.net_spending) ? "− " : ""}{formatMoney(absText(p.net_spending), currency)}</span>
                  </li>
                ))}
              </ul>
            );
          })()}
    </Card>
  );
}
