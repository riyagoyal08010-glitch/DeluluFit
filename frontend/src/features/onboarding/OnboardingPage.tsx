import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Info, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Brand } from "@/components/layout/Brand";
import { BrandLogo } from "@/components/layout/BrandLogo";
import { DemoTag } from "@/components/layout/DemoTag";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ErrorState, LoadingState, Progress } from "@/components/ui/Feedback";
import { useSession } from "@/features/auth/session";
import { BudgetSettings } from "@/features/budget/BudgetSettings";
import { PERIOD_NOUN } from "@/features/budget/money";
import { AllergiesEditor } from "@/features/profile/AllergiesEditor";
import { ALLERGEN_LABELS, DIETARY_PATTERN_LABELS, PREFERENCE_LABELS, SEVERITY_LABELS, TARGET_SOURCE_LABELS }
  from "@/features/profile/options";
import { PersonalProfileForm } from "@/features/profile/PersonalProfileForm";
import { PreferencesEditor } from "@/features/profile/PreferencesEditor";
import { apiMessage } from "@/features/profile/shared";
import { TargetsManager } from "@/features/profile/TargetsManager";
import { ApiError } from "@/lib/api/client";
import { budgetApi, profileApi } from "@/lib/api/endpoints";
import { liveKeys } from "@/lib/api/queryKeys";
import { cn } from "@/lib/cn";
import { formatAmount, formatMoney, NUTRIENT_LABELS } from "@/lib/format";
import type { ActivityLevel, DietaryPattern, Profile, ProfileBundle, ProfileInput } from "@/types/api";

/*
 * Setup wizard for a new account, built on the backend as it is:
 *   - each section is saved by its own endpoint (PUT /profile, /profile/preferences,
 *     /profile/allergies, /targets/active, /budget/active), the same ones Profile & settings uses;
 *   - progress is the profile's `onboarding_step` (PUT /profile; the server only ever raises it),
 *     so a refresh or a later sign-in resumes at the furthest saved step;
 *   - POST /profile/complete-onboarding (idempotent) finishes setup; the session's
 *     `onboarding_completed` reflects it.
 * Unsaved edits live only in this page. Visited steps stay mounted (hidden), so Back and
 * Continue never lose them.
 *
 * Layout: a full-height page. From lg, a rail on the left, on the logo's own ground, carries the
 * logo and the step list; the work column on the right holds one step at a time, which glides in
 * from the direction of travel.
 */

export const STEPS = [
  { title: "Welcome", optional: false, lead: null },
  { title: "Your profile", optional: false,
    lead: "Only your name is required. Everything else on this step is optional." },
  { title: "Food preferences and allergies", optional: true,
    lead: "Foods you like, dislike or avoid, and any allergies you want on record." },
  { title: "Nutrition targets", optional: true,
    lead: "Daily amounts you choose yourself, shown beside your logged estimates." },
  { title: "Food budget", optional: true,
    lead: "An amount to compare the food spending you record with." },
  { title: "Review and finish", optional: false,
    lead: "Here's what's saved to your account. Change anything, or finish." },
] as const;
const LAST = STEPS.length;
const clampStep = (n: number) => Math.min(Math.max(Math.trunc(n) || 1, 1), LAST);

/** PUT /profile replaces every field, so recording progress re-sends the saved profile unchanged. */
function inputFrom(p: Profile): ProfileInput {
  return {
    display_name: p.display_name, height_cm: p.height_cm, weight_kg: p.weight_kg,
    activity_level: p.activity_level as ActivityLevel | null, dietary_pattern: p.dietary_pattern as DietaryPattern,
    currency: p.currency, timezone: p.timezone, institution_id: p.institution_id, hostel_id: p.hostel_id,
  };
}

