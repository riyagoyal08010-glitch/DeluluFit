/**
 * Test-only API responses shaped like backend/app/schemas/menus.py (MenuSummaryOut, MenuSuggestionsOut).
 * Names and numbers are arbitrary test values, not nutrition facts.
 */
import type { DishNutrition, DishSuggestion, MenuSuggestions, MenuSummary, ProfileNutrientStatus } from "@/types/api";

export const MENU_ID = "33333333-3333-4333-8333-333333333333";
export const MEAL_ID = "44444444-4444-4444-8444-444444444444";
export const DISH_ID = "55555555-5555-4555-8555-555555555555";

export function menuSummary(over: Partial<MenuSummary> = {}): MenuSummary {
  return {
    id: MENU_ID, title: "Menu for 11 Oct 2026", menu_date: "2026-10-11", meal_type_hint: null, mess_id: null,
    status: "confirmed", has_draft: false, has_confirmed: true, item_count: 3, has_image: false,
    created_at: "2026-10-11T08:00:00Z", updated_at: "2026-10-11T09:00:00Z", ...over,
  };
}

/** Reference nutrition with one status per nutrient; `display` is only set for reported values. */
export function refNutrition(statuses: Partial<Record<keyof DishNutrition["nutrients"], ProfileNutrientStatus>>,
                             values: Partial<Record<keyof DishNutrition["nutrients"], string>> = {}): DishNutrition {
  const units: Record<string, string> = { energy_kcal: "kcal", protein_g: "g", carbohydrate_g: "g", fat_g: "g", fibre_g: "g" };
  return {
    reference_mass_g: "100.00", source_name: "Test dataset",
    nutrients: Object.fromEntries(Object.entries(statuses).map(([k, status]) => [k, {
      value: status === "reported" ? `${values[k as keyof typeof values] ?? "1"}.0000` : null,
      display: status === "reported" ? values[k as keyof typeof values] ?? "1" : null,
      unit: units[k] ?? "g", status,
    }])) as DishNutrition["nutrients"],
  };
}

export function dish(over: Partial<DishSuggestion> = {}): DishSuggestion {
  return {
    menu_item_id: DISH_ID, menu_meal_id: MEAL_ID, name: "Jeera aloo", meal_type: "lunch", section_heading: null,
    serving_note: null, source: "manual", is_user_corrected: false, group: "available", score: 0, reasons: [], cautions: [],
    food: null, diet_type: null, nutrition: null, price: null, currency: "INR", ...over,
  };
}

export function suggestions(over: Partial<MenuSuggestions> = {}): MenuSuggestions {
  return {
    menu_id: MENU_ID, menu_date: "2026-10-11", status: "confirmed", confirmed: true, meal_types: ["lunch", "dinner"],
    meal_type: null, rule_version: "menu-rules-1",
    personalization: { personalized: true, based_on: ["1 food preference"], message: "Based on 1 food preference." },
    allergy_notice: null, budget: { has_budget: false, period: null, remaining: null, currency: "INR" },
    dishes: [dish()], ...over,
  };
}
