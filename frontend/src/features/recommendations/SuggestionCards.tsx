import { AlertTriangle, Camera, Keyboard, Lightbulb, Soup } from "lucide-react";
import { Link } from "react-router-dom";

import { DemoTag } from "@/components/layout/DemoTag";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge, EmptyState } from "@/components/ui/Feedback";
import { formatAmount, formatMoney, MEAL_LABELS, NUTRIENT_LABELS } from "@/lib/format";
import type { DishNutrition, DishSuggestion, MenuSuggestions, NutrientKey, SuggestionGroup } from "@/types/api";

/**
 * Renders one GET /menus/{id}/suggestions response. The same component shows live results and the
 * labelled demo sample, so the two can never drift apart. Nothing here logs a meal: "Log this" only
 * opens the meal logger with the dish filled in, and the student still chooses a portion and saves.
 */

const GROUPS: Array<{ group: SuggestionGroup; title: string; description: string }> = [
  { group: "suggested", title: "Suggested for you", description: "Matched something you recorded: a food you like or your eating pattern." },
  { group: "available", title: "Also on the menu", description: "Nothing recorded speaks for or against these." },
  { group: "check_first", title: "Check first", description: "Something you recorded conflicts: an allergen listed for the reference food, a food you avoid, or your eating pattern." },
];

const NUTRIENT_ORDER: NutrientKey[] = ["energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g", "sugars_g", "sodium_mg"];

/** "/app/meals?menu_meal=…&menu_item=…": the meal logger reads these once and prefills the form. */
export function logThisHref(dish: DishSuggestion): string {
  const params = new URLSearchParams({
    menu_meal: dish.menu_meal_id, menu_item: dish.menu_item_id, meal_type: dish.meal_type,
    food: dish.food?.id ?? "", name: dish.name,
  });
  return `/app/meals?${params.toString()}`;
}

export function AllergyPanel({ notice }: { notice: string }) {
  return (
    <section aria-labelledby="allergy-notice" className="rounded-card border border-ink bg-sheet p-4 shadow-card">
      <h2 id="allergy-notice" className="flex items-center gap-2 text-sm font-semibold">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Allergy
      </h2>
      <p className="mt-1 text-sm text-ink-muted">{notice}</p>
    </section>
  );
}

