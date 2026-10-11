import { DemoTag } from "@/components/layout/DemoTag";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, PageHeader, Progress } from "@/components/ui/Feedback";
import { useDataMode } from "@/features/auth/session";
import { formatMoney, localIsoDate } from "@/lib/format";
import { demoBudget, DEMO_TRANSACTIONS } from "@/mocks/demoData";

import { LiveBudget } from "./LiveBudget";
import { CATEGORY_LABELS as LABELS } from "./money";

const CATEGORY_LABELS: Record<string, string> = LABELS;

export function BudgetPage() {
  const isDemo = useDataMode() === "demo";
  return (
    <>
      <PageHeader title="Food budget" description="Money you spend on food, kept separate from what you eat." />
      {isDemo ? <DemoBudget /> : <LiveBudget />}
    </>
  );
}

function DemoBudget() {
  const s = demoBudget(localIsoDate());
  const categories = Object.entries(s.by_category).filter(([, v]) => Number(v) > 0);
  const max = Math.max(...categories.map(([, v]) => Number(v)), 1);
  return (
    <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
      <Card aria-labelledby="b-today">
        <CardHeader id="b-today" title={<span className="flex items-center gap-2">Today<DemoTag /></span>} />
        <p className="metric text-3xl font-semibold">{formatMoney(s.net_spending)}</p>
        <p className="mb-3 text-sm text-ink-muted">spent of {formatMoney(s.budget_amount)}</p>
        <Progress value={Number(s.utilization)} label="Share of today's budget used" />
        <p className="mt-3 text-sm text-ink-muted">{formatMoney(s.remaining)} left today.</p>
      </Card>
      <Card aria-labelledby="b-cat" className="lg:col-span-2">
        <CardHeader id="b-cat" title={<span className="flex items-center gap-2">By category<DemoTag /></span>}
                    description="Net of refunds." />
        <ul className="space-y-3">
          {categories.map(([cat, amount]) => (
            <li key={cat}>
              <div className="mb-1 flex justify-between text-sm"><span>{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="metric text-ink-muted">{formatMoney(amount)}</span></div>
              <Progress value={Number(amount)} max={max} label={`${CATEGORY_LABELS[cat] ?? cat} spending`} />
            </li>
          ))}
        </ul>
      </Card>
      <Card aria-labelledby="b-tx" className="lg:col-span-3">
        <CardHeader id="b-tx" title={<span className="flex items-center gap-2">Recent transactions<DemoTag /></span>} />
        <ul className="divide-y divide-line/30">
          {DEMO_TRANSACTIONS.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <p className="truncate text-ink">{t.description}</p>
                <p className="text-xs text-ink-muted">{CATEGORY_LABELS[t.category]}</p>
              </div>
              <div className="flex items-center gap-2">
                {t.kind === "refund" && <Badge tone="success">Refund</Badge>}
                <span className="metric">{t.kind === "refund" ? "− " : ""}{formatMoney(t.amount)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
