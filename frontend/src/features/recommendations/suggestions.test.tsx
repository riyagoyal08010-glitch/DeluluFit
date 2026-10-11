import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { Providers, ROUTER_FUTURE, routes } from "@/app/App";
import { menusApi } from "@/lib/api/endpoints";
import { invalidateMenus, liveKeys } from "@/lib/api/queryKeys";
import { formatMoney, localIsoDate } from "@/lib/format";
import { lunch, preview, ROTI_ID, rotiDetail, rotiHit, rotiItem, SERVING_ID } from "@/test/mealFixtures";
import { dish, DISH_ID, MEAL_ID, MENU_ID, menuSummary, refNutrition, suggestions } from "@/test/menuFixtures";
import { mockApi, renderApp, USER, type Handler } from "@/test/utils";
import type { ProfileBundle } from "@/types/api";

const TODAY = localIsoDate();
const session: Handler = () => ({ status: 200, body: USER });
const serverError = { status: 500, body: { error: { code: "internal_error", message: "Something went wrong on our side.", details: null, request_id: "r" } } };
const list = (items: unknown[]): Handler => () => ({ status: 200, body: { items, total: items.length, limit: 50, offset: 0 } });
const page = (over: Parameters<typeof suggestions>[0] = {}): Handler => (_i, url) =>
  ({ status: 200, body: suggestions({ ...over, meal_type: (url.searchParams.get("meal_type") as never) ?? null }) });
const todayMenu = menuSummary({ menu_date: TODAY });
const SUGGESTIONS_PATH = `GET /api/v1/menus/${MENU_ID}/suggestions`;

function enterDemoMode() {
  window.sessionStorage.setItem("delulufit:demo", "1");
}

function bodyOf(call: unknown[] | undefined): Record<string, unknown> {
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

const urlsOf = (fetchMock: ReturnType<typeof mockApi>, path: string) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(path));

/** renderApp with a caller-owned QueryClient, to inspect the cache (same settings as renderApp). */
function renderWithClient(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path], future: ROUTER_FUTURE });
  render(<Providers client={client}><RouterProvider router={router} future={{ v7_startTransition: true }} /></Providers>);
  return { client, router };
}

describe("menus API client and cache keys", () => {
  it("calls the backend paths with encoded ids and the meal filter only when given", async () => {
    const fetchMock = mockApi({
      "GET /api/v1/menus": list([]),
      "GET /api/v1/menus/a%20b": () => ({ status: 200, body: {} }),
      "GET /api/v1/menus/a%20b/suggestions": () => ({ status: 200, body: suggestions() }),
    });
    await menusApi.list({ limit: 50 });
    await menusApi.get("a b");
    await menusApi.suggestions("a b", "lunch");
    await menusApi.suggestions("a b");
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[0]).toBe("/api/v1/menus?limit=50");
    expect(urls[1]).toBe("/api/v1/menus/a%20b");
    expect(urls[2]).toBe("/api/v1/menus/a%20b/suggestions?meal_type=lunch");
    expect(urls[3]).toBe("/api/v1/menus/a%20b/suggestions");
  });

  it("keeps every menu query under the live menus prefix and invalidates them together", async () => {
    expect(liveKeys.menuSuggestions("m1")).toEqual(["live", "menus", "suggestions", "m1", "all"]);
    expect(liveKeys.menuSuggestions("m1", "dinner")).toEqual(["live", "menus", "suggestions", "m1", "dinner"]);
    for (const key of [liveKeys.menuList, liveKeys.menu("m1"), liveKeys.menuSuggestions("m1")]) {
      expect(key.slice(0, 2)).toEqual(liveKeys.menus);
    }
    const client = new QueryClient();
    client.setQueryData(liveKeys.menuSuggestions("m1", "lunch"), suggestions());
    client.setQueryData(liveKeys.menuList, { items: [], total: 0, limit: 50, offset: 0 });
    client.setQueryData(liveKeys.profile, {});
    await invalidateMenus(client);
    expect(client.getQueryState(liveKeys.menuSuggestions("m1", "lunch"))?.isInvalidated).toBe(true);
    expect(client.getQueryState(liveKeys.menuList)?.isInvalidated).toBe(true);
    expect(client.getQueryState(liveKeys.profile)?.isInvalidated).toBe(false);
  });
});

