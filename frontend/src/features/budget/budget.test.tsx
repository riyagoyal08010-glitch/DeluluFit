import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { dashboardApis, emptyDay } from "@/test/fixtures";
import { lunch } from "@/test/mealFixtures";
import { mockApi, renderApp, USER, type Handler } from "@/test/utils";
import type { Budget, BudgetSummary, Transaction } from "@/types/api";

import { absText, checkAmount, isNegative } from "./money";

const session: Handler = () => ({ status: 200, body: USER });

/** Test-only API responses (backend/app/schemas/budget.py shapes). Amounts are arbitrary. */
function summary(over: Partial<BudgetSummary> = {}): BudgetSummary {
  return { period: "weekly", start: "2026-10-05", end: "2026-10-11", currency: "INR", budget_amount: "700.00",
           expenses: "200.50", refunds: "20.50", net_spending: "180.00", remaining: "520.00", utilization: "0.2571",
           over_budget: false, excluded_other_currency: 0, transaction_count: 3, has_budget: true,
           by_category: { outside_food: "80.00", mess: "100.00" },
           explanation: "Net spending = expenses - refunds for transactions dated inside this period.", ...over };
}
const noBudgetSummary = summary({ budget_amount: null, remaining: null, utilization: null, has_budget: false,
                                  expenses: "0.00", refunds: "0.00", net_spending: "0.00", transaction_count: 0, by_category: {} });
const weekly: Budget = { id: "b1", period: "weekly", amount: "700.00", currency: "INR", effective_from: "2026-10-01", effective_to: null };
const samosa: Transaction = { id: "t1", kind: "expense", amount: "120.50", currency: "INR", category: "outside_food",
  occurred_on: "2026-10-06", description: "Samosa", meal_log_id: "meal-1", refund_of_id: null, created_at: "2026-10-06T10:00:00Z" };
const refund: Transaction = { ...samosa, id: "t2", kind: "refund", amount: "20.50", description: "Change returned",
  meal_log_id: null, refund_of_id: "t1", occurred_on: "2026-10-07" };
const page = (items: Transaction[]) => ({ status: 200, body: { items, total: items.length, limit: 20, offset: 0 } });
const trend = { status: 200, body: Array.from({ length: 14 }, (_, i) => ({ date: `2026-09-${String(28 + i > 30 ? i - 2 : 28 + i).padStart(2, "0")}`, net_spending: "0.00" })) };

function liveApis(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/v1/auth/session": session,
    "GET /api/v1/budget/summary": () => ({ status: 200, body: summary() }),
    "GET /api/v1/budget": () => ({ status: 200, body: { active: weekly, history: [weekly] } }),
    "GET /api/v1/budget/transactions": () => page([refund, samosa]),
    "GET /api/v1/budget/trend": () => trend,
    "GET /api/v1/meals/day": () => emptyDay,
    ...over,
  };
}

