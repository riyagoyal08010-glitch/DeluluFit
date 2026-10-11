"""Proportional calculation, rounding, nutrient statuses, totals and confidence."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.services.nutrition.calculator import (NUTRIENTS, UNITS, NutrientAmounts, NutrientProfile,
                                               NutritionDataError, display_value, for_storage, scale, stored, total)
from app.services.nutrition.confidence import estimate_confidence, portion_confidence, rank, weakest
from app.services.nutrition.estimates import compute_estimate
from app.services.nutrition.provenance import ENGINE_VERSION
from app.services.nutrition.units import ServingRef, resolve_mass

D = Decimal
CORE = {"energy_kcal": D("299"), "protein_g": D("7.85"), "carbohydrate_g": D("46.13"), "fat_g": D("9.2"),
        "fibre_g": D("9.7")}
# The current dataset provides five nutrients; sugars and sodium are not in the source.
ROTI = NutrientProfile(D("100"), CORE, food_nutrient_id=uuid.uuid4(), source_name="USDA FNDDS",
                       source_reference="FDC ID 2707713", source_food_id="2707713", dataset_version="2024-10-31")


def test_formula_is_exact_without_intermediate_rounding() -> None:
    amounts = scale(ROTI, D("40"))
    assert amounts.values["energy_kcal"] == D("119.6")
    assert amounts.values["carbohydrate_g"] == D("18.452")   # not rounded to 18.45
    assert scale(ROTI, D("33.33")).values["protein_g"] == D("2.616405")
    assert scale(ROTI, D("100")).values["energy_kcal"] == D("299")


def test_scaling_is_linear_in_mass() -> None:
    one, two = scale(ROTI, D("50")), scale(ROTI, D("100"))
    for n in CORE:
        assert two.values[n] == one.values[n] * 2  # type: ignore[operator]


def test_non_100g_reference_mass() -> None:
    profile = NutrientProfile(D("30"), {"energy_kcal": D("60")})
    assert scale(profile, D("45")).values["energy_kcal"] == D("90")


def test_storage_and_display_rounding() -> None:
    assert for_storage(D("2.616405")) == D("2.6164")
    assert for_storage(D("0.00005")) == D("0.0001")  # half up
    assert for_storage(None) is None
    assert display_value("energy_kcal", D("119.5")) == D("120")
    assert display_value("protein_g", D("2.65")) == D("2.7")
    assert display_value("sodium_mg", D("10.49")) == D("10")
    assert display_value("fat_g", None) is None
    assert set(UNITS) == set(NUTRIENTS) and UNITS["sodium_mg"] == "mg" and UNITS["energy_kcal"] == "kcal"


def test_rounding_is_applied_after_summing() -> None:
    # Three items of 1/3 kcal each: summing display-rounded values would give 0, not 1.
    profile = NutrientProfile(D("3"), {"energy_kcal": D("1")})
    items = [stored(scale(profile, D("1"))) for _ in range(3)]
    t = total(items)["energy_kcal"]
    assert t.total == D("0.9999")
    assert display_value("energy_kcal", t.total) == D("1")


@pytest.mark.parametrize("mass", [D("0"), D("-1"), D("NaN"), D("Infinity")])
def test_invalid_mass_is_rejected(mass: Decimal) -> None:
    with pytest.raises(ValueError):
        scale(ROTI, mass)


def test_invalid_reference_data_is_rejected() -> None:
    with pytest.raises(NutritionDataError):
        NutrientProfile(D("0"), {})
    with pytest.raises(NutritionDataError):
        NutrientProfile(D("100"), {"energy_kcal": D("-1")})
    with pytest.raises(NutritionDataError):
        NutrientProfile(D("100"), {"vitamin_q": D("1")})
    with pytest.raises(NutritionDataError):  # a value for a nutrient the source does not provide
        NutrientProfile(D("100"), {"energy_kcal": D("1")}, source_nutrients=frozenset({"protein_g"}))


def test_zero_unknown_and_not_in_source_are_distinct() -> None:
    profile = NutrientProfile(D("100"), {"energy_kcal": D("50"), "fat_g": D("0"), "protein_g": None},
                              source_nutrients=frozenset({"energy_kcal", "fat_g", "protein_g"}))
    assert profile.status("fat_g") == "reported"            # a genuine, reported zero
    assert profile.status("protein_g") == "unknown"         # covered by the source, no value
    assert profile.status("sodium_mg") == "not_in_source"   # not provided at all
    amounts = scale(profile, D("200"))
    assert amounts.values["fat_g"] == D("0") and amounts.statuses["fat_g"] == "estimated"
    assert amounts.values["protein_g"] is None and amounts.statuses["protein_g"] == "unknown"
    assert amounts.values["sodium_mg"] is None and amounts.statuses["sodium_mg"] == "not_in_source"
    assert not amounts.complete and "fat_g" not in amounts.missing


def test_empty_meal_totals_are_not_zero() -> None:
    t = total([])
    assert t.item_count == 0 and t.complete
    for n in NUTRIENTS:
        assert t[n].status == "empty" and t[n].total is None


def test_all_known_items_give_complete_totals() -> None:
    profile = NutrientProfile(D("100"), {n: D("1") for n in NUTRIENTS})
    t = total([scale(profile, D("40")), scale(profile, D("60"))])
    assert t.complete
    assert t["sodium_mg"].total == D("1") and t["sodium_mg"].status == "complete"


def test_mixed_known_and_unknown_items_are_incomplete_lower_bounds() -> None:
    partial = NutrientProfile(D("100"), {"energy_kcal": D("50"), "protein_g": None})
    t = total([scale(ROTI, D("40")), scale(partial, D("100")), None])
    assert t.item_count == 3 and not t.complete
    energy = t["energy_kcal"]
    assert energy.total == D("169.6") and energy.known_items == 2 and energy.missing_items == 1
    assert energy.status == "incomplete" and energy.is_lower_bound
    assert t["protein_g"].known_items == 1 and t["protein_g"].missing_items == 2
    assert t["sodium_mg"].total is None and t["sodium_mg"].status == "unavailable"


def test_item_without_estimate_contributes_nothing() -> None:
    t = total([None, NutrientAmounts.no_estimate()])
    assert t["energy_kcal"].status == "unavailable" and t["energy_kcal"].total is None


def test_confidence_rules() -> None:
    assert rank("HIGH") > rank("MEDIUM") > rank("LOW") > rank("UNKNOWN")
    assert weakest("HIGH", "LOW", "MEDIUM") == "LOW"
    assert portion_confidence("user_grams") == "HIGH"
    assert portion_confidence("serving_reference") == "MEDIUM"
    assert estimate_confidence("HIGH", "user_grams") == "HIGH"
    assert estimate_confidence("HIGH", "serving_reference") == "MEDIUM"
    assert estimate_confidence("MEDIUM", "user_grams") == "MEDIUM"
    assert estimate_confidence("HIGH", "unknown") == "UNKNOWN"
    with pytest.raises(ValueError):
        rank("CERTAIN")


def test_compute_estimate_with_serving_records_provenance() -> None:
    food = uuid.uuid4()
    serving = ServingRef(uuid.uuid4(), food, "1 medium chappatti or roti (7\")", D("40.0"))
    mass = resolve_mass(2, "serving", food_id=food, servings=[serving], serving_id=serving.id)
    draft = compute_estimate(match_confidence="HIGH", mass=mass, profile=ROTI)
    assert draft.method == "per_reference_mass" and draft.confidence == "MEDIUM"
    assert draft.amounts.values["energy_kcal"] == D("239.2")
    assert draft.amounts.values["carbohydrate_g"] == D("36.9040")
    snap = draft.snapshot
    assert snap["engine_version"] == ENGINE_VERSION
    assert snap["portion"] == {"quantity": "2", "unit": "serving", "mass_g": "80.00",
                               "mass_source": "serving_reference", "basis": mass.basis, "missing_reason": None,
                               "serving": {"id": str(serving.id), "label": serving.label, "mass_g": "40.0"}}
    ref = snap["reference"]
    assert ref["source_reference"] == "FDC ID 2707713" and ref["source_food_id"] == "2707713"
    assert ref["dataset_version"] == "2024-10-31" and ref["values"]["protein_g"] == "7.85"
    assert ref["source_nutrients"] == sorted(CORE)
    assert snap["nutrient_status"]["protein_g"] == "estimated"
    assert snap["nutrient_status"]["sodium_mg"] == "not_in_source"
    assert snap["missing_nutrients"] == ["sugars_g", "sodium_mg"]
    assert snap["units"]["sodium_mg"] == "mg"


def test_compute_estimate_unavailable_without_mass_or_reference() -> None:
    no_mass = resolve_mass(1, "serving", food_id=uuid.uuid4())
    draft = compute_estimate(match_confidence="HIGH", mass=no_mass, profile=ROTI)
    assert draft.method == "unavailable" and draft.confidence == "UNKNOWN"
    assert draft.reason == "serving_not_selected" and draft.profile is None
    assert all(v is None for v in draft.amounts.values.values())
    assert set(draft.snapshot["nutrient_status"].values()) == {"no_estimate"}
    unknown_food = compute_estimate(match_confidence="UNKNOWN", mass=resolve_mass(100, "g", food_id=None),
                                    profile=None)
    assert unknown_food.method == "unavailable" and unknown_food.reason == "no_reference_data"
    assert unknown_food.snapshot["reference"] is None


def test_engine_version_fits_column() -> None:
    assert len(ENGINE_VERSION) <= 20