describe("suggestions page for a real account", () => {
  it("shows a loading state, then explains when no confirmed menu exists for the date", async () => {
    let release: () => void = () => {};
    mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/menus": () => new Promise((resolve) => { release = () => resolve({ status: 200, body: { items: [], total: 0, limit: 50, offset: 0 } }); }) as never });
    renderApp("/app/suggestions");
    const loading = await screen.findByText(/Loading suggestions/);
    expect(loading.closest("[role='status']")).not.toBeNull();
    release();
    expect(await screen.findByText("No confirmed menu for this date")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the mess menu" })).toHaveAttribute("href", "/app/menu");
    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
  });

  it("shows an error with a working retry instead of sample data", async () => {
    let calls = 0;
    mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/menus": (i, url) => (++calls === 1 ? serverError : list([])(i, url)) });
    const user = userEvent.setup();
    renderApp("/app/suggestions");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your menus");
    expect(alert).toHaveTextContent("Something went wrong on our side.");
    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No confirmed menu for this date")).toBeInTheDocument();
  });

  it("explains an unconfirmed menu without requesting suggestions for it", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/menus": list([menuSummary({ menu_date: TODAY, status: "needs_review", has_draft: true, has_confirmed: false })]) });
    renderApp("/app/suggestions");
    expect(await screen.findByText("This menu isn't confirmed yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the mess menu" })).toHaveAttribute("href", "/app/menu");
    expect(urlsOf(fetchMock, "/suggestions")).toHaveLength(0);
  });

  it("renders the sections in order with reasons, cautions, provenance, nutrition statuses and prices", async () => {
    const rajma = dish({ menu_item_id: "d-rajma", name: "Rajma chawal", group: "suggested", score: 3, source: "extraction",
      is_user_corrected: true, section_heading: "Main course", serving_note: "1 bowl",
      reasons: [{ code: "likes", text: "You marked “Rajma” as a food you like." }],
      cautions: [{ code: "allergy_unknown", text: "Ingredients aren't known, so we can't tell whether this dish contains milk." }],
      food: { id: "f1", canonical_name: "Kidney beans (cooked)" }, diet_type: "vegetarian",
      nutrition: refNutrition({ energy_kcal: "reported", protein_g: "unknown", fibre_g: "not_in_source" }, { energy_kcal: "127" }),
      price: "40.00" });
    const paneer = dish({ menu_item_id: "d-paneer", name: "Paneer butter masala", group: "check_first", score: 1,
      cautions: [{ code: "allergen_listed", text: "The matching reference food lists milk, which you've recorded as an allergy." }],
      food: { id: "f2", canonical_name: "Paneer" }, diet_type: "vegetarian" });
    const jeera = dish({ menu_item_id: "d-jeera", name: "Jeera aloo", source: "manual",
      cautions: [{ code: "allergy_unknown", text: "Ingredients aren't known, so we can't tell whether this dish contains milk." }] });
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/menus": list([todayMenu]),
      [SUGGESTIONS_PATH]: page({ dishes: [rajma, paneer, jeera], allergy_notice: "You've recorded milk. Ask the mess before eating anything you're unsure about." }) });
    renderApp("/app/suggestions");

    await screen.findByRole("region", { name: /Rajma chawal/ });
    const titles = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(titles.indexOf("Suggested for you")).toBeLessThan(titles.indexOf("Also on the menu"));
    expect(titles.indexOf("Also on the menu")).toBeLessThan(titles.indexOf("Check first"));
    // The allergy notice appears exactly once, with the word "Allergy", above the dishes.
    expect(screen.getAllByRole("heading", { name: "Allergy" })).toHaveLength(1);
    expect(screen.getByText(/You've recorded milk/)).toBeInTheDocument();

    const card = screen.getByRole("region", { name: /Rajma chawal/ });
    expect(card).toHaveTextContent("Lunch · Main course · 1 bowl");
    expect(within(card).getByText("From photo")).toBeInTheDocument();
    expect(within(card).getByText("Edited")).toBeInTheDocument();
    expect(card).toHaveTextContent("Reference food: Kidney beans (cooked) · listed as vegetarian");
    expect(within(card).getByRole("heading", { name: "Why" })).toBeInTheDocument();
    expect(within(card).getByText("You marked “Rajma” as a food you like.")).toBeInTheDocument();
    expect(within(card).getByRole("list", { name: "Cautions for Rajma chawal" })).toHaveTextContent("Caution: Ingredients aren't known");
    expect(card).toHaveTextContent("Per 100 g of the reference food (Test dataset), not a portion.");
    expect(within(card).getByText("127 kcal")).toBeInTheDocument();
    expect(within(card).getByText("No data")).toBeInTheDocument();
    expect(within(card).getByText("Not in source")).toBeInTheDocument();
    expect(within(card).queryByText("0 g")).not.toBeInTheDocument();
    expect(card).toHaveTextContent(`Price on the menu: ${formatMoney("40.00", "INR")}`);
    expect(within(card).queryByText("Check first")).not.toBeInTheDocument();

    const paneerCard = screen.getByRole("region", { name: /Paneer butter masala/ });
    expect(within(paneerCard).getByText("Check first")).toBeInTheDocument();
    expect(paneerCard).toHaveTextContent("Caution: The matching reference food lists milk");

    const jeeraCard = screen.getByRole("region", { name: /Jeera aloo/ });
    expect(within(jeeraCard).getByText("Typed in")).toBeInTheDocument();
    expect(jeeraCard).toHaveTextContent("No price printed on the menu.");
    expect(jeeraCard).not.toHaveTextContent(/free/i);
    expect(jeeraCard).not.toHaveTextContent("Reference food");
    expect(jeeraCard).not.toHaveTextContent("not a portion");

    // Internal ranking details are never shown, and "safe" is never claimed.
    expect(document.body).not.toHaveTextContent(/menu-rules-1|score/i);
    expect(document.body).not.toHaveTextContent(/\bsafe\b/i);
    expect(screen.getByText("Based on 1 food preference.")).toBeInTheDocument();
  });

  it("links each dish to the meal logger with encoded parameters", async () => {
    const d = dish({ name: "Rajma chawal & rice", food: { id: "f 1", canonical_name: "Kidney beans" } });
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/menus": list([todayMenu]), [SUGGESTIONS_PATH]: page({ dishes: [d] }) });
    renderApp("/app/suggestions");
    const link = await screen.findByRole("link", { name: "Log this: Rajma chawal & rice" });
    const href = new URL(link.getAttribute("href")!, "http://x");
    expect(href.pathname).toBe("/app/meals");
    expect(Object.fromEntries(href.searchParams)).toEqual({ menu_meal: MEAL_ID, menu_item: DISH_ID, meal_type: "lunch",
                                                           food: "f 1", name: "Rajma chawal & rice" });
    expect(href.search).toContain("name=Rajma+chawal+%26+rice");
    expect(href.search).toContain("food=f+1");
  });

  it("keeps meal tabs in the address and asks the server for that meal", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/menus": list([todayMenu]),
      [SUGGESTIONS_PATH]: (_i, url) => ({ status: 200, body: suggestions({
        meal_type: url.searchParams.get("meal_type") as never,
        dishes: url.searchParams.get("meal_type") === "dinner" ? [] : [dish()] }) }) });
    const user = userEvent.setup();
    const { router } = renderApp("/app/suggestions?meal_type=lunch");
    const tabs = () => screen.getByRole("group", { name: "Meal" });
    expect(await screen.findByRole("region", { name: /Jeera aloo/ })).toBeInTheDocument();
    expect(within(tabs()).getByRole("button", { name: "Lunch" })).toHaveAttribute("aria-pressed", "true");
    expect(within(tabs()).getByRole("button", { name: "All meals" })).toHaveAttribute("aria-pressed", "false");
    expect(urlsOf(fetchMock, "/suggestions")[0]).toContain("meal_type=lunch");

    await user.click(within(tabs()).getByRole("button", { name: "Dinner" }));
    expect(router.state.location.search).toContain("meal_type=dinner");
    expect(await screen.findByText("No dinner dishes on this menu")).toBeInTheDocument();
    expect(within(tabs()).getByRole("button", { name: "Dinner" })).toHaveAttribute("aria-pressed", "true");
    expect(urlsOf(fetchMock, "/suggestions").at(-1)).toContain("meal_type=dinner");

    await user.click(within(tabs()).getByRole("button", { name: "All meals" }));
    expect(router.state.location.search).not.toContain("meal_type");
    expect(await screen.findByRole("region", { name: /Jeera aloo/ })).toBeInTheDocument();
    expect(urlsOf(fetchMock, "/suggestions").at(-1)).not.toContain("meal_type");
  });

  it("keeps the dishes and points to the profile when nothing personal is recorded", async () => {
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/menus": list([todayMenu]),
      [SUGGESTIONS_PATH]: page({ personalization: { personalized: false, based_on: [],
        message: "Nothing you've recorded can rank these dishes yet, so they're shown in menu order." } }) });
    renderApp("/app/suggestions");
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("Nothing you've recorded can rank these dishes yet");
    expect(within(note).getByRole("link", { name: "Open your profile" })).toHaveAttribute("href", "/app/profile");
    expect(screen.getByRole("region", { name: /Jeera aloo/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Allergy" })).not.toBeInTheDocument();
  });

  it("shows every confirmed menu for the date as its own section, newest first, and ignores other dates", async () => {
    const older = menuSummary({ id: "m-old", title: "Breakfast photo", menu_date: TODAY, updated_at: "2026-10-11T06:00:00Z" });
    const newer = menuSummary({ id: "m-new", title: "Lunch photo", menu_date: TODAY, updated_at: "2026-10-11T12:00:00Z" });
    const other = menuSummary({ id: "m-other", title: "Yesterday", menu_date: "2000-01-01" });
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/menus": list([older, other, newer]),
      "GET /api/v1/menus/m-old/suggestions": page({ menu_id: "m-old", dishes: [dish({ menu_item_id: "a", name: "Poha" })] }),
      "GET /api/v1/menus/m-new/suggestions": page({ menu_id: "m-new", dishes: [dish({ menu_item_id: "b", name: "Dal" })] }) });
    renderApp("/app/suggestions");
    expect(await screen.findByRole("region", { name: /Poha/ })).toBeInTheDocument();
    expect(await screen.findByRole("region", { name: /Dal/ })).toBeInTheDocument();
    const sections = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
      .filter((t) => t === "Breakfast photo" || t === "Lunch photo");
    expect(sections).toEqual(["Lunch photo", "Breakfast photo"]);
    expect(urlsOf(fetchMock, "/suggestions")).toHaveLength(2);
    expect(urlsOf(fetchMock, "m-other")).toHaveLength(0);
  });

  it("refreshes the menu list when a menu was deleted meanwhile", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/menus": list([todayMenu]),
      [SUGGESTIONS_PATH]: () => ({ status: 404, body: { error: { code: "not_found", message: "Menu not found.", details: null, request_id: "r" } } }) });
    renderApp("/app/suggestions");
    expect(await screen.findByText("This menu no longer exists")).toBeInTheDocument();
    await waitFor(() => expect(urlsOf(fetchMock, "/api/v1/menus?")).toHaveLength(2));
  });

  it("retries a failed suggestions request on demand", async () => {
    let calls = 0;
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/menus": list([todayMenu]),
      [SUGGESTIONS_PATH]: (i, url) => (++calls === 1 ? serverError : page()(i, url)) });
    const user = userEvent.setup();
    renderApp("/app/suggestions");
    expect(await screen.findByText("Couldn't load suggestions")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: /Jeera aloo/ })).toBeInTheDocument();
  });

  it("re-fetches suggestions after food preferences or allergies are saved", async () => {
    const bundle: ProfileBundle = {
      profile: { display_name: "Asha", height_cm: null, weight_kg: null, activity_level: null, dietary_pattern: "vegetarian",
                 currency: "INR", timezone: "Asia/Kolkata", institution_id: null, hostel_id: null, onboarding_step: 2,
                 onboarding_completed_at: null },
      preferences: [{ id: "p1", label: "Rajma", preference: "like", food_id: null }],
      allergies: [{ id: "a1", allergen: "peanut", custom_label: null, severity: "severe", notes: null }],
      institution: null, hostel: null, active_target: null,
    };
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/profile": () => ({ status: 200, body: bundle }),
      "GET /api/v1/targets": () => ({ status: 200, body: [] }),
      "PUT /api/v1/profile/preferences": () => ({ status: 200, body: [] }),
      "PUT /api/v1/profile/allergies": () => ({ status: 200, body: [] }) });
    const user = userEvent.setup();
    const { client } = renderWithClient("/app/profile");
    const key = liveKeys.menuSuggestions(MENU_ID, "all");
    client.setQueryData(key, suggestions());
    client.setQueryData(liveKeys.menuList, { items: [todayMenu], total: 1, limit: 50, offset: 0 });

    const prefs = await screen.findByRole("region", { name: "Food preferences" });
    await user.click(within(prefs).getByRole("button", { name: "Remove Rajma" }));
    await user.click(within(prefs).getByRole("button", { name: "Save food preferences" }));
    expect(await within(prefs).findByText("Food preferences saved.")).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryState(key)?.isInvalidated).toBe(true));

    client.setQueryData(key, suggestions());   // "fresh" again
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    const allergies = screen.getByRole("region", { name: "Allergies and intolerances" });
    await user.selectOptions(within(allergies).getByLabelText("Severity for Peanut"), "mild");
    await user.click(within(allergies).getByRole("button", { name: "Save allergies" }));
    expect(await within(allergies).findByText("Allergies saved.")).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
    expect(client.getQueryState(liveKeys.menuList)?.isInvalidated).toBe(true);
  });
});

