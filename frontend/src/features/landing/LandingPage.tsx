import { FlaskConical, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { BowlIllustration, ChaiIllustration, CoinJarIllustration, ThaliIllustration } from "@/components/illustrations/Porcelain";
import { Brand } from "@/components/layout/Brand";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Feedback";
import { GlassChip, ImagePanel } from "@/components/ui/ImagePanel";
import { Dialog } from "@/components/ui/Dialog";
import { useSession } from "@/features/auth/session";

const FEATURES = [
  { art: BowlIllustration, title: "Log what you actually ate", available: true,
    text: "Search a food list, enter grams or servings, and see an estimate with its source. Dishes that aren't listed can still be logged by name." },
  { art: ThaliIllustration, title: "Your mess menu, from a photo", available: false,
    text: "Upload your hostel's menu, fix anything the photo got wrong, and confirm it. A planned menu is never counted as eaten." },
  { art: CoinJarIllustration, title: "Food spending in one place", available: true,
    text: "Set a budget, record canteen and outside food, handle refunds, and see what's left for the day, week or month." },
];

export function LandingPage() {
  const { state, enterDemo } = useSession();
  const navigate = useNavigate();
  const [demoOpen, setDemoOpen] = useState(false);
  const signedIn = state.status === "authenticated";

  return (
    <div className="min-h-screen px-3 pb-10 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between px-2 py-5 sm:px-4">
          <Brand />
          <nav aria-label="Account" className="flex items-center gap-2">
            {signedIn ? <ButtonLink to="/app" size="sm">Open dashboard</ButtonLink> : (
              <>
                <ButtonLink to="/login" variant="ghost" size="sm">Sign in</ButtonLink>
                <ButtonLink to="/register" variant="secondary" size="sm">Create account</ButtonLink>
              </>
            )}
          </nav>
        </header>

        <main className="space-y-6 sm:space-y-8">
          {/* Hero: a cinematic image panel; the illustration is decorative. */}
          <ImagePanel scene="thali" aria-labelledby="hero-title">
            <div className="px-6 pb-56 pt-10 sm:px-12 sm:pb-64 sm:pt-14 md:max-w-[60%] md:pb-20 lg:py-24">
              <div>
                <GlassChip>For students eating in hostel messes</GlassChip>
                <h1 id="hero-title" className="mt-6 text-5xl font-light leading-[1.05] text-white sm:text-7xl">
                  Know your <span className="font-semibold">plate</span>
                </h1>
                <p className="mt-6 max-w-xl text-base leading-relaxed text-white/90 sm:text-lg">
                  DeluluFit brings your mess menu, the meals you log and your food spending together — without the
                  guesswork dressed up as precision. Nutrition is shown as an estimate with its source, and when
                  something isn't known, it says so.
                </p>
                <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                  {signedIn ? <ButtonLink to="/app" variant="secondary" size="lg">Open dashboard</ButtonLink> : (
                    <>
                      <ButtonLink to="/register" variant="secondary" size="lg">Create a free account</ButtonLink>
                      <Button variant="onImage" size="lg" onClick={() => setDemoOpen(true)}
                              icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}>
                        Explore with sample data
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </ImagePanel>

          {/* About: text column, a large framed illustration, and a column of small tiles. */}
          <section aria-labelledby="about" className="grid gap-6 lg:grid-cols-[1fr_1.2fr_0.55fr]">
            <div className="flex flex-col justify-center rounded-sheet px-4 py-6 sm:px-6">
              <h2 id="about" className="text-3xl">How it <span className="font-semibold">works</span></h2>
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-muted">
                Your hostel's menu says what's planned; DeluluFit only counts what you log as eaten. Each meal gets an
                estimate from public reference foods, with the source shown and gaps marked. Spending is tracked
                separately, so nothing is counted twice.
              </p>
            </div>
            <div aria-hidden="true" className="glass-card rounded-sheet p-8 sm:p-10">
              <BowlIllustration />
            </div>
            <div aria-hidden="true" className="hidden grid-rows-3 gap-4 lg:grid">
              {[ChaiIllustration, CoinJarIllustration, ThaliIllustration].map((Art, i) => (
                <div key={i} className="glass-subtle flex items-center rounded-card p-4">
                  <Art />
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="features" className="glass-card rounded-sheet px-5 py-10 sm:px-10">
            <h2 id="features" className="text-3xl">What DeluluFit <span className="font-semibold">does</span></h2>
            <ul className="mt-8 grid gap-5 md:grid-cols-3">
              {FEATURES.map(({ art: Art, title, text, available }) => (
                <li key={title} className="surface-solid flex h-full flex-col rounded-card p-5">
                  <div aria-hidden="true" className="mb-5 rounded-control bg-accent-tint p-5"><Art /></div>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <h3 className="text-base">{title}</h3>
                    {available ? <Badge tone="success">Available</Badge> : <Badge>Being built</Badge>}
                  </div>
                  <p className="text-sm leading-relaxed text-ink-muted">{text}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="honesty" className="surface-solid flex flex-col gap-4 rounded-sheet px-6 py-8 sm:flex-row sm:items-start sm:px-10">
            <div className="w-fit rounded-full bg-accent-tint p-3.5">
              <ShieldCheck className="h-6 w-6 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h2 id="honesty" className="text-xl">Private by default, honest about limits</h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">
                Your meals, menus and spending are visible only to you. Estimates come from public reference data
                (USDA FoodData Central) and won't exactly match your mess's recipes. DeluluFit is for everyday
                awareness and budgeting, not medical or diet advice.
              </p>
            </div>
          </section>
          <p className="text-center text-xs text-ink-muted">
            DeluluFit is in early development: meal logging, nutrition history and budgets work today; menu upload is
            being built. <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link>
          </p>
        </main>
      </div>

      <Dialog open={demoOpen} onClose={() => setDemoOpen(false)} title="Explore with sample data"
              description="You'll see the app filled with sample meals, menus and spending for a fictional student. Nothing you do is saved, no account is created, and none of it is real data."
              footer={<>
                <Button variant="ghost" onClick={() => setDemoOpen(false)}>Cancel</Button>
                <Button onClick={() => { enterDemo(); navigate("/app"); }}>Start demo</Button>
              </>} />
    </div>
  );
}