function bodyOf(call: unknown[] | undefined): Record<string, unknown> {
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

describe("money helpers", () => {
  it("validates amounts as strings, never as floats", () => {
    expect(checkAmount("120")).toEqual({ ok: true, value: "120" });
    expect(checkAmount("45.5")).toEqual({ ok: true, value: "45.5" });
    expect(checkAmount("1,200.00")).toEqual({ ok: true, value: "1200.00" });
    expect(checkAmount("0").ok).toBe(false);
    expect(checkAmount("0", { allowZero: true })).toEqual({ ok: true, value: "0" });
    for (const bad of ["", "-5", "1.005", "abc", "12345678901", "1e3"]) expect(checkAmount(bad).ok).toBe(false);
    expect(checkAmount("9999999999.99")).toEqual({ ok: true, value: "9999999999.99" });
  });

  it("phrases negative amounts without arithmetic", () => {
    expect([absText("-12.50"), absText("12.50")]).toEqual(["12.50", "12.50"]);
    expect([isNegative("-0.01"), isNegative("-0.00"), isNegative("0.00")]).toEqual([true, false, false]);
  });
});

describe("budget overview (live)", () => {
  it("shows the server's totals, categories and transactions", async () => {
    mockApi(liveApis());
    renderApp("/app/budget");
    const overview = await screen.findByRole("region", { name: "Weekly spending" });
    expect(within(overview).getByText("₹180.00")).toBeInTheDocument();
    expect(within(overview).getByText("₹520.00 left")).toBeInTheDocument();
    expect(within(overview).getByText("₹700.00")).toBeInTheDocument();
    expect(within(overview).getByText("Outside food").closest("li")).toHaveTextContent("₹80.00");
    expect(within(overview).getByRole("progressbar", { name: "Share of budget used" })).toHaveAttribute("aria-valuenow", "26");
    expect(within(overview).getByText(/Logging a meal never adds an expense/)).toBeInTheDocument();

    const txns = await screen.findByRole("region", { name: "Transactions" });
    const refundRow = (await within(txns).findByText("Change returned")).closest("li")!;
    expect(refundRow).toHaveTextContent("Refund");
    expect(refundRow).toHaveTextContent("− ₹20.50");
    expect(refundRow).toHaveTextContent("refund of “Samosa”");
    expect(within(txns).getByText("Samosa").closest("li")).toHaveTextContent("linked to a meal");
    expect(within(refundRow).queryByRole("button", { name: /Record refund/ })).not.toBeInTheDocument();
  });

  it("requests transactions for exactly the summarised period", async () => {
    const fetchMock = mockApi(liveApis());
    renderApp("/app/budget");
    await screen.findByText("Samosa");
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/budget/transactions"));
    expect(String(call![0])).toContain("start=2026-10-05&end=2026-10-11&limit=20");
    const sum = fetchMock.mock.calls.find(([u]) => String(u).includes("/budget/summary"));
    expect(String(sum![0])).not.toContain("?");  // server picks today and the budget's period
  });

  it("handles no budget and no transactions honestly", async () => {
    mockApi(liveApis({ "GET /api/v1/budget/summary": () => ({ status: 200, body: noBudgetSummary }),
                       "GET /api/v1/budget": () => ({ status: 200, body: { active: null, history: [] } }),
                       "GET /api/v1/budget/transactions": () => page([]) }));
    renderApp("/app/budget");
    expect(await screen.findByText("No transactions in this period")).toBeInTheDocument();
    expect(screen.getByText(/No weekly budget applies to this period/)).toBeInTheDocument();
    expect(await screen.findByText("No budget set")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: "Share of budget used" })).not.toBeInTheDocument();
    expect(screen.getByText("Nothing recorded in the last 14 days.")).toBeInTheDocument();
  });

  it("phrases over-budget and other-currency cases from server values", async () => {
    mockApi(liveApis({ "GET /api/v1/budget/summary": () => ({ status: 200, body: summary({
      net_spending: "700.01", remaining: "-0.01", utilization: "1.0000", over_budget: true, excluded_other_currency: 2 }) }) }));
    renderApp("/app/budget");
    expect(await screen.findByText("₹0.01 over this budget")).toBeInTheDocument();
    expect(screen.getByText(/2 transactions are in a different currency/)).toBeInTheDocument();
    expect(screen.queryByText(/-₹|₹-/)).not.toBeInTheDocument();
  });

  it("shows failures with retry and never demo data", async () => {
    let calls = 0;
    mockApi(liveApis({ "GET /api/v1/budget/summary": () => (++calls === 1
      ? { status: 503, body: { error: { code: "http_error", message: "Service temporarily unavailable." } } }
      : { status: 200, body: summary() }) }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    expect(await screen.findByText("Service temporarily unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Demo data")).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
    expect(await screen.findByText("₹520.00 left")).toBeInTheDocument();
  });

  it("navigates periods using the server's boundaries", async () => {
    const fetchMock = mockApi(liveApis());
    const user = userEvent.setup();
    const { router } = renderApp("/app/budget");
    await screen.findByText("₹520.00 left");
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=weekly&date=2026-10-04"));
    await user.click(screen.getByRole("button", { name: "Daily" }));
    await waitFor(() => expect(router.state.location.search).toBe("?period=daily&date=2026-10-04"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("period=daily&date=2026-10-04")))
      .toBe(true));
  });
});

