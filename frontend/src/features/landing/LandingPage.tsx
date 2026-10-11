import { ArrowRight, BookOpen, EyeOff, FlaskConical, Plus, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Brand } from "@/components/layout/Brand";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useSession } from "@/features/auth/session";
import { cn } from "@/lib/cn";

/*
 * Landing page in the app's monochrome editorial world (F35): white paper, black type, hairline
 * rules, sharp corners and pill buttons. The hero is the page's one black band, with the
 * logo in its own column beside the headline (never behind text). A sample meal, labelled
 * as sample, shows the product's mechanism: estimates with sources, unknowns marked.
 */

const STEPS = [
  { title: "Log what you ate",
    text: "Search the food list, enter grams or a serving, and save. A dish that isn't listed can still be logged by name." },
  { title: "Read the estimate",
    text: "Each meal shows a nutrition estimate with its source. Partial totals are marked ≥ and unknown values say so, never zero." },
  { title: "Keep the money in view",
    text: "Set a daily, weekly or monthly budget, record canteen and outside food, handle refunds and see what's left." },
];

const PRINCIPLES = [
  { title: "Every estimate has a source",
    text: "Reference foods come from USDA FoodData Central, and each meal keeps a versioned history of its estimate." },
  { title: "Unknown is never zero",
    text: "Missing nutrients show as “No data” and partial totals carry a ≥, so a gap can't hide inside a total." },
  { title: "Planned isn't eaten",
    text: "Your mess menu says what's planned. Only meals you log count, and logging a meal never creates an expense." },
];

const FAQ = [
  { q: "Where do the nutrition numbers come from?",
    a: "From public reference foods (USDA FoodData Central). They won't exactly match your mess's recipes, so every value is shown as an estimate with its source." },
  { q: "What if a dish isn't in the food list?",
    a: "Log it by name. Its nutrition is recorded as unknown, shown as “No data”, and the day's totals are marked partial rather than quietly left short." },
  { q: "Can I upload my mess menu?",
    a: "Menu upload from a photo is being built. You'll review and correct what was read from the photo, then confirm it, and a planned menu will still never be counted as eaten." },
  { q: "Is this diet or medical advice?",
    a: "No. DeluluFit is for everyday awareness and budgeting. Your meals, menus and spending are visible only to you." },
];

/** A logged meal as the app shows it. Made-up values, labelled as a sample. */
function SampleMeal() {
  return (
    <figure className="grid overflow-hidden rounded-card border border-ink shadow-card sm:grid-cols-[1.4fr_1fr]">
      <div className="p-6 sm:p-8">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-lg">Lunch</p>
          <p className="text-xs text-ink-muted">1:10 pm · sample</p>
        </div>
        <dl className="mt-6 border-t border-ink text-sm">
          {[["Dal tadka", "1 katori"], ["Rice", "150 g"]].map(([food, portion]) => (
            <div key={food} className="flex justify-between border-b border-line py-3">
              <dt>{food}</dt><dd className="metric">{portion}</dd>
            </div>
          ))}
          <div className="flex justify-between border-b border-line py-3">
            <dt>Curd</dt><dd className="text-ink-muted">No data</dd>
          </div>
          <div className="flex items-baseline justify-between py-3">
            <dt>Energy</dt><dd className="metric text-2xl font-light">≥ 412 <span className="text-sm">kcal</span></dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-col justify-between gap-8 bg-black p-6 text-white sm:p-8">
        <div>
          <p className="text-xs text-white/60">Today so far</p>
          <p className="metric mt-2 text-4xl font-light tracking-[-0.03em]">≥ 1,210 <span className="text-base">kcal</span></p>
          <p className="mt-1 text-xs text-white/60">Partial · 2 of 3 meals logged</p>
        </div>
        <div className="border-t border-white/20 pt-6">
          <p className="text-xs text-white/60">Food budget left today</p>
          <p className="metric mt-2 text-4xl font-light tracking-[-0.03em]">₹140 <span className="text-base text-white/60">of ₹250</span></p>
        </div>
      </div>
      <figcaption className="border-t border-ink px-6 py-3 text-xs text-ink-muted sm:col-span-2 sm:px-8">
        Sample values. Source: USDA FoodData Central. The total is partial because curd has no reference data.
      </figcaption>
    </figure>
  );
}

