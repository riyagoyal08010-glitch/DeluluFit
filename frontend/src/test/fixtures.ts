/** API response fixtures shared by tests (test-only data). */
export const emptyDay = { status: 200, body: { date: "2026-10-11", meals: [], totals: { item_count: 0, complete: true, note: null,
  nutrients: Object.fromEntries(["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g", "sugars_g", "sodium_mg"]
    .map((k) => [k, { total: null, display: null, unit: "g", status: "empty", known_items: 0, missing_items: 0 }])) } } };
export const noBudget = { status: 200, body: { period: "weekly", start: "2026-10-05", end: "2026-10-11", currency: "INR",
  budget_amount: null, expenses: "0.00", refunds: "0.00", net_spending: "0.00", remaining: null, utilization: null,
  over_budget: false, transaction_count: 0, has_budget: false, by_category: {}, explanation: "" } };
export const dashboardApis = {
  "GET /api/v1/profile": () => ({ status: 200, body: { profile: null } }),
  "GET /api/v1/meals/day": () => emptyDay,
  "GET /api/v1/budget/summary": () => noBudget,
};
