import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { emptyDay } from "@/test/fixtures";
import { lunch, rotiItem } from "@/test/mealFixtures";
import { mockApi, renderApp, USER, type Handler } from "@/test/utils";
import type { DayTotals, NutrientKey, NutritionTarget, RangeSummary, Totals, TotalStatus } from "@/types/api";

import { buildTrend, hasAnyValue, targetOn } from "./analytics";

const session: Handler = () => ({ status: 200, body: USER });
const KEYS: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g", "sugars_g", "sodium_mg"];
const UNITS: Record<NutrientKey, string> = { energy_kcal: "kcal", protein_g: "g", carbohydrate_g: "g", fat_g: "g",
                                             fibre_g: "g", sugars_g: "g", sodium_mg: "mg" };

/** Test-only totals: `values` maps a nutrient to [display, status]; anything else is unavailable/empty. */
function totals(items: number, values: Partial<Record<NutrientKey, [string, TotalStatus]>>): Totals {
  return {
    item_count: items, complete: false, note: null,
    nutrients: Object.fromEntries(KEYS.map((k) => {
      const v = values[k];
      const status: TotalStatus = v ? v[1] : items === 0 ? "empty" : "unavailable";
      return [k, { total: v ? v[0] : null, display: v ? v[0] : null, unit: UNITS[k], status,
                   known_items: v ? (status === "incomplete" ? items - 1 : items) : 0,
                   missing_items: v ? (status === "incomplete" ? 1 : 0) : items }];
    })) as Totals["nutrients"],
  };
}

function day(date: string, meals: number, values: Partial<Record<NutrientKey, [string, TotalStatus]>>): DayTotals {
  return { date, meal_count: meals, totals: totals(meals * 2, values) };
}

function week(end = "2026-10-11"): RangeSummary {
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${end}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const days = dates.map((d, i) => i === 4 ? day(d, 2, { energy_kcal: ["1450", "incomplete"], protein_g: ["40.5", "incomplete"] })
    : i === 6 ? day(d, 1, { energy_kcal: ["600", "complete"], protein_g: ["20", "complete"] })
    : i === 5 ? { date: d, meal_count: 1, totals: totals(1, {}) }   // logged, but nothing known
    : day(d, 0, {}));
  return { start: dates[0]!, end, days, days_with_meals: 3,
           totals: totals(5, { energy_kcal: ["2050", "incomplete"], protein_g: ["60.5", "incomplete"] }) };
}

const target: NutritionTarget = { id: "t1", source: "self_set", energy_kcal: "2000.0", protein_g: "60.0",
  carbohydrate_g: null, fat_g: null, fibre_g: null, effective_from: "2026-10-01", effective_to: null, notes: null };

