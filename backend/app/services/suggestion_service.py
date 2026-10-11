"""Deterministic, explainable dish suggestions for a confirmed menu (rule version below).

Signals, all from data the student recorded or the reference dataset holds:

    +2  a food preference marked "like" matches the dish
    -2  a preference marked "dislike" matches                     (caution)
    -3  a preference marked "avoid" matches                       (caution, "check first")
    +1  the linked reference food's diet type fits the student's eating pattern
    -3  it conflicts with the eating pattern                      (caution, "check first")
     0  a recorded allergen is listed for the linked reference food (caution, "check first")

Missing data never lowers a score: an unlinked dish, a dish without nutrition
or price, or an unknown diet type simply gets no signal. Every student with a
recorded allergy sees a caution on every dish, because menus don't list
ingredients and a reference food describes a generic recipe, not the mess's.
Nutrition values are reference values per 100 g, never a portion estimate, and
are not used for ranking. Prices are shown only when entered on the menu.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Food,
    FoodNutrient,
    StudentProfile,
    UserAllergy,
    UserFoodPreference,
)
from app.schemas.menus import (
    BudgetContextOut,
    DishNutritionOut,
    DishSuggestionOut,
    MenuFoodOut,
    MenuSuggestionsOut,
    PersonalizationOut,
    SignalOut,
)
from app.schemas.nutrition import NutrientValueOut
from app.services import budget_service, menu_service
from app.services.nutrition import catalog
from app.services.nutrition.calculator import UNITS, display_value, for_storage
from app.services.text import normalize_label

RULE_VERSION = "menu-rules-1"
SHOWN_NUTRIENTS = ("energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g")
ALLERGEN_NAMES = {"peanut": "peanut", "tree_nut": "tree nuts", "milk": "milk", "egg": "egg",
                  "wheat_gluten": "wheat/gluten", "soy": "soy", "fish": "fish", "shellfish": "shellfish",
                  "sesame": "sesame", "mustard": "mustard"}
PATTERN_NAMES = {"vegetarian": "vegetarian", "eggetarian": "eggetarian", "vegan": "vegan", "jain": "Jain"}
DIET_NAMES = {"vegan": "vegan", "vegetarian": "vegetarian", "eggetarian": "containing egg",
              "non_vegetarian": "non-vegetarian"}
# Which reference diet types fit each eating pattern. Patterns not listed don't restrict anything.
COMPATIBLE = {
    "vegan": {"vegan"},
    "vegetarian": {"vegan", "vegetarian"},
    "jain": {"vegan", "vegetarian"},
    "eggetarian": {"vegan", "vegetarian", "eggetarian"},
}


def _words(value: str) -> list[str]:
    return normalize_label(value).split()


def _matches(pref_label: str, pref_food: uuid.UUID | None, dish: str, dish_food: uuid.UUID | None) -> bool:
    if pref_food is not None and pref_food == dish_food:
        return True
    pref, words = _words(pref_label), _words(dish)
    if not pref or len(pref) > len(words):
        return False
    # The preference's words appear consecutively in the dish name ("rajma" in "Rajma Chawal").
    return any(words[i:i + len(pref)] == pref for i in range(len(words) - len(pref) + 1))


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def suggestions(db: Session, user_id: uuid.UUID, menu_id: uuid.UUID, meal_type: str | None) -> MenuSuggestionsOut:
    detail = menu_service.detail(db, user_id, menu_id)
    profile = db.get(StudentProfile, user_id)
    prefs = list(db.scalars(select(UserFoodPreference).where(UserFoodPreference.user_id == user_id)))
    allergies = list(db.scalars(select(UserAllergy).where(UserAllergy.user_id == user_id)))
    pattern = profile.dietary_pattern if profile else "no_preference"
    currency = profile.currency if profile else "INR"

    allergy_names = sorted({ALLERGEN_NAMES.get(a.allergen) or (a.custom_label or "other") for a in allergies})
    allergen_codes = {a.allergen for a in allergies if a.allergen != "other"}
    based_on = ([f"{len(prefs)} food preference{'s' if len(prefs) != 1 else ''}"] if prefs else []) + \
               ([f"your {PATTERN_NAMES[pattern]} eating pattern"] if pattern in COMPATIBLE else []) + \
               (["your recorded allergies (as cautions only)"] if allergies else [])

    summary = budget_service.summary(db, user_id)
    budget = BudgetContextOut(has_budget=summary.budget_amount is not None, period=summary.period,
                              remaining=summary.remaining, currency=summary.currency)
    allergy_notice = (f"You've recorded {_join(allergy_names)}. Menus don't list ingredients, so DeluluFit can't tell "
                      "whether a dish contains them. Ask the mess before eating anything you're unsure about."
                      if allergies else None)

    version = detail.confirmed
    if version is None:
        return MenuSuggestionsOut(
            menu_id=detail.id, menu_date=detail.menu_date, status=detail.status, confirmed=False, meal_types=[],
            meal_type=meal_type, rule_version=RULE_VERSION,
            personalization=PersonalizationOut(personalized=False, based_on=based_on,
                                               message="Confirm this menu to see suggestions."),
            allergy_notice=allergy_notice, budget=budget, dishes=[])

    meal_types = list(dict.fromkeys(i.meal_type for i in version.items))
    items = [i for i in version.items if meal_type is None or i.meal_type == meal_type]
    food_ids = {i.food.id for i in items if i.food}
    foods = {f.id: f for f in db.scalars(select(Food).where(Food.id.in_(food_ids)))} if food_ids else {}
    rows = {r.food_id: r for r in db.scalars(select(FoodNutrient).where(FoodNutrient.food_id.in_(food_ids),
                                                                       FoodNutrient.is_current.is_(True)))} \
        if food_ids else {}

    dishes: list[DishSuggestionOut] = []
    any_signal = False
    for item in items:
        food = foods.get(item.food.id) if item.food else None
        score = 0
        reasons: list[SignalOut] = []
        cautions: list[SignalOut] = []
        blocking = False

        for p in prefs:
            if not _matches(p.label, p.food_id, item.name, food.id if food else None):
                continue
            if p.preference == "like":
                score += 2
                reasons.append(SignalOut(code="likes", text=f"You marked “{p.label}” as a food you like."))
            elif p.preference == "dislike":
                score -= 2
                cautions.append(SignalOut(code="dislikes", text=f"You marked “{p.label}” as a food you dislike."))
            else:
                score -= 3
                blocking = True
                cautions.append(SignalOut(code="avoids", text=f"You said you avoid “{p.label}”."))

        if pattern in COMPATIBLE:
            name = PATTERN_NAMES[pattern]
            if food is None or food.diet_type == "unknown":
                cautions.append(SignalOut(code="diet_unknown",
                                          text=f"We couldn't check this dish against your {name} eating pattern."))
            elif food.diet_type in COMPATIBLE[pattern]:
                score += 1
                reasons.append(SignalOut(code="fits_pattern",
                                         text=f"The matching reference food is listed as {DIET_NAMES[food.diet_type]}, "
                                              f"which fits your {name} eating pattern. The mess's recipe may differ."))
            else:
                score -= 3
                blocking = True
                cautions.append(SignalOut(code="pattern_conflict",
                                          text=f"The matching reference food is listed as "
                                               f"{DIET_NAMES.get(food.diet_type, food.diet_type)}, which doesn't fit "
                                               f"your {name} eating pattern."))
            if pattern == "jain":
                cautions.append(SignalOut(code="jain_unknown",
                                          text="Onion, garlic and root vegetables can't be checked from a menu."))

        if allergies:
            listed = sorted(allergen_codes & set(food.known_allergens)) if food else []
            if listed:
                blocking = True
                cautions.append(SignalOut(code="allergen_listed",
                                          text=f"The matching reference food lists "
                                               f"{_join([ALLERGEN_NAMES[a] for a in listed])}, which you've recorded "
                                               "as an allergy."))
            else:
                cautions.append(SignalOut(code="allergy_unknown",
                                          text="Ingredients aren't known, so we can't tell whether this dish contains "
                                               f"{_join(allergy_names)}."))

        if reasons or any(c.code in ("dislikes", "avoids", "pattern_conflict", "allergen_listed") for c in cautions):
            any_signal = True
        group = "check_first" if blocking else ("suggested" if score > 0 else "available")
        nutrition = None
        row = rows.get(food.id) if food else None
        if row is not None:
            prof = catalog.profile_from_row(row)
            nutrition = DishNutritionOut(reference_mass_g=row.reference_mass_g, source_name=row.source_name, nutrients={
                n: NutrientValueOut(value=for_storage(prof.value(n)), display=display_value(n, prof.value(n)),
                                    unit=UNITS[n], status=prof.status(n)) for n in SHOWN_NUTRIENTS})
        dishes.append(DishSuggestionOut(
            menu_item_id=item.id, menu_meal_id=item.meal_id, name=item.name, meal_type=item.meal_type,
            section_heading=item.section_heading, serving_note=item.serving_note, source=item.source,
            is_user_corrected=item.is_user_corrected, group=group, score=score, reasons=reasons, cautions=cautions,
            food=MenuFoodOut(id=food.id, canonical_name=food.canonical_name) if food else None,
            diet_type=food.diet_type if food else None, nutrition=nutrition, price=item.price, currency=currency))

    order = {"suggested": 0, "available": 1, "check_first": 2}
    position = {d.menu_item_id: n for n, d in enumerate(dishes)}
    dishes.sort(key=lambda d: (order[d.group], -d.score if d.group == "suggested" else 0, position[d.menu_item_id]))

    if not based_on:
        message = ("Nothing you've recorded can rank these dishes yet, so they're shown in menu order. Add food "
                   "preferences or an eating pattern in Profile to get suggestions.")
    elif not any_signal:
        message = "None of what you've recorded matches dishes on this menu, so they're shown in menu order."
    else:
        message = f"Based on {_join(based_on)}."
    return MenuSuggestionsOut(
        menu_id=detail.id, menu_date=detail.menu_date, status=detail.status, confirmed=True, meal_types=meal_types,
        meal_type=meal_type, rule_version=RULE_VERSION,
        personalization=PersonalizationOut(personalized=bool(based_on) and any_signal, based_on=based_on,
                                           message=message),
        allergy_notice=allergy_notice, budget=budget, dishes=dishes)
