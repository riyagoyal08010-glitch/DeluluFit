import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";
import { useState, type FormEvent } from "react";

import { NutrientList } from "@/components/nutrition/NutrientList";
import { NutritionSummary } from "@/components/nutrition/NutritionSummary";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, EmptyState, ErrorState, LoadingState } from "@/components/ui/Feedback";
import { Input, Select } from "@/components/ui/Field";
import { ApiError } from "@/lib/api/client";
import { mealsApi } from "@/lib/api/endpoints";
import { invalidateBudget, invalidateMeals, liveKeys } from "@/lib/api/queryKeys";
import { formatLongDate, formatTime, localIsoDate, MEAL_LABELS, shiftIsoDate } from "@/lib/format";
import type { FoodSearchHit, Meal, MealItem, MealType } from "@/types/api";

import { describeMealError } from "./errors";
import { FoodSearch } from "./FoodSearch";
import { portionText } from "./MealComposer";
import { ManualItemForm } from "./ManualItemForm";
import { isInFuture, MAX_ITEMS_PER_MEAL, MEAL_TYPE_OPTIONS, timeOf, toOffsetIso, trimDecimal } from "./portion";
import { PortionEditor } from "./PortionEditor";

function errorText(err: unknown): string {
  const e = describeMealError(err);
  return [e.message, ...e.details].join(" ");
}

/** Meals for one local date, from GET /meals/day. */
export function MealHistory({ date, onDateChange }: { date: string; onDateChange: (date: string) => void }) {
  const day = useQuery({ queryKey: liveKeys.mealDay(date), queryFn: ({ signal }) => mealsApi.day(date, signal) });
  const today = localIsoDate();

  return (
    <div className="space-y-4">
      <Card aria-labelledby="history-title">
        <CardHeader id="history-title" title="Meal history" description={formatLongDate(date)} />
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => onDateChange(shiftIsoDate(date, -1))}
                  icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}>Previous day</Button>
          <div className="w-44"><Input label="Date" type="date" value={date} max={today}
                                       onChange={(e) => e.target.value && onDateChange(e.target.value)} /></div>
          <Button variant="secondary" size="sm" disabled={date >= today} onClick={() => onDateChange(shiftIsoDate(date, 1))}
                  icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}>Next day</Button>
        </div>
        <div className="mt-5">
          {day.isPending ? <LoadingState label="Loading meals" />
            : day.isError ? <ErrorState message={day.error instanceof ApiError ? day.error.message : "Please try again."}
                                        onRetry={() => day.refetch()} />
            : day.data.meals.length === 0
              ? <EmptyState icon={UtensilsCrossed} title="No meals logged on this day">
                  Meals you log appear here. Menu items are only counted once you log them.
                </EmptyState>
              : <NutritionSummary totals={day.data.totals} />}
        </div>
      </Card>
      {day.data?.meals.map((meal) => <MealCard key={meal.id} meal={meal} />)}
    </div>
  );
}

type Mode =
  | { kind: "view" }
  | { kind: "edit-item"; item: MealItem }
  | { kind: "add-search" }
  | { kind: "add-portion"; hit: FoodSearchHit }
  | { kind: "add-manual"; name: string }
  | { kind: "edit-details" };