describe("chart data preparation", () => {
  it("keeps unknown days as gaps, never zero, and marks partial days", () => {
    const points = buildTrend(week().days, "energy_kcal");
    expect(points).toHaveLength(7);
    expect(points.map((p) => p.value)).toEqual([null, null, null, null, 1450, null, 600]);
    expect(points[4]).toMatchObject({ status: "incomplete", display: "1450", mealCount: 2, missingItems: 1 });
    expect(points[5]).toMatchObject({ status: "unavailable", value: null, mealCount: 1 });
    expect(points[0]).toMatchObject({ status: "empty", value: null });
    expect(hasAnyValue(points)).toBe(true);
    expect(hasAnyValue(buildTrend(week().days, "sodium_mg"))).toBe(false);
  });

  it("labels short periods with weekdays and long periods with dates", () => {
    expect(buildTrend(week().days, "energy_kcal")[6]!.label).toMatch(/Sun|11/);
    const month = Array.from({ length: 30 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, "0")}`, 0, {}));
    expect(buildTrend(month, "energy_kcal")[0]!.label).toMatch(/Sept?|1/);
  });

  it("finds the target in effect on a date, including boundaries", () => {
    const old: NutritionTarget = { ...target, id: "t0", effective_from: "2026-09-01", effective_to: "2026-09-30" };
    expect(targetOn([target, old], "2026-09-30")?.id).toBe("t0");
    expect(targetOn([target, old], "2026-10-01")?.id).toBe("t1");
    expect(targetOn([target, old], "2026-08-31")).toBeNull();
  });
});

describe("day view (live)", () => {
  const partialDay = { status: 200, body: { date: "2026-10-11", meals: [lunch([rotiItem(), { ...rotiItem("item-2"),
    display_name: "Mess curry", food: null, is_manual: true, estimate: null }])],
    totals: totals(2, { energy_kcal: ["239", "incomplete"], protein_g: ["6.3", "incomplete"] }) } };

  it("shows real totals with partial and missing nutrients, sources, meals and the student's target", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/meals/day": () => partialDay,
                                "GET /api/v1/targets": () => ({ status: 200, body: [target] }) });
    renderApp("/app/nutrition");
    await screen.findByRole("heading", { name: "Sunday, 11 October" });
    // Scope to the day card: "Energy" also appears in the targets card once that loads.
    const dayCard = screen.getByRole("region", { name: "Sunday, 11 October" });
    const energy = within(dayCard).getByText("Energy").closest("div")!;
    expect(energy).toHaveTextContent("≥ 239 kcal");
    expect(energy).toHaveTextContent("Partial");
    expect(energy).toHaveTextContent("1 of 2 items");
    const sodium = within(dayCard).getByText("Sodium").closest("div")!;
    expect(sodium).toHaveTextContent("—");
    expect(sodium).toHaveTextContent("No data");
    expect(sodium).not.toHaveTextContent("0 mg");
    expect(screen.getByText(/No nutrition data for: Mess curry/)).toBeInTheDocument();
    expect(screen.getByText(/Reference data: Test dataset \(test-v1\)/)).toBeInTheDocument();

    const targets = await screen.findByRole("region", { name: "Your targets" });
    // The card renders with a skeleton first; wait for the targets themselves.
    expect(await within(targets).findByText(/Set by you/)).toBeInTheDocument();
    expect(within(targets).getByText("Energy").closest("li")).toHaveTextContent("Recorded ≥ 239 kcal · target 2,000 kcal");
    expect(within(targets).queryByText(/met|deficien|too (little|much)/i)).not.toBeInTheDocument();
    // Today is chosen by the server: no date is sent.
    const dayCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/meals/day"));
    expect(String(dayCall![0])).not.toContain("date=");
  });

  it("is honest when no target is set", async () => {
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/meals/day": () => partialDay,
              "GET /api/v1/targets": () => ({ status: 200, body: [] }) });
    renderApp("/app/nutrition");
    expect(await screen.findByText("No target set for this day")).toBeInTheDocument();
    expect(screen.getByText(/never picks one for you/)).toBeInTheDocument();
  });

  it("shows an empty day with a way to log a meal", async () => {
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/meals/day": () => emptyDay });
    renderApp("/app/nutrition");
    expect(await screen.findByText("No meals logged on this day")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log a meal" })).toHaveAttribute("href", "/app/meals");
    expect(screen.queryByRole("region", { name: "Your targets" })).not.toBeInTheDocument();
  });

  it("shows API failures with retry and no demo fallback", async () => {
    let calls = 0;
    mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/meals/day": () => (++calls === 1
        ? { status: 500, body: { error: { code: "internal_error", message: "Something went wrong on our side." } } }
        : emptyDay) });
    const user = userEvent.setup();
    renderApp("/app/nutrition");
    expect(await screen.findByText("Something went wrong on our side.")).toBeInTheDocument();
    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No meals logged on this day")).toBeInTheDocument();
  });

  it("navigates days from the server's date", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/meals/day": (_i, url) => ({ status: 200, body: { ...emptyDay.body, date: url.searchParams.get("date") ?? "2026-10-11" } }) });
    const user = userEvent.setup();
    const { router } = renderApp("/app/nutrition");
    await screen.findByRole("heading", { name: "Sunday, 11 October" });
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(router.state.location.search).toBe("?date=2026-10-10"));
    expect(await screen.findByRole("heading", { name: "Saturday, 10 October" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("date=2026-10-10"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });
});

describe("period views (live)", () => {
  it("shows a week of daily totals with a chart, an accessible table and honest gaps", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session,
                                "GET /api/v1/nutrition/summary": () => ({ status: 200, body: week() }) });
    const user = userEvent.setup();
    renderApp("/app/nutrition?view=7");
    expect(await screen.findByText(/Meals logged on 3 of 7 days/)).toBeInTheDocument();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/nutrition/summary"));
    expect(String(call![0])).toContain("days=7");
    expect(String(call![0])).not.toContain("end=");
    expect(screen.getByText("Energy per day (kcal)")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Energy by day" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(7);
    expect(within(table).getByRole("row", { name: /Friday, 9 October/ })).toHaveTextContent("≥ 1,450 kcalPartial");
    expect(within(table).getByRole("row", { name: /Saturday, 10 October/ })).toHaveTextContent("1—No data");
    expect(within(table).getByRole("row", { name: /Sunday, 11 October/ })).toHaveTextContent("600 kcalAll items");
    expect(within(table).queryByText("0 kcal")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Nutrient"), "protein_g");
    expect(screen.getByRole("table", { name: "Protein by day" })).toHaveTextContent("≥ 40.5 g");
  });

  it("moves between periods using explicit end dates", async () => {
    const fetchMock = mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/nutrition/summary": (_i, url) => ({ status: 200, body: week(url.searchParams.get("end") ?? "2026-10-11") }) });
    const user = userEvent.setup();
    const { router } = renderApp("/app/nutrition?view=7");
    await screen.findByText(/Meals logged on 3 of 7 days/);
    expect(screen.getByRole("button", { name: "Next 7 days" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Previous 7 days" }));
    await waitFor(() => expect(router.state.location.search).toBe("?view=7&end=2026-10-04"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("end=2026-10-04"))).toBe(true));
  });

  it("shows an empty period and a chart-specific empty state", async () => {
    const empty: RangeSummary = { ...week(), days: week().days.map((d) => ({ ...d, meal_count: 0, totals: totals(0, {}) })),
                                  days_with_meals: 0, totals: totals(0, {}) };
    mockApi({ "GET /api/v1/auth/session": session, "GET /api/v1/nutrition/summary": () => ({ status: 200, body: empty }) });
    renderApp("/app/nutrition?view=30");
    expect(await screen.findByText("No meals logged in these days")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("refreshes summaries after a meal is deleted elsewhere", async () => {
    let deleted = false;
    let summaryCalls = 0;
    mockApi({ "GET /api/v1/auth/session": session,
      "GET /api/v1/nutrition/summary": () => {
        summaryCalls += 1;
        return { status: 200, body: deleted ? { ...week(), days_with_meals: 0 } : week() };
      },
      "GET /api/v1/meals/day": (_i, url) => ({ status: 200, body: deleted ? { ...emptyDay.body, date: url.searchParams.get("date") }
        : { date: url.searchParams.get("date"), meals: [lunch()], totals: lunch().totals } }),
      "DELETE /api/v1/meals/meal-1": () => { deleted = true; return { status: 204 }; } });
    const user = userEvent.setup();
    const { router } = renderApp("/app/nutrition?view=7");
    await screen.findByText(/Meals logged on 3 of 7 days/);
    await router.navigate("/app/meals?view=history&date=2026-10-11");
    await user.click(await screen.findByRole("button", { name: /^Delete Lunch/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete meal" }));
    await screen.findByText("No meals logged on this day");
    await router.navigate("/app/nutrition?view=7");
    expect(await screen.findByText("No meals logged in these days")).toBeInTheDocument();
    expect(summaryCalls).toBeGreaterThanOrEqual(2);
  });
});

describe("demo separation", () => {
  it("demo mode keeps the labelled sample chart and makes no API calls", async () => {
    window.sessionStorage.setItem("delulufit:demo", "1");
    const fetchMock = mockApi({});
    renderApp("/app/nutrition");
    expect((await screen.findAllByText("Demo data")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("group", { name: "Period" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
