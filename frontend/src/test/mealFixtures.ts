/**
 * Test-only API responses shaped like the backend's (backend/app/schemas/meals.py, foods.py).
 * Values are arbitrary test numbers, not nutrition facts.
 */
import type { FoodDetail, ItemPreview, Meal, MealItem, NutrientKey, NutrientValue, Totals } from "@/types/api";

const KEYS: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g", "sugars_g", "sodium_mg"];
const UNITS: Record<NutrientKey, string> = { energy_kcal: "kcal", protein_g: "g", carbohydrate_g: "g", fat_g: "g",
                                             fibre_g: "g", sugars_g: "g", sodium_mg: "mg" };

export const ROTI_ID = "11111111-1111-4111-8111-111111111111";
export const SERVING_ID = "22222222-2222-4222-8222-222222222222";

export function nutrients(values: Partial<Record<NutrientKey, string>>): Record<NutrientKey, NutrientValue> {
  return Object.fromEntries(KEYS.map((k) => [k, values[k] === undefined
    ? { value: null, display: null, unit: UNITS[k], status: "not_in_source" }
    : { value: values[k]!, display: values[k]!, unit: UNITS[k], status: "estimated" }])) as Record<NutrientKey, NutrientValue>;
}

export const rotiHit = { id: ROTI_ID, canonical_name: "Roti / chapati", category: "bread", diet_type: "vegetarian",
                         matched_name: "roti", match_kind: "exact", score: 1, alias_confidence: "HIGH" };

export const rotiDetail: FoodDetail = {
  id: ROTI_ID, canonical_name: "Roti / chapati", category: "bread", diet_type: "vegetarian",
  known_allergens: ["wheat_gluten"], preparation_notes: null, aliases: ["roti", "chapati"], reference_mass_g: "100.00",
  nutrients: Object.fromEntries(KEYS.map((k) => [k, { value: null, display: null, unit: UNITS[k], status: "not_in_source" }])) as FoodDetail["nutrients"],
  provenance: { source_name: "Test dataset", source_reference: "TEST 1", source_food_id: "1", dataset_version: "test-v1" },
  servings: [{ id: SERVING_ID, label: "1 medium roti", mass_g: "40.0", is_default: false }],
  supported_units: ["g", "serving"], caveat: "Reference food, not your mess's recipe.",
};

export function preview(quantity: string, energy: string): ItemPreview {
  return {
    food: { id: ROTI_ID, canonical_name: "Roti / chapati" }, quantity, unit: "serving",
    serving: { id: SERVING_ID, label: "1 medium roti", mass_g: "40.0" }, estimated_mass_g: "40.00",
    mass_source: "serving_reference", match_confidence: "HIGH", method: "per_reference_mass", confidence: "MEDIUM",
    reason: null, nutrients: nutrients({ energy_kcal: energy, protein_g: "3.1" }),
    provenance: { food_nutrient_id: null, source_name: "Test dataset", source_reference: "TEST 1", source_food_id: "1",
                  dataset_version: "test-v1", portion_basis: null, mass_source: "serving_reference" },
  };
}

export function totals(items: MealItem[], energy: string | null): Totals {
  return {
    item_count: items.length, complete: false, note: items.some((i) => i.is_manual) ? "Some items have no data." : null,
    nutrients: Object.fromEntries(KEYS.map((k) => [k, {
      total: k === "energy_kcal" ? energy : null, display: k === "energy_kcal" ? energy : null, unit: UNITS[k],
      status: items.length === 0 ? "empty" : k === "energy_kcal" && energy ? "complete" : "unavailable",
      known_items: k === "energy_kcal" && energy ? items.length : 0, missing_items: 0,
    }])) as Totals["nutrients"],
  };
}

export function rotiItem(id = "item-1", quantity = "2.00"): MealItem {
  return {
    id, position: 0, display_name: "Roti / chapati", food: { id: ROTI_ID, canonical_name: "Roti / chapati" },
    is_manual: false, quantity, unit: "serving", serving: { id: SERVING_ID, label: "1 medium roti", mass_g: "40.0" },
    estimated_mass_g: "80.00", mass_source: "serving_reference", match_confidence: "HIGH", note: null,
    estimate: { version: 1, method: "per_reference_mass", confidence: "MEDIUM",
                nutrients: nutrients({ energy_kcal: "239", protein_g: "6.3" }),
                provenance: { source_name: "Test dataset", dataset_version: "test-v1", portion_basis: null } },
  };
}

export function lunch(items: MealItem[] = [rotiItem()], date = "2026-10-11"): Meal {
  return { id: "meal-1", meal_type: "lunch", source: "manual", consumed_at: `${date}T13:05:00+05:30`, log_date: date,
           note: null, location_note: "Hostel mess", items, totals: totals(items, items.length ? "239" : null) };
}
