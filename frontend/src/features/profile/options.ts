import type { ActivityLevel, Allergen, AllergySeverity, DietaryPattern, NutritionTarget, PreferenceKind } from "@/types/api";

/** Option lists mirror the backend enums exactly (backend/app/db/enums.py); nothing here is invented. */

export const DIETARY_PATTERN_LABELS: Record<DietaryPattern, string> = {
  no_preference: "No preference", vegetarian: "Vegetarian", eggetarian: "Eggetarian (vegetarian + eggs)",
  non_vegetarian: "Non-vegetarian", vegan: "Vegan", jain: "Jain",
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Mostly sitting", light: "Lightly active", moderate: "Moderately active", active: "Active",
  very_active: "Very active",
};

export const PREFERENCE_LABELS: Record<PreferenceKind, string> = { like: "Like", dislike: "Dislike", avoid: "Avoid" };

export const ALLERGEN_LABELS: Record<Allergen, string> = {
  peanut: "Peanut", tree_nut: "Tree nuts", milk: "Milk / dairy", egg: "Egg", wheat_gluten: "Wheat / gluten",
  soy: "Soy", fish: "Fish", shellfish: "Shellfish", sesame: "Sesame", mustard: "Mustard", other: "Other (describe)",
};

export const SEVERITY_LABELS: Record<AllergySeverity, string> = {
  unknown: "Not sure", mild: "Mild", moderate: "Moderate", severe: "Severe",
};

export const TARGET_SOURCE_LABELS: Record<NutritionTarget["source"], string> = {
  self_set: "Set by you",
  professional: "From a professional, as you entered it",
  reference_estimate: "General reference estimate (not personalised)",
};

/** Common currencies; the backend accepts any three-letter ISO code, and a saved code not listed here is kept. */
export const CURRENCIES = ["INR", "NPR", "BDT", "LKR", "USD", "EUR", "GBP", "AED"];

export function timeZones(current: string): string[] {
  // Intl.supportedValuesOf is ES2022 (not in this project's ES2020 lib types); feature-detect it.
  const intl = Intl as unknown as { supportedValuesOf?: (key: "timeZone") => string[] };
  const all = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : ["Asia/Kolkata", "UTC"];
  return all.includes(current) ? all : [current, ...all];
}

export function options<K extends string>(labels: Record<K, string>): Array<{ value: K; label: string }> {
  return (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
}
