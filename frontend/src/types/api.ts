/**
 * Response shapes of the DeluluFit API, written from the backend's Pydantic
 * schemas (backend/app/schemas). Decimal values arrive as strings and are only
 * formatted for display, never used for arithmetic here.
 */

export type DecimalString = string;

export interface SessionUser {
  id: string;
  email: string;
  role: string;
  created_at: string;
  has_profile: boolean;
  onboarding_completed: boolean;
}

export interface SessionResponse {
  user: SessionUser;
  csrf_token: string;
}

export interface Profile {
  display_name: string;
  height_cm: DecimalString | null;
  weight_kg: DecimalString | null;
  activity_level: string | null;
  dietary_pattern: string;
  currency: string;
  timezone: string;
  institution_id: string | null;
  hostel_id: string | null;
  onboarding_step: number;
  onboarding_completed_at: string | null;
}

export interface ProfileBundle {
  profile: Profile | null;
}

export type NutrientKey = "energy_kcal" | "protein_g" | "carbohydrate_g" | "fat_g" | "fibre_g" | "sugars_g" | "sodium_mg";
export type ItemNutrientStatus = "estimated" | "unknown" | "not_in_source" | "no_estimate";
export type TotalStatus = "complete" | "incomplete" | "unavailable" | "empty";

export interface NutrientValue {
  value: DecimalString | null;
  display: DecimalString | null;
  unit: string;
  status: ItemNutrientStatus;
}

export interface NutrientTotal {
  total: DecimalString | null;
  display: DecimalString | null;
  unit: string;
  status: TotalStatus;
  known_items: number;
  missing_items: number;
}

export interface Totals {
  item_count: number;
  complete: boolean;
  nutrients: Record<NutrientKey, NutrientTotal>;
  note: string | null;
}

export interface MealItem {
  id: string;
  position: number;
  display_name: string;
  food: { id: string; canonical_name: string } | null;
  is_manual: boolean;
  quantity: DecimalString;
  unit: "g" | "ml" | "serving";
  serving: { id: string; label: string; mass_g: DecimalString } | null;
  estimated_mass_g: DecimalString | null;
  mass_source: string;
  match_confidence: string;
  note: string | null;
  estimate: {
    version: number;
    method: string;
    confidence: string;
    nutrients: Record<NutrientKey, NutrientValue>;
    engine_version?: string;
    calculated_at?: string;
    reason?: string | null;
    provenance: EstimateProvenance | { source_name: string | null; dataset_version: string | null; portion_basis: string | null };
  } | null;
}

export type MealType = "breakfast" | "lunch" | "snacks" | "dinner" | "other";

export interface Meal {
  id: string;
  meal_type: MealType;
  source: string;
  consumed_at: string;
  log_date: string;
  note: string | null;
  location_note: string | null;
  items: MealItem[];
  totals: Totals;
}

export interface DayMeals {
  date: string;
  meals: Meal[];
  totals: Totals;
}

