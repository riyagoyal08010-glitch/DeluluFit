import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

import { EmptyState } from "@/components/ui/Feedback";
import { formatAmount, formatLongDate } from "@/lib/format";

import { hasAnyValue, type TrendPoint } from "./analytics";

const COMPLETENESS: Record<TrendPoint["status"], string> = {
  complete: "All items", incomplete: "Partial", unavailable: "No data", empty: "Nothing logged",
};

/**
 * Daily bars for one nutrient. Days with nothing known are gaps, not zero bars;
 * partial days are lighter. The table below carries the same data for screen
 * readers and narrow screens.
 */
export function TrendChart({ points, title }: { points: TrendPoint[]; title: string }) {
  const unit = points[0]?.unit ?? "";
  if (!hasAnyValue(points)) {
    return (
      <EmptyState icon={BarChart3} title={`No ${title.toLowerCase()} data in this period`}>
        Nothing logged in these days has data for this nutrient, so there is nothing to chart.
      </EmptyState>
    );
  }
  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{title} per day ({unit})</figcaption>
      <div className="h-56 w-full sm:h-64" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--color-line) / 0.35)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8}
                   tick={{ fill: "rgb(var(--color-text-muted))", fontSize: 11 }} />
            <YAxis tickLine={false} axisLine={false} width={52} allowDecimals={false}
                   tick={{ fill: "rgb(var(--color-text-muted))", fontSize: 11 }} />
            <ChartTooltip cursor={{ fill: "rgb(255 255 255 / 0.45)" }}
                          contentStyle={{ background: "rgb(var(--color-surface))", border: "1px solid rgb(var(--color-line))", borderRadius: 14,
                                          boxShadow: "0 12px 30px -16px rgb(31 52 89 / 0.3)", color: "rgb(var(--color-text-primary))" }}
                          labelFormatter={(_l, payload) => {
                            const p = payload[0]?.payload as TrendPoint | undefined;
                            return p ? formatLongDate(p.date) : "";
                          }}
                          formatter={(_v, _n, item) => {
                            const p = item.payload as TrendPoint;
                            return [`${p.status === "incomplete" ? "≥ " : ""}${formatAmount(p.display, p.unit)} (${COMPLETENESS[p.status].toLowerCase()})`, title];
                          }} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {points.map((p) => (
                <Cell key={p.date} fill={p.status === "incomplete" ? "rgb(var(--color-accent-light))" : "rgb(var(--color-accent-soft))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-ink-muted">Lighter bars are partial (at least one item had no data). Missing bars mean nothing known.</p>
    </figure>
  );
}

export function DaysTable({ points, title }: { points: TrendPoint[]; title: string }) {
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[22rem] text-sm">
        <caption className="sr-only">{title} by day</caption>
        <thead className="text-xs text-ink-muted">
          <tr>
            <th scope="col" className="px-2 py-2 text-left font-medium">Date</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Meals</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{title}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Completeness</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {[...points].reverse().map((p) => (
            <tr key={p.date}>
              <th scope="row" className="px-2 py-2 text-left font-normal">{formatLongDate(p.date)}</th>
              <td className="metric px-2 py-2 text-right">{p.mealCount}</td>
              <td className="metric px-2 py-2 text-right">
                {p.value === null ? "—" : `${p.status === "incomplete" ? "≥ " : ""}${formatAmount(p.display, p.unit)}`}
              </td>
              <td className="px-2 py-2 text-right text-ink-muted">{COMPLETENESS[p.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
