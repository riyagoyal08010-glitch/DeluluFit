import type { QueryClient } from "@tanstack/react-query";

/**
 * Query keys for live (real-account) data. Every key starts with "live" so demo
 * data (keyed "demo") can never satisfy or be overwritten by a live query.
 */
export const liveKeys = {
  meals: ["live", "meals"] as const,
  mealDay: (date: string) => ["live", "meals", "day", date] as const,
  // Under "meals" so invalidateMeals() also refreshes nutrition summaries after any meal change.
  nutritionSummary: (days: number, end: string) => ["live", "meals", "summary", days, end] as const,
  targets: ["live", "targets"] as const,
  // Everything budget-related, including the dashboard card, lives under ["live","budget"].
  budget: ["live", "budget"] as const,
  budgetSummary: (period: string | null, date: string | null) =>
    ["live", "budget", "summary", period ?? "auto", date ?? "current"] as const,
  budgetOverview: ["live", "budget", "overview"] as const,
  budgetTrend: (days: number) => ["live", "budget", "trend", days] as const,
  transactions: (start: string, end: string, limit: number) =>
    ["live", "budget", "transactions", start, end, limit] as const,
  foodSearch: (q: string) => ["live", "foods", "search", q] as const,
  food: (id: string) => ["live", "foods", "detail", id] as const,
  estimate: (id: string, quantity: string, unit: string, servingId: string | null) =>
    ["live", "foods", "estimate", id, quantity, unit, servingId] as const,
};

/** After any meal change: refetch every meal list, day view and the dashboard (all under ["live","meals"]). */
export function invalidateMeals(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: liveKeys.meals });
}

/** After any budget or transaction change: refetch the Budget page and the dashboard's budget card. */
export function invalidateBudget(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: liveKeys.budget });
}
