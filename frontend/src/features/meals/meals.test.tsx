import { screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { dashboardApis, emptyDay } from "@/test/fixtures";
import { lunch, preview, ROTI_ID, rotiDetail, rotiHit, rotiItem, SERVING_ID } from "@/test/mealFixtures";
import { mockApi, renderApp, USER, type Handler } from "@/test/utils";

import { checkQuantity, toOffsetIso, trimDecimal } from "./portion";

const session: Handler = () => ({ status: 200, body: USER });
const search = (results: unknown[]): Handler => (_i, url) =>
  ({ status: 200, body: { query: url.searchParams.get("q"), results } });
const detail: Handler = () => ({ status: 200, body: rotiDetail });
const estimate: Handler = (_i, url) => ({ status: 200, body: preview(url.searchParams.get("quantity")!, "120") });

function bodyOf(call: unknown[] | undefined): Record<string, unknown> {
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

async function addRoti(user: UserEvent, quantity = "1") {
  await user.click(screen.getByRole("button", { name: "Add food" }));
  await user.type(screen.getByLabelText("Search foods"), "roti");
  await user.click(await screen.findByRole("button", { name: /Roti \/ chapati/ }));
  await user.type(await screen.findByLabelText("Amount"), quantity);
  await user.selectOptions(screen.getByLabelText("Serving size"), SERVING_ID);
  await screen.findByText("120 kcal");
  await user.click(screen.getByRole("button", { name: "Add to meal" }));
}

describe("portion helpers", () => {
  it("validates quantities like the backend", () => {
    expect(checkQuantity("150")).toEqual({ ok: true, value: "150" });
    expect(checkQuantity(" 1.5 ")).toEqual({ ok: true, value: "1.5" });
    expect(checkQuantity(".5")).toEqual({ ok: true, value: "0.5" });
    for (const bad of ["", "0", "-1", "abc", "1.005", "10001", "1e3", "1,5"]) expect(checkQuantity(bad).ok).toBe(false);
  });

  it("builds timestamps with the device offset and rejects impossible dates", () => {
    expect(toOffsetIso("2026-10-11", "13:05")).toMatch(/^2026-10-11T13:05:00[+-]\d{2}:\d{2}$/);
    expect(toOffsetIso("2026-02-30", "10:00")).toBeNull();
    expect(toOffsetIso("2026-10-11", "25:00")).toBeNull();
  });

  it("trims only fractional zeros", () => {
    expect([trimDecimal("150.00"), trimDecimal("1.50"), trimDecimal("100"), trimDecimal("0.25")])
      .toEqual(["150", "1.5", "100", "0.25"]);
  });
});

describe("food search", () => {
  it("debounces typing into one request and shows results with match details", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/foods/search": search([rotiHit, { ...rotiHit, id: "x2", canonical_name: "Paratha", matched_name: "paratha" }]) });
    const user = userEvent.setup();
    renderApp("/app/meals");
    await user.click(await screen.findByRole("button", { name: "Add food" }));
    await user.type(screen.getByLabelText("Search foods"), "roti");
    const results = await screen.findByRole("list", { name: "Search results" });
    expect(within(results).getAllByRole("button").map((b) => b.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Roti / chapati"), expect.stringContaining("Paratha")]));
    const searches = fetchMock.mock.calls.filter(([u]) => String(u).includes("/foods/search"));
    expect(searches).toHaveLength(1);
    expect(String(searches[0]![0])).toContain("q=roti");
  });

  it("offers a manual entry when nothing matches", async () => {
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/foods/search": search([]) });
    const user = userEvent.setup();
    renderApp("/app/meals");
    await user.click(await screen.findByRole("button", { name: "Add food" }));
    await user.type(screen.getByLabelText("Search foods"), "mess special");
    expect(await screen.findByText("No foods match “mess special”.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Log “mess special” without nutrition data/ }));
    expect(screen.getByRole("form", { name: "Food not in the list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Food name")).toHaveValue("mess special");
  });

  it("shows search failures with a working retry", async () => {
    let calls = 0;
    mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/foods/search": (i, url) => (++calls === 1
        ? { status: 500, body: { error: { code: "internal_error", message: "Something went wrong on our side." } } }
        : search([rotiHit])(i, url)) });
    const user = userEvent.setup();
    renderApp("/app/meals");
    await user.click(await screen.findByRole("button", { name: "Add food" }));
    await user.type(screen.getByLabelText("Search foods"), "roti");
    expect(await screen.findByText("Search failed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /Roti \/ chapati/ })).toBeInTheDocument();
  });
});

describe("portion editor", () => {
  it("validates input and shows the backend's estimate, never zero for unknowns", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/foods/search": search([rotiHit]),
      [`GET /api/v1/foods/${ROTI_ID}`]: detail, [`GET /api/v1/foods/${ROTI_ID}/estimate`]: estimate });
    const user = userEvent.setup();
    renderApp("/app/meals");
    await user.click(await screen.findByRole("button", { name: "Add food" }));
    await user.type(screen.getByLabelText("Search foods"), "roti");
    await user.click(await screen.findByRole("button", { name: /Roti \/ chapati/ }));
    const amount = await screen.findByLabelText("Amount");
    expect(screen.getByText(/reference recipe contains wheat gluten/)).toBeInTheDocument();
    for (const [input, message] of [["0", "The amount must be more than zero."], ["abc", "Use numbers only, like 150 or 1.5."],
                                     ["1.005", "Use at most two decimal places."]]) {
      await user.clear(amount);
      await user.type(amount, input!);
      expect(screen.getByText(message!)).toBeInTheDocument();
    }
    await user.clear(amount);
    await user.type(amount, "2");
    await user.click(screen.getByRole("button", { name: "Add to meal" }));
    expect(screen.getByText("Choose a serving size.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/estimate"))).toBe(false);

    await user.selectOptions(screen.getByLabelText("Serving size"), SERVING_ID);
    const estimateRegion = await screen.findByRole("region", { name: "Estimate" });
    expect(await within(estimateRegion).findByText("120 kcal")).toBeInTheDocument();
    expect(within(estimateRegion).getAllByText("Not in dataset").length).toBeGreaterThan(0);
    expect(within(estimateRegion).queryByText("0 mg")).not.toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/estimate"));
    expect(String(call![0])).toContain(`quantity=2&unit=serving&serving_id=${SERVING_ID}`);
  });
});

describe("logging a meal", () => {
  const apis = { "GET /api/v1/auth/session": session, "GET /api/v1/foods/search": search([rotiHit]),
                 [`GET /api/v1/foods/${ROTI_ID}`]: detail, [`GET /api/v1/foods/${ROTI_ID}/estimate`]: estimate };

  it("adds and removes foods, then saves only what remains and confirms after the server responds", async () => {
    let release: () => void = () => {};
    const fetchMock = mockApi({ ...apis, ...dashboardApis,
      "POST /api/v1/meals": (init) => new Promise((resolve) => {
        release = () => resolve({ status: 201, body: lunch([rotiItem()]) });
        void init;
      }) as never });
    const user = userEvent.setup();
    renderApp("/app/meals");
    expect(await screen.findByRole("button", { name: "Save meal" })).toBeDisabled();
    await addRoti(user);
    await user.click(screen.getByRole("button", { name: "Add food" }));
    await user.type(screen.getByLabelText("Search foods"), "x");
    await user.click(await screen.findByRole("button", { name: /without nutrition data/ }));
    await user.clear(screen.getByLabelText("Food name"));
    await user.type(screen.getByLabelText("Food name"), "Mess curry");
    await user.click(screen.getByRole("button", { name: "Add to meal" }));
    expect(screen.getByRole("heading", { name: "Foods (2)" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Mess curry" }));
    expect(screen.getByRole("heading", { name: "Foods (1)" })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Meal"), "lunch");
    await user.type(screen.getByLabelText(/Where/), "Hostel mess");
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(screen.queryByText(/saved with/)).not.toBeInTheDocument();  // nothing claimed before the server answers
    release();
    expect(await screen.findByText("Lunch saved with 1 item.")).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/api/v1/meals") && i?.method === "POST");
    const body = bodyOf(post);
    expect(body.meal_type).toBe("lunch");
    expect(body.location_note).toBe("Hostel mess");
    expect(body.consumed_at).toMatch(/T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.items).toEqual([{ food_id: ROTI_ID, quantity: "1", unit: "serving", serving_id: SERVING_ID }]);
    expect(screen.getByRole("heading", { name: "Foods (0)" })).toBeInTheDocument();
  });

  it("prevents duplicate submission and reuses the request key when retrying the same meal", async () => {
    let posts = 0;
    let release: (r: { status: number; body?: unknown }) => void = () => {};
    const fetchMock = mockApi({ ...apis,
      "POST /api/v1/meals": () => {
        posts += 1;
        if (posts === 1) return new Promise((resolve) => { release = resolve; }) as never;
        return { status: 201, body: lunch() };
      } });
    const user = userEvent.setup();
    renderApp("/app/meals");
    await screen.findByRole("button", { name: "Save meal" });
    await addRoti(user, "2");
    const save = screen.getByRole("button", { name: "Save meal" });
    await user.click(save);
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("aria-busy", "true");
    await user.click(save);
    await user.dblClick(save);
    expect(posts).toBe(1);

    release({ status: 503, body: { error: { code: "http_error", message: "Service temporarily unavailable." } } });
    expect(await screen.findByText("Service temporarily unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Foods (1)" })).toBeInTheDocument();  // the draft is kept
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(await screen.findByText(/saved with/)).toBeInTheDocument();
    const keys = fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/api/v1/meals") && i?.method === "POST")
      .map((c) => bodyOf(c).idempotency_key);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("shows the server's validation messages per item", async () => {
    mockApi({ ...apis, "POST /api/v1/meals": () => ({ status: 422, body: { error: {
      code: "validation_failed", message: "Some fields are invalid.",
      details: [{ loc: ["body", "items", "0", "quantity"], msg: "Input should be less than or equal to 10000" }] } } }) });
    const user = userEvent.setup();
    renderApp("/app/meals");
    await screen.findByRole("button", { name: "Save meal" });
    await addRoti(user);
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some fields are invalid.");
    expect(alert).toHaveTextContent("Item 1 (quantity): Input should be less than or equal to 10000");
  });

  it("refuses future times before calling the API", async () => {
    const fetchMock = mockApi(apis);
    const user = userEvent.setup();
    renderApp("/app/meals");
    await screen.findByRole("button", { name: "Save meal" });
    await addRoti(user);
    const next = new Date(Date.now() + 2 * 86400_000);
    const iso = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    const dateInput = screen.getByLabelText("Date");
    await user.clear(dateInput);
    await user.type(dateInput, iso);
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    expect(await screen.findByText(/not for a future time/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  });
});

describe("meal history", () => {
  it("shows an empty day", async () => {
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/meals/day": () => emptyDay });
    renderApp("/app/meals?view=history&date=2026-10-11");
    expect(await screen.findByText("No meals logged on this day")).toBeInTheDocument();
  });

  it("lists meals, edits a portion, and deletes a meal after confirmation", async () => {
    let deleted = false;
    let dayCalls = 0;
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/meals/day": (_i, url) => {
        dayCalls += 1;
        const date = url.searchParams.get("date")!;
        return { status: 200, body: deleted ? { ...emptyDay.body, date } : { date, meals: [lunch()], totals: lunch().totals } };
      },
      [`GET /api/v1/foods/${ROTI_ID}`]: detail, [`GET /api/v1/foods/${ROTI_ID}/estimate`]: estimate,
      "PATCH /api/v1/meals/meal-1/items/item-1": () => ({ status: 200, body: lunch([rotiItem("item-1", "3.00")]) }),
      "DELETE /api/v1/meals/meal-1": () => { deleted = true; return { status: 204 }; } });
    const user = userEvent.setup();
    renderApp("/app/meals?view=history&date=2026-10-11");
    const card = await screen.findByRole("region", { name: /Lunch ·/ });
    expect(within(card).getByText("Roti / chapati")).toBeInTheDocument();
    expect(within(card).getByText(/2 × 1 medium roti/)).toBeInTheDocument();
    expect(within(card).getByText("Hostel mess")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Edit Roti / chapati" }));
    const amount = await within(card).findByLabelText("Amount");
    expect(amount).toHaveValue("2");
    await user.clear(amount);
    await user.type(amount, "3");
    await user.click(within(card).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH");
    expect(bodyOf(patch)).toEqual({ quantity: "3", unit: "serving", serving_id: SERVING_ID });
    const callsBeforeDelete = dayCalls;
    await waitFor(() => expect(dayCalls).toBeGreaterThan(1));  // refetched after the edit

    await user.click(within(await screen.findByRole("region", { name: /Lunch ·/ })).getByRole("button", { name: /^Delete Lunch/ }));
    const dialog = screen.getByRole("dialog", { name: "Delete this meal?" });
    expect(dialog).toHaveTextContent("Any expense linked to it stays in your budget.");
    await user.click(within(dialog).getByRole("button", { name: "Delete meal" }));
    expect(await screen.findByText("No meals logged on this day")).toBeInTheDocument();
    expect(dayCalls).toBeGreaterThan(callsBeforeDelete);
  });

  it("navigates between days", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/meals/day": (_i, url) => ({ status: 200, body: { ...emptyDay.body, date: url.searchParams.get("date") } }) });
    const user = userEvent.setup();
    const { router } = renderApp("/app/meals?view=history&date=2026-10-10");
    await screen.findByText("No meals logged on this day");
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(router.state.location.search).toContain("date=2026-10-09"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("date=2026-10-09"))).toBe(true));
  });
});

describe("dashboard refresh", () => {
  it("shows the new meal on the dashboard after saving, without stale totals", async () => {
    let saved = false;
    mockApi({ "GET /api/v1/auth/session": session, ...dashboardApis,
      "GET /api/v1/foods/search": search([rotiHit]), [`GET /api/v1/foods/${ROTI_ID}`]: detail,
      [`GET /api/v1/foods/${ROTI_ID}/estimate`]: estimate,
      "GET /api/v1/meals/day": () => (saved ? { status: 200, body: { date: "2026-10-11", meals: [lunch()], totals: lunch().totals } }
                                            : emptyDay),
      "POST /api/v1/meals": () => { saved = true; return { status: 201, body: lunch() }; } });
    const user = userEvent.setup();
    const { router } = renderApp("/app");
    expect(await screen.findByText("No meals logged today")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Log a meal" }));
    await screen.findByRole("button", { name: "Save meal" });
    await addRoti(user);
    await user.click(screen.getByRole("button", { name: "Save meal" }));
    await screen.findByText(/saved with/);
    await router.navigate("/app");
    expect(await screen.findByText("239 kcal")).toBeInTheDocument();
    expect(screen.queryByText("No meals logged today")).not.toBeInTheDocument();
  });

  it("keeps demo mode separate: the demo meals page makes no API calls", async () => {
    window.sessionStorage.setItem("delulufit:demo", "1");
    const fetchMock = mockApi({});
    renderApp("/app/meals");
    expect((await screen.findAllByText("Demo data")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Save meal" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
