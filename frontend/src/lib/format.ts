import type { MealType, NutrientKey, TotalStatus } from "@/types/api";

export const NUTRIENT_LABELS: Record<NutrientKey, string> = {
  energy_kcal: "Energy", protein_g: "Protein", carbohydrate_g: "Carbohydrates", fat_g: "Fat",
  fibre_g: "Fibre", sugars_g: "Sugars", sodium_mg: "Sodium",
};

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast", lunch: "Lunch", snacks: "Snacks", dinner: "Dinner", other: "Other",
};

/** Plain-language meaning of a total's status, for labels and tooltips. */
export const TOTAL_STATUS_TEXT: Record<TotalStatus, string> = {
  complete: "Every logged item has data for this nutrient.",
  incomplete: "Some items have no data for this nutrient, so this is a lower bound.",
  unavailable: "None of the logged items have data for this nutrient.",
  empty: "Nothing logged yet.",
};

/** "—" for unknown values: never print 0 for something we do not know. */
export function formatAmount(display: string | null, unit: string): string {
  if (display === null) return "—";
  const n = Number(display);
  const shown = Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 1 }) : display;
  return unit === "kcal" ? `${shown} kcal` : `${shown} ${unit}`;
}

export function formatMoney(amount: string | null, currency = "INR"): string {
  if (amount === null) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export function formatLongDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(date);
}

export function formatTime(isoDateTime: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone })
    .format(new Date(isoDateTime));
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** Today's calendar date in the browser's timezone as YYYY-MM-DD. */
export function localIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Move an ISO date (YYYY-MM-DD) by whole days, without timezone drift. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