export function MealCard({ meal, timeZone }: { meal: Meal; timeZone?: string }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState<MealItem | null>(null);
  const done = async () => {
    setMode({ kind: "view" });
    await invalidateMeals(queryClient);
  };

  const updateItem = useMutation({
    mutationFn: (v: { itemId: string; body: Parameters<typeof mealsApi.updateItem>[2] }) =>
      mealsApi.updateItem(meal.id, v.itemId, v.body),
    onSuccess: done,
  });
  const addItem = useMutation({ mutationFn: (body: Parameters<typeof mealsApi.addItem>[1]) => mealsApi.addItem(meal.id, body),
                                onSuccess: done });
  const removeItem = useMutation({ mutationFn: (itemId: string) => mealsApi.removeItem(meal.id, itemId),
                                   onSuccess: async () => { setRemoving(null); await done(); } });
  const updateMeal = useMutation({ mutationFn: (body: Parameters<typeof mealsApi.update>[1]) => mealsApi.update(meal.id, body),
                                   onSuccess: done });
  const deleteMeal = useMutation({ mutationFn: () => mealsApi.remove(meal.id),
                                   onSuccess: async () => {
                                     setConfirmDelete(false);
                                     // The server keeps linked expenses and only unlinks them; refresh budget views too.
                                     await Promise.all([invalidateMeals(queryClient), invalidateBudget(queryClient)]);
                                   } });

  const title = `${MEAL_LABELS[meal.meal_type]} · ${formatTime(meal.consumed_at, timeZone)}`;

  return (
    <Card aria-labelledby={`meal-${meal.id}`} surface="solid">
      <CardHeader id={`meal-${meal.id}`} title={title}
                  description={[meal.location_note, meal.note].filter(Boolean).join(" · ") || undefined}
                  action={mode.kind === "view" && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setMode({ kind: "edit-details" })}
                              aria-label={`Edit details of ${title}`} icon={<Pencil className="h-4 w-4" aria-hidden="true" />}>Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}
                              aria-label={`Delete ${title}`} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}>Delete</Button>
                    </div>
                  )} />

      {mode.kind === "edit-details" ? (
        <MealDetailsForm meal={meal} busy={updateMeal.isPending}
                         error={updateMeal.isError ? errorText(updateMeal.error) : null}
                         onCancel={() => { updateMeal.reset(); setMode({ kind: "view" }); }}
                         onSubmit={(body) => updateMeal.mutate(body)} />
      ) : mode.kind === "edit-item" ? (
        mode.item.food ? (
          <PortionEditor foodId={mode.item.food.id} submitLabel="Save changes" busy={updateItem.isPending}
                         serverError={updateItem.isError ? errorText(updateItem.error) : null}
                         initial={{ quantity: trimDecimal(mode.item.quantity), unit: mode.item.unit,
                                    servingId: mode.item.serving?.id ?? null }}
                         onCancel={() => { updateItem.reset(); setMode({ kind: "view" }); }}
                         onSubmit={(p) => updateItem.mutate({ itemId: mode.item.id,
                           body: { quantity: p.quantity, unit: p.unit, serving_id: p.servingId } })} />
        ) : (
          <ManualItemForm initial={{ name: mode.item.display_name, quantity: trimDecimal(mode.item.quantity),
                                     unit: mode.item.unit }}
                          submitLabel="Save changes" busy={updateItem.isPending}
                          serverError={updateItem.isError ? errorText(updateItem.error) : null}
                          onCancel={() => { updateItem.reset(); setMode({ kind: "view" }); }}
                          onSubmit={(m) => updateItem.mutate({ itemId: mode.item.id,
                            body: { display_name: m.name, quantity: m.quantity, unit: m.unit } })} />
        )
      ) : mode.kind === "add-search" ? (
        <div className="space-y-3">
          <FoodSearch autoFocus onSelect={(hit) => setMode({ kind: "add-portion", hit })}
                      onManual={(name) => setMode({ kind: "add-manual", name: name.slice(0, 160) })} />
          <Button variant="ghost" onClick={() => setMode({ kind: "view" })}>Cancel</Button>
        </div>
      ) : mode.kind === "add-portion" ? (
        <PortionEditor foodId={mode.hit.id} submitLabel="Add to meal" busy={addItem.isPending}
                       serverError={addItem.isError ? errorText(addItem.error) : null}
                       onCancel={() => { addItem.reset(); setMode({ kind: "add-search" }); }}
                       onSubmit={(p) => addItem.mutate({ food_id: mode.hit.id, quantity: p.quantity, unit: p.unit,
                                                         serving_id: p.servingId })} />
      ) : mode.kind === "add-manual" ? (
        <ManualItemForm initial={{ name: mode.name, quantity: "1", unit: "serving" }} submitLabel="Add to meal"
                        busy={addItem.isPending} serverError={addItem.isError ? errorText(addItem.error) : null}
                        onCancel={() => { addItem.reset(); setMode({ kind: "add-search" }); }}
                        onSubmit={(m) => addItem.mutate({ display_name: m.name, quantity: m.quantity, unit: m.unit })} />
      ) : (
        <>
          {meal.items.length === 0 ? (
            <p className="text-sm text-ink-muted">This meal has no foods yet.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {meal.items.map((item) => (
                <li key={item.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{item.display_name}
                        {item.is_manual && <Badge className="ml-2">Not in food list</Badge>}</p>
                      <p className="text-xs text-ink-muted">
                        {portionText(trimDecimal(item.quantity), item.unit, item.serving?.label ?? null)}
                        {item.estimated_mass_g && item.unit !== "g" ? ` · about ${Number(item.estimated_mass_g)} g` : ""}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" aria-label={`Edit ${item.display_name}`}
                              onClick={() => setMode({ kind: "edit-item", item })}>Edit</Button>
                      <Button variant="ghost" size="sm" aria-label={`Remove ${item.display_name}`}
                              onClick={() => setRemoving(item)}>Remove</Button>
                    </div>
                  </div>
                  {item.estimate && <div className="mt-2"><NutrientList nutrients={item.estimate.nutrients} compact /></div>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4">
            <p className="text-xs text-ink-muted">
              {meal.totals.note ?? (meal.items.length ? "All items have data for these nutrients." : "")}
            </p>
            <Button variant="secondary" size="sm" disabled={meal.items.length >= MAX_ITEMS_PER_MEAL}
                    onClick={() => setMode({ kind: "add-search" })} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
              Add food
            </Button>
          </div>
        </>
      )}

      <Dialog open={confirmDelete} onClose={() => { deleteMeal.reset(); setConfirmDelete(false); }} title="Delete this meal?"
              description={`${title} and its ${meal.items.length} item${meal.items.length === 1 ? "" : "s"} will be removed from your history. Any expense linked to it stays in your budget.`}
              footer={<>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleteMeal.isPending}>Keep meal</Button>
                <Button variant="danger" loading={deleteMeal.isPending} onClick={() => deleteMeal.mutate()}>Delete meal</Button>
              </>}>
        {deleteMeal.isError && <ErrorState title="Couldn't delete" message={errorText(deleteMeal.error)} />}
      </Dialog>

      <Dialog open={removing !== null} onClose={() => { removeItem.reset(); setRemoving(null); }}
              title={`Remove ${removing?.display_name ?? "item"}?`}
              description="It will be removed from this meal and from your totals."
              footer={<>
                <Button variant="ghost" onClick={() => setRemoving(null)} disabled={removeItem.isPending}>Cancel</Button>
                <Button variant="danger" loading={removeItem.isPending}
                        onClick={() => removing && removeItem.mutate(removing.id)}>Remove</Button>
              </>}>
        {removeItem.isError && <ErrorState title="Couldn't remove" message={errorText(removeItem.error)} />}
      </Dialog>
    </Card>
  );
}

function MealDetailsForm({ meal, onSubmit, onCancel, busy, error }:
  { meal: Meal; onSubmit: (body: Parameters<typeof mealsApi.update>[1]) => void; onCancel: () => void; busy: boolean;
    error: string | null }) {
  const [mealType, setMealType] = useState<MealType>(meal.meal_type);
  const [date, setDate] = useState(meal.log_date);
  const [time, setTime] = useState(timeOf(meal.consumed_at));
  const [location, setLocation] = useState(meal.location_note ?? "");
  const [note, setNote] = useState(meal.note ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const consumedAt = toOffsetIso(date, time);
    if (!consumedAt) return setLocalError("Enter a valid date and time.");
    if (isInFuture(consumedAt)) return setLocalError("A meal can't be set to a future time.");
    setLocalError(null);
    onSubmit({ meal_type: mealType, consumed_at: consumedAt, location_note: location.trim() || null, note: note.trim() || null });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Edit meal details">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Meal" value={mealType} onChange={(e) => setMealType(e.target.value as MealType)} options={MEAL_TYPE_OPTIONS} />
        <Input label="Date" type="date" value={date} max={localIsoDate()} onChange={(e) => setDate(e.target.value)} />
        <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Where" optional value={location} maxLength={120} onChange={(e) => setLocation(e.target.value)} />
        <Input label="Note" optional value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </div>
      {(localError || error) && <ErrorState title="Couldn't save" message={localError ?? error ?? ""} />}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" loading={busy}>Save details</Button>
      </div>
    </form>
  );
}
