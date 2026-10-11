import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { emptyDay, noBudget } from "@/test/fixtures";
import { mockApi, NEW_USER, renderApp, USER, type Handler } from "@/test/utils";
import type { Budget, FoodPreference, NutritionTarget, Profile, SessionResponse, UserAllergy } from "@/types/api";

/*
 * A small in-memory stand-in for the backend, following the semantics verified in
 * backend/app (profile_service, auth routes): PUT /profile replaces every field and only ever
 * raises onboarding_step; complete-onboarding needs a profile, is idempotent, and is what the
 * session's onboarding_completed reports.
 */
type Fail = { status: number; code: string; message: string };

function fakeBackend(start: { user?: SessionResponse; signedIn?: boolean; profile?: Partial<Profile> | null;
                              preferences?: FoodPreference[] } = {}) {
  const account = start.user ?? NEW_USER;
  const db = {
    signedIn: start.signedIn ?? true,
    profile: start.profile === null ? null : {
      display_name: "Asha", height_cm: null, weight_kg: null, activity_level: null, dietary_pattern: "no_preference",
      currency: "INR", timezone: "Asia/Kolkata", institution_id: null, hostel_id: null, onboarding_step: 1,
      onboarding_completed_at: account.user.onboarding_completed ? "2026-10-01T00:00:00Z" : null, ...start.profile,
    } as Profile | null,
    preferences: start.preferences ?? [] as FoodPreference[],
    allergies: [] as UserAllergy[],
    target: null as NutritionTarget | null,
    budget: null as Budget | null,
  };
  const failures: Record<string, Fail[]> = {};
  const holds: Record<string, Promise<void>> = {};

  const session = () => ({ csrf_token: account.csrf_token, user: { ...account.user, has_profile: db.profile !== null,
                                                                   onboarding_completed: Boolean(db.profile?.onboarding_completed_at) } });
  const unauth = { status: 401, body: { error: { code: "session_expired", message: "Your session has expired. Please sign in again.",
                                                 details: null, request_id: "r" } } };
  const body = (init?: RequestInit) => JSON.parse(String(init?.body ?? "{}"));

  const routes: Record<string, Handler> = {
    "GET /api/v1/auth/session": () => (db.signedIn ? { status: 200, body: session() } : unauth),
    "POST /api/v1/auth/login": () => { db.signedIn = true; return { status: 200, body: session() }; },
    "POST /api/v1/auth/register": (init) => {
      db.signedIn = true;
      const name = body(init).display_name as string | null;
      if (name && db.profile) db.profile = { ...db.profile, display_name: name, onboarding_step: 1 };
      return { status: 201, body: session() };
    },
    "POST /api/v1/auth/logout": () => { db.signedIn = false; return { status: 204 }; },
    "GET /api/v1/profile": () => ({ status: 200, body: {
      profile: db.profile, preferences: db.preferences, allergies: db.allergies, institution: null, hostel: null,
      active_target: db.target } }),
    "PUT /api/v1/profile": (init) => {
      const { onboarding_step: step, ...fields } = body(init);
      const prev = db.profile;
      const nextStep = prev === null ? (step ?? 1)
        : step != null && !prev.onboarding_completed_at ? Math.max(prev.onboarding_step, step) : prev.onboarding_step;
      db.profile = { ...fields, onboarding_step: nextStep, onboarding_completed_at: prev?.onboarding_completed_at ?? null };
      return { status: 200, body: db.profile };
    },
    "PUT /api/v1/profile/preferences": (init) => {
      db.preferences = body(init).items.map((x: FoodPreference, i: number) => ({ ...x, id: `p${i}`, food_id: null }));
      return { status: 200, body: db.preferences };
    },
    "PUT /api/v1/profile/allergies": (init) => {
      db.allergies = body(init).items.map((x: UserAllergy, i: number) => ({ ...x, id: `a${i}` }));
      return { status: 200, body: db.allergies };
    },
    "GET /api/v1/targets": () => ({ status: 200, body: db.target ? [db.target] : [] }),
    "PUT /api/v1/targets/active": (init) => {
      const b = body(init);
      db.target = { id: "t1", source: b.source, energy_kcal: b.energy_kcal, protein_g: b.protein_g, carbohydrate_g: b.carbohydrate_g,
                    fat_g: b.fat_g, fibre_g: b.fibre_g, effective_from: "2026-10-11", effective_to: null, notes: b.notes };
      return { status: 200, body: db.target };
    },
    "GET /api/v1/budget": () => ({ status: 200, body: { active: db.budget, history: db.budget ? [db.budget] : [] } }),
    "PUT /api/v1/budget/active": (init) => {
      const b = body(init);
      db.budget = { id: "b1", period: b.period, amount: b.amount, currency: db.profile?.currency ?? "INR",
                    effective_from: "2026-10-11", effective_to: null };
      return { status: 200, body: db.budget };
    },
    "POST /api/v1/profile/complete-onboarding": () => {
      if (!db.profile) return { status: 422, body: { error: { code: "profile_incomplete",
        message: "Add your name and food preferences before finishing setup.", details: null, request_id: "r" } } };
      db.profile = { ...db.profile, onboarding_completed_at: db.profile.onboarding_completed_at ?? "2026-10-11T08:00:00Z" };
      return { status: 200, body: db.profile };
    },
    "GET /api/v1/meals/day": () => emptyDay,
    "GET /api/v1/budget/summary": () => noBudget,
  };

  // Every route (except the session check) answers 401 once the session has expired.
  const handlers = Object.fromEntries(Object.entries(routes).map(([key, handler]) => [key, (async (init, url) => {
    if (holds[key]) await holds[key];
    const fail = failures[key]?.shift();
    if (fail) return { status: fail.status, body: { error: { code: fail.code, message: fail.message, details: null, request_id: "r" } } };
    if (!db.signedIn && !key.includes("/auth/")) return unauth;
    return handler(init, url);
  }) as Handler]));
  const fetchMock = mockApi(handlers);

  return {
    db, fetchMock,
    failNext(key: string, fail: Fail = { status: 500, code: "internal_error", message: "Something went wrong on our side." }) {
      (failures[key] ??= []).push(fail);
    },
    /** Hold responses for `key` until the returned function is called. */
    hold(key: string) {
      let release!: () => void;
      holds[key] = new Promise<void>((r) => { release = r; });
      return () => { delete holds[key]; release(); };
    },
    calls(method: string, path: string) {
      return fetchMock.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === method && new URL(String(u), "http://x").pathname === path);
    },
    callIndex(method: string, path: string) {
      return fetchMock.mock.calls.map(([u, i], n) => ((i?.method ?? "GET") === method && new URL(String(u), "http://x").pathname === path ? n : -1))
        .filter((n) => n >= 0);
    },
  };
}

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const stepHeading = (name: string | RegExp) => screen.findByRole("heading", { level: 1, name });
const visibleStep = () => document.querySelector<HTMLElement>("[data-step]:not([hidden])")!;

