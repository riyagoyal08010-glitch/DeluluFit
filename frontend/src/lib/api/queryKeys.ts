import type { QueryClient } from "@tanstack/react-query";

/**
 * Query keys for live (real-account) data. Every key starts with "live" so demo
 * data (keyed "demo") can never satisfy or be overwritten by a live query.
 */
export const liveKeys = {
  meals: ["live", "meals"] as const,
  mealDay: (date: string) => ["live", "meals", "day", date] as const,
  foodSearch: (q: string) => ["live", "foods", "search", q] as const,
  food: (id: string) => ["live", "foods", "detail", id] as const,
  estimate: (id: string, quantity: string, unit: string, servingId: string | null) =>
    ["live", "foods", "estimate", id, quantity, unit, servingId] as const,
};

/** After any meal change: refetch every meal list, day view and the dashboard (all under ["live","meals"]). */
export function invalidateMeals(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: liveKeys.meals });
}