describe("suggestions in demo mode", () => {
  it("renders the labelled sample through the same cards and makes no request", async () => {
    enterDemoMode();
    const fetchMock = mockApi({});
    const user = userEvent.setup();
    renderApp("/app/suggestions");
    expect(await screen.findByRole("region", { name: /Dal tadka/ })).toBeInTheDocument();
    expect(screen.getAllByText("Demo data").length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByRole("heading", { name: "Allergy" })).toHaveLength(1);
    expect(screen.getByRole("region", { name: /Aloo sabzi/ })).toHaveTextContent("No price printed on the menu.");
    expect(screen.getByRole("region", { name: /Samosa/ })).toHaveTextContent(formatMoney("15.00", "INR"));
    expect(screen.queryByRole("link", { name: /Log this/ })).not.toBeInTheDocument();
    const disabled = screen.getAllByRole("button", { name: "Not available in demo" });
    expect(disabled.length).toBeGreaterThan(0);
    for (const b of disabled) expect(b).toBeDisabled();

    await user.click(within(screen.getByRole("group", { name: "Meal" })).getByRole("button", { name: "Dinner" }));
    const curd = await screen.findByRole("region", { name: /Curd/ });
    expect(within(curd).getByText("Check first")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Dal tadka/ })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("logging a dish from a suggestion", () => {
  const detail: Handler = () => ({ status: 200, body: rotiDetail });
  const estimate: Handler = (_i, url) => ({ status: 200, body: preview(url.searchParams.get("quantity")!, "120") });
  const apis = { "GET /api/v1/auth/session": session, [`GET /api/v1/foods/${ROTI_ID}`]: detail,
                 [`GET /api/v1/foods/${ROTI_ID}/estimate`]: estimate };
  const posts = (fetchMock: ReturnType<typeof mockApi>) =>
    fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/api/v1/meals") && i?.method === "POST");
  const prefillUrl = (food: string, name: string) =>
    `/app/meals?menu_meal=${MEAL_ID}&menu_item=${DISH_ID}&meal_type=dinner&food=${food}&name=${encodeURIComponent(name)}`;
  /** A saved meal as the server returns it (shape from mealFixtures); the menu link makes its source "mess_menu". */
  const savedMeal = (id: string, source: "mess_menu" | "manual") =>
    ({ status: 201, body: { ...lunch([rotiItem()]), id, meal_type: "dinner", source } });

  it("prefills the linked reference food, waits for a portion and an explicit save, then sends the menu links", async () => {
    const fetchMock = mockApi({ ...apis, "POST /api/v1/meals": () => savedMeal("meal-1", "mess_menu") });
    const user = userEvent.setup();
    const { router } = renderApp(prefillUrl(ROTI_ID, "Roti sabzi"));
    expect(await screen.findByRole("form", { name: "Portion of Roti / chapati" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Roti sabzi from your menu");
    expect(screen.getByRole("status")).toHaveTextContent("nothing is logged until you do");
    // The parameters are consumed once and removed from the address, so a refresh can't re-apply them.
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes(`/foods/${ROTI_ID}`))).toBe(true);
    expect(posts(fetchMock)).toHaveLength(0);

    await user.type(screen.getByLabelText("Amount"), "1");
    await user.selectOptions(screen.getByLabelText("Serving size"), SERVING_ID);
    await screen.findByText("120 kcal");
    await user.click(screen.getByRole("button", { name: "Add to meal" }));
    expect(screen.getByRole("heading", { name: "Foods (1)" })).toBeInTheDocument();
    expect(screen.getByText("Roti / chapati")).toBeInTheDocument();
    expect(screen.getByText(/from your menu/)).toBeInTheDocument();
    expect(screen.getByLabelText("Meal")).toHaveValue("dinner");
    expect(posts(fetchMock)).toHaveLength(0);   // nothing is sent until Save

    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(await screen.findByText(/saved with/)).toBeInTheDocument();
    const body = bodyOf(posts(fetchMock)[0]);
    expect(body.meal_type).toBe("dinner");
    expect(body.menu_meal_id).toBe(MEAL_ID);
    expect(body.items).toEqual([{ food_id: ROTI_ID, quantity: "1", unit: "serving", serving_id: SERVING_ID, menu_item_id: DISH_ID }]);
    expect(posts(fetchMock)).toHaveLength(1);
  });

  it("prefills the manual form for a dish without a reference food and links it on save", async () => {
    const fetchMock = mockApi({ ...apis, "POST /api/v1/meals": () => savedMeal("meal-2", "mess_menu") });
    const user = userEvent.setup();
    renderApp(prefillUrl("", "Mess special"));
    const form = await screen.findByRole("form", { name: "Food not in the list" });
    expect(within(form).getByLabelText("Food name")).toHaveValue("Mess special");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/foods/"))).toBe(false);
    await user.click(within(form).getByRole("button", { name: "Add to meal" }));
    expect(screen.getByRole("heading", { name: "Foods (1)" })).toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(await screen.findByText(/saved with/)).toBeInTheDocument();
    const body = bodyOf(posts(fetchMock)[0]);
    expect(body.menu_meal_id).toBe(MEAL_ID);
    expect(body.items).toEqual([{ display_name: "Mess special", quantity: "1", unit: "serving", menu_item_id: DISH_ID }]);
  });

  it("drops the menu link when the prefilled dish is removed, and explains a refused link", async () => {
    let attempt = 0;
    const fetchMock = mockApi({ ...apis, "GET /api/v1/foods/search": (_i, url) => ({ status: 200, body: { query: url.searchParams.get("q"), results: [rotiHit] } }),
      "POST /api/v1/meals": () => (++attempt === 1
        ? { status: 422, body: { error: { code: "menu_unavailable", message: "That menu isn't available. Confirm the menu first.", details: null, request_id: "r" } } }
        : savedMeal("meal-3", "manual")) });
    const user = userEvent.setup();
    renderApp(prefillUrl("", "Mess special"));
    await user.click(await screen.findByRole("button", { name: "Add to meal" }));
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That menu isn't available. Confirm the menu first.");
    expect(alert).toHaveTextContent("Confirm it on the Mess menu page");
    expect(bodyOf(posts(fetchMock)[0]).menu_meal_id).toBe(MEAL_ID);

    await user.click(screen.getByRole("button", { name: "Remove Mess special" }));
    await user.click(screen.getByRole("button", { name: "Add food" }));
    await user.type(screen.getByLabelText("Search foods"), "roti");
    await user.click(await screen.findByRole("button", { name: /Roti \/ chapati/ }));
    await user.type(await screen.findByLabelText("Amount"), "1");
    await user.selectOptions(screen.getByLabelText("Serving size"), SERVING_ID);
    await user.click(screen.getByRole("button", { name: "Add to meal" }));
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(await screen.findByText(/saved with/)).toBeInTheDocument();
    const body = bodyOf(posts(fetchMock)[1]);
    expect(body).not.toHaveProperty("menu_meal_id");
    expect(body.items).toEqual([{ food_id: ROTI_ID, quantity: "1", unit: "serving", serving_id: SERVING_ID }]);
  });

  it("opens the plain logger when no prefill parameters are present", async () => {
    const fetchMock = mockApi({ ...apis });
    renderApp("/app/meals");
    expect(await screen.findByRole("heading", { name: "Foods (0)" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(posts(fetchMock)).toHaveLength(0);
  });
});