function ReferenceNutrition({ nutrition }: { nutrition: DishNutrition }) {
  const keys = NUTRIENT_ORDER.filter((k) => nutrition.nutrients[k] !== undefined);
  if (keys.length === 0) return null;
  const mass = nutrition.reference_mass_g === null ? "the reference amount" : `${Number(nutrition.reference_mass_g)} g`;
  return (
    <div className="rounded-control border border-line/70 bg-sheet p-3">
      <p className="text-xs text-ink-muted">
        Per {mass} of the reference food{nutrition.source_name ? ` (${nutrition.source_name})` : ""}, not a portion.
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        {keys.map((k) => {
          const n = nutrition.nutrients[k]!;
          return (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-ink-muted">{NUTRIENT_LABELS[k]}</dt>
              <dd className="metric font-medium text-ink">
                {n.status === "reported" ? formatAmount(n.display, n.unit)
                  : <span className="font-normal text-ink-muted">{n.status === "unknown" ? "No data" : "Not in source"}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function dietText(dietType: string | null): string | null {
  if (!dietType || dietType === "unknown") return null;
  return dietType.replace(/_/g, "-");
}

export function DishCard({ dish, demo }: { dish: DishSuggestion; demo: boolean }) {
  const allergenListed = dish.cautions.some((c) => c.code === "allergen_listed");
  const diet = dietText(dish.diet_type);
  const titleId = `dish-${dish.menu_item_id}`;
  return (
    <Card aria-labelledby={titleId} surface="solid" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="flex flex-wrap items-center gap-2 text-base">
            {dish.name}
            {allergenListed && <Badge tone="danger" icon={AlertTriangle}>Check first</Badge>}
            {demo && <DemoTag />}
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {MEAL_LABELS[dish.meal_type]}
            {dish.section_heading && ` · ${dish.section_heading}`}
            {dish.serving_note && ` · ${dish.serving_note}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge icon={dish.source === "extraction" ? Camera : Keyboard}>
            {dish.source === "extraction" ? "From photo" : "Typed in"}
          </Badge>
          {dish.is_user_corrected && <Badge>Edited</Badge>}
        </div>
      </div>

      {(dish.food || diet) && (
        <p className="text-sm text-ink-muted">
          {dish.food && <>Reference food: <span className="text-ink">{dish.food.canonical_name}</span></>}
          {dish.food && diet && " · "}
          {diet && <>listed as {diet}</>}
        </p>
      )}

      {dish.reasons.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Why</h4>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {dish.reasons.map((r) => <li key={r.code + r.text}>{r.text}</li>)}
          </ul>
        </div>
      )}

      {dish.cautions.length > 0 && (
        <ul className="space-y-1.5 text-sm" aria-label={`Cautions for ${dish.name}`}>
          {dish.cautions.map((c) => (
            <li key={c.code + c.text} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span><span className="font-semibold">Caution:</span> {c.text}</span>
            </li>
          ))}
        </ul>
      )}

      {dish.nutrition && <ReferenceNutrition nutrition={dish.nutrition} />}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p className="text-sm text-ink-muted">
          {dish.price !== null ? <>Price on the menu: <span className="metric text-ink">{formatMoney(dish.price, dish.currency)}</span></>
                               : "No price printed on the menu."}
        </p>
        {demo ? (
          <Button variant="secondary" size="sm" disabled>Not available in demo</Button>
        ) : (
          <ButtonLink to={logThisHref(dish)} variant="secondary" size="sm" aria-label={`Log this: ${dish.name}`}>Log this</ButtonLink>
        )}
      </div>
    </Card>
  );
}

/**
 * One menu's dishes in fixed sections. `data.dishes` is already filtered by the server when a meal was
 * requested; `mealTypeLabel` names that meal for the empty state.
 */
export function SuggestionList({ data, demo, mealTypeLabel }:
  { data: MenuSuggestions; demo: boolean; mealTypeLabel: string | null }) {
  const sections = GROUPS.map((g) => ({ ...g, dishes: data.dishes.filter((d) => d.group === g.group) }))
    .filter((g) => g.dishes.length > 0);
  return (
    <div className="space-y-5">
      {data.allergy_notice && <AllergyPanel notice={data.allergy_notice} />}

      {!data.personalization.personalized && (
        <p className="flex items-start gap-2 rounded-control border border-line/70 bg-sheet p-3 text-sm text-ink-muted" role="note">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {data.personalization.message}{" "}
            <Link to="/app/profile" className="text-ink underline">Open your profile</Link> to add preferences, allergies or an eating pattern.
          </span>
        </p>
      )}
      {data.personalization.personalized && (
        <p className="text-sm text-ink-muted">{data.personalization.message}</p>
      )}

      {data.budget.has_budget && data.budget.remaining !== null && (
        <p className="text-xs text-ink-muted">
          Budget left this {data.budget.period ?? "period"} (as of today): <span className="metric text-ink">{formatMoney(data.budget.remaining, data.budget.currency)}</span>.
          Menu prices are shown only when printed on the menu.
        </p>
      )}

      {data.dishes.length === 0 ? (
        <Card>
          <EmptyState icon={Soup} title={mealTypeLabel ? `No ${mealTypeLabel.toLowerCase()} dishes on this menu` : "No dishes on this menu"}>
            {mealTypeLabel ? "This menu lists nothing for that meal. Pick another meal above." : "This menu has no dishes."}
          </EmptyState>
        </Card>
      ) : sections.map((s) => (
        <section key={s.group} aria-labelledby={`group-${data.menu_id}-${s.group}`} className="space-y-3">
          <div className="px-1">
            <h2 id={`group-${data.menu_id}-${s.group}`} className="text-lg font-medium">{s.title}</h2>
            <p className="text-sm text-ink-muted">{s.description}</p>
          </div>
          <ul className="space-y-3">
            {s.dishes.map((d) => <li key={d.menu_item_id}><DishCard dish={d} demo={demo} /></li>)}
          </ul>
        </section>
      ))}
    </div>
  );
}
