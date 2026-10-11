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

export type DietaryPattern = "vegetarian" | "eggetarian" | "non_vegetarian" | "vegan" | "jain" | "no_preference";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type PreferenceKind = "like" | "dislike" | "avoid";
export type Allergen = "peanut" | "tree_nut" | "milk" | "egg" | "wheat_gluten" | "soy" | "fish" | "shellfish" |
  "sesame" | "mustard" | "other";
export type AllergySeverity = "mild" | "moderate" | "severe" | "unknown";

export interface FoodPreference {
  id: string;
  label: string;
  preference: PreferenceKind;
  food_id: string | null;
}

export interface UserAllergy {
  id: string;
  allergen: Allergen;
  custom_label: string | null;
  severity: AllergySeverity;
  notes: string | null;
}

export interface Institution {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

export interface Hostel {
  id: string;
  institution_id: string;
  name: string;
}

/** GET /profile. `profile` is null until the student saves one. */
export interface ProfileBundle {
  profile: Profile | null;
  preferences?: FoodPreference[];
  allergies?: UserAllergy[];
  institution?: Institution | null;
  hostel?: Hostel | null;
  active_target?: NutritionTarget | null;
}

/** PUT /profile replaces every field: anything omitted reverts to its default, so always send all of them. */
export interface ProfileInput {
  display_name: string;
  height_cm: string | null;
  weight_kg: string | null;
  activity_level: ActivityLevel | null;
  dietary_pattern: DietaryPattern;
  currency: string;
  timezone: string;
  institution_id: string | null;
  hostel_id: string | null;
  /** Onboarding progress; the server only ever raises it, and ignores it once setup is complete. */
  onboarding_step?: number;
}

export interface TargetInput {
  source: "self_set" | "professional";
  energy_kcal: string | null;
  protein_g: string | null;
  carbohydrate_g: string | null;
  fat_g: string | null;
  fibre_g: string | null;
  effective_from: string | null;
  notes: string | null;
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
  /** The dish on the meal's menu this item is, when logged from a confirmed menu (needs `MealInput.menu_meal_id`). */
  menu_item_id?: string | null;
}

export interface MealInput {
  meal_type: MealType;
  consumed_at: string;
  note?: string | null;
  location_note?: string | null;
  idempotency_key?: string | null;
  /** Set when the student logs what they ate from a confirmed menu meal; the server records source "mess_menu". */
  menu_meal_id?: string | null;
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

/** Mess menus (backend/app/schemas/menus.py). Every menu belongs to the signed-in student. */
export type MenuStatus = "processing" | "failed" | "needs_review" | "confirmed";

/** GET /menus list rows (MenuSummaryOut). */
export interface MenuSummary {
  id: string;
  title: string;
  menu_date: string;
  meal_type_hint: MealType | null;
  mess_id: string | null;
  status: MenuStatus;
  has_draft: boolean;
  has_confirmed: boolean;
  item_count: number;
  has_image: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuList {
  items: MenuSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface MenuItemView {
  id: string;
  meal_id: string;
  meal_type: MealType;
  position: number;
  name: string;
  /** "extraction" = read from the photo; "manual" = typed by the student. */
  source: "extraction" | "manual";
  is_user_corrected: boolean;
  extraction_confidence: DecimalString | null;
  section_heading: string | null;
  serving_note: string | null;
  price: DecimalString | null;
  food: { id: string; canonical_name: string } | null;
  match_confidence: string;
}

export interface MenuVersion {
  id: string;
  version_number: number;
  status: "draft" | "confirmed";
  source: "extraction" | "manual" | "revision";
  meal_type_hint: MealType | null;
  menu_date: string;
  confirmed_at: string | null;
  items: MenuItemView[];
}

/** GET /menus/{id} (MenuDetailOut). */
export interface MenuDetail extends MenuSummary {
  image: { width: number | null; height: number | null; size_bytes: number } | null;
  extraction: {
    available: boolean;
    job: {
      status: string; attempt_count: number; max_attempts: number; error_code: string | null;
      error_message: string | null; started_at: string | null; finished_at: string | null;
      is_menu: boolean | null; item_count: number | null; detected_date: string | null;
    } | null;
    can_start: boolean;
    can_retry: boolean;
  };
  draft: MenuVersion | null;
  confirmed: MenuVersion | null;
}

/** One reason or caution on a suggested dish. `code` is stable; `text` is the server's wording. */
export interface SuggestionSignal {
  code: string;
  text: string;
}

/**
 * Reference values per `reference_mass_g` grams of the linked reference food, not a portion.
 * Statuses are the reference-data statuses (reported / unknown / not_in_source), not meal estimate statuses.
 * Only the nutrients the server chose to show are present (energy, protein, carbohydrate, fat, fibre today).
 */
export interface DishNutrition {
  reference_mass_g: DecimalString | null;
  source_name: string | null;
  nutrients: Partial<Record<NutrientKey, { value: DecimalString | null; display: DecimalString | null; unit: string;
                                           status: ProfileNutrientStatus }>>;
}

export type SuggestionGroup = "suggested" | "available" | "check_first";

/** GET /menus/{id}/suggestions dish (DishSuggestionOut). `score` is an internal ranking key, never shown. */
export interface DishSuggestion {
  menu_item_id: string;
  menu_meal_id: string;
  name: string;
  meal_type: MealType;
  section_heading: string | null;
  serving_note: string | null;
  source: "extraction" | "manual";
  is_user_corrected: boolean;
  group: SuggestionGroup;
  score: number;
  reasons: SuggestionSignal[];
  cautions: SuggestionSignal[];
  food: { id: string; canonical_name: string } | null;
  diet_type: string | null;
  nutrition: DishNutrition | null;
  price: DecimalString | null;
  currency: string;
}

/** GET /menus/{id}/suggestions (MenuSuggestionsOut). Viewing suggestions never logs a meal. */
export interface MenuSuggestions {
  menu_id: string;
  menu_date: string;
  status: MenuStatus;
  confirmed: boolean;
  meal_types: MealType[];
  meal_type: MealType | null;
  rule_version: string;
  personalization: { personalized: boolean; based_on: string[]; message: string };
  allergy_notice: string | null;
  budget: { has_budget: boolean; period: BudgetPeriod | null; remaining: DecimalString | null; currency: string };
  dishes: DishSuggestion[];
}
