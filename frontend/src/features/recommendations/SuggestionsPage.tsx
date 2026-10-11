import { Lightbulb, X } from "lucide-react";
import { useState } from "react";

import { ComingSoon } from "@/components/layout/ComingSoon";
import { DemoTag } from "@/components/layout/DemoTag";
import { Card } from "@/components/ui/Card";
import { EmptyState, PageHeader } from "@/components/ui/Feedback";
import { useDataMode } from "@/features/auth/session";
import { DEMO_SUGGESTIONS } from "@/mocks/demoData";

export function SuggestionsPage() {
  const isDemo = useDataMode() === "demo";
  return (
    <>
      <PageHeader title="Suggestions" description="Only shown when your own data supports them, always with the reason." />
      {isDemo ? <DemoSuggestions /> : (
        <ComingSoon feature="Suggestions" plans={[
          "Get reminders when a meal you usually log is missing.",
          "See when a food you like is on a confirmed menu, or a cheaper option is available.",
          "Read why each suggestion appeared, and dismiss any you don't want.",
        ]} />
      )}
    </>
  );
}

function DemoSuggestions() {
  // Dismissal here only hides the sample card for this visit; demo mode saves nothing.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const visible = DEMO_SUGGESTIONS.filter((s) => !dismissed.includes(s.id));
  if (visible.length === 0) {
    return <Card><EmptyState icon={Lightbulb} title="No suggestions right now">Sample suggestions dismissed.</EmptyState></Card>;
  }
  return (
    <ul className="space-y-3">
      {visible.map((s) => (
        <li key={s.id}>
          <Card className="flex items-start gap-4">
            <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">{s.title}<DemoTag /></h2>
              <p className="mt-1 text-sm text-ink-muted"><span className="font-medium text-ink">Why: </span>{s.why}</p>
            </div>
            <button type="button" onClick={() => setDismissed((d) => [...d, s.id])}
                    aria-label={`Dismiss suggestion: ${s.title}`}
                    className="rounded-control p-2 text-ink-muted hover:bg-surface-raised hover:text-ink">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </Card>
        </li>
      ))}
    </ul>
  );
}