export interface BudgetSummary {
  period: "daily" | "weekly" | "monthly";
  start: string;
  end: string;
  currency: string;
  budget_amount: DecimalString | null;
  expenses: DecimalString;
  refunds: DecimalString;
  net_spending: DecimalString;
  remaining: DecimalString | null;
  utilization: DecimalString | null;
  over_budget: boolean;
  excluded_other_currency: number;
  transaction_count: number;
  has_budget: boolean;
  by_category: Record<string, DecimalString>;
  explanation: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** GET /foods/search. `score` is a ranking key, not a probability. */
export interface FoodSearchHit {
  id: string;
  canonical_name: string;
  category: string | null;
  diet_type: string;
  matched_name: string;
  match_kind: "exact" | "prefix" | "words" | "fuzzy";
  score: number;
  alias_confidence: string;
}

export interface FoodSearchResult {
  query: string;
  results: FoodSearchHit[];
}

export type ProfileNutrientStatus = "reported" | "unknown" | "not_in_source";
export type Unit = "g" | "ml" | "serving";

/** GET /foods/{id}. Nutrients are per `reference_mass_g` grams. */
export interface FoodDetail {
  id: string;
  canonical_name: string;
  category: string | null;
  diet_type: string;
  known_allergens: string[];
  preparation_notes: string | null;
  aliases: string[];
  reference_mass_g: DecimalString | null;
  nutrients: Record<NutrientKey, { value: DecimalString | null; display: DecimalString | null; unit: string;
                                   status: ProfileNutrientStatus }>;
  provenance: { source_name: string; source_reference: string | null; source_food_id: string | null;
                dataset_version: string | null } | null;
  servings: Array<{ id: string; label: string; mass_g: DecimalString; is_default: boolean }>;
  supported_units: Unit[];
  caveat: string;
}

export interface EstimateProvenance {
  food_nutrient_id: string | null;
  source_name: string | null;
  source_reference: string | null;
  source_food_id: string | null;
  dataset_version: string | null;
  portion_basis: string | null;
  mass_source: string;
}

/** GET /foods/{id}/estimate — what saving this portion would record. Nothing is stored. */
export interface ItemPreview {
  food: { id: string; canonical_name: string };
  quantity: DecimalString;
  unit: Unit;
  serving: { id: string; label: string; mass_g: DecimalString } | null;
  estimated_mass_g: DecimalString | null;
  mass_source: string;
  match_confidence: string;
  method: "per_reference_mass" | "unavailable";
  confidence: string;
  reason: string | null;
  nutrients: Record<NutrientKey, NutrientValue>;
  provenance: EstimateProvenance;
}

/** Request bodies (backend/app/schemas/meals.py). Quantities are sent as strings to keep decimals exact. */
export interface MealItemInput {
  food_id?: string | null;
  display_name?: string | null;
  quantity: string;
  unit: Unit;
  serving_id?: string | null;
  note?: string | null;
}

export interface MealInput {
  meal_type: MealType;
  consumed_at: string;
  note?: string | null;
  location_note?: string | null;
  idempotency_key?: string | null;
  items: MealItemInput[];
}

export type MealUpdateInput = Partial<Pick<MealInput, "meal_type" | "consumed_at" | "note" | "location_note">>;
export type MealItemUpdateInput = Partial<MealItemInput>;

/** GET /nutrition/summary — per-day totals over an inclusive range of profile-timezone dates. */
export interface DayTotals {
  date: string;
  meal_count: number;
  totals: Totals;
}

export interface RangeSummary {
  start: string;
  end: string;
  days: DayTotals[];
  totals: Totals;
  days_with_meals: number;
}

/** GET /targets — history of the student's nutrition targets (daily amounts). */
export interface NutritionTarget {
  id: string;
  source: "reference_estimate" | "self_set" | "professional";
  energy_kcal: DecimalString | null;
  protein_g: DecimalString | null;
  carbohydrate_g: DecimalString | null;
  fat_g: DecimalString | null;
  fibre_g: DecimalString | null;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

/** Budget API (backend/app/schemas/budget.py). Money is a decimal string; never do arithmetic on it here. */
export type BudgetPeriod = "daily" | "weekly" | "monthly";
export type SpendingCategory = "mess" | "outside_food" | "groceries" | "beverages" | "snacks" | "other";

export interface Budget {
  id: string;
  period: BudgetPeriod;
  amount: DecimalString;
  currency: string;
  effective_from: string;
  effective_to: string | null;
}

export interface BudgetOverview {
  active: Budget | null;
  history: Budget[];
}

export interface Transaction {
  id: string;
  kind: "expense" | "refund";
  amount: DecimalString;
  currency: string;
  category: SpendingCategory;
  occurred_on: string;
  description: string | null;
  meal_log_id: string | null;
  refund_of_id: string | null;
  created_at: string;
}

export interface TransactionInput {
  kind: "expense" | "refund";
  amount: string;
  category: SpendingCategory;
  occurred_on: string;
  description?: string | null;
  meal_log_id?: string | null;
  refund_of_id?: string | null;
  idempotency_key?: string | null;
}

export type TransactionUpdateInput = Partial<Pick<TransactionInput, "amount" | "category" | "occurred_on" | "description">>;

export interface SpendingPoint {
  date: string;
  net_spending: DecimalString;
}
