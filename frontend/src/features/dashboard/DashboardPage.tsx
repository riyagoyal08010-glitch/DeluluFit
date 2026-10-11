import { ArrowRight, ChevronRight, Soup, UtensilsCrossed, Wallet } from "lucide-react";

import { DemoTag } from "@/components/layout/DemoTag";
import { MealTimeline } from "@/components/meals/MealTimeline";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader, SectionTitle } from "@/components/ui/Card";
import { DayStrip } from "@/components/ui/DayStrip";
import { Badge, EmptyState, ErrorState, Progress, Skeleton } from "@/components/ui/Feedback";
import { GlassChip, ImagePanel } from "@/components/ui/ImagePanel";
import { ApiError } from "@/lib/api/client";
import { formatAmount, formatLongDate, formatMoney, greeting, localIsoDate, MEAL_LABELS, NUTRIENT_LABELS } from "@/lib/format";
import { DEMO_MENU } from "@/mocks/demoData";
import type { BudgetSummary, NutrientKey, Totals } from "@/types/api";

import { absText } from "@/features/budget/money";

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
        <p className="metric text-3xl font-light">{formatMoney(budget.net_spending, budget.currency)}</p>
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
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="metric text-3xl font-light">{formatMoney(budget.net_spending, budget.currency)}</p>
        <p className="text-sm text-ink-muted">of {formatMoney(budget.budget_amount, budget.currency)}</p>
      </div>
      <Progress value={Math.min(used, 1)} label="Share of budget used" tone={budget.over_budget ? "warning" : "accent"} />
      <p className="text-sm text-ink-muted">
        {budget.over_budget
          ? `${formatMoney(absText(budget.remaining ?? "0"), budget.currency)} over this ${budget.period} budget.`
          : `${formatMoney(budget.remaining, budget.currency)} left for this ${budget.period} period.`}
      </p>
    </div>
  );
}

const CHIPS: NutrientKey[] = ["protein_g", "carbohydrate_g", "fat_g"];

