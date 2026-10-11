import { FlaskConical, ShieldCheck, Soup, UtensilsCrossed, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Brand } from "@/components/layout/Brand";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { Dialog } from "@/components/ui/Dialog";
import { useSession } from "@/features/auth/session";

const FEATURES = [
  { icon: UtensilsCrossed, title: "Log what you actually ate",
    text: "Search a food list, enter grams or servings, and see an estimate with its source. Dishes that aren't listed can still be logged by name." },
  { icon: Soup, title: "Your mess menu, from a photo",
    text: "Upload your hostel's menu, fix anything the photo got wrong, and confirm it. A planned menu is never counted as eaten." },
  { icon: Wallet, title: "Food spending in one place",
    text: "Set a budget, record canteen and outside food, handle refunds, and see what's left for the day, week or month." },
];

export function LandingPage() {
  const { state, enterDemo } = useSession();
  const navigate = useNavigate();
  const [demoOpen, setDemoOpen] = useState(false);
  const signedIn = state.status === "authenticated";

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-content items-center justify-between px-4 py-5 sm:px-6">
        <Brand />
        <nav aria-label="Account" className="flex items-center gap-2">
          {signedIn ? <ButtonLink to="/app" size="sm">Open dashboard</ButtonLink> : (
            <>
              <ButtonLink to="/login" variant="ghost" size="sm">Sign in</ButtonLink>
              <ButtonLink to="/register" size="sm">Create account</ButtonLink>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-content px-4 pb-16 pt-10 sm:px-6 sm:pt-16">
          <p className="mb-4 text-sm font-medium text-accent">For students eating in hostel messes</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
            Understand what you eat and what you spend, without the guesswork dressed up as precision.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-ink-muted sm:text-lg">
            DeluluFit brings your mess menu, the meals you log and your food spending together. Nutrition is shown as an
            estimate with its source, and when something isn't known, it says so.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {signedIn ? <ButtonLink to="/app" size="lg">Open dashboard</ButtonLink> : (
              <>
                <ButtonLink to="/register" size="lg">Create a free account</ButtonLink>
                <Button variant="secondary" size="lg" onClick={() => setDemoOpen(true)}
                        icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}>
                  Explore with sample data
                </Button>
              </>
            )}
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-content px-4 pb-16 sm:px-6">
          <h2 id="features" className="sr-only">What DeluluFit does</h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Card className="h-full">
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <Icon className="h-6 w-6 text-accent" aria-hidden="true" />
                    <Badge>Being built</Badge>
                  </div>
                  <h3 className="text-base font-semibold">{title}</h3>
                  <p className="mt-2 text-sm text-ink-muted">{text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="honesty" className="mx-auto max-w-content px-4 pb-20 sm:px-6">
          <Card raised className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <ShieldCheck className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <h2 id="honesty" className="text-base font-semibold">Private by default, honest about limits</h2>
              <p className="mt-2 text-sm text-ink-muted">
                Your meals, menus and spending are visible only to you. Estimates come from public reference data
                (USDA FoodData Central) and won't exactly match your mess's recipes. DeluluFit is for everyday
                awareness and budgeting, not medical or diet advice.
              </p>
            </div>
          </Card>
          <p className="mt-6 text-center text-xs text-ink-muted">
            DeluluFit is in early development: accounts work today, and the features above are being built. <Link to="/login" className="text-accent hover:underline">Sign in</Link>
          </p>
        </section>
      </main>

      <Dialog open={demoOpen} onClose={() => setDemoOpen(false)} title="Explore with sample data"
              description="You'll see the app filled with sample meals, menus and spending for a fictional student. Nothing you do is saved, no account is created, and none of it is real data."
              footer={<>
                <Button variant="ghost" onClick={() => setDemoOpen(false)}>Cancel</Button>
                <Button onClick={() => { enterDemo(); navigate("/app"); }}>Start demo</Button>
              </>} />
    </div>
  );
}
