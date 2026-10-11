import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, PenLine, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { NutritionSummary } from "@/components/nutrition/NutritionSummary";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, EmptyState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { foodsApi, mealsApi } from "@/lib/api/endpoints";
import { invalidateMeals, liveKeys } from "@/lib/api/queryKeys";
import { formatAmount, localIsoDate, MEAL_LABELS } from "@/lib/format";
import type { FoodSearchHit, Meal, MealInput, MealItemInput, MealType, Unit } from "@/types/api";

import { describeMealError } from "./errors";
import { FoodSearch } from "./FoodSearch";
import { ManualItemForm } from "./ManualItemForm";
import { currentTime, isInFuture, MAX_ITEMS_PER_MEAL, MEAL_TYPE_OPTIONS, newIdempotencyKey, toOffsetIso } from "./portion";
import { PortionEditor } from "./PortionEditor";

interface DraftItem {
  key: string;
  foodId: string | null;
  name: string;
  quantity: string;
  unit: Unit;
  servingId: string | null;
  servingLabel: string | null;
  /** The confirmed-menu dish this item came from ("Log this" on Suggestions), if any. */
  menuItemId: string | null;
}

/** What the portion editor needs to know about a food: a search hit, or a dish's linked reference food. */
type FoodRef = Pick<FoodSearchHit, "id" | "canonical_name">;

type Step =
  | { kind: "review" }
  | { kind: "search" }
  | { kind: "portion"; hit: FoodRef; menuItemId: string | null }
  | { kind: "manual"; name: string; menuItemId: string | null };

const MEAL_TYPES: readonly MealType[] = ["breakfast", "lunch", "snacks", "dinner", "other"];

function defaultMealType(now = new Date()): MealType {
  const h = now.getHours();
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snacks" : "dinner";
}

/**
 * Prefill from Suggestions ("Log this"): /app/meals?menu_meal=&menu_item=&meal_type=&food=&name=.
 * Only the dish is filled in; the student still chooses the portion and presses Save.
 */
interface Prefill {
  menuMealId: string;
  menuItemId: string;
  mealType: MealType | null;
  foodId: string | null;
  name: string;
}

