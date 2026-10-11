import type { Budget, BudgetOverview, BudgetPeriod, BudgetSummary, DayMeals, FoodDetail, FoodSearchResult, ItemPreview, Meal, MealInput, MealItemInput,
              MealItemUpdateInput, MealUpdateInput, NutritionTarget, Page, ProfileBundle, RangeSummary, SessionResponse,
              SpendingPoint, Transaction, TransactionInput, TransactionUpdateInput, Unit } from "@/types/api";

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

const txn = (id: string) => `/api/v1/budget/transactions/${encodeURIComponent(id)}`;

export const budgetApi = {
  /** Without arguments the server picks today (profile timezone) and the active budget's period. */
  summary: (params: { date?: string; period?: BudgetPeriod } = {}, signal?: AbortSignal) =>
    apiRequest<BudgetSummary>("/api/v1/budget/summary", { query: params, signal }),
  overview: (signal?: AbortSignal) => apiRequest<BudgetOverview>("/api/v1/budget", { signal }),
  setActive: (body: { period: BudgetPeriod; amount: string; effective_from?: string | null }) =>
    apiRequest<Budget>("/api/v1/budget/active", { method: "PUT", body }),
  endActive: () => apiRequest<void>("/api/v1/budget/active", { method: "DELETE" }),
  trend: (days: number, signal?: AbortSignal) =>
    apiRequest<SpendingPoint[]>("/api/v1/budget/trend", { query: { days }, signal }),
  transactions: (params: { start?: string; end?: string; limit?: number; offset?: number }, signal?: AbortSignal) =>
    apiRequest<Page<Transaction>>("/api/v1/budget/transactions", { query: params, signal }),
  createTransaction: (body: TransactionInput) =>
    apiRequest<Transaction>("/api/v1/budget/transactions", { method: "POST", body }),
  updateTransaction: (id: string, body: TransactionUpdateInput) =>
    apiRequest<Transaction>(txn(id), { method: "PATCH", body }),
  deleteTransaction: (id: string) => apiRequest<void>(txn(id), { method: "DELETE" }),
};

export const nutritionApi = {
  /** Either `days` (optionally with `end`) or `start` + `end`; omit `end` to let the server pick today. */
  summary: (params: { start?: string; end?: string; days?: number }, signal?: AbortSignal) =>
    apiRequest<RangeSummary>("/api/v1/nutrition/summary", { query: params, signal }),
};

export const targetsApi = {
  list: (signal?: AbortSignal) => apiRequest<NutritionTarget[]>("/api/v1/targets", { signal }),
};
