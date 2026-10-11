import type { BudgetPeriod, SpendingCategory } from "@/types/api";

/**
 * Money is handled as decimal strings from input to API. These helpers only
 * validate and format; totals always come from the backend.
 */

export const CATEGORY_LABELS: Record<SpendingCategory, string> = {
  mess: "Mess", outside_food: "Outside food", groceries: "Groceries", beverages: "Beverages", snacks: "Snacks",
  other: "Other",
};
export const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as SpendingCategory[])
  .map((value) => ({ value, label: CATEGORY_LABELS[value] }));

export const PERIOD_LABELS: Record<BudgetPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
export const PERIOD_NOUN: Record<BudgetPeriod, string> = { daily: "day", weekly: "week", monthly: "month" };
export const PERIOD_OPTIONS = (Object.keys(PERIOD_LABELS) as BudgetPeriod[])
  .map((value) => ({ value, label: PERIOD_LABELS[value] }));

// Mirrors backend limits: NUMERIC(12, 2), at most 9,999,999,999.99.
const AMOUNT = /^(\d{1,10})(\.(\d{0,2}))?$/;

export type AmountCheck = { ok: true; value: string } | { ok: false; error: string };

/** Validate a typed amount without converting it to a float. `allowZero` for budgets (a ₹0 budget is valid). */
export function checkAmount(raw: string, { allowZero = false } = {}): AmountCheck {
  const value = raw.trim().replace(/,/g, "");
  if (!value) return { ok: false, error: "Enter an amount." };
  if (value.startsWith("-")) return { ok: false, error: "Enter the amount without a minus sign." };
  const m = AMOUNT.exec(value);
  if (!m) {
    return /^\d+\.\d{3,}$/.test(value) ? { ok: false, error: "Use at most two decimal places (paise)." }
      : /^\d{11,}/.test(value) ? { ok: false, error: "That amount is too large." }
      : { ok: false, error: "Use numbers only, like 120 or 45.50." };
  }
  const isZero = /^0+$/.test(m[1]!) && /^0*$/.test(m[3] ?? "");
  if (isZero && !allowZero) return { ok: false, error: "The amount must be more than zero." };
  return { ok: true, value: m[3] ? `${m[1]}.${m[3]}` : m[1]! };
}

/** "-12.50" -> "12.50" (text only), for phrasing "₹12.50 over budget" without arithmetic. */
export function absText(amount: string): string {
  return amount.startsWith("-") ? amount.slice(1) : amount;
}

export function isNegative(amount: string): boolean {
  return amount.startsWith("-") && !/^-0*(\.0*)?$/.test(amount);
}
