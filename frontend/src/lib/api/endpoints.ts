import type { BudgetSummary, DayMeals, FoodDetail, FoodSearchResult, ItemPreview, Meal, MealInput, MealItemInput,
              MealItemUpdateInput, MealUpdateInput, Page, ProfileBundle, SessionResponse, Unit } from "@/types/api";

import { apiRequest } from "./client";

/** Typed wrappers for the endpoints the frontend uses today. Paths match backend/app/api/routes. */

export const authApi = {
  session: (signal?: AbortSignal) =>
    apiRequest<SessionResponse>("/api/v1/auth/session", { signal, skipUnauthorizedHandler: true }),
  login: (email: string, password: string) =>
    apiRequest<SessionResponse>("/api/v1/auth/login", { method: "POST", body: { email, password },
                                                         skipUnauthorizedHandler: true }),
  register: (email: string, password: string, displayName: string | null) =>
    apiRequest<SessionResponse>("/api/v1/auth/register", {
      method: "POST", body: { email, password, display_name: displayName }, skipUnauthorizedHandler: true,
    }),
  logout: () => apiRequest<void>("/api/v1/auth/logout", { method: "POST", skipUnauthorizedHandler: true }),
};

export const profileApi = {
  get: (signal?: AbortSignal) => apiRequest<ProfileBundle>("/api/v1/profile", { signal }),
};

export const foodsApi = {
  search: (q: string, signal?: AbortSignal) =>
    apiRequest<FoodSearchResult>("/api/v1/foods/search", { query: { q, limit: 10 }, signal }),
  detail: (foodId: string, signal?: AbortSignal) =>
    apiRequest<FoodDetail>(`/api/v1/foods/${encodeURIComponent(foodId)}`, { signal }),
  /** Read-only preview computed by the backend nutrition engine; nothing is saved. */
  estimate: (foodId: string, portion: { quantity: string; unit: Unit; servingId?: string | null }, signal?: AbortSignal) =>
    apiRequest<ItemPreview>(`/api/v1/foods/${encodeURIComponent(foodId)}/estimate`, {
      query: { quantity: portion.quantity, unit: portion.unit, serving_id: portion.servingId ?? undefined }, signal,
    }),
};

const meal = (id: string) => `/api/v1/meals/${encodeURIComponent(id)}`;

export const mealsApi = {
  day: (date?: string, signal?: AbortSignal) =>
    apiRequest<DayMeals>("/api/v1/meals/day", { query: { date }, signal }),
  list: (params: { start?: string; end?: string; limit?: number; offset?: number }, signal?: AbortSignal) =>
    apiRequest<Page<Meal>>("/api/v1/meals", { query: params, signal }),
  get: (id: string, signal?: AbortSignal) => apiRequest<Meal>(meal(id), { signal }),
  create: (body: MealInput) => apiRequest<Meal>("/api/v1/meals", { method: "POST", body }),
  update: (id: string, body: MealUpdateInput) => apiRequest<Meal>(meal(id), { method: "PATCH", body }),
  remove: (id: string) => apiRequest<void>(meal(id), { method: "DELETE" }),
  addItem: (id: string, body: MealItemInput) => apiRequest<Meal>(`${meal(id)}/items`, { method: "POST", body }),
  updateItem: (id: string, itemId: string, body: MealItemUpdateInput) =>
    apiRequest<Meal>(`${meal(id)}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body }),
  removeItem: (id: string, itemId: string) =>
    apiRequest<Meal>(`${meal(id)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" }),
};

export const budgetApi = {
  summary: (signal?: AbortSignal) => apiRequest<BudgetSummary>("/api/v1/budget/summary", { signal }),
};
