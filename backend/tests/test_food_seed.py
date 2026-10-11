"""Audit of the curated USDA FNDDS dataset and of the seed loader."""

from __future__ import annotations

import copy
import re
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import models as m
from app.services.nutrition import catalog
from app.services.nutrition.calculator import NUTRIENTS
from app.services.nutrition.normalize import normalize_food_name
from app.services.nutrition.seed import SeedDataError, is_usable_portion, load_seed, read_seed_file, validate_seed

DATA = read_seed_file()


# --- dataset audit (no database writes) ----------------------------------------------------

def test_dataset_is_valid() -> None:
    validate_seed(DATA)
    assert DATA["dataset"] == "USDA FoodData Central - FNDDS Survey Foods"
    assert DATA["dataset_version"] == "2024-10-31"
    assert DATA["license"] == "CC0 1.0"


def test_every_food_has_fdc_provenance() -> None:
    for food in DATA["foods"]:
        n = food["nutrients"]
        assert re.fullmatch(r"FDC ID \d+: .+", n["source_reference"]), food["canonical_name"]
        assert n["source_name"] == DATA["dataset"] and n["dataset_version"] == DATA["dataset_version"]
        fdc_id = n["source_reference"].split(":")[0]
        for s in food["servings"]:
            assert s["source_reference"] == f"{fdc_id} food_portion" and s["source_name"] == DATA["dataset"]


def test_nutrients_share_one_basis_and_unit_convention() -> None:
    # FNDDS reports nutrients per 100 g edible portion: energy in kcal, the rest in grams.
    for food in DATA["foods"]:
        n = food["nutrients"]
        assert Decimal(n["reference_mass_g"]) == 100
        # This file was built before sugars and sodium were extracted: the five core
        # nutrients are present for every food; the other two are absent (not in source).
        assert {"energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g"} <= set(n)
        macros = sum(Decimal(n[k]) for k in ("protein_g", "carbohydrate_g", "fat_g") if n[k] is not None)
        assert macros <= 100, food["canonical_name"]
        if n["fibre_g"] is not None and n["carbohydrate_g"] is not None:
            assert Decimal(n["fibre_g"]) <= Decimal(n["carbohydrate_g"]), food["canonical_name"]


def test_energy_is_consistent_with_macronutrients() -> None:
    # Atwater 4/4/9 kcal per g as a plausibility check on units, not a replacement for source values.
    for food in DATA["foods"]:
        n = food["nutrients"]
        if None in (n["energy_kcal"], n["protein_g"], n["carbohydrate_g"], n["fat_g"]):
            continue
        energy = Decimal(n["energy_kcal"])
        atwater = 4 * Decimal(n["protein_g"]) + 4 * Decimal(n["carbohydrate_g"]) + 9 * Decimal(n["fat_g"])
        assert abs(atwater - energy) <= max(Decimal("10"), energy * Decimal("0.15")), food["canonical_name"]


def test_reference_portions_are_positive() -> None:
    for food in DATA["foods"]:
        assert food["servings"], food["canonical_name"]
        for s in food["servings"]:
            assert Decimal(s["mass_g"]) > 0


def test_names_and_aliases_are_normalized_consistently() -> None:
    keys: dict[str, str] = {}
    for food in DATA["foods"]:
        for key in [normalize_food_name(food["canonical_name"])] + \
                   [normalize_food_name(a["alias"]) for a in food["aliases"]]:
            assert keys.setdefault(key, food["canonical_name"]) == food["canonical_name"], key
        for a in food["aliases"]:
            assert a["alias"] == normalize_food_name(a["alias"]), a["alias"]


def test_guideline_portions_are_not_usable() -> None:
    assert not is_usable_portion("Guideline amount per fl oz of beverage")
    assert is_usable_portion("1 cup")


def test_validator_rejects_bad_data() -> None:
    def broken(mutate: Any) -> dict[str, Any]:
        data = copy.deepcopy(DATA)
        mutate(data["foods"][0])
        return data

    cases = [
        lambda f: f["nutrients"].update(source_reference=""),
        lambda f: f["nutrients"].update(energy_kcal="-1"),
        lambda f: f["nutrients"].update(protein_g="7.855"),
        lambda f: f["nutrients"].update(source_nutrients=["energy_kcal"]),  # values outside coverage
        lambda f: f["nutrients"].update(source_nutrients=["vitamin_q"]),
        lambda f: f["nutrients"].update(reference_mass_g="0"),
        lambda f: f["servings"][0].update(mass_g="0"),
        lambda f: f["aliases"].append({"alias": "dal", "confidence": "HIGH"}),  # owned by Dal
        lambda f: f["aliases"].append({"alias": "naan", "confidence": "MEDIUM"}),
        lambda f: f["aliases"].append({"alias": "x", "confidence": "UNKNOWN"}),
        lambda f: f.update(diet_type="pescatarian"),
        lambda f: f.update(known_allergens=["gluten"]),
    ]
    for mutate in cases:
        with pytest.raises(SeedDataError):
            validate_seed(broken(mutate))


# --- loader (database) ------------------------------------------------------------------------

def _count(db: Session, model: type) -> int:
    return db.scalar(select(func.count()).select_from(model)) or 0


