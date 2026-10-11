/**
 * DEMO DATA — used only in demo mode (see features/auth/session.tsx).
 *
 * Nothing here is any person's data. Meals are sample combinations; their
 * nutrient amounts are computed from the real reference values in
 * backend/data/foods_usda_fndds.json (USDA FNDDS 2024-10-31, per 100 g) with
 * the same formula and display rounding as the backend. A food that is not
 * in the dataset ("Aloo sabzi") is shown with unknown nutrition, exactly as a
 * real account would see it. Prices, menus and suggestions are invented
 * examples and are labelled as demo data wherever they appear.
 *
 * Production data-access code (lib/api) never imports this file.
 */
import type { BudgetSummary, DayMeals, Meal, MealItem, MealType, NutrientKey, NutrientTotal, NutrientValue,
              Totals } from "@/types/api";

const KEYS: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g", "sugars_g", "sodium_mg"];
const UNIT: Record<NutrientKey, string> = { energy_kcal: "kcal", protein_g: "g", carbohydrate_g: "g", fat_g: "g",
                                            fibre_g: "g", sugars_g: "g", sodium_mg: "mg" };

/** Per-100 g reference values copied from the dataset. Sugars and sodium are not in this dataset version. */
const REFERENCE: Record<string, Partial<Record<NutrientKey, number>>> = {
  "Roti / chapati": { energy_kcal: 299, protein_g: 7.85, carbohydrate_g: 46.13, fat_g: 9.2, fibre_g: 9.7 },
  Dal: { energy_kcal: 145, protein_g: 8.6, carbohydrate_g: 19.17, fat_g: 4.31, fibre_g: 7.5 },
  "Steamed white rice": { energy_kcal: 129, protein_g: 2.67, carbohydrate_g: 27.99, fat_g: 0.28, fibre_g: 0.4 },
  "Tea with milk": { energy_kcal: 51, protein_g: 1.58, carbohydrate_g: 8.95, fat_g: 1.05, fibre_g: 0.1 },
  Idli: { energy_kcal: 128, protein_g: 6.36, carbohydrate_g: 24.98, fat_g: 0.35, fibre_g: 5.8 },
  Sambar: { energy_kcal: 86, protein_g: 4.33, carbohydrate_g: 11.77, fat_g: 2.71, fibre_g: 4 },
  Banana: { energy_kcal: 97, protein_g: 0.74, carbohydrate_g: 22.71, fat_g: 0.28, fibre_g: 1.7 },
  "Curd (plain whole-milk yogurt)": { energy_kcal: 78, protein_g: 3.82, carbohydrate_g: 5.57, fat_g: 4.48, fibre_g: 0 },
};

function displayOf(key: NutrientKey, value: number): string {
  // Backend display rounding: kcal and mg to whole numbers, grams to 0.1 (half up).
  const step = UNIT[key] === "g" ? 10 : 1;
  return String(Math.round(value * step + 1e-9) / step);
}

function item(position: number, name: string, grams: number | null, quantity: string,
              unit: MealItem["unit"], servingLabel?: string): MealItem {
  const ref = REFERENCE[name];
  const known = ref !== undefined && grams !== null;
  const nutrients = Object.fromEntries(KEYS.map((k) => {
    const v = known ? ref[k] : undefined;
    const value: NutrientValue = v === undefined
      ? { value: null, display: null, unit: UNIT[k], status: known ? "not_in_source" : "no_estimate" }
      : { value: String((v * grams!) / 100), display: displayOf(k, (v * grams!) / 100), unit: UNIT[k], status: "estimated" };
    return [k, value];
  })) as Record<NutrientKey, NutrientValue>;
  return {
    id: `demo-item-${position}-${name}`, position, display_name: ref ? name : name, quantity, unit,
    food: ref ? { id: `demo-food-${name}`, canonical_name: name } : null, is_manual: !ref,
    serving: servingLabel ? { id: `demo-serving-${name}`, label: servingLabel, mass_g: String(grams) } : null,
    estimated_mass_g: grams === null ? null : grams.toFixed(2),
    mass_source: grams === null ? "unknown" : unit === "g" ? "user_grams" : "serving_reference",
    match_confidence: ref ? "HIGH" : "UNKNOWN", note: null,
    estimate: {
      version: 1, method: known ? "per_reference_mass" : "unavailable", confidence: known ? "MEDIUM" : "UNKNOWN",
      nutrients,
      provenance: { source_name: known ? "USDA FoodData Central - FNDDS Survey Foods" : null,
                    dataset_version: known ? "2024-10-31" : null, portion_basis: null },
    },
  };
}

