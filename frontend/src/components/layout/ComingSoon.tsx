import { Hammer } from "lucide-react";

import { Card } from "@/components/ui/Card";

/**
 * Shown to real accounts on screens that are not connected yet. It states what
 * the screen will do and offers no controls, so nothing pretends to work.
 */
export function ComingSoon({ feature, plans, tryDemo = true }: { feature: string; plans: string[]; tryDemo?: boolean }) {
  return (
    <Card>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="w-fit rounded-full bg-accent-tint p-3.5">
          <Hammer className="h-6 w-6 text-accent" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{feature} isn't available yet</h2>
          <p className="mt-1 text-sm text-ink-muted">This screen is being built. When it's ready you'll be able to:</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {plans.map((p) => <li key={p}>{p}</li>)}
          </ul>
          {tryDemo && (
            <p className="mt-4 text-xs text-ink-muted">
              To preview the design, sign out and choose “Explore with sample data” on the home page.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
