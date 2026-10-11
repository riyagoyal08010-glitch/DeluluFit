import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Soup } from "lucide-react";
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

import { Card, CardHeader } from "@/components/ui/Card";
import { ButtonLink, Button } from "@/components/ui/Button";
import { EmptyState, ErrorState, LoadingState, PageHeader, Skeleton } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Field";
import { useDataMode } from "@/features/auth/session";
import { ApiError } from "@/lib/api/client";
import { menusApi } from "@/lib/api/endpoints";
import { invalidateMenus, liveKeys } from "@/lib/api/queryKeys";
import { cn } from "@/lib/cn";
import { formatLongDate, localIsoDate, MEAL_LABELS, shiftIsoDate } from "@/lib/format";
import { demoMenuSuggestions } from "@/mocks/demoData";
import type { MealType, MenuSuggestions, MenuSummary } from "@/types/api";

import { SuggestionList } from "./SuggestionCards";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "snacks", "dinner", "other"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isMealType(value: string | null): value is MealType {
  return value !== null && (MEAL_TYPES as string[]).includes(value);
}

/**
 * Menu suggestions for one date, ranked by the backend from the student's own profile. Viewing
 * suggestions never logs a meal; "Log this" opens the meal logger with the dish filled in.
 *
 * The date and the chosen meal live in the URL (`?date=`, `?meal_type=`), as on the Meals page.
 */
export function SuggestionsPage() {
  const isDemo = useDataMode() === "demo";
  const [params, setParams] = useSearchParams();
  const date = ISO_DATE.test(params.get("date") ?? "") ? params.get("date")! : localIsoDate();
  const mealType = isMealType(params.get("meal_type")) ? params.get("meal_type") as MealType : null;
  const setDate = (next: string) => setParams((p) => { const q = new URLSearchParams(p); q.set("date", next); return q; });
  const setMealType = (next: MealType | null) => setParams((p) => {
    const q = new URLSearchParams(p);
    if (next) q.set("meal_type", next); else q.delete("meal_type");
    return q;
  }, { replace: true });

  return (
    <>
      <PageHeader title="Suggestions"
                  description="Dishes from your confirmed menu, ordered by what you've recorded about yourself. Always with the reason, never logged for you." />
      <div className="space-y-4">
        <DatePicker date={date} onChange={setDate} />
        {isDemo
          ? <DemoSuggestions date={date} mealType={mealType} onMealType={setMealType} />
          : <LiveSuggestions date={date} mealType={mealType} onMealType={setMealType} />}
      </div>
    </>
  );
}

function DatePicker({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  return (
    <Card aria-labelledby="suggestions-day">
      <CardHeader id="suggestions-day" title="Menu for" description={formatLongDate(date)} />
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="secondary" size="sm" onClick={() => onChange(shiftIsoDate(date, -1))}
                icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}>Previous day</Button>
        <div className="w-44">
          <Input label="Date" type="date" value={date}
                 onChange={(e) => { if (ISO_DATE.test(e.target.value)) onChange(e.target.value); }} />
        </div>
        <Button variant="secondary" size="sm" onClick={() => onChange(shiftIsoDate(date, 1))}
                icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}>Next day</Button>
      </div>
    </Card>
  );
}

