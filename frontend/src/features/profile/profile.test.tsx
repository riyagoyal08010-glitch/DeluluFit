import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { dashboardApis } from "@/test/fixtures";
import { mockApi, renderApp, USER, type Handler } from "@/test/utils";
import type { NutritionTarget, ProfileBundle } from "@/types/api";

/** Test-only data shaped like backend/app/schemas/profile.py responses. */
const bundle: ProfileBundle = {
  profile: { display_name: "Asha", height_cm: "160.0", weight_kg: null, activity_level: null, dietary_pattern: "vegetarian",
             currency: "INR", timezone: "Asia/Kolkata", institution_id: "inst-1", hostel_id: null, onboarding_step: 2,
             onboarding_completed_at: null },
  preferences: [{ id: "p1", label: "Rajma", preference: "like", food_id: "f1" }],
  allergies: [{ id: "a1", allergen: "peanut", custom_label: null, severity: "severe", notes: null }],
  institution: { id: "inst-1", name: "Test College", city: "Pune", state: null },
  hostel: null,
  active_target: null,
};
const proTarget: NutritionTarget = { id: "t1", source: "professional", energy_kcal: "1800.0", protein_g: "70.0",
  carbohydrate_g: null, fat_g: null, fibre_g: null, effective_from: "2026-10-01", effective_to: null, notes: "From clinic" };
const oldTarget: NutritionTarget = { ...proTarget, id: "t0", source: "self_set", energy_kcal: "2000.0",
  effective_from: "2026-09-01", effective_to: "2026-09-30", notes: null };

const err = (status: number, code: string, message: string, details: unknown = null) =>
  ({ status, body: { error: { code, message, details, request_id: "r" } } });

function apis(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/v1/auth/session": () => ({ status: 200, body: USER }),
    "GET /api/v1/profile": () => ({ status: 200, body: bundle }),
    "GET /api/v1/targets": () => ({ status: 200, body: [] }),
    "GET /api/v1/institutions/inst-1/hostels": () => ({ status: 200, body: [{ id: "h1", institution_id: "inst-1", name: "Hostel 4" }] }),
    ...over,
  };
}

function bodyOf(call: unknown[] | undefined): Record<string, unknown> {
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

const calls = (fetchMock: ReturnType<typeof mockApi>, method: string, path: string) =>
  fetchMock.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === method && new URL(String(u), "http://x").pathname === path);