def test_load_is_complete_and_idempotent(db: Session) -> None:
    report = load_seed(db, DATA)
    db.commit()
    assert report.foods_created == len(DATA["foods"]) == _count(db, m.Food)
    assert report.aliases_created == sum(len(f["aliases"]) for f in DATA["foods"]) == _count(db, m.FoodAlias)
    assert report.nutrient_versions_created == len(DATA["foods"]) == _count(db, m.FoodNutrient)
    total_servings = sum(len(f["servings"]) for f in DATA["foods"])
    assert report.servings_created + report.servings_skipped == total_servings
    assert report.servings_skipped > 0
    assert db.scalar(select(func.count()).select_from(m.FoodServing)
                     .where(m.FoodServing.label.ilike("guideline amount%"))) == 0

    again = load_seed(db, DATA)
    db.commit()
    assert (again.foods_created, again.aliases_created, again.nutrient_versions_created,
            again.servings_created, again.foods_updated) == (0, 0, 0, 0, 0)
    assert again.serving_conflicts == []


def test_loaded_values_match_the_file_and_missing_stays_null(db: Session) -> None:
    data = copy.deepcopy(DATA)
    data["foods"][0]["nutrients"]["fibre_g"] = None
    load_seed(db, data)
    db.commit()
    for food in data["foods"]:
        row = db.scalar(select(m.FoodNutrient).join(m.Food)
                        .where(m.Food.normalized_name == normalize_food_name(food["canonical_name"])))
        assert row is not None
        for n in NUTRIENTS:
            expected = food["nutrients"].get(n)
            assert getattr(row, n) == (None if expected is None else Decimal(expected)), (food["canonical_name"], n)
        assert row.source_reference == food["nutrients"]["source_reference"]
        assert row.source_food_id == food["nutrients"]["source_reference"].split(":")[0].removeprefix("FDC ID ")
        assert sorted(row.source_nutrients) == sorted(k for k in NUTRIENTS if k in food["nutrients"])
        assert row.sugars_g is None and row.sodium_mg is None
    first = normalize_food_name(data["foods"][0]["canonical_name"])
    assert db.scalar(select(m.FoodNutrient.fibre_g).join(m.Food).where(m.Food.normalized_name == first)) is None


def test_changed_reference_values_create_a_new_version(db: Session) -> None:
    load_seed(db, DATA)
    db.commit()
    revised = copy.deepcopy(DATA)
    revised["foods"][0]["nutrients"]["energy_kcal"] = "300"
    revised["foods"][0]["nutrients"]["dataset_version"] = "2026-01-01"
    report = load_seed(db, revised)
    db.commit()
    assert report.nutrient_versions_created == 1
    food_id = db.scalar(select(m.Food.id).where(
        m.Food.normalized_name == normalize_food_name(DATA["foods"][0]["canonical_name"])))
    rows = list(db.scalars(select(m.FoodNutrient).where(m.FoodNutrient.food_id == food_id)
                           .order_by(m.FoodNutrient.created_at, m.FoodNutrient.is_current)))
    assert [(r.energy_kcal, r.is_current) for r in rows] == [(Decimal("299.00"), False), (Decimal("300.00"), True)]


def test_alias_owned_by_another_food_in_database_is_rejected(db: Session) -> None:
    load_seed(db, DATA)
    db.commit()
    moved = copy.deepcopy(DATA)
    alias = moved["foods"][0]["aliases"].pop(0)
    moved["foods"][1]["aliases"].append(alias)
    with pytest.raises(SeedDataError):
        load_seed(db, moved)
    db.rollback()


def test_loaded_catalog_supports_end_to_end_matching(db: Session) -> None:
    load_seed(db, DATA)
    db.commit()
    index = catalog.load_food_index(db)
    assert len(index) == len(DATA["foods"])
    match = index.match("Chapati")
    assert match.food is not None and match.food.canonical_name == "Roti / chapati"
    milk = index.match("milk")
    assert milk.food is not None
    servings = catalog.food_servings(db, milk.food.food_id)
    assert any(s.label == "1 fl oz" for s in servings)
    assert not any(s.label.lower().startswith("guideline") for s in servings)
    profile = catalog.current_nutrient_profile(db, milk.food.food_id)
    assert profile is not None and profile.reference_mass_g == Decimal("100")


def test_unknown_and_not_in_source_nutrients_load_distinctly(db: Session) -> None:
    data = copy.deepcopy(DATA)
    n = data["foods"][0]["nutrients"]
    n["sodium_mg"] = None                      # covered by the source but unknown for this food
    n["sugars_g"] = "0"                        # a reported zero
    load_seed(db, data)
    db.commit()
    food_id = db.scalar(select(m.Food.id).where(
        m.Food.normalized_name == normalize_food_name(data["foods"][0]["canonical_name"])))
    profile = catalog.current_nutrient_profile(db, food_id)  # type: ignore[arg-type]
    assert profile is not None
    assert profile.status("sugars_g") == "reported" and profile.value("sugars_g") == Decimal("0")
    assert profile.status("sodium_mg") == "unknown"
    other = catalog.current_nutrient_profile(db, db.scalar(select(m.Food.id).where(  # type: ignore[arg-type]
        m.Food.normalized_name == normalize_food_name(data["foods"][1]["canonical_name"]))))
    assert other is not None and other.status("sodium_mg") == "not_in_source"


def test_database_rejects_values_outside_source_coverage(db: Session) -> None:
    from sqlalchemy.exc import IntegrityError

    food = m.Food(canonical_name="Coverage test", normalized_name="coverage test")
    db.add(food)
    db.flush()
    db.add(m.FoodNutrient(food_id=food.id, reference_mass_g=Decimal("100"), sodium_mg=Decimal("5"),
                          source_name="test", source_nutrients=["energy_kcal"]))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
