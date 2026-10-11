import { CalendarDays, Plus, Soup, UtensilsCrossed, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { DemoTag } from "@/components/layout/DemoTag";
import { MealTimeline } from "@/components/meals/MealTimeline";
import { NutritionSummary } from "@/components/nutrition/NutritionSummary";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, EmptyState, ErrorState, PageHeader, Progress, Skeleton } from "@/components/ui/Feedback";
import { ApiError } from "@/lib/api/client";
import { formatLongDate, formatMoney, greeting, localIsoDate, MEAL_LABELS } from "@/lib/format";
import { DEMO_MENU } from "@/mocks/demoData";
import type { BudgetSummary } from "@/types/api";

import { useDashboard } from "./useDashboard";

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Please try again.";
}

function CardSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function BudgetBody({ budget }: { budget: BudgetSummary }) {
  if (!budget.has_budget || budget.budget_amount === null) {
    return (
      <div className="space-y-2">
        <p className="metric text-2xl font-semibold">{formatMoney(budget.net_spending, budget.currency)}</p>
        <p className="text-sm text-ink-muted">
          spent {budget.period === "daily" ? "today" : `this ${budget.period.replace("ly", "")}`}. No budget is set
          for this period, so there's nothing to compare against.
        </p>
      </div>
    );
  }
  const used = Number(budget.utilization ?? 0);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="metric text-2xl font-semibold">{formatMoney(budget.net_spending, budget.currency)}</p>
        <p className="text-sm text-ink-muted">of {formatMoney(budget.budget_amount, budget.currency)}</p>
      </div>
      <Progress value={Math.min(used, 1)} label="Share of budget used" tone={budget.over_budget ? "warning" : "accent"} />
      <p className="text-sm text-ink-muted">
        {budget.over_budget
          ? `${formatMoney(String(Math.abs(Number(budget.remaining))), budget.currency)} over this ${budget.period} budget.`
          : `${formatMoney(budget.remaining, budget.currency)} left for this ${budget.period} period.`}
      </p>
    </div>
  );
}

function Section({ id, title, description, tag, action, children, className }:
  { id: string; title: string; description?: string; tag?: ReactNode; action?: ReactNode; children: ReactNode;
    className?: string }) {
  return (
    <Card aria-labelledby={id} className={className}>
      <CardHeader id={id} title={<span className="flex items-center gap-2">{title}{tag}</span>}
                  description={description} action={action} />
      {children}
    </Card>
  );
}

export function DashboardPage() {
  const { isDemo, profile, today, budget } = useDashboard();
  const demoTag = isDemo ? <DemoTag /> : null;
  // The demo persona is fictional; the demo banner and tags say so.
  const name = isDemo ? "Asha" : profile.data?.profile?.display_name ?? null;
  const timeZone = profile.data?.profile?.timezone ?? (isDemo ? "Asia/Kolkata" : undefined);
  const date = today.data?.date ?? localIsoDate();

  return (
    <>
      <PageHeader
        title={name ? `${greeting()}, ${name}` : greeting()}
        description={<span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" aria-hidden="true" />{formatLongDate(date)}</span>}
        actions={<>
          <ButtonLink to="/app/meals" icon={<Plus className="h-4 w-4" aria-hidden="true" />}>Log a meal</ButtonLink>
          <ButtonLink to="/app/menu" variant="secondary" icon={<Soup className="h-4 w-4" aria-hidden="true" />}>View menu</ButtonLink>
        </>}
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        <Section id="today-nutrition" title="Today's nutrition" tag={demoTag} className="lg:col-span-2"
                 description="Known totals for what you've logged today.">
          {today.isPending ? <CardSkeleton />
            : today.isError ? <ErrorState message={errorMessage(today.error)} onRetry={() => today.refetch()} />
            : today.data.totals.item_count === 0
              ? <EmptyState icon={UtensilsCrossed} title="No meals logged today">
                  Log what you actually ate and your estimated totals will appear here.
                </EmptyState>
              : <NutritionSummary totals={today.data.totals} />}
        </Section>

        <Section id="budget" title="Food budget" tag={demoTag} description="Spending recorded for the current period.">
          {budget.isPending ? <CardSkeleton />
            : budget.isError ? <ErrorState message={errorMessage(budget.error)} onRetry={() => budget.refetch()} />
            : budget.data.transaction_count === 0 && !budget.data.has_budget
              ? <EmptyState icon={Wallet} title="No spending recorded yet">
                  Set a budget and record food you buy outside the mess to see what's left.
                </EmptyState>
              : <BudgetBody budget={budget.data} />}
        </Section>

        <Section id="meals" title="Meals today" tag={demoTag} className="lg:col-span-2">
          {today.isPending ? <CardSkeleton />
            : today.isError ? <ErrorState message={errorMessage(today.error)} onRetry={() => today.refetch()} />
            : today.data.meals.length === 0
              ? <p className="text-sm text-ink-muted">Nothing logged yet. Breakfast, lunch, snacks and dinner you log appear here in order.</p>
              : <MealTimeline meals={today.data.meals} timeZone={timeZone} />}
        </Section>

        <Section id="menu" title="Today's mess menu" tag={demoTag}
                 description={isDemo ? "What the mess planned. Planned isn't the same as eaten." : undefined}>
          {isDemo ? (
            <ul className="space-y-3">
              {DEMO_MENU.map((m) => (
                <li key={m.meal}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{MEAL_LABELS[m.meal]}</h3>
                    {m.status === "confirmed" ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Needs review</Badge>}
                  </div>
                  <p className="text-sm text-ink-muted">{m.items.join(", ")}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Soup} title="No menu yet">
              Uploading and reviewing your mess menu is coming in a later update.
            </EmptyState>
          )}
        </Section>
      </div>
    </>
  );
}