describe("budget settings", () => {
  it("validates, saves, confirms after the server responds, and refreshes", async () => {
    let summaryCalls = 0;
    const fetchMock = mockApi(liveApis({
      "GET /api/v1/budget/summary": () => { summaryCalls += 1; return { status: 200, body: summary() }; },
      "PUT /api/v1/budget/active": () => ({ status: 200, body: { ...weekly, id: "b2", period: "monthly", amount: "2500.00", effective_from: "2026-10-11" } }),
    }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Change budget" }));
    const form = screen.getByRole("form", { name: "Budget" });
    const amount = within(form).getByLabelText(/Amount/);
    expect(amount).toHaveValue("700.00");
    for (const [input, msg] of [["abc", "Use numbers only, like 120 or 45.50."], ["-5", "Enter the amount without a minus sign."],
                                 ["1.005", "Use at most two decimal places (paise)."]]) {
      await user.clear(amount);
      await user.type(amount, input!);
      expect(within(form).getByText(msg!)).toBeInTheDocument();
    }
    await user.type(within(form).getByLabelText(/Starts/), "2026-09-01");
    expect(within(form).getByText(/Can't start before your current budget started/)).toBeInTheDocument();
    await user.clear(within(form).getByLabelText(/Starts/));
    await user.clear(amount);
    await user.type(amount, "2500");
    await user.selectOptions(within(form).getByLabelText("Period"), "monthly");
    const before = summaryCalls;
    await user.click(within(form).getByRole("button", { name: "Save budget" }));
    expect(await screen.findByText(/Budget saved: ₹2,500.00 per month, starting Sunday, 11 October/)).toBeInTheDocument();
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === "PUT");
    expect(bodyOf(put)).toEqual({ period: "monthly", amount: "2500", effective_from: null });
    await waitFor(() => expect(summaryCalls).toBeGreaterThan(before));
  });

  it("shows server validation errors without losing the form", async () => {
    mockApi(liveApis({ "PUT /api/v1/budget/active": () => ({ status: 422, body: { error: { code: "validation_failed",
      message: "A new budget cannot start before the current budget started." } } }) }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Change budget" }));
    await user.click(screen.getByRole("button", { name: "Save budget" }));
    expect(await screen.findByText("A new budget cannot start before the current budget started.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Budget" })).toBeInTheDocument();
  });

  it("ends a budget only after confirmation", async () => {
    const fetchMock = mockApi(liveApis({ "DELETE /api/v1/budget/active": () => ({ status: 204 }) }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "End budget" }));
    const dialog = screen.getByRole("dialog", { name: "End this budget?" });
    expect(dialog).toHaveTextContent("Your recorded spending is not affected.");
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "End budget" }));
    expect(await screen.findByText("Budget ended.")).toBeInTheDocument();
  });
});