/** Tabs for the meals the server found on this menu, plus "All meals". Selection lives in `?meal_type=`. */
function MealTabs({ mealTypes, selected, onSelect }:
  { mealTypes: MealType[]; selected: MealType | null; onSelect: (m: MealType | null) => void }) {
  const tabs: Array<{ value: MealType | null; label: string }> = [{ value: null, label: "All meals" },
    ...mealTypes.map((m) => ({ value: m, label: MEAL_LABELS[m] }))];
  return (
    <div role="group" aria-label="Meal" className="glass-card inline-flex flex-wrap rounded-full p-1">
      {tabs.map((t) => (
        <button key={t.value ?? "all"} type="button" aria-pressed={selected === t.value} onClick={() => onSelect(t.value)}
                className={cn("min-h-[40px] rounded-full px-4 text-sm font-medium transition-colors",
                              selected === t.value ? "bg-action text-ink-inverse" : "text-ink-muted hover:text-ink")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function DemoSuggestions({ date, mealType, onMealType }:
  { date: string; mealType: MealType | null; onMealType: (m: MealType | null) => void }) {
  // Sample data only: no request is made and nothing is saved (session.tsx keeps demo and live apart).
  const data = demoMenuSuggestions(date, mealType);
  return (
    <div className="space-y-4">
      <MealTabs mealTypes={data.meal_types} selected={mealType} onSelect={onMealType} />
      <SuggestionList data={data} demo mealTypeLabel={mealType ? MEAL_LABELS[mealType] : null} />
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="space-y-3">
      <LoadingState label="Loading suggestions" />
      {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}
    </div>
  );
}

/**
 * Real account. The menu list has no date filter yet, so the menus for the chosen date are picked
 * client-side from the most recent 50; each confirmed one gets its own ranked section.
 */
function LiveSuggestions({ date, mealType, onMealType }:
  { date: string; mealType: MealType | null; onMealType: (m: MealType | null) => void }) {
  // Only mounted for real accounts; the guard keeps a demo session from ever issuing a live request.
  const isDemo = useDataMode() === "demo";
  const menus = useQuery({ queryKey: liveKeys.menuList, queryFn: ({ signal }) => menusApi.list({ limit: 50 }, signal),
                           enabled: !isDemo });

  if (menus.isPending) return <LoadingCards />;
  if (menus.isError) {
    return <ErrorState title="Couldn't load your menus" message={menus.error.message} onRetry={() => void menus.refetch()} />;
  }

  const onDate = menus.data.items.filter((m) => m.menu_date === date);
  const confirmed = onDate.filter((m) => m.has_confirmed)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  const unconfirmed = onDate.filter((m) => !m.has_confirmed);

  if (confirmed.length === 0) {
    return (
      <Card>
        {unconfirmed.length > 0 ? (
          <EmptyState icon={Soup} title="This menu isn't confirmed yet"
                      action={<ButtonLink to="/app/menu" variant="secondary">Open the mess menu</ButtonLink>}>
            {unconfirmed.length === 1 ? "A menu for this date is waiting for review. " : `${unconfirmed.length} menus for this date are waiting for review. `}
            Suggestions appear once a menu is confirmed, so nothing is ranked from unchecked dishes.
          </EmptyState>
        ) : (
          <EmptyState icon={Soup} title="No confirmed menu for this date"
                      action={<ButtonLink to="/app/menu" variant="secondary">Open the mess menu</ButtonLink>}>
            Suggestions come from your own confirmed mess menu for the day. Add and confirm one to see dishes ranked for you.
          </EmptyState>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {confirmed.map((menu) => (
        <MenuSection key={menu.id} menu={menu} mealType={mealType} onMealType={onMealType}
                     titled={confirmed.length > 1} />
      ))}
    </div>
  );
}

function MenuSection({ menu, mealType, onMealType, titled }:
  { menu: MenuSummary; mealType: MealType | null; onMealType: (m: MealType | null) => void; titled: boolean }) {
  const queryClient = useQueryClient();
  const isDemo = useDataMode() === "demo";
  const suggestions = useQuery({
    queryKey: liveKeys.menuSuggestions(menu.id, mealType),
    queryFn: ({ signal }) => menusApi.suggestions(menu.id, mealType, signal),
    enabled: !isDemo,
    // Switching meal tabs keeps the previous list (and the tabs themselves) on screen while the next loads.
    placeholderData: keepPreviousData,
  });
  const gone = suggestions.isError && suggestions.error instanceof ApiError && suggestions.error.status === 404;

  // A menu deleted since the list loaded: refresh the list rather than showing a dead section.
  useEffect(() => {
    if (gone) void invalidateMenus(queryClient);
  }, [gone, queryClient]);

  const body = suggestions.isPending ? <LoadingCards />
    : gone ? <ErrorState title="This menu no longer exists" message="It was removed. Refreshing your menus." />
    : suggestions.isError
      ? <ErrorState title="Couldn't load suggestions" message={suggestions.error.message} onRetry={() => void suggestions.refetch()} />
      : <SuggestionBody data={suggestions.data} mealType={mealType} onMealType={onMealType} />;

  return (
    <section aria-labelledby={`menu-${menu.id}`} className="space-y-4">
      <h2 id={`menu-${menu.id}`} className={cn("text-lg font-medium", !titled && "sr-only")}>{menu.title}</h2>
      {body}
    </section>
  );
}

function SuggestionBody({ data, mealType, onMealType }:
  { data: MenuSuggestions; mealType: MealType | null; onMealType: (m: MealType | null) => void }) {
  if (!data.confirmed) {
    // Branch on `confirmed`, not `status`: a confirmed menu with a newer draft still has suggestions.
    return (
      <Card>
        <EmptyState icon={Soup} title="This menu isn't confirmed yet"
                    action={<ButtonLink to="/app/menu" variant="secondary">Open the mess menu</ButtonLink>}>
          Confirm the menu to see its dishes ranked for you.
        </EmptyState>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <MealTabs mealTypes={data.meal_types} selected={mealType} onSelect={onMealType} />
      <SuggestionList data={data} demo={false} mealTypeLabel={mealType ? MEAL_LABELS[mealType] : null} />
    </div>
  );
}