function readPrefill(params: URLSearchParams): Prefill | null {
  const menuMealId = params.get("menu_meal");
  const menuItemId = params.get("menu_item");
  if (!menuMealId || !menuItemId) return null;
  const mealType = params.get("meal_type");
  const name = (params.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
  return { menuMealId, menuItemId, mealType: MEAL_TYPES.includes(mealType as MealType) ? mealType as MealType : null,
           foodId: params.get("food") || null, name };
}

export function portionText(quantity: string, unit: Unit, servingLabel: string | null): string {
  if (unit === "serving") return servingLabel ? `${quantity} × ${servingLabel}` : `${quantity} serving${quantity === "1" ? "" : "s"}`;
  return `${quantity} ${unit}`;
}

/** Energy for one draft item, read from the same cached backend preview the editor showed. */
function DraftEstimate({ item }: { item: DraftItem }) {
  const preview = useQuery({
    queryKey: liveKeys.estimate(item.foodId ?? "", item.quantity, item.unit, item.servingId),
    queryFn: ({ signal }) => foodsApi.estimate(item.foodId!, { quantity: item.quantity, unit: item.unit,
                                                               servingId: item.servingId }, signal),
    enabled: item.foodId !== null,
    staleTime: 60_000,
  });
  if (item.foodId === null) return <Badge>No data</Badge>;
  if (!preview.data) return null;
  const energy = preview.data.nutrients.energy_kcal;
  return <span className="metric text-sm text-ink-muted">{energy.status === "estimated" ? formatAmount(energy.display, energy.unit) : "No estimate"}</span>;
}

/** Record a meal the student actually ate. Nothing is logged automatically from a menu. */
export function MealComposer({ onViewHistory }: { onViewHistory?: (date: string) => void }) {
  const queryClient = useQueryClient();
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [date, setDate] = useState(localIsoDate);
  const [time, setTime] = useState(currentTime);
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [step, setStep] = useState<Step>({ kind: "review" });
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Meal | null>(null);
  // The confirmed menu meal the prefilled dish belongs to; sent only while a linked dish is in the draft.
  const [menuMealId, setMenuMealId] = useState<string | null>(null);
  // Reuse the idempotency key only when retrying the exact same request, so a retry after a
  // lost response can't create a second meal, while an edited draft is a new request.
  const lastAttempt = useRef<{ payload: string; key: string } | null>(null);

  // Read the "Log this" parameters once, then drop them from the address so a refresh or a later
  // visit never re-applies a stale prefill (and StrictMode's double effect can't apply it twice).
  const [params, setParams] = useSearchParams();
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    const prefill = readPrefill(params);
    if (!prefill) return;
    prefilled.current = true;
    if (prefill.mealType) setMealType(prefill.mealType);
    setMenuMealId(prefill.menuMealId);
    setSaved(null);
    if (prefill.foodId) {
      // The linked reference food: the portion step shows its servings and the backend's estimate.
      setStep({ kind: "portion", hit: { id: prefill.foodId, canonical_name: prefill.name }, menuItemId: prefill.menuItemId });
    } else {
      // No reference food is linked, so it is logged by name with unknown nutrition (never guessed).
      setStep({ kind: "manual", name: prefill.name, menuItemId: prefill.menuItemId });
    }
    const rest = new URLSearchParams(params);
    for (const k of ["menu_meal", "menu_item", "meal_type", "food", "name"]) rest.delete(k);
    setParams(rest, { replace: true });
  }, [params, setParams]);

  const create = useMutation({
    mutationFn: (body: MealInput) => mealsApi.create(body),
    onSuccess: async (meal) => {
      lastAttempt.current = null;
      setSaved(meal);
      setItems([]);
      setMenuMealId(null);
      setNote("");
      setLocation("");
      setTime(currentTime());
      await invalidateMeals(queryClient);
    },
  });

  function addFood(hit: FoodRef, portion: { quantity: string; unit: Unit; servingId: string | null },
                   servingLabel: string | null, menuItemId: string | null) {
    setItems((list) => [...list, { key: newIdempotencyKey(), foodId: hit.id, name: hit.canonical_name, ...portion,
                                   servingLabel, menuItemId }]);
    setStep({ kind: "review" });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    setFormError(null);
    setSaved(null);
    if (items.length === 0) return setFormError("Add at least one food before saving.");
    const consumedAt = toOffsetIso(date, time);
    if (!consumedAt) return setFormError("Enter a valid date and time.");
    if (isInFuture(consumedAt)) return setFormError("Meals can only be logged once they've been eaten, not for a future time.");
    // A dish may only be linked to its menu meal together with that meal (the server enforces both).
    const linked = menuMealId !== null && items.some((i) => i.menuItemId !== null);
    const body: Omit<MealInput, "idempotency_key"> = {
      meal_type: mealType, consumed_at: consumedAt, note: note.trim() || null, location_note: location.trim() || null,
      ...(linked ? { menu_meal_id: menuMealId } : {}),
      items: items.map((i): MealItemInput => ({
        ...(i.foodId
          ? { food_id: i.foodId, quantity: i.quantity, unit: i.unit, serving_id: i.servingId }
          : { display_name: i.name, quantity: i.quantity, unit: i.unit }),
        ...(linked && i.menuItemId ? { menu_item_id: i.menuItemId } : {}),
      })),
    };
    const payload = JSON.stringify(body);
    const key = lastAttempt.current?.payload === payload ? lastAttempt.current.key : newIdempotencyKey();
    lastAttempt.current = { payload, key };
    create.mutate({ ...body, idempotency_key: key });
  }

  const error = create.isError ? describeMealError(create.error) : null;

  return (
    <Card aria-labelledby="log-title" surface="solid">
      <CardHeader id="log-title" title="Log a meal"
                  description="Record what you actually ate, from the mess or anywhere else." />

      {saved && (
        <div role="status" className="mb-5 rounded-control border border-success/30 bg-success/10 p-4">
          <p className="flex items-center gap-2 font-medium text-success">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            {MEAL_LABELS[saved.meal_type]} saved with {saved.items.length} item{saved.items.length === 1 ? "" : "s"}.
          </p>
          <div className="mt-3"><NutritionSummary totals={saved.totals} /></div>
          {onViewHistory && (
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => onViewHistory(saved.log_date)}>
              See it in history
            </Button>
          )}
        </div>
      )}

      {step.kind === "search" ? (
        <div className="space-y-3">
          <FoodSearch autoFocus onSelect={(hit) => setStep({ kind: "portion", hit, menuItemId: null })}
                      onManual={(name) => setStep({ kind: "manual", name: name.slice(0, 160), menuItemId: null })} />
          <Button variant="ghost" onClick={() => setStep({ kind: "review" })}>Back to meal</Button>
        </div>
      ) : step.kind === "portion" ? (
        <>
          {step.menuItemId && <MenuDishNote name={step.hit.canonical_name} />}
          <PortionFor hit={step.hit} onAdd={(hit, p, label) => addFood(hit, p, label, step.menuItemId)}
                      onCancel={() => setStep(step.menuItemId ? { kind: "review" } : { kind: "search" })} />
        </>
      ) : step.kind === "manual" ? (
        <>
          {step.menuItemId && <MenuDishNote name={step.name} />}
          <ManualItemForm initial={{ name: step.name, quantity: "1", unit: "serving" }} submitLabel="Add to meal"
                          onCancel={() => setStep(step.menuItemId ? { kind: "review" } : { kind: "search" })}
                          onSubmit={(m) => { setItems((list) => [...list, { key: newIdempotencyKey(), foodId: null, name: m.name,
                            quantity: m.quantity, unit: m.unit, servingId: null, servingLabel: null, menuItemId: step.menuItemId }]);
                            setStep({ kind: "review" }); }} />
        </>
      ) : (
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Meal" value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}
                    options={MEAL_TYPE_OPTIONS} />
            <Input label="Date" type="date" value={date} max={localIsoDate()} onChange={(e) => setDate(e.target.value)} />
            <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)}
                   hint="This device's time zone." />
          </div>

          <section aria-labelledby="items-title">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 id="items-title" className="text-sm font-semibold">Foods ({items.length})</h3>
              <Button variant="secondary" size="sm" onClick={() => setStep({ kind: "search" })}
                      disabled={items.length >= MAX_ITEMS_PER_MEAL} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
                Add food
              </Button>
            </div>
            {items.length === 0 ? (
              <EmptyState icon={PenLine} title="No foods added yet">Add each thing you ate, with how much.</EmptyState>
            ) : (
              <ul className="divide-y divide-line/70 rounded-control border border-line/70">
                {items.map((item) => (
                  <li key={item.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{item.name}</p>
                      <p className="text-xs text-ink-muted">{portionText(item.quantity, item.unit, item.servingLabel)}
                        {item.foodId === null && " · not in food list"}
                        {item.menuItemId !== null && " · from your menu"}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <DraftEstimate item={item} />
                      <button type="button" aria-label={`Remove ${item.name}`}
                              onClick={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                              className="rounded-control p-2 text-ink-muted hover:bg-surface-raised hover:text-danger">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {items.length > 0 && <p className="mt-2 text-xs text-ink-muted">Meal totals are calculated by DeluluFit when you save.</p>}
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Where" optional value={location} maxLength={120} placeholder="e.g. Hostel mess, canteen, home"
                   onChange={(e) => setLocation(e.target.value)} />
            <Input label="Note" optional value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </div>

          {(formError || error) && (
            <div role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-3 text-sm">
              <p className="font-medium text-ink">{formError ?? error?.message}</p>
              {!formError && error && error.details.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-ink-muted">{error.details.map((d) => <li key={d}>{d}</li>)}</ul>
              )}
            </div>
          )}

          <div className="flex justify-end">
            <Button type="submit" size="lg" loading={create.isPending} disabled={items.length === 0}>Save meal</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** Shown above the portion or manual step when the dish came from Suggestions. */
function MenuDishNote({ name }: { name: string }) {
  return (
    <p role="status" className="mb-4 rounded-control border border-line/70 bg-sheet p-3 text-sm text-ink-muted">
      <span className="font-medium text-ink">{name}</span> from your menu. Choose how much you ate, then save the meal:
      nothing is logged until you do.
    </p>
  );
}

function PortionFor({ hit, onAdd, onCancel }:
  { hit: FoodRef; onAdd: (hit: FoodRef, p: { quantity: string; unit: Unit; servingId: string | null },
                          servingLabel: string | null) => void; onCancel: () => void }) {
  const queryClient = useQueryClient();
  return (
    <PortionEditor foodId={hit.id} submitLabel="Add to meal" onCancel={onCancel}
                   onSubmit={(p) => {
                     // The editor has fetched the food (same query key): use its name and the chosen serving's label.
                     const food = queryClient.getQueryData<{ canonical_name: string; servings: Array<{ id: string; label: string }> }>(
                       liveKeys.food(hit.id));
                     const label = food?.servings.find((s) => s.id === p.servingId)?.label ?? null;
                     onAdd({ id: hit.id, canonical_name: food?.canonical_name ?? hit.canonical_name }, p, label);
                   }} />
  );
}