describe("transactions", () => {
  it("adds an expense linked to a meal from that day", async () => {
    const fetchMock = mockApi(liveApis({
      "GET /api/v1/meals/day": (_i, url) => ({ status: 200, body: { date: url.searchParams.get("date"), meals: [lunch()], totals: lunch().totals } }),
      "POST /api/v1/budget/transactions": () => ({ status: 201, body: { ...samosa, id: "t9" } }),
    }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Add expense" }));
    const form = screen.getByRole("form", { name: "Add an expense" });
    await user.type(within(form).getByLabelText(/Amount/), "45.50");
    await user.selectOptions(within(form).getByLabelText("Category"), "beverages");
    const date = within(form).getByLabelText("Date");
    await user.clear(date);
    await user.type(date, "2026-10-08");
    await user.type(within(form).getByLabelText(/Note/), "Cold coffee");
    const meal = within(form).getByLabelText(/Meal/);
    await waitFor(() => expect(meal).not.toBeDisabled());
    await user.selectOptions(meal, "meal-1");
    await user.click(within(form).getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Add an expense" })).not.toBeInTheDocument());
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST");
    const body = bodyOf(post);
    expect(body).toMatchObject({ kind: "expense", amount: "45.50", category: "beverages", occurred_on: "2026-10-08",
                                 description: "Cold coffee", meal_log_id: "meal-1", refund_of_id: null });
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("records a refund against an expense and shows the server's limit error", async () => {
    const fetchMock = mockApi(liveApis({ "POST /api/v1/budget/transactions": () => ({ status: 422, body: { error: {
      code: "validation_failed", message: "Refunds cannot exceed the original expense amount." } } }) }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Record refund for Samosa" }));
    const form = screen.getByRole("form", { name: "Record a refund" });
    expect(form).toHaveTextContent("Refund for “Samosa”, ₹120.50");
    expect(within(form).getByLabelText("Category")).toHaveValue("outside_food");
    expect(within(form).queryByLabelText(/Meal/)).not.toBeInTheDocument();
    await user.type(within(form).getByLabelText(/Amount/), "200");
    await user.click(within(form).getByRole("button", { name: "Save refund" }));
    expect(await within(form).findByText("Refunds cannot exceed the original expense amount.")).toBeInTheDocument();
    expect(bodyOf(fetchMock.mock.calls.find(([, i]) => i?.method === "POST"))).toMatchObject(
      { kind: "refund", amount: "200", refund_of_id: "t1", meal_log_id: null });
  });

  it("prevents duplicate submission and reuses the key for an identical retry", async () => {
    let posts = 0;
    let failNetwork: () => void = () => {};
    const fetchMock = mockApi(liveApis({ "POST /api/v1/budget/transactions": () => {
      posts += 1;
      // The first attempt hangs, then fails like a dropped connection.
      if (posts === 1) return new Promise((_resolve, reject) => { failNetwork = () => reject(new TypeError("Failed to fetch")); }) as never;
      return { status: 201, body: samosa };
    } }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Add expense" }));
    const form = screen.getByRole("form", { name: "Add an expense" });
    await user.type(within(form).getByLabelText(/Amount/), "30");
    const save = within(form).getByRole("button", { name: "Save expense" });
    await user.click(save);
    expect(save).toBeDisabled();
    await user.dblClick(save);
    expect(posts).toBe(1);
    failNetwork();
    expect(await within(form).findByText(/couldn't reach DeluluFit/i)).toBeInTheDocument();
    // A failed first attempt (network error) keeps the form; retrying sends the same key.
    await waitFor(() => expect(within(form).getByRole("button", { name: "Save expense" })).not.toBeDisabled());
    await user.click(within(form).getByRole("button", { name: "Save expense" }));
    await waitFor(() => expect(posts).toBe(2));
    const keys = fetchMock.mock.calls.filter(([, i]) => i?.method === "POST").map((c) => bodyOf(c).idempotency_key);
    expect(keys[0]).toBe(keys[1]);
  });

  it("edits only the fields the API allows", async () => {
    const fetchMock = mockApi(liveApis({ "PATCH /api/v1/budget/transactions/t1": () => ({ status: 200, body: { ...samosa, amount: "100.00" } }) }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Edit Samosa" }));
    const form = screen.getByRole("form", { name: "Edit transaction" });
    expect(form).toHaveTextContent("type and links can't be changed");
    const amount = within(form).getByLabelText(/Amount/);
    await user.clear(amount);
    await user.type(amount, "100");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "PATCH")).toBe(true));
    expect(bodyOf(fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH"))).toEqual(
      { amount: "100", category: "outside_food", occurred_on: "2026-10-06", description: "Samosa" });
  });

  it("confirms deletion and explains when refunds block it", async () => {
    let deletes = 0;
    mockApi(liveApis({ "DELETE /api/v1/budget/transactions/t1": () => {
      deletes += 1;
      return { status: 422, body: { error: { code: "has_refunds", message: "Delete the refunds linked to this expense first." } } };
    } }));
    const user = userEvent.setup();
    renderApp("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Delete Samosa" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this transaction?" });
    expect(deletes).toBe(0);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByText("Delete the refunds linked to this expense first.")).toBeInTheDocument();
    expect(deletes).toBe(1);
  });
});

describe("refresh and isolation", () => {
  it("updates the dashboard's budget card after an expense is added", async () => {
    let added = false;
    mockApi({ ...dashboardApis, ...liveApis({
      "GET /api/v1/budget/summary": () => ({ status: 200, body: added ? summary({ budget_amount: null, has_budget: false, remaining: null,
        utilization: null, net_spending: "45.50", transaction_count: 1 }) : noBudgetSummary }),
      "GET /api/v1/budget/transactions": () => page(added ? [samosa] : []),
      "POST /api/v1/budget/transactions": () => { added = true; return { status: 201, body: samosa }; },
    }) });
    const user = userEvent.setup();
    const { router } = renderApp("/app");
    expect(await screen.findByText("No spending recorded yet")).toBeInTheDocument();
    await router.navigate("/app/budget");
    await user.click(await screen.findByRole("button", { name: "Add expense" }));
    await user.type(within(screen.getByRole("form", { name: "Add an expense" })).getByLabelText(/Amount/), "45.50");
    await user.click(screen.getByRole("button", { name: "Save expense" }));
    await screen.findByText("Samosa");
    await router.navigate("/app");
    const card = await screen.findByRole("region", { name: "Food budget" });
    expect(await within(card).findByText("₹45.50")).toBeInTheDocument();
    expect(within(card).queryByText("No spending recorded yet")).not.toBeInTheDocument();
  });

  it("keeps an expense when its meal is deleted, and refreshes the link", async () => {
    let mealDeleted = false;
    let txnCalls = 0;
    mockApi(liveApis({
      "GET /api/v1/budget/transactions": () => { txnCalls += 1; return page([{ ...samosa, meal_log_id: mealDeleted ? null : "meal-1" }]); },
      "GET /api/v1/meals/day": (_i, url) => ({ status: 200, body: mealDeleted ? { ...emptyDay.body, date: url.searchParams.get("date") }
        : { date: url.searchParams.get("date"), meals: [lunch()], totals: lunch().totals } }),
      "DELETE /api/v1/meals/meal-1": () => { mealDeleted = true; return { status: 204 }; },
    }));
    const user = userEvent.setup();
    const { router } = renderApp("/app/budget");
    expect((await screen.findByText("Samosa")).closest("li")).toHaveTextContent("linked to a meal");
    await router.navigate("/app/meals?view=history&date=2026-10-11");
    await user.click(await screen.findByRole("button", { name: /^Delete Lunch/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete meal" }));
    await screen.findByText("No meals logged on this day");
    const before = txnCalls;
    await router.navigate("/app/budget");
    const row = (await screen.findByText("Samosa")).closest("li")!;
    await waitFor(() => expect(row).not.toHaveTextContent("linked to a meal"));
    expect(row).toHaveTextContent("₹120.50");
    expect(txnCalls).toBeGreaterThan(before);
  });

  it("demo mode shows labelled sample data and makes no API calls", async () => {
    window.sessionStorage.setItem("delulufit:demo", "1");
    const fetchMock = mockApi({});
    renderApp("/app/budget");
    expect((await screen.findAllByText("Demo data")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Add expense" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