export function OnboardingPage() {
  const { state } = useSession();
  const location = useLocation();

  if (state.status === "loading") return <Plain><LoadingState label="Checking your session" /></Plain>;
  if (state.status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (state.status === "demo") return <Plain><DemoNotice /></Plain>;
  // Already set up (confirmed by the server): nothing to do here. AppShell never sends a
  // completed account back, so this can't loop.
  if (state.user.onboarding_completed) return <Navigate to="/app" replace />;
  return <Wizard />;
}

/** Simple page for the session check and demo mode. */
function Plain({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center px-4 py-6 sm:px-8"><Brand /></header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 pb-16 pt-6 sm:px-8 sm:pt-12">{children}</main>
    </div>
  );
}

function DemoNotice() {
  return (
    <section aria-labelledby="demo-setup" className="border-t border-ink pt-8">
      <h1 id="demo-setup" className="flex flex-wrap items-center gap-3 text-[2.5rem] tracking-[-0.03em]">
        Account setup<DemoTag />
      </h1>
      <p className="mt-4 max-w-lg text-base text-ink-muted">
        You're exploring sample data. There's no account to set up and nothing is saved. Create an account to set up
        your own profile.
      </p>
      <ButtonLink to="/app" variant="secondary" className="mt-8">Back to the demo</ButtonLink>
    </section>
  );
}

type Unsaved = { preferences: boolean; allergies: boolean; target: boolean; budget: boolean };
const UNSAVED_LABELS: Record<keyof Unsaved, string> = {
  preferences: "food preferences", allergies: "allergies", target: "the target form", budget: "the budget form",
};

function Wizard() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { markOnboardingComplete, logout, deferOnboarding } = useSession();
  const [params, setParams] = useSearchParams();
  const bundle = useQuery({ queryKey: liveKeys.profile, queryFn: ({ signal }) => profileApi.get(signal) });
  const [signingOut, setSigningOut] = useState(false);

  // The furthest step the server has recorded; a refresh may reopen any step up to it.
  const savedStep = clampStep(bundle.data?.profile?.onboarding_step ?? 1);
  const requested = Number(params.get("step"));
  const [chosen, setChosen] = useState<number | null>(null);
  const current = chosen ?? (requested >= 1 && requested <= savedStep ? Math.trunc(requested) : savedStep);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [visited, setVisited] = useState<Set<number>>(() => new Set());
  const [unsaved, setUnsaved] = useState<Unsaved>({ preferences: false, allergies: false, target: false, budget: false });
  const [blocked, setBlocked] = useState<string | null>(null);

  const goTo = useCallback((n: number) => {
    setVisited((v) => new Set(v).add(current));
    setDirection(n >= current ? 1 : -1);
    setChosen(n);
    setBlocked(null);
    setParams({ step: String(n) }, { replace: true });
  }, [current, setParams]);

  const track = useCallback((key: keyof Unsaved) => (value: boolean) =>
    setUnsaved((u) => (u[key] === value ? u : { ...u, [key]: value })), []);
  const onPreferences = useCallback((d: boolean) => track("preferences")(d), [track]);
  const onAllergies = useCallback((d: boolean) => track("allergies")(d), [track]);
  const onTarget = useCallback((d: boolean) => track("target")(d), [track]);
  const onBudget = useCallback((d: boolean) => track("budget")(d), [track]);

  // Record progress on the server before moving on, so a refresh resumes here.
  const advance = useMutation({
    mutationFn: async (next: number) => {
      const fresh = await queryClient.fetchQuery({ queryKey: liveKeys.profile, staleTime: 0,
                                                   queryFn: ({ signal }) => profileApi.get(signal) });
      if (!fresh.profile) return "no-profile" as const;
      if (fresh.profile.onboarding_step >= next) return "ok" as const;
      const updated = await profileApi.update({ ...inputFrom(fresh.profile), onboarding_step: next });
      queryClient.setQueryData<ProfileBundle>(liveKeys.profile, (b) => (b ? { ...b, profile: updated } : b));
      return "ok" as const;
    },
    onSuccess: (result, next) => goTo(result === "no-profile" ? 2 : next),
  });

  const continueFrom = (step: number, keys: Array<keyof Unsaved>) => {
    if (advance.isPending) return;
    const open = keys.filter((k) => unsaved[k]).map((k) => UNSAVED_LABELS[k]);
    if (open.length) {
      setBlocked(`You have unsaved changes in ${open.join(" and ")}. Save or discard them before continuing.`);
      return;
    }
    setBlocked(null);
    advance.mutate(step + 1);
  };

  const finish = useMutation({
    mutationFn: profileApi.completeOnboarding,
    onSuccess: async () => {
      // Refresh everything the dashboard and other pages show before leaving setup.
      await queryClient.invalidateQueries({ queryKey: ["live"] });
      markOnboardingComplete();
      navigate("/app", { replace: true });
    },
  });

  // Move focus to the new step's heading so keyboard and screen-reader users start there.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [current]);

  // Clear a stale "unsaved changes" message once the student resolves it.
  useEffect(() => { if (blocked && !Object.values(unsaved).some(Boolean)) setBlocked(null); }, [unsaved, blocked]);

  const step = STEPS[current - 1] ?? STEPS[0];
  const mounted = new Set(visited).add(current);
  const data = bundle.data;
  const hasTarget = Boolean(data?.active_target);
  const advanceError = advance.isError
    ? <ErrorState title="Couldn't save your progress" onRetry={() => advance.mutate(current + 1)}
                  message={`${apiMessage(advance.error)} Everything you entered is still here.`} />
    : null;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(17rem,24rem)_1fr]">
      <StepRail current={current} savedStep={savedStep} />

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 sm:px-8 lg:px-12">
          <span className="lg:invisible"><Brand /></span>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { deferOnboarding(); navigate("/app"); }}>Finish later</Button>
            <Button variant="ghost" size="sm" loading={signingOut} icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                    onClick={async () => { setSigningOut(true); await logout(); }}>
              Sign out
            </Button>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="flex flex-1 flex-col px-4 pb-10 pt-8 outline-none sm:px-8 sm:pt-12 lg:px-12 lg:pt-16">
          <div className="mx-auto w-full max-w-3xl">
            <ProgressRow current={current} />

            {!data ? (
              bundle.isError
                ? <ErrorState title="Couldn't load your setup" message={apiMessage(bundle.error)} onRetry={() => bundle.refetch()} />
                : <LoadingState label="Loading your setup" />
            ) : (
                <>
                  <div className="mt-10 sm:mt-14">
                    <h1 ref={heading} tabIndex={-1}
                        className="text-[2.5rem] leading-[1.02] tracking-[-0.035em] outline-none sm:text-[3.5rem] lg:text-[4rem]">
                      {step.title}
                    </h1>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {step.optional && (
                        <span className="rounded-full border border-ink px-3 py-0.5 text-xs">Optional · skip any time</span>
                      )}
                      {step.lead && <p className="max-w-xl text-base text-ink-muted">{step.lead}</p>}
                    </div>
                  </div>

                  <div className="mt-10 sm:mt-12">
                    <Panel step={1} current={current} mounted={mounted} direction={direction}>
                      <Welcome name={data.profile?.display_name ?? null} onStart={() => goTo(2)} />
                    </Panel>

                    <Panel step={2} current={current} mounted={mounted} direction={direction}>
                      <PersonalProfileForm bundle={data}
                                           wizard={{ nextStep: 3, onSaved: () => goTo(3), onBack: () => goTo(1) }} />
                    </Panel>

                    <Panel step={3} current={current} mounted={mounted} direction={direction}>
                      <div className="space-y-6">
                        <PreferencesEditor saved={data.preferences ?? []} onDirtyChange={onPreferences} />
                        <AllergiesEditor saved={data.allergies ?? []} onDirtyChange={onAllergies} />
                      </div>
                      <p className="mt-6 text-sm text-ink-muted">
                        Each list is saved with its own Save button. You can change both later in Profile &amp; settings.
                      </p>
                      <StepActions onBack={() => goTo(2)} onNext={() => continueFrom(3, ["preferences", "allergies"])}
                                   busy={advance.isPending} blocked={blocked} error={advanceError}
                                   nextLabel={(data.preferences?.length || data.allergies?.length) ? "Continue" : "Skip for now"} />
                    </Panel>

                    <Panel step={4} current={current} mounted={mounted} direction={direction}>
                      <Note>
                        DeluluFit doesn't suggest a target and can't tell whether a number is right for you. A target from
                        a professional is stored as you enter it; it isn't verified.
                      </Note>
                      <div className="mt-6"><TargetsManager onEditingChange={onTarget} /></div>
                      <StepActions onBack={() => goTo(3)} onNext={() => continueFrom(4, ["target"])}
                                   busy={advance.isPending} blocked={blocked} error={advanceError}
                                   nextLabel={hasTarget ? "Continue" : "Skip for now"} />
                    </Panel>

                    <Panel step={5} current={current} mounted={mounted} direction={direction}>
                      <BudgetStep onEditingChange={onBudget} currency={data.profile?.currency ?? null}>
                        {(hasBudget) => (
                          <StepActions onBack={() => goTo(4)} onNext={() => continueFrom(5, ["budget"])}
                                       busy={advance.isPending} blocked={blocked} error={advanceError}
                                       nextLabel={hasBudget ? "Continue" : "Skip for now"} />
                        )}
                      </BudgetStep>
                    </Panel>

                    <Panel step={6} current={current} mounted={mounted} direction={direction}>
                      {current === LAST && <Review bundle={data} unsaved={unsaved} onEdit={goTo} />}
                      {finish.isError && (
                        <div className="mt-6">
                          <ErrorState title="Couldn't finish setup"
                                      message={finish.error instanceof ApiError && finish.error.code === "profile_incomplete"
                                        ? `${finish.error.message} Go back to “Your profile” and save it.`
                                        : `${apiMessage(finish.error)} Nothing you saved has been lost.`} />
                        </div>
                      )}
                      <StepActions onBack={() => goTo(5)} busy={finish.isPending} blocked={null} error={null}
                                   nextLabel={finish.isError ? "Try again" : "Finish setup"} finalStep
                                   onNext={() => { if (!finish.isPending) finish.mutate(); }} />
                    </Panel>
                  </div>
                </>
              )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Rail with the logo and the step list (lg and up). */
function StepRail({ current, savedStep }: { current: number; savedStep: number }) {
  return (
    <aside aria-label="Setup" className="sticky top-0 hidden h-screen flex-col overflow-y-auto bg-[rgb(var(--brand-ground))] text-white lg:flex">
      <BrandLogo decorative priority />
      <div className="px-10 pt-2">
        <p className="text-sm text-white/65">Set up your account</p>
      </div>
      <ol aria-label="Setup steps" className="mt-6 space-y-1 px-10">
        {STEPS.map((s, i) => {
          const n = i + 1;
          const active = n === current;
          // Saved = the server has recorded progress past this step.
          const saved = n < savedStep && n !== 1;
          return (
            <li key={s.title} aria-current={active ? "step" : undefined}
                className={cn("flex items-baseline gap-4 py-2 text-[0.95rem] transition-colors duration-500 ease-glide",
                              active ? "text-white" : saved ? "text-white/80" : "text-white/60")}>
              <span className="metric w-5 shrink-0 text-xs" aria-hidden="true">
                {saved && !active ? <Check className="h-3.5 w-3.5" /> : String(n).padStart(2, "0")}
              </span>
              <span className={cn("transition-[letter-spacing] duration-700 ease-glide", active && "underline decoration-1 underline-offset-[6px]")}>
                {s.title}
              </span>
              {saved && <span className="sr-only"> (saved)</span>}
              {s.optional && <span className="sr-only"> (optional)</span>}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/** Step count with a progress line that glides between steps. */
function ProgressRow({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-4">
      <p className="metric shrink-0 text-sm text-ink-muted">Step {current} of {LAST}</p>
      <div className="flex-1">
        <Progress value={current} max={LAST} label={`Setup progress: step ${current} of ${LAST}`} />
      </div>
    </div>
  );
}

/**
 * Only mounted steps render; hidden ones keep their unsaved state. The active step glides in
 * from the direction of travel (no motion when the visitor prefers reduced motion).
 */
function Panel({ step, current, mounted, direction, children }:
  { step: number; current: number; mounted: Set<number>; direction: 1 | -1; children: ReactNode }) {
  const active = step === current;
  const [shown, setShown] = useState(active);
  useEffect(() => {
    if (!active) { setShown(false); return; }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [active]);
  if (!mounted.has(step)) return null;
  return (
    <div hidden={!active} data-step={step}
         className={cn("transition-[opacity,transform] duration-700 ease-glide motion-reduce:transition-none",
                       shown ? "translate-x-0 opacity-100"
                             : cn("opacity-0", direction === 1 ? "translate-x-6" : "-translate-x-6"))}>
      {children}
    </div>
  );
}

function StepActions({ onBack, onNext, nextLabel, busy, blocked, error, finalStep = false }:
  { onBack: () => void; onNext: () => void; nextLabel: string; busy: boolean; blocked: string | null;
    error: ReactNode; finalStep?: boolean }) {
  return (
    <div className="mt-10 space-y-4">
      {blocked && <p role="alert" className="rounded-control border border-ink px-4 py-3 text-sm shadow-card">{blocked}</p>}
      {error}
      {/* On phones the actions stay within reach at the bottom of the screen. */}
      <div className="sticky bottom-0 -mx-4 flex gap-3 border-t border-line bg-canvas px-4 py-4 sm:static sm:mx-0 sm:justify-between sm:px-0 sm:pt-6">
        <Button variant="secondary" size="lg" onClick={onBack} disabled={busy} className="sm:min-w-[8rem]"
                icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
          Back
        </Button>
        <Button size="lg" onClick={onNext} loading={busy} className="flex-1 sm:min-w-[12rem] sm:flex-none"
                icon={busy ? undefined : finalStep ? <Check className="h-4 w-4" aria-hidden="true" /> : undefined}>
          {nextLabel}
          {!busy && !finalStep && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-3 border-l border-ink pl-4 text-sm text-ink-muted">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function Welcome({ name, onStart }: { name: string | null; onStart: () => void }) {
  return (
    <div>
      <p className="max-w-2xl text-2xl font-light leading-snug tracking-[-0.015em] sm:text-[1.75rem]">
        {name ? <>Hi {name}. </> : null}Let's set up DeluluFit. It takes a few minutes.
      </p>

      <ol className="mt-10 border-t border-ink">
        {STEPS.slice(1, -1).map((s, i) => (
          <li key={s.title} className="flex items-baseline justify-between gap-4 border-b border-line py-4">
            <span className="flex items-baseline gap-5">
              <span className="metric w-5 text-xs text-ink-muted" aria-hidden="true">{String(i + 2).padStart(2, "0")}</span>
              <span className="text-base">{s.title}</span>
            </span>
            <span className="shrink-0 text-sm text-ink-muted">{s.optional ? "Optional" : "Your name is required"}</span>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-6 text-sm text-ink-muted sm:grid-cols-2">
        <p>Each step is saved to your account when you save or continue, so you can stop and come back later. Changes
          you haven't saved are kept only on this page.</p>
        <p>Everything here can be changed later in Profile &amp; settings.</p>
      </div>

      <div className="mt-8">
        <Note>
          DeluluFit shows general nutrition estimates for awareness and budgeting. It isn't medical advice, and it doesn't
          check foods or menus against allergies.
        </Note>
      </div>

      <div className="mt-12">
        <Button size="lg" onClick={onStart} className="w-full sm:w-auto sm:min-w-[14rem]">
          Get started <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function BudgetStep({ currency, onEditingChange, children }:
  { currency: string | null; onEditingChange: (editing: boolean) => void; children: (hasBudget: boolean) => ReactNode }) {
  // Same query key as BudgetSettings, so this reads its cached, server-confirmed data.
  const overview = useQuery({ queryKey: liveKeys.budgetOverview, queryFn: ({ signal }) => budgetApi.overview(signal) });
  return (
    <>
      <Note>
        It uses your profile currency{currency ? ` (${currency})` : ""}. Without a budget, DeluluFit still totals what
        you record.
      </Note>
      <div className="mt-6"><BudgetSettings onEditingChange={onEditingChange} /></div>
      {children(Boolean(overview.data?.active))}
    </>
  );
}

function ReviewSection({ title, step, onEdit, children }:
  { title: string; step: number; onEdit: (n: number) => void; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-6 sm:grid-cols-[12rem_1fr_auto] sm:gap-8">
      <h2 className="text-base font-normal">{title}</h2>
      <div className="min-w-0 text-sm">{children}</div>
      <Button variant="ghost" size="sm" onClick={() => onEdit(step)} aria-label={`Edit ${title.toLowerCase()}`}
              className="justify-self-start sm:justify-self-end">
        Edit
      </Button>
    </div>
  );
}

function Review({ bundle, unsaved, onEdit }: { bundle: ProfileBundle; unsaved: Unsaved; onEdit: (n: number) => void }) {
  const overview = useQuery({ queryKey: liveKeys.budgetOverview, queryFn: ({ signal }) => budgetApi.overview(signal) });
  const p = bundle.profile;
  const target = bundle.active_target ?? null;
  const open = (Object.keys(unsaved) as Array<keyof Unsaved>).filter((k) => unsaved[k]).map((k) => UNSAVED_LABELS[k]);
  const notSet = <span className="text-ink-muted">Not set (optional)</span>;

  return (
    <section aria-label="What's saved" className="border-t border-ink">
      {open.length > 0 && (
        <p role="status" className="mt-6 rounded-control border border-ink px-4 py-3 text-sm shadow-card">
          Not saved yet: {open.join(", ")}. Go back and save, or they won't be kept.
        </p>
      )}
      <ReviewSection title="Your profile" step={2} onEdit={onEdit}>
        {p ? (
          <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            <div><dt className="inline text-ink-muted">Name: </dt><dd className="inline">{p.display_name}</dd></div>
            <div><dt className="inline text-ink-muted">Eating pattern: </dt>
              <dd className="inline">{DIETARY_PATTERN_LABELS[p.dietary_pattern as DietaryPattern] ?? p.dietary_pattern}</dd></div>
            <div><dt className="inline text-ink-muted">College: </dt><dd className="inline">{bundle.institution?.name ?? "Not set"}</dd></div>
            <div><dt className="inline text-ink-muted">Hostel: </dt><dd className="inline">{bundle.hostel?.name ?? "Not set"}</dd></div>
            <div><dt className="inline text-ink-muted">Currency: </dt><dd className="inline">{p.currency}</dd></div>
            <div><dt className="inline text-ink-muted">Time zone: </dt><dd className="inline">{p.timezone.replace(/_/g, " ")}</dd></div>
          </dl>
        ) : <span className="text-danger">Not saved yet. Your name is required.</span>}
      </ReviewSection>
      <ReviewSection title="Food preferences" step={3} onEdit={onEdit}>
        {bundle.preferences?.length
          ? <ul className="space-y-1">{bundle.preferences.map((x) => <li key={x.id}>{x.label}: {PREFERENCE_LABELS[x.preference].toLowerCase()}</li>)}</ul>
          : notSet}
      </ReviewSection>
      <ReviewSection title="Allergies" step={3} onEdit={onEdit}>
        {bundle.allergies?.length ? (
          <>
            <ul className="space-y-1">
              {bundle.allergies.map((a) => (
                <li key={a.id}>{a.allergen === "other" ? a.custom_label : ALLERGEN_LABELS[a.allergen]} ({SEVERITY_LABELS[a.severity].toLowerCase()})</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">Recorded for your reference. DeluluFit doesn't check meals or menus against them.</p>
          </>
        ) : notSet}
      </ReviewSection>
      <ReviewSection title="Nutrition target" step={4} onEdit={onEdit}>
        {target ? (
          <>
            <p>{TARGET_SOURCE_LABELS[target.source]}</p>
            <p className="text-ink-muted">
              {(["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g"] as const)
                .filter((k) => target[k] !== null)
                .map((k) => `${NUTRIENT_LABELS[k]} ${formatAmount(String(Number(target[k])), k === "energy_kcal" ? "kcal" : "g")}`)
                .join(" · ")}
            </p>
          </>
        ) : notSet}
      </ReviewSection>
      <ReviewSection title="Food budget" step={5} onEdit={onEdit}>
        {overview.isPending ? <span className="text-ink-muted">Loading…</span>
          : overview.isError ? <ErrorState message={apiMessage(overview.error)} onRetry={() => overview.refetch()} />
          : overview.data.active
            ? <>{formatMoney(overview.data.active.amount, overview.data.active.currency)} per {PERIOD_NOUN[overview.data.active.period]}</>
            : notSet}
      </ReviewSection>
      <p className="mt-6 text-xs text-ink-muted">You can change any of this later in Profile &amp; settings.</p>
    </section>
  );
}