export function totalsOf(items: MealItem[]): Totals {
  const nutrients = Object.fromEntries(KEYS.map((k) => {
    const values = items.map((i) => i.estimate?.nutrients[k]?.value ?? null);
    const known = values.filter((v): v is string => v !== null).map(Number);
    const missing = values.length - known.length;
    const sum = known.reduce((a, b) => a + b, 0);
    const status: NutrientTotal["status"] = items.length === 0 ? "empty" : known.length === 0 ? "unavailable"
      : missing > 0 ? "incomplete" : "complete";
    return [k, { total: known.length ? String(sum) : null, display: known.length ? displayOf(k, sum) : null,
                 unit: UNIT[k], status, known_items: known.length, missing_items: missing } satisfies NutrientTotal];
  })) as Record<NutrientKey, NutrientTotal>;
  const complete = Object.values(nutrients).every((t) => t.status === "complete" || t.status === "empty");
  return { item_count: items.length, complete, nutrients,
           note: complete ? null : "Some items have no data for some nutrients; those totals are lower bounds." };
}

function meal(id: string, type: MealType, date: string, time: string, items: MealItem[]): Meal {
  return { id, meal_type: type, source: "manual", consumed_at: `${date}T${time}:00+05:30`, log_date: date,
           note: null, location_note: null, items, totals: totalsOf(items) };
}

export function demoDay(date: string): DayMeals {
  const meals = [
    meal("demo-breakfast", "breakfast", date, "08:15", [
      item(0, "Idli", 114, "3", "serving", "1 item"),
      item(1, "Sambar", 150, "150", "g"),
      item(2, "Tea with milk", 240, "1", "serving", "1 cup"),
    ]),
    meal("demo-lunch", "lunch", date, "13:05", [
      item(0, "Roti / chapati", 80, "2", "serving", "1 medium chappatti or roti (7\")"),
      item(1, "Dal", 150, "150", "g"),
      item(2, "Steamed white rice", 158, "1", "serving", "1 cup, cooked"),
      item(3, "Aloo sabzi", null, "1", "serving"),
    ]),
  ];
  return { date, meals, totals: totalsOf(meals.flatMap((m) => m.items)) };
}

/** Seven sample days for the nutrition trend: each day is a combination of the sample meals above. */
export function demoWeek(endDate: string): Array<{ date: string; totals: Totals }> {
  const end = new Date(`${endDate}T00:00:00Z`);
  const patterns: Array<Array<[string, number]>> = [
    [["Idli", 114], ["Sambar", 150], ["Dal", 150], ["Steamed white rice", 316]],
    [["Roti / chapati", 120], ["Dal", 200], ["Banana", 126]],
    [["Tea with milk", 240], ["Roti / chapati", 80], ["Curd (plain whole-milk yogurt)", 113]],
    [["Idli", 76], ["Sambar", 248], ["Steamed white rice", 158], ["Dal", 150], ["Tea with milk", 240]],
    [["Roti / chapati", 160], ["Dal", 150], ["Curd (plain whole-milk yogurt)", 170]],
    [["Steamed white rice", 158], ["Sambar", 150], ["Banana", 126]],
    [],
  ];
  return patterns.map((p, i) => {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - (patterns.length - 1 - i));
    const items = p.map(([name, g], j) => item(j, name, g, String(g), "g"));
    if (i === 1) items.push(item(9, "Aloo sabzi", null, "1", "serving"));
    return { date: d.toISOString().slice(0, 10), totals: totalsOf(items) };
  });
}

export function demoBudget(date: string): BudgetSummary {
  return {
    period: "daily", start: date, end: date, currency: "INR", budget_amount: "250.00", expenses: "90.00",
    refunds: "10.00", net_spending: "80.00", remaining: "170.00", utilization: "0.3200", over_budget: false,
    transaction_count: 3, has_budget: true, by_category: { outside_food: "50.00", beverages: "30.00", snacks: "0.00" },
    explanation: "Net spending = expenses - refunds for transactions dated inside this period.",
  };
}

export const DEMO_TRANSACTIONS = [
  { id: "demo-t1", kind: "expense", amount: "40.00", category: "outside_food", description: "Samosa at canteen" },
  { id: "demo-t2", kind: "expense", amount: "50.00", category: "beverages", description: "Cold coffee" },
  { id: "demo-t3", kind: "refund", amount: "10.00", category: "beverages", description: "Canteen change returned" },
] as const;

export const DEMO_MENU: Array<{ meal: MealType; items: string[]; status: "confirmed" | "needs_review" }> = [
  { meal: "breakfast", items: ["Idli", "Sambar", "Coconut chutney", "Tea"], status: "confirmed" },
  { meal: "lunch", items: ["Roti", "Dal tadka", "Jeera rice", "Aloo sabzi", "Salad"], status: "confirmed" },
  { meal: "snacks", items: ["Samosa", "Tea"], status: "needs_review" },
  { meal: "dinner", items: ["Paratha", "Rajma", "Rice", "Curd"], status: "needs_review" },
];

export const DEMO_SUGGESTIONS = [
  { id: "s1", title: "Dinner isn't logged yet",
    why: "You've logged breakfast and lunch today. Logging dinner keeps today's totals complete." },
  { id: "s2", title: "One lunch item has no nutrition data",
    why: "\"Aloo sabzi\" isn't in the reference dataset, so today's totals are lower bounds. You can choose a closer food if one fits." },
  { id: "s3", title: "Rajma is on tonight's menu",
    why: "You marked rajma as a food you like. The menu entry still needs your review before it's confirmed." },
];