/** Today's totals over the hero image. Unknown stays "—"; partial totals are marked, never shown as complete. */
function HeroTotals({ totals }: { totals: Totals }) {
  const energy = totals.nutrients.energy_kcal;
  const known = energy.status === "complete" || energy.status === "incomplete";
  const partial = (["energy_kcal", ...CHIPS] as NutrientKey[]).some((k) => totals.nutrients[k].status === "incomplete");
  return (
    <>
      <p className="metric mt-3 flex items-baseline gap-2">
        {energy.status === "incomplete" && <span className="sr-only">At least </span>}
        {energy.status === "incomplete" && <span aria-hidden="true" className="text-2xl font-light text-white/90">≥</span>}
        <span className="text-5xl font-light tracking-tight sm:text-6xl">{known ? Number(energy.display).toLocaleString("en-IN") : "—"}</span>
        <span className="text-base text-white/90">kcal{known ? " estimated" : ", no data"}</span>
      </p>
      <ul className="mt-5 flex flex-wrap gap-2" aria-label="Macronutrients">
        {CHIPS.map((k) => {
          const t = totals.nutrients[k];
          const value = t.status === "complete" || t.status === "incomplete"
            ? `${t.status === "incomplete" ? "≥ " : ""}${formatAmount(t.display, t.unit)}` : "—";
          return <li key={k}><GlassChip>{NUTRIENT_LABELS[k]} <span className="metric font-semibold">{value}</span></GlassChip></li>;
        })}
        {partial && <li><GlassChip className="border-white">Partial</GlassChip></li>}
      </ul>
      {totals.note && <p className="mt-4 max-w-md text-xs leading-relaxed text-white/90">{totals.note}</p>}
    </>
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-8">
        <div className="min-w-0">
          <h1 className="text-[2.25rem] leading-[1.02] tracking-[-0.03em] sm:text-[3.25rem]">
            {greeting()}{name ? <>, <span className="font-normal">{name}</span></> : null}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">Welcome to DeluluFit · {formatLongDate(date)}</p>
        </div>
      </header>

      <Card className="p-4 sm:p-5">
        <SectionTitle action={<ButtonLink to="/app/meals?view=history" variant="ghost" size="sm">History <ChevronRight className="h-4 w-4" aria-hidden="true" /></ButtonLink>}>
          This week
        </SectionTitle>
        <DayStrip hrefFor={(d) => `/app/meals?view=history&date=${d}`} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        {today.isError ? (
          <Card aria-labelledby="today-nutrition" className="lg:col-span-2">
            <CardHeader id="today-nutrition" title="Today's nutrition" />
            <ErrorState message={errorMessage(today.error)} onRetry={() => today.refetch()} />
          </Card>
        ) : (
          <ImagePanel scene="thali" aria-labelledby="today-nutrition" className="lg:col-span-2">
            <div className="flex min-h-[19rem] flex-col justify-between p-6 sm:p-8">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="today-nutrition" className="text-base font-normal text-white">Today's nutrition</h2>
                  {demoTag}
                </div>
                {today.isPending ? <p className="mt-6 text-sm text-white/90" role="status">Loading today's totals…</p>
                  : today.data.totals.item_count === 0 ? (
                    <div className="mt-6 max-w-sm">
                      <p className="text-2xl font-light">No meals logged today</p>
                      <p className="mt-2 text-sm text-white/90">Log what you actually ate and your estimated totals will appear here.</p>
                    </div>
                  ) : <HeroTotals totals={today.data.totals} />}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-2">
                <ButtonLink to="/app/meals" variant="inverse" icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}>
                  Log a meal
                </ButtonLink>
                <ButtonLink to="/app/nutrition" variant="onImage">Nutrition details <ChevronRight className="h-4 w-4" aria-hidden="true" /></ButtonLink>
              </div>
            </div>
          </ImagePanel>
        )}

        <Card aria-labelledby="budget">
          <CardHeader id="budget" title={<span className="flex items-center gap-2">Food budget{demoTag}</span>}
                      description="Spending recorded for the current period." />
          {budget.isPending ? <CardSkeleton />
            : budget.isError ? <ErrorState message={errorMessage(budget.error)} onRetry={() => budget.refetch()} />
            : budget.data.transaction_count === 0 && !budget.data.has_budget
              ? <EmptyState icon={Wallet} title="No spending recorded yet">
                  Set a budget and record food you buy outside the mess to see what's left.
                </EmptyState>
              : <BudgetBody budget={budget.data} />}
        </Card>

        <Card aria-labelledby="meals" className="lg:col-span-2">
          <CardHeader id="meals" title={<span className="flex items-center gap-2">Meals today{demoTag}</span>}
                      action={<ButtonLink to="/app/meals?view=history" variant="ghost" size="sm">All meals <ChevronRight className="h-4 w-4" aria-hidden="true" /></ButtonLink>} />
          {today.isPending ? <CardSkeleton />
            : today.isError ? <ErrorState message={errorMessage(today.error)} onRetry={() => today.refetch()} />
            : today.data.meals.length === 0
              ? <EmptyState icon={UtensilsCrossed} title="Nothing logged yet">
                  Breakfast, lunch, snacks and dinner you log appear here in order.
                </EmptyState>
              : <MealTimeline meals={today.data.meals} timeZone={timeZone} />}
        </Card>

        <div className="space-y-6">
          <Card aria-labelledby="quick" className="p-4 sm:p-5">
            <h2 id="quick" className="mb-3 px-1 text-base font-medium">Quick actions</h2>
            <div className="flex flex-wrap gap-2">
              <ButtonLink to="/app/budget" variant="secondary" size="sm" icon={<Wallet className="h-4 w-4" aria-hidden="true" />}>Record spending</ButtonLink>
              <ButtonLink to="/app/menu" variant="secondary" size="sm" icon={<Soup className="h-4 w-4" aria-hidden="true" />}>View menu</ButtonLink>
            </div>
          </Card>

          {/* A menu summary appears only when menu data exists; today that is demo mode only. */}
          {isDemo && (
            <Card aria-labelledby="menu">
              <CardHeader id="menu" title={<span className="flex items-center gap-2">Today's mess menu{demoTag}</span>}
                          description="What the mess planned. Planned isn't the same as eaten." />
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
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
