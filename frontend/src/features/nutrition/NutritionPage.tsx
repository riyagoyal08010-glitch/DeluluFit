import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { DemoTag } from "@/components/layout/DemoTag";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/Feedback";
import { Select } from "@/components/ui/Field";
import { useDataMode } from "@/features/auth/session";
import { formatAmount, localIsoDate, NUTRIENT_LABELS } from "@/lib/format";
import { demoWeek } from "@/mocks/demoData";
import type { NutrientKey } from "@/types/api";

const CHOICES: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g"];

export function NutritionPage() {
  const isDemo = useDataMode() === "demo";
  return (
    <>
      <PageHeader title="Nutrition" description="Estimated totals by day, with how complete each total is." />
      {isDemo ? <DemoTrend /> : (
        <ComingSoon feature="Nutrition history" plans={[
          "See daily totals for the last 7 or 30 days, or any range you choose.",
          "Tell complete totals apart from partial ones where some items had no data.",
          "Check which reference food and dataset each estimate came from.",
        ]} />
      )}
    </>
  );
}

function DemoTrend() {
  const [nutrient, setNutrient] = useState<NutrientKey>("energy_kcal");
  const days = demoWeek(localIsoDate()).map((d) => {
    const t = d.totals.nutrients[nutrient];
    return { label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }),
             date: d.date, value: t.display === null ? 0 : Number(t.display), display: t.display, status: t.status,
             unit: t.unit };
  });
  const unit = days[0]?.unit ?? "";
  return (
    <Card aria-labelledby="trend-title">
      <CardHeader id="trend-title" title={<span className="flex items-center gap-2">Last 7 days<DemoTag /></span>}
                  description="Lighter bars are partial: at least one item that day had no data."
                  action={<div className="w-44"><Select label="Nutrient" value={nutrient}
                    onChange={(e) => setNutrient(e.target.value as NutrientKey)}
                    options={CHOICES.map((k) => ({ value: k, label: NUTRIENT_LABELS[k] }))} /></div>} />
      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="rgb(var(--color-line) / 0.35)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--color-text-muted))", fontSize: 12 }} />
            <YAxis tickLine={false} axisLine={false} width={48} tick={{ fill: "rgb(var(--color-text-muted))", fontSize: 12 }} />
            <ChartTooltip cursor={{ fill: "rgb(var(--color-surface-raised) / 0.5)" }}
                          contentStyle={{ background: "rgb(var(--color-surface-raised))", border: "none", borderRadius: 12 }}
                          formatter={(_v, _n, p) => [formatAmount((p.payload as { display: string | null }).display, unit),
                                                     NUTRIENT_LABELS[nutrient]]} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {days.map((d) => (
                <Cell key={d.date} fill={d.status === "incomplete" ? "rgb(var(--color-accent) / 0.4)" : "rgb(var(--color-accent))"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* The same data as a table, for screen readers and anyone who prefers numbers. */}
      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">{NUTRIENT_LABELS[nutrient]} by day (demo data)</caption>
        <thead className="text-xs text-ink-muted"><tr><th className="py-1 text-left font-medium">Day</th>
          <th className="py-1 text-right font-medium">{NUTRIENT_LABELS[nutrient]}</th>
          <th className="py-1 text-right font-medium">Completeness</th></tr></thead>
        <tbody className="divide-y divide-line/20">
          {days.map((d) => (
            <tr key={d.date}>
              <td className="py-1.5">{d.label}</td>
              <td className="metric py-1.5 text-right">{d.status === "incomplete" ? "≥ " : ""}{formatAmount(d.display, d.unit)}</td>
              <td className="py-1.5 text-right text-ink-muted">
                {{ complete: "All items", incomplete: "Partial", unavailable: "No data", empty: "Nothing logged" }[d.status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