async function startSetup(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Get started" }));
  return within(await screen.findByRole("form", { name: "Personal profile" }));
}

describe("registration and sign-in", () => {
  it("sends a new account to setup, saves every section, and reaches the dashboard after finishing", async () => {
    const api = fakeBackend({ signedIn: false });
    const user = userEvent.setup();
    const { router } = renderApp("/register");

    await user.type(await screen.findByLabelText(/What should we call you/), "Riya");
    await user.type(screen.getByLabelText("Email"), "new@example.test");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse battery");
    await user.click(screen.getByLabelText(/not medical advice/));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/app/onboarding"));
    expect(await stepHeading("Welcome")).toBeInTheDocument();
    expect(screen.getByText(/Hi Riya/)).toBeInTheDocument();
    expect(screen.getByText(/isn't medical advice, and it doesn't check foods or menus against allergies/)).toBeInTheDocument();

    // Step 2: the name from registration is already there; saving records progress (step 3).
    const form = await startSetup(user);
    expect(form.getByLabelText("Name")).toHaveValue("Riya");
    await user.selectOptions(form.getByLabelText(/Eating pattern/), "vegetarian");
    await user.click(form.getByRole("button", { name: "Save and continue" }));
    expect(await stepHeading(/Food preferences and allergies/)).toBeInTheDocument();
    const put = bodyOf(api.calls("PUT", "/api/v1/profile")[0]);
    expect(put).toMatchObject({ display_name: "Riya", dietary_pattern: "vegetarian", currency: "INR",
                                timezone: "Asia/Kolkata", onboarding_step: 3 });

    // Step 3: add and save a preference and an allergy, then continue.
    const step3 = within(visibleStep());
    await user.type(step3.getByLabelText("Food"), "Rajma");
    await user.click(step3.getByRole("button", { name: "Add" }));
    await user.click(step3.getByRole("button", { name: "Save food preferences" }));
    expect(await step3.findByText("Food preferences saved.")).toBeInTheDocument();
    await user.selectOptions(step3.getByLabelText("Allergen"), "peanut");
    await user.selectOptions(step3.getByLabelText("Severity"), "severe");
    await user.click(step3.getByRole("button", { name: "Add allergy" }));
    await user.click(step3.getByRole("button", { name: "Save allergies" }));
    expect(await step3.findByText("Allergies saved.")).toBeInTheDocument();
    await user.click(step3.getByRole("button", { name: "Continue" }));
    expect(await stepHeading(/Nutrition targets/)).toBeInTheDocument();
    await waitFor(() => expect(api.db.profile?.onboarding_step).toBe(4));

    // Step 4: a self-set target, described as the student's own number.
    const step4 = within(visibleStep());
    expect(step4.getByText(/doesn't\s+suggest a target/)).toBeInTheDocument();
    await user.click(await step4.findByRole("button", { name: "Set a target" }));
    await user.type(step4.getByLabelText(/Energy/), "2000");
    await user.click(step4.getByRole("button", { name: "Save target" }));
    await user.click(await step4.findByRole("button", { name: "Continue" }));
    expect(await stepHeading(/Food budget/)).toBeInTheDocument();
    expect(bodyOf(api.calls("PUT", "/api/v1/targets/active")[0])).toMatchObject({ source: "self_set", energy_kcal: "2000" });

    // Step 5: a weekly budget.
    const step5 = within(visibleStep());
    await user.click(await step5.findByRole("button", { name: "Set a budget" }));
    await user.clear(step5.getByLabelText(/Amount/));
    await user.type(step5.getByLabelText(/Amount/), "1500");
    await user.click(step5.getByRole("button", { name: "Save budget" }));
    await user.click(await step5.findByRole("button", { name: "Continue" }));
    expect(await stepHeading(/Review and finish/)).toBeInTheDocument();

    // Review shows what the server has saved.
    const review = within(screen.getByRole("region", { name: "What's saved" }));
    expect(review.getByText("Riya")).toBeInTheDocument();
    expect(review.getByText("Vegetarian")).toBeInTheDocument();
    expect(review.getByText("Rajma: like")).toBeInTheDocument();
    expect(review.getByText(/Peanut \(severe\)/)).toBeInTheDocument();
    expect(review.getByText(/doesn't check meals or menus/)).toBeInTheDocument();
    expect(review.getByText("Energy 2,000 kcal")).toBeInTheDocument();
    expect(review.getByText(/^₹1,500(.00)? per week$/)).toBeInTheDocument();

    const profileGetsBefore = api.calls("GET", "/api/v1/profile").length;
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(api.calls("POST", "/api/v1/profile/complete-onboarding")).toHaveLength(1);
    // Cached profile data was refreshed after completing, before the dashboard showed it.
    const completeAt = api.callIndex("POST", "/api/v1/profile/complete-onboarding")[0]!;
    expect(api.callIndex("GET", "/api/v1/profile").some((n) => n > completeAt)).toBe(true);
    expect(api.calls("GET", "/api/v1/profile").length).toBeGreaterThan(profileGetsBefore);
    expect(await screen.findByRole("heading", { level: 1, name: /Riya/ })).toBeInTheDocument();
    expect(screen.queryByText(/setup isn't finished/)).not.toBeInTheDocument();
  }, 20_000);  // a full journey: types into about fifteen fields

  it("takes an existing, set-up account straight to the dashboard and never into setup", async () => {
    const api = fakeBackend({ user: USER, signedIn: false });
    const user = userEvent.setup();
    const { router } = renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), USER.user.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(await screen.findByText("No meals logged today")).toBeInTheDocument();
    expect(screen.queryByText(/setup isn't finished/)).not.toBeInTheDocument();

    // Opening the setup address directly just returns to the dashboard (once: no loop).
    await act(() => router.navigate("/app/onboarding"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(await screen.findByText("No meals logged today")).toBeInTheDocument();
    expect(api.calls("PUT", "/api/v1/profile")).toHaveLength(0);
  });

  it("offers setup to an account the server reports as not set up, but never forces it", async () => {
    fakeBackend({ signedIn: false });
    const user = userEvent.setup();
    const { router } = renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), NEW_USER.user.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/onboarding"));
    expect(await stepHeading("Welcome")).toBeInTheDocument();

    // "Finish later": the app is usable, with a reminder, and other pages don't bounce back.
    await user.click(screen.getByRole("button", { name: "Finish later" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(await screen.findByText(/setup isn't finished/)).toBeInTheDocument();
    await act(() => router.navigate("/app/meals"));
    await new Promise((r) => setTimeout(r, 50));
    expect(router.state.location.pathname).toBe("/app/meals");

    // The reminder leads back into setup.
    await act(() => router.navigate("/app"));
    await user.click(await screen.findByRole("link", { name: "Finish setup" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/onboarding"));

    // Signing out and in again offers setup again.
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    await user.type(await screen.findByLabelText("Email"), NEW_USER.user.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/onboarding"));
  });
});

describe("steps", () => {
  it("validates the profile step before saving or moving on", async () => {
    const api = fakeBackend();
    const user = userEvent.setup();
    renderApp("/app/onboarding");
    const form = await startSetup(user);
    await user.clear(form.getByLabelText("Name"));
    await user.type(form.getByLabelText(/Height/), "12");
    await user.click(form.getByRole("button", { name: "Save and continue" }));
    expect(await form.findByText("Enter a name.")).toBeInTheDocument();
    expect(form.getByText("Height must be between 50 and 272.")).toBeInTheDocument();
    expect(api.calls("PUT", "/api/v1/profile")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "Your profile" })).toBeInTheDocument();
  });

  it("keeps entries when going back, and won't continue past unsaved list changes", async () => {
    const api = fakeBackend();
    const user = userEvent.setup();
    renderApp("/app/onboarding");
    let form = await startSetup(user);

    // Back from step 2 keeps what was typed.
    await user.type(form.getByLabelText(/Weight/), "55");
    await user.click(form.getByRole("button", { name: "Back" }));
    expect(await stepHeading("Welcome")).toBeInTheDocument();
    form = await startSetup(user);
    expect(form.getByLabelText(/Weight/)).toHaveValue("55");
    await user.click(form.getByRole("button", { name: "Save and continue" }));
    expect(await stepHeading(/Food preferences/)).toBeInTheDocument();

    // An unsaved preference survives Back and Continue…
    let step3 = within(visibleStep());
    await user.type(step3.getByLabelText("Food"), "Poha");
    await user.click(step3.getByRole("button", { name: "Add" }));
    await user.click(step3.getByRole("button", { name: "Back" }));
    form = within(await screen.findByRole("form", { name: "Personal profile" }));
    await user.click(form.getByRole("button", { name: "Save and continue" }));
    step3 = within(await waitFor(() => { const el = visibleStep(); expect(el.dataset.step).toBe("3"); return el; }));
    expect(step3.getByText("Poha")).toBeInTheDocument();
    expect(step3.getByText("Unsaved changes")).toBeInTheDocument();

    // …but Continue explains it must be saved or discarded first, and records nothing.
    const putsBefore = api.calls("PUT", "/api/v1/profile").length;
    await user.click(step3.getByRole("button", { name: /Continue|Skip for now/ }));
    expect(await step3.findByRole("alert")).toHaveTextContent("unsaved changes in food preferences");
    expect(api.calls("PUT", "/api/v1/profile")).toHaveLength(putsBefore);
    expect(screen.getByRole("heading", { level: 1, name: /Food preferences/ })).toBeInTheDocument();

    await user.click(step3.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(step3.queryByRole("alert")).not.toBeInTheDocument());
    await user.click(step3.getByRole("button", { name: "Skip for now" }));
    expect(await stepHeading(/Nutrition targets/)).toBeInTheDocument();
    expect(api.calls("PUT", "/api/v1/profile/preferences")).toHaveLength(0);
  });

  it("skips the optional steps without saving anything for them", async () => {
    const api = fakeBackend();
    const user = userEvent.setup();
    const { router } = renderApp("/app/onboarding");
    const form = await startSetup(user);
    await user.click(form.getByRole("button", { name: "Save and continue" }));
    for (const title of [/Nutrition targets/, /Food budget/, /Review and finish/]) {
      await user.click(within(visibleStep()).getByRole("button", { name: "Skip for now" }));
      expect(await stepHeading(title)).toBeInTheDocument();
    }
    const review = within(screen.getByRole("region", { name: "What's saved" }));
    await waitFor(() => expect(review.getAllByText("Not set (optional)")).toHaveLength(4));
    expect(api.calls("PUT", "/api/v1/profile/preferences")).toHaveLength(0);
    expect(api.calls("PUT", "/api/v1/profile/allergies")).toHaveLength(0);
    expect(api.calls("PUT", "/api/v1/targets/active")).toHaveLength(0);
    expect(api.calls("PUT", "/api/v1/budget/active")).toHaveLength(0);
    expect(api.db.profile?.onboarding_step).toBe(6);

    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(api.db.target).toBeNull();   // no nutrition defaults were created
  });
});

describe("failures and retries", () => {
  it("keeps entries after a failed save and continues on retry", async () => {
    const api = fakeBackend();
    const user = userEvent.setup();
    renderApp("/app/onboarding");
    const form = await startSetup(user);
    await user.clear(form.getByLabelText("Name"));
    await user.type(form.getByLabelText("Name"), "Meera");
    api.failNext("PUT /api/v1/profile");
    await user.click(form.getByRole("button", { name: "Save and continue" }));
    expect(await form.findByText("Couldn't save your profile")).toBeInTheDocument();
    expect(form.getByLabelText("Name")).toHaveValue("Meera");
    expect(screen.getByRole("heading", { level: 1, name: "Your profile" })).toBeInTheDocument();
    expect(api.db.profile?.display_name).toBe("Asha");

    await user.click(form.getByRole("button", { name: "Save and continue" }));
    expect(await stepHeading(/Food preferences/)).toBeInTheDocument();
    expect(api.db.profile?.display_name).toBe("Meera");

    // Recording progress can fail too; Try again resumes without losing anything.
    api.failNext("PUT /api/v1/profile");
    await user.click(within(visibleStep()).getByRole("button", { name: "Skip for now" }));
    expect(await screen.findByText("Couldn't save your progress")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: /Food preferences/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await stepHeading(/Nutrition targets/)).toBeInTheDocument();
    expect(api.db.profile?.onboarding_step).toBe(4);
  });

  it("shows a finishing error, keeps everything saved, and finishes on retry", async () => {
    const api = fakeBackend({ profile: { onboarding_step: 6 } });
    const user = userEvent.setup();
    const { router } = renderApp("/app/onboarding");
    expect(await stepHeading(/Review and finish/)).toBeInTheDocument();
    api.failNext("POST /api/v1/profile/complete-onboarding");
    await user.click(screen.getByRole("button", { name: "Finish setup" }));
    expect(await screen.findByText("Couldn't finish setup")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/onboarding");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(api.db.profile?.onboarding_completed_at).not.toBeNull();
  });

  it("sends only one request when Save or Finish is pressed repeatedly", async () => {
    const api = fakeBackend();
    const user = userEvent.setup();
    const { router } = renderApp("/app/onboarding");
    const form = await startSetup(user);
    let release = api.hold("PUT /api/v1/profile");
    const save = form.getByRole("button", { name: "Save and continue" });
    await user.click(save);
    await user.click(save);
    await user.dblClick(save);
    release();
    expect(await stepHeading(/Food preferences/)).toBeInTheDocument();
    expect(api.calls("PUT", "/api/v1/profile")).toHaveLength(1);

    for (let i = 0; i < 3; i++) await user.click(within(visibleStep()).getByRole("button", { name: "Skip for now" }));
    expect(await stepHeading(/Review and finish/)).toBeInTheDocument();
    release = api.hold("POST /api/v1/profile/complete-onboarding");
    const finish = screen.getByRole("button", { name: "Finish setup" });
    await user.click(finish);
    await user.click(finish);
    expect(finish).toBeDisabled();
    release();
    await waitFor(() => expect(router.state.location.pathname).toBe("/app"));
    expect(api.calls("POST", "/api/v1/profile/complete-onboarding")).toHaveLength(1);
  });
});

describe("resuming", () => {
  it("resumes at the furthest saved step with saved data after a refresh; unsaved drafts are not kept", async () => {
    const api = fakeBackend({ profile: { onboarding_step: 4 },
                              preferences: [{ id: "p1", label: "Rajma", preference: "like", food_id: null }] });
    const user = userEvent.setup();
    let view = renderApp("/app/onboarding");
    expect(await stepHeading(/Nutrition targets/)).toBeInTheDocument();
    expect(screen.getByText("Step 4 of 6")).toBeInTheDocument();

    // Saved progress is marked; Back shows the saved list.
    const steps = within(screen.getByRole("list", { name: "Setup steps" }));
    expect(steps.getByText("Your profile").closest("li")).toHaveTextContent("(saved)");
    expect(steps.getByText(/Food preferences/).closest("li")).toHaveTextContent("(saved)");
    expect(steps.getByText("Nutrition targets").closest("li")).not.toHaveTextContent("(saved)");
    await user.click(within(visibleStep()).getByRole("button", { name: "Back" }));
    const step3 = within(visibleStep());
    expect(step3.getByText("Rajma")).toBeInTheDocument();
    await user.type(step3.getByLabelText("Food"), "Poha");
    await user.click(step3.getByRole("button", { name: "Add" }));
    expect(view.router.state.location.search).toBe("?step=3");

    // Refresh: same step (from the address), saved data back, the unsaved draft gone.
    view.unmount();
    view = renderApp("/app/onboarding?step=3");
    expect(await stepHeading(/Food preferences/)).toBeInTheDocument();
    expect(within(visibleStep()).getByText("Rajma")).toBeInTheDocument();
    expect(within(visibleStep()).queryByText("Poha")).not.toBeInTheDocument();
    view.unmount();

    // An address beyond the saved progress can't skip ahead.
    renderApp("/app/onboarding?step=6");
    expect(await stepHeading(/Nutrition targets/)).toBeInTheDocument();
    expect(api.calls("PUT", "/api/v1/profile")).toHaveLength(0);
  });

  it("sends an expired session to sign in, then back to setup at the saved step", async () => {
    const api = fakeBackend({ profile: { onboarding_step: 3 } });
    const user = userEvent.setup();
    const { router } = renderApp("/app/onboarding");
    expect(await stepHeading(/Food preferences/)).toBeInTheDocument();

    api.db.signedIn = false;  // the server-side session expires
    await user.click(within(visibleStep()).getByRole("button", { name: "Skip for now" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(api.db.profile?.onboarding_step).toBe(3);

    await user.type(await screen.findByLabelText("Email"), NEW_USER.user.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/onboarding"));
    expect(await stepHeading(/Food preferences/)).toBeInTheDocument();
  });

  it("starts at the profile step for an account without a profile, and can't finish without one", async () => {
    const api = fakeBackend({ user: { ...NEW_USER, user: { ...NEW_USER.user, has_profile: false } }, profile: null });
    const user = userEvent.setup();
    renderApp("/app/onboarding?step=6");
    expect(await stepHeading("Welcome")).toBeInTheDocument();
    const form = await startSetup(user);
    expect(form.getByLabelText("Name")).toHaveValue("");
    await user.type(form.getByLabelText("Name"), "Kabir");
    await user.click(form.getByRole("button", { name: "Save and continue" }));
    expect(await stepHeading(/Food preferences/)).toBeInTheDocument();
    expect(api.db.profile).toMatchObject({ display_name: "Kabir", onboarding_step: 3 });
  });
});

describe("demo mode and accessibility", () => {
  it("keeps demo mode out of setup: no API calls, no redirects", async () => {
    window.sessionStorage.setItem("delulufit:demo", "1");
    const fetchMock = mockApi({});
    const { router } = renderApp("/app/onboarding");
    expect(await screen.findByText(/There's no account to set up and nothing is saved/)).toBeInTheDocument();
    expect(screen.getByText("Demo data")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish later" })).not.toBeInTheDocument();
    await act(() => router.navigate("/app"));
    expect(await screen.findByText(/Demo mode\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows progress, marks optional steps, moves focus to each step and works from the keyboard", async () => {
    fakeBackend();
    const user = userEvent.setup();
    renderApp("/app/onboarding");
    expect(await stepHeading("Welcome")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Setup progress: step 1 of 6" })).toBeInTheDocument();
    const steps = within(screen.getByRole("list", { name: "Setup steps" }));
    expect(steps.getByText("Welcome").closest("li")).toHaveAttribute("aria-current", "step");
    expect(steps.getByText("Nutrition targets").closest("li")).toHaveTextContent("(optional)");

    // Keyboard only: reach "Get started" and press Enter.
    const start = screen.getByRole("button", { name: "Get started" });
    start.focus();
    await user.keyboard("{Enter}");
    const heading = await stepHeading("Your profile");
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("progressbar", { name: "Setup progress: step 2 of 6" })).toBeInTheDocument();
    expect(steps.getByText("Your profile").closest("li")).toHaveAttribute("aria-current", "step");
    // Every field in the step has an accessible name.
    const form = screen.getByRole("form", { name: "Personal profile" });
    for (const el of within(form).getAllByRole("textbox")) expect(el).toHaveAccessibleName();
    for (const el of within(form).getAllByRole("combobox")) expect(el).toHaveAccessibleName();
  });
});