describe("personal profile", () => {
  it("loads the saved profile into the form", async () => {
    mockApi(apis());
    renderApp("/app/profile");
    const form = await screen.findByRole("form", { name: "Personal profile" });
    expect(within(form).getByLabelText("Name")).toHaveValue("Asha");
    expect(within(form).getByLabelText(/Eating pattern/)).toHaveValue("vegetarian");
    expect(within(form).getByLabelText(/Height/)).toHaveValue("160");
    expect(within(form).getByText("Test College, Pune")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Save profile" })).toBeDisabled();  // nothing to save yet
    expect(screen.getByRole("navigation", { name: "Profile sections" })).toBeInTheDocument();
  });

  it("saves every field (PUT replaces the profile) and refreshes cached profile data", async () => {
    let saved = false;
    const fetchMock = mockApi(apis({
      "GET /api/v1/profile": () => ({ status: 200, body: saved ? { ...bundle, profile: { ...bundle.profile!, display_name: "Ravi" } } : bundle }),
      "PUT /api/v1/profile": () => { saved = true; return { status: 200, body: { ...bundle.profile, display_name: "Ravi" } }; },
    }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Ravi");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
    expect(bodyOf(calls(fetchMock, "PUT", "/api/v1/profile")[0])).toEqual({
      display_name: "Ravi", dietary_pattern: "vegetarian", height_cm: "160", weight_kg: null, activity_level: null,
      currency: "INR", timezone: "Asia/Kolkata", institution_id: "inst-1", hostel_id: null,
    });
    await waitFor(() => expect(calls(fetchMock, "GET", "/api/v1/profile").length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });

  it("validates before sending anything", async () => {
    const fetchMock = mockApi(apis());
    const user = userEvent.setup();
    renderApp("/app/profile");
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    const height = screen.getByLabelText(/Height/);
    await user.clear(height);
    await user.type(height, "20");
    await user.type(screen.getByLabelText(/Weight/), "55.55");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Height must be between 50 and 272.")).toBeInTheDocument();
    expect(screen.getByText("Weight: use numbers with at most 1 decimal place.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(calls(fetchMock, "PUT", "/api/v1/profile")).toHaveLength(0);
  });

  it("keeps the student's input when the server rejects or fails", async () => {
    let attempt = 0;
    mockApi(apis({ "PUT /api/v1/profile": () => (++attempt === 1
      ? err(422, "validation_failed", "Some fields are invalid.", [{ loc: ["body", "display_name"], msg: "Value error, Display name is required." }])
      : err(500, "internal_error", "Something went wrong on our side. Please try again.")) }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Ravi K");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Display name is required.")).toBeInTheDocument();
    expect(name).toHaveValue("Ravi K");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("Something went wrong on our side. Please try again.")).toBeInTheDocument();
    expect(name).toHaveValue("Ravi K");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.queryByText("Profile saved.")).not.toBeInTheDocument();
  });

  it("prevents duplicate submissions", async () => {
    let puts = 0;
    let release: () => void = () => {};
    mockApi(apis({ "PUT /api/v1/profile": () => { puts += 1;
      return new Promise((resolve) => { release = () => resolve({ status: 200, body: bundle.profile }); }) as never; } }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const name = await screen.findByLabelText("Name");
    await user.type(name, " K");
    const save = screen.getByRole("button", { name: "Save profile" });
    await user.click(save);
    expect(save).toBeDisabled();
    await user.dblClick(save);
    expect(puts).toBe(1);
    release();
    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
  });

  it("does not overwrite unsaved edits when profile data refreshes", async () => {
    mockApi(apis({ "PUT /api/v1/profile/preferences": () => ({ status: 200, body: [] }) }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Unsaved name");
    // Saving another section refetches the profile bundle from the server.
    await user.click(screen.getByRole("button", { name: "Remove Rajma" }));
    await user.click(screen.getByRole("button", { name: "Save food preferences" }));
    expect(await screen.findByText("Food preferences saved.")).toBeInTheDocument();
    expect(name).toHaveValue("Unsaved name");
  });

  it("starts empty for a student without a profile", async () => {
    mockApi(apis({ "GET /api/v1/profile": () => ({ status: 200, body: { ...bundle, profile: null, institution: null, preferences: [], allergies: [] } }) }));
    renderApp("/app/profile");
    expect(await screen.findByText(/You haven't saved a profile yet/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByText("No food preferences listed.")).toBeInTheDocument();
    expect(screen.getByText("No allergies listed.")).toBeInTheDocument();
  });

  it("shows a recoverable error when the profile can't load", async () => {
    let n = 0;
    mockApi(apis({ "GET /api/v1/profile": () => (++n === 1 ? err(503, "http_error", "Service temporarily unavailable.") : { status: 200, body: bundle }) }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    expect(await screen.findByText("Service temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(await screen.findByLabelText("Name")).toHaveValue("Asha");
  });
});

describe("food preferences", () => {
  it("adds, removes and saves the whole list; shows what the server returns", async () => {
    const fetchMock = mockApi(apis({ "PUT /api/v1/profile/preferences": () => ({ status: 200,
      body: [{ id: "p9", label: "Karela", preference: "avoid", food_id: null }] }) }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const card = await screen.findByRole("region", { name: "Food preferences" });
    expect(within(card).getByText("Rajma")).toBeInTheDocument();
    await user.type(within(card).getByLabelText("Food"), "rajma!");
    await user.click(within(card).getByRole("button", { name: "Add" }));
    expect(within(card).getByText("“rajma!” is already in your list.")).toBeInTheDocument();
    await user.clear(within(card).getByLabelText("Food"));
    await user.type(within(card).getByLabelText("Food"), "Karela");
    await user.selectOptions(within(card).getByLabelText("Preference"), "avoid");
    await user.click(within(card).getByRole("button", { name: "Add" }));
    await user.click(within(card).getByRole("button", { name: "Remove Rajma" }));
    await user.click(within(card).getByRole("button", { name: "Save food preferences" }));
    expect(await within(card).findByText("Food preferences saved.")).toBeInTheDocument();
    expect(bodyOf(calls(fetchMock, "PUT", "/api/v1/profile/preferences")[0])).toEqual({ items: [{ label: "Karela", preference: "avoid" }] });
    expect(within(card).queryByText("Rajma")).not.toBeInTheDocument();
  });

  it("keeps the draft and the saved state distinct when saving fails", async () => {
    mockApi(apis({ "PUT /api/v1/profile/preferences": () => err(500, "internal_error", "Something went wrong on our side. Please try again.") }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const card = await screen.findByRole("region", { name: "Food preferences" });
    await user.type(within(card).getByLabelText("Food"), "Poha");
    await user.click(within(card).getByRole("button", { name: "Add" }));
    await user.click(within(card).getByRole("button", { name: "Save food preferences" }));
    expect(await within(card).findByText(/Your changes are still here/)).toBeInTheDocument();
    expect(within(card).getByText("Poha")).toBeInTheDocument();
    expect(within(card).getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Discard changes" }));
    expect(within(card).queryByText("Poha")).not.toBeInTheDocument();
    expect(within(card).getByText("Rajma")).toBeInTheDocument();
  });
});

describe("allergies", () => {
  it("requires a description for 'other', edits severity and saves the list", async () => {
    const fetchMock = mockApi(apis({ "PUT /api/v1/profile/allergies": (init) => ({ status: 200,
      body: (JSON.parse(String(init?.body)).items as object[]).map((x, i) => ({ id: `n${i}`, ...x })) }) }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const card = await screen.findByRole("region", { name: "Allergies and intolerances" });
    expect(card).toHaveTextContent("never means a food is safe");
    await user.selectOptions(within(card).getByLabelText("Allergen"), "other");
    await user.click(within(card).getByRole("button", { name: "Add allergy" }));
    expect(within(card).getByText("Describe the allergy.")).toBeInTheDocument();
    await user.type(within(card).getByLabelText("Describe it"), "Kiwi");
    await user.selectOptions(within(card).getByLabelText("Severity"), "moderate");
    await user.click(within(card).getByRole("button", { name: "Add allergy" }));
    await user.selectOptions(within(card).getByLabelText("Severity for Peanut"), "mild");
    await user.click(within(card).getByRole("button", { name: "Save allergies" }));
    expect(await within(card).findByText("Allergies saved.")).toBeInTheDocument();
    expect(bodyOf(calls(fetchMock, "PUT", "/api/v1/profile/allergies")[0])).toEqual({ items: [
      { allergen: "peanut", custom_label: null, severity: "mild", notes: null },
      { allergen: "other", custom_label: "Kiwi", severity: "moderate", notes: null },
    ] });
  });

  it("does not change the saved list when saving fails", async () => {
    mockApi(apis({ "PUT /api/v1/profile/allergies": () => Promise.reject(new TypeError("Failed to fetch")) }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const card = await screen.findByRole("region", { name: "Allergies and intolerances" });
    await user.click(within(card).getByRole("button", { name: "Remove Peanut" }));
    await user.click(within(card).getByRole("button", { name: "Save allergies" }));
    expect(await within(card).findByText(/couldn't reach DeluluFit/i)).toBeInTheDocument();
    expect(within(card).getByText("No allergies listed.")).toBeInTheDocument();  // the draft
    await user.click(within(card).getByRole("button", { name: "Discard changes" }));
    expect(within(within(card).getByRole("list", { name: "Allergies list" })).getByText("Peanut")).toBeInTheDocument();  // saved state kept
  });
});

describe("nutrition targets", () => {
  it("validates, creates a professional target and refreshes target queries", async () => {
    let saved = false;
    const fetchMock = mockApi(apis({
      "GET /api/v1/targets": () => ({ status: 200, body: saved ? [{ ...proTarget, energy_kcal: "1000.0", protein_g: null, notes: null }] : [] }),
      "PUT /api/v1/targets/active": () => { saved = true; return { status: 200, body: { ...proTarget, effective_from: "2026-10-11" } }; },
    }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const card = await screen.findByRole("region", { name: "Nutrition targets" });
    expect(await within(card).findByText("No target set")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Set a target" }));
    const form = within(card).getByRole("form", { name: "Nutrition target" });
    await user.click(within(form).getByRole("button", { name: "Save target" }));
    expect(await within(form).findByText("Enter at least one target value.")).toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Energy/), "1000");
    await user.type(within(form).getByLabelText(/Protein/), "600");
    await user.click(within(form).getByRole("button", { name: "Save target" }));
    expect(await within(form).findByText(/below 1200 kcal aren't supported/)).toBeInTheDocument();
    expect(within(form).getByText("Protein must be between 0 and 500.")).toBeInTheDocument();
    expect(calls(fetchMock, "PUT", "/api/v1/targets/active")).toHaveLength(0);

    await user.selectOptions(within(form).getByLabelText(/Where does this target come from/), "professional");
    expect(form).toHaveTextContent("doesn't treat it as a prescription");
    await user.clear(within(form).getByLabelText(/Protein/));
    await user.click(within(form).getByRole("button", { name: "Save target" }));
    expect(await within(card).findByText(/Target saved, starting/)).toBeInTheDocument();
    expect(bodyOf(calls(fetchMock, "PUT", "/api/v1/targets/active")[0])).toEqual({ source: "professional", energy_kcal: "1000",
      protein_g: null, carbohydrate_g: null, fat_g: null, fibre_g: null, effective_from: null, notes: null });
    expect(await within(card).findByText("From a professional, as you entered it")).toBeInTheDocument();
    expect(calls(fetchMock, "GET", "/api/v1/targets").length).toBeGreaterThanOrEqual(2);
  });

  it("shows provenance and history, pre-fills changes, and ends a target after confirmation", async () => {
    const fetchMock = mockApi(apis({ "GET /api/v1/targets": () => ({ status: 200, body: [proTarget, oldTarget] }),
                                     "DELETE /api/v1/targets/active": () => ({ status: 204 }) }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const card = await screen.findByRole("region", { name: "Nutrition targets" });
    expect(await within(card).findByText("From a professional, as you entered it")).toBeInTheDocument();
    expect(within(card).getByText("Note: From clinic")).toBeInTheDocument();
    expect(within(card).getByText("Past targets (1)")).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/\bmet\b|on track|deficien/i);
    await user.click(within(card).getByRole("button", { name: "Change target" }));
    expect(within(card).getByLabelText(/Energy/)).toHaveValue("1800");
    expect(within(card).getByLabelText(/Where does this target come from/)).toHaveValue("professional");
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    await user.click(within(card).getByRole("button", { name: "End target" }));
    const dialog = screen.getByRole("dialog", { name: "End this target?" });
    await user.click(within(dialog).getByRole("button", { name: "End target" }));
    expect(await within(card).findByText("Target ended.")).toBeInTheDocument();
    expect(calls(fetchMock, "DELETE", "/api/v1/targets/active")).toHaveLength(1);
  });

  it("shows the server's message and keeps the entries when a target is rejected", async () => {
    mockApi(apis({ "PUT /api/v1/targets/active": () => err(422, "validation_failed",
      "A new target cannot start before your current target started.") }));
    const user = userEvent.setup();
    renderApp("/app/profile");
    const card = await screen.findByRole("region", { name: "Nutrition targets" });
    await user.click(await within(card).findByRole("button", { name: "Set a target" }));
    await user.type(within(card).getByLabelText(/Fibre/), "30");
    await user.click(within(card).getByRole("button", { name: "Save target" }));
    expect(await within(card).findByText(/cannot start before your current target started. Your entries are still here./)).toBeInTheDocument();
    expect(within(card).getByLabelText(/Fibre/)).toHaveValue("30");
  });
});

describe("account", () => {
  it("handles a wrong current password without signing out, then changes it", async () => {
    let attempt = 0;
    const fetchMock = mockApi(apis({ "POST /api/v1/auth/change-password": () => (++attempt === 1
      ? err(401, "invalid_credentials", "Current password is incorrect.") : { status: 204 }) }));
    const user = userEvent.setup();
    const { router } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Change password" }));
    const form = screen.getByRole("form", { name: "Change password" });
    await user.type(within(form).getByLabelText("Current password"), "old password here");
    await user.type(within(form).getByLabelText("New password"), "a brand new passphrase");
    await user.type(within(form).getByLabelText("Confirm new password"), "a brand new passphrase");
    await user.click(within(form).getByRole("button", { name: "Change password" }));
    expect(await within(form).findByText("Your current password is incorrect.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/profile");
    await user.click(within(form).getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Password changed. Your other devices were signed out.")).toBeInTheDocument();
    expect(bodyOf(calls(fetchMock, "POST", "/api/v1/auth/change-password")[1])).toEqual(
      { current_password: "old password here", new_password: "a brand new passphrase" });
  });

  it("can cancel account deletion, and requires the password and exact confirmation", async () => {
    const fetchMock = mockApi(apis());
    const user = userEvent.setup();
    renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete your account?" });
    expect(dialog).toHaveTextContent("Not removed: colleges or hostels you added");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Your password"), "correct horse battery");
    await user.type(within(dialog).getByLabelText(/Type "DELETE"/), "delete");
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Keep my account" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(calls(fetchMock, "POST", "/api/v1/auth/delete-account")).toHaveLength(0);
    // Reopening starts clean.
    await user.click(screen.getByRole("button", { name: "Delete account…" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Your password")).toHaveValue("");
  });

  it("keeps the account and the session on a wrong password or network failure", async () => {
    let attempt = 0;
    mockApi(apis({ "POST /api/v1/auth/delete-account": () => (++attempt === 1
      ? err(401, "invalid_credentials", "Password is incorrect.") : Promise.reject(new TypeError("Failed to fetch"))) }));
    const user = userEvent.setup();
    const { router } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Your password"), "wrong password");
    await user.type(within(dialog).getByLabelText(/Type "DELETE"/), "DELETE");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    expect(await within(dialog).findByText("That password is incorrect. Your account has not been deleted.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/profile");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    expect(await within(dialog).findByText(/couldn't reach DeluluFit.*has not been deleted/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Asha");
  });

  it("deletes the account once, clears private data, and signs out", async () => {
    let posts = 0;
    let release: () => void = () => {};
    const fetchMock = mockApi({ ...apis(), ...dashboardApis,
      "GET /api/v1/profile": () => ({ status: 200, body: bundle }),
      "GET /api/v1/auth/session": () => ({ status: posts ? 401 : 200, body: posts ? { error: { code: "not_authenticated", message: "Please sign in to continue." } } : USER }),
      "POST /api/v1/auth/delete-account": () => { posts += 1;
        return new Promise((resolve) => { release = () => resolve({ status: 204 }); }) as never; } });
    const user = userEvent.setup();
    const { router } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Your password"), "correct horse battery");
    await user.type(within(dialog).getByLabelText(/Type "DELETE"/), "DELETE");
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });
    await user.click(confirm);
    await user.dblClick(confirm);
    expect(posts).toBe(1);
    expect(within(dialog).getByRole("button", { name: "Keep my account" })).toBeDisabled();
    release();
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByText("Your account and its data have been deleted.")).toBeInTheDocument();
    expect(bodyOf(calls(fetchMock, "POST", "/api/v1/auth/delete-account")[0])).toEqual(
      { password: "correct horse battery", confirmation: "DELETE" });
    expect(screen.queryByText("Asha")).not.toBeInTheDocument();
    expect(screen.queryByText(USER.user.email)).not.toBeInTheDocument();
    // Private pages are no longer reachable and nothing is served from cache.
    const profileGets = calls(fetchMock, "GET", "/api/v1/profile").length;
    await router.navigate("/app/profile");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(calls(fetchMock, "GET", "/api/v1/profile").length).toBe(profileGets);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("never shows the deleted account's cached data to the next person who signs in on this tab", async () => {
    let deleted = false;
    const other = { ...USER, user: { ...USER.user, id: "u2", email: "next@example.test" }, csrf_token: "csrf-2" };
    mockApi({ ...apis(), ...dashboardApis,
      "GET /api/v1/auth/session": () => ({ status: 200, body: USER }),
      "POST /api/v1/auth/delete-account": () => { deleted = true; return { status: 204 }; },
      "POST /api/v1/auth/login": () => ({ status: 200, body: other }),
      "GET /api/v1/profile": () => ({ status: 200, body: deleted
        ? { ...bundle, profile: { ...bundle.profile!, display_name: "Bina" }, preferences: [], allergies: [], institution: null }
        : bundle }) });
    const user = userEvent.setup();
    const { router } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Your password"), "correct horse battery");
    await user.type(within(dialog).getByLabelText(/Type "DELETE"/), "DELETE");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await screen.findByText("Your account and its data have been deleted.");
    await user.type(screen.getByLabelText("Email"), "next@example.test");
    await user.type(screen.getByLabelText("Password"), "another passphrase");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    // Login returns to the page the redirect came from: the profile page.
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/profile"));
    // Within the 30 s cache window, a surviving cache would render "Asha" instantly; it must be gone.
    expect(screen.queryByDisplayValue("Asha")).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue("Bina")).toBeInTheDocument();
    expect(screen.queryByText("Rajma")).not.toBeInTheDocument();
  }, 20_000);  // a full delete, sign-in and reload journey

  it("signs out if the session expired before deleting", async () => {
    mockApi(apis({ "POST /api/v1/auth/delete-account": () => err(401, "session_expired", "Your session has expired. Please sign in again.") }));
    const user = userEvent.setup();
    const { router } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Delete account…" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Your password"), "pw");
    await user.type(within(dialog).getByLabelText(/Type "DELETE"/), "DELETE");
    await user.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(screen.queryByText("Your account and its data have been deleted.")).not.toBeInTheDocument();
  });
});

describe("demo mode", () => {
  it("shows no editors and makes no API calls", async () => {
    window.sessionStorage.setItem("delulufit:demo", "1");
    const fetchMock = mockApi({});
    renderApp("/app/profile");
    expect(await screen.findByText(/profile editing is available only with a real account/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Personal profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete account…" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
