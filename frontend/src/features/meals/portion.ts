import { useEffect, useState } from "react";

import type { MealType, Unit } from "@/types/api";

/**
 * Client-side checks mirror the backend (quantity > 0, <= 10000, at most two
 * decimal places) so students get instant feedback. The server re-validates
 * everything and remains authoritative; no nutrition is calculated here.
 */
export const MAX_QUANTITY = 10000;
export const MAX_ITEMS_PER_MEAL = 30;

export const UNIT_LABELS: Record<Unit, string> = { g: "grams (g)", ml: "millilitres (ml)", serving: "servings" };
export const MEAL_TYPE_OPTIONS: Array<{ value: MealType; label: string }> = [
  { value: "breakfast", label: "Breakfast" }, { value: "lunch", label: "Lunch" }, { value: "snacks", label: "Snacks" },
  { value: "dinner", label: "Dinner" }, { value: "other", label: "Other" },
];

export type QuantityCheck = { ok: true; value: string } | { ok: false; error: string };

export function checkQuantity(raw: string): QuantityCheck {
  const value = raw.trim();
  if (!value) return { ok: false, error: "Enter an amount." };
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(value)) return { ok: false, error: "Use numbers only, like 150 or 1.5." };
  const decimals = value.includes(".") ? value.split(".")[1]!.length : 0;
  if (decimals > 2) return { ok: false, error: "Use at most two decimal places." };
  const n = Number(value);
  if (!(n > 0)) return { ok: false, error: "The amount must be more than zero." };
  if (n > MAX_QUANTITY) return { ok: false, error: `The amount can be at most ${MAX_QUANTITY.toLocaleString("en-IN")}.` };
  return { ok: true, value: value.startsWith(".") ? `0${value}` : value.replace(/\.$/, "") };
}

/** "2026-10-11" + "13:05" in this device's timezone -> "2026-10-11T13:05:00+05:30". */
export function toOffsetIso(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const local = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  if (Number.isNaN(local.getTime()) || local.getDate() !== Number(dm[3])) return null;
  const offset = -local.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const hh = String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0");
  const mm = String(Math.abs(offset) % 60).padStart(2, "0");
  return `${date}T${time}:00${sign}${hh}:${mm}`;
}

/** The backend rejects meals more than 10 minutes in the future (clock-skew allowance). */
export function isInFuture(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() > now.getTime() + 10 * 60 * 1000;
}

export function currentTime(now: Date = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

/** Local "HH:MM" of an ISO instant, for editing an existing meal's time. */
export function timeOf(iso: string): string {
  return currentTime(new Date(iso));
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** "150.00" -> "150", "1.50" -> "1.5", "100" -> "100" (only zeros after a decimal point are dropped). */
export function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