export function LandingPage() {
  const { state, enterDemo } = useSession();
  const navigate = useNavigate();
  const [demoOpen, setDemoOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const signedIn = state.status === "authenticated";

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Brand />
          <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
            {signedIn ? <ButtonLink to="/app" size="sm">Open dashboard</ButtonLink> : (
              <>
                <ButtonLink to="/login" variant="ghost" size="sm">Sign in</ButtonLink>
                <ButtonLink to="/register" size="sm">Get started</ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: the one black band. Headline left; the logo sits in its own column on its own ground. */}
        <section aria-labelledby="hero-title" className="flex flex-col bg-black text-white lg:min-h-[calc(100vh-4rem)] lg:flex-row">
          <div className="reveal-up stagger-2 flex shrink-0 items-center justify-center bg-[rgb(var(--brand-ground))] lg:order-last lg:w-[42%]">
            <BrandLogo priority className="max-w-[40rem]" />
          </div>
          <div className="flex flex-1 flex-col justify-end px-5 pb-14 pt-12 sm:px-10 lg:px-16 lg:pb-20">
            <h1 id="hero-title"
                className="reveal-up stagger-1 text-[3.75rem] font-light leading-[0.9] tracking-[-0.045em] text-white sm:text-[6rem] xl:text-[7.5rem]">
              Know your<br />plate.
            </h1>
            <p className="reveal-up stagger-2 mt-10 max-w-lg text-lg leading-relaxed text-white/75">
              For students eating in hostel messes. Log what you actually ate, see nutrition estimates with their source,
              and keep your food budget in one place. When something isn't known, it says so.
            </p>
            <div className="reveal-up stagger-3 mt-10 flex flex-col gap-3 sm:flex-row">
              {signedIn ? (
                <ButtonLink to="/app" variant="inverse" size="lg">
                  Open dashboard <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </ButtonLink>
              ) : (
                <>
                  <ButtonLink to="/register" variant="inverse" size="lg">
                    Create a free account <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </ButtonLink>
                  <Button variant="onImage" size="lg" onClick={() => setDemoOpen(true)}
                          icon={<FlaskConical className="h-4 w-4" aria-hidden="true" />}>
                    Explore with sample data
                  </Button>
                </>
              )}
            </div>
            <ul className="reveal-up stagger-4 mt-14 flex flex-wrap gap-x-8 gap-y-3 border-t border-white/20 pt-6 text-sm text-white/70">
              <li className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Private by default</li>
              <li className="flex items-center gap-2"><BookOpen className="h-4 w-4" aria-hidden="true" />A source on every estimate</li>
              <li className="flex items-center gap-2"><EyeOff className="h-4 w-4" aria-hidden="true" />Unknowns never hidden</li>
            </ul>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-5 sm:px-8">
          {/* The mechanism, shown rather than claimed. */}
          <section aria-labelledby="sample-title" className="grid gap-12 py-24 lg:grid-cols-[1fr_1.35fr] lg:gap-20 lg:py-32">
            <div>
              <h2 id="sample-title" className="text-[2.5rem] font-light leading-[1.02] tracking-[-0.035em] sm:text-[3.25rem]">
                Numbers you can actually trust.
              </h2>
              <p className="mt-6 max-w-md text-base leading-relaxed text-ink-muted">
                Nutrition apps love to look precise. DeluluFit shows an estimate, tells you where it came from, and admits
                what it doesn't know.
              </p>
            </div>
            <SampleMeal />
          </section>

          <section aria-labelledby="how-title" className="border-t border-ink py-24 lg:py-28">
            <div className="grid gap-6 md:grid-cols-[1fr_1.35fr] md:gap-20">
              <h2 id="how-title" className="text-[2rem] font-light tracking-[-0.03em] sm:text-[2.5rem]">How it works</h2>
              <p className="self-end text-base text-ink-muted">Three things, kept separate so nothing is counted twice.</p>
            </div>
            <ol className="mt-14 grid gap-12 md:grid-cols-3 md:gap-10">
              {STEPS.map(({ title, text }, i) => (
                <li key={title} className="border-t border-ink pt-6">
                  <span className="metric text-xs text-ink-muted" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="mt-6 text-xl font-normal tracking-[-0.01em]">{title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">{text}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="why-title" className="border-t border-ink py-24 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-[1fr_1.35fr] lg:gap-20">
              <h2 id="why-title" className="text-[2rem] font-light tracking-[-0.03em] sm:text-[2.5rem]">What it won't pretend</h2>
              <dl className="border-t border-line">
                {PRINCIPLES.map(({ title, text }) => (
                  <div key={title} className="grid gap-2 border-b border-line py-7 sm:grid-cols-[1fr_1.3fr] sm:gap-10">
                    <dt className="text-lg">{title}</dt>
                    <dd className="text-sm leading-relaxed text-ink-muted">{text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section aria-labelledby="faq-title" className="border-t border-ink py-24 lg:py-28">
            <div className="grid gap-12 lg:grid-cols-[1fr_1.35fr] lg:gap-20">
              <div>
                <h2 id="faq-title" className="text-[2rem] font-light tracking-[-0.03em] sm:text-[2.5rem]">Common questions</h2>
                <p className="mt-4 max-w-sm text-base text-ink-muted">What the numbers mean, and what the app won't pretend to know.</p>
              </div>
              <div className="border-t border-line">
                {FAQ.map(({ q, a }, i) => {
                  const open = openFaq === i;
                  const panelId = `faq-panel-${i}`;
                  return (
                    <div key={q} className="border-b border-line">
                      <h3 className="font-normal">
                        <button type="button" aria-expanded={open} aria-controls={panelId}
                                onClick={() => setOpenFaq(open ? null : i)}
                                className="flex w-full items-center justify-between gap-6 py-6 text-left">
                          <span className="text-lg leading-snug">{q}</span>
                          <span aria-hidden="true"
                                className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ink transition-colors duration-500 ease-glide",
                                              open ? "bg-ink text-ink-inverse" : "text-ink")}>
                            <Plus className={cn("h-3.5 w-3.5 transition-transform duration-500 ease-glide", open && "rotate-45")} />
                          </span>
                        </button>
                      </h3>
                      <div id={panelId} hidden={!open} className="pb-7 pr-14">
                        <p className="max-w-xl text-sm leading-relaxed text-ink-muted">{a}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section aria-labelledby="cta-title" className="border-t border-ink py-24 lg:py-32">
            <h2 id="cta-title" className="max-w-3xl text-[2.75rem] font-light leading-[1] tracking-[-0.04em] sm:text-[4.5rem]">
              Ready to know your plate?
            </h2>
            <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-base text-ink-muted">Free, private, and honest about what it doesn't know. Not diet advice.</p>
              <ButtonLink to={signedIn ? "/app" : "/register"} size="lg" className="shrink-0">
                {signedIn ? "Open dashboard" : "Get started free"} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </ButtonLink>
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-6 px-5 py-10 text-xs text-ink-muted sm:grid-cols-3 sm:px-8">
          <div className="flex items-center gap-3"><Brand /><span>© 2026</span></div>
          <p>Early development: meal logging, nutrition history and budgets work today; menu upload is being built.</p>
          <nav aria-label="Footer" className="flex gap-6 sm:justify-end">
            <Link to="/login" className="hover:text-ink">Sign in</Link>
            <Link to="/register" className="hover:text-ink">Create account</Link>
          </nav>
        </div>
      </footer>

      <Dialog open={demoOpen} onClose={() => setDemoOpen(false)} title="Explore with sample data"
              description="You'll see the app filled with sample meals, menus and spending for a fictional student. Nothing you do is saved, no account is created, and none of it is real data."
              footer={<>
                <Button variant="ghost" onClick={() => setDemoOpen(false)}>Cancel</Button>
                <Button onClick={() => { enterDemo(); navigate("/app"); }}>Start demo</Button>
              </>} />
    </div>
  );
}
