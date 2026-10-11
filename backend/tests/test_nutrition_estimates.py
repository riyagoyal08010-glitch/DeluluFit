"""Persisted, versioned estimates and preservation of historical estimates."""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db import models as m
from app.services.nutrition import catalog
from app.services.nutrition.estimates import record_estimate
from app.services.nutrition.provenance import ENGINE_VERSION
from app.services.nutrition.units import resolve_mass
from tests import factories as f


def _item(db: Session, food: m.Food | None, *, quantity: str, unit: str, serving: m.FoodServing | None = None,
          match_confidence: str = "HIGH") -> tuple[m.ConsumedItem, object]:
    user = f.make_user(db)
    log = f.make_meal_log(db, user)
    servings = catalog.food_servings(db, food.id) if food else []
    mass = resolve_mass(quantity, unit, food_id=food.id if food else None, servings=servings,
                        serving_id=serving.id if serving else None)
    item = m.ConsumedItem(meal_log_id=log.id, food_id=food.id if food else None,
                          serving_id=serving.id if serving else None, display_name="Roti", quantity=mass.quantity,
                          unit=unit, estimated_mass_g=mass.mass_g, mass_source=mass.mass_source,
                          match_confidence=match_confidence)
    db.add(item)
    db.flush()
    return item, mass


def test_record_estimate_from_serving(db: Session) -> None:
    food = f.make_food(db, "Roti")
    nutrient = f.make_nutrient(db, food, kcal="299")
    serving = m.FoodServing(food_id=food.id, label="1 medium roti", mass_g=Decimal("40"), source_name="test")
    db.add(serving)
    db.flush()
    item, mass = _item(db, food, quantity="3", unit="serving", serving=serving)
    est = record_estimate(db, item, mass=mass)  # type: ignore[arg-type]
    db.commit()
    assert est.estimate_version == 1 and est.is_current
    assert est.method == "per_reference_mass" and est.food_nutrient_id == nutrient.id
    assert est.engine_version == ENGINE_VERSION
    assert est.confidence == "MEDIUM"  # HIGH match x serving portion
    assert est.energy_kcal == Decimal("358.80") and est.protein_g == Decimal("3.60")
    assert est.carbohydrate_g is None  # unknown in the reference row stays unknown
    assert est.input_snapshot["portion"]["serving"]["label"] == "1 medium roti"
    assert est.input_snapshot["reference"]["food_nutrient_id"] == str(nutrient.id)
    # The fixture's source covers the five core nutrients but only gives energy and protein.
    status = est.input_snapshot["nutrient_status"]
    assert status["carbohydrate_g"] == "unknown" and status["sodium_mg"] == "not_in_source"
    assert est.sugars_g is None and est.sodium_mg is None


def test_unknown_food_or_portion_is_stored_as_unavailable(db: Session) -> None:
    unknown_food, _ = _item(db, None, quantity="100", unit="g", match_confidence="UNKNOWN")
    est = record_estimate(db, unknown_food)
    assert est.method == "unavailable" and est.confidence == "UNKNOWN" and est.food_nutrient_id is None
    assert est.energy_kcal is None and est.input_snapshot["reason"] == "no_reference_data"
    food = f.make_food(db)
    f.make_nutrient(db, food)
    no_serving, _ = _item(db, food, quantity="1", unit="serving")
    est = record_estimate(db, no_serving)
    assert est.method == "unavailable" and est.input_snapshot["reason"] == "unknown_mass"
    db.commit()


def test_portion_must_match_the_stored_item(db: Session) -> None:
    food = f.make_food(db)
    f.make_nutrient(db, food)
    item, _ = _item(db, food, quantity="100", unit="g")
    other = resolve_mass("150", "g", food_id=food.id)
    with pytest.raises(ValueError):
        record_estimate(db, item, mass=other)


def test_recalculation_preserves_historical_estimates(db: Session) -> None:
    food = f.make_food(db)
    old_row = f.make_nutrient(db, food, kcal="100")
    item, _ = _item(db, food, quantity="200", unit="g")
    v1 = record_estimate(db, item)
    db.commit()
    assert v1.energy_kcal == Decimal("200.00")

    # The reference data is revised: a new row supersedes the old one.
    old_row.is_current = False
    db.flush()
    new_row = m.FoodNutrient(food_id=food.id, reference_mass_g=Decimal("100"), energy_kcal=Decimal("120"),
                             protein_g=Decimal("4"), source_name="Test fixture", dataset_version="test-2")
    db.add(new_row)
    db.flush()
    v2 = record_estimate(db, item)
    db.commit()

    rows = list(db.scalars(select(m.NutritionEstimate).where(m.NutritionEstimate.consumed_item_id == item.id)
                           .order_by(m.NutritionEstimate.estimate_version)))
    assert [r.estimate_version for r in rows] == [1, 2]
    assert [r.is_current for r in rows] == [False, True]
    db.refresh(rows[0])
    assert rows[0].energy_kcal == Decimal("200.00") and rows[0].food_nutrient_id == old_row.id
    assert rows[0].input_snapshot["reference"]["dataset_version"] == "test"
    assert v2.energy_kcal == Decimal("240.00") and v2.food_nutrient_id == new_row.id
    assert v2.input_snapshot["reference"]["dataset_version"] == "test-2"
    # The superseded estimate cannot be rewritten, and its reference row cannot be deleted.
    rows[0].energy_kcal = Decimal("1")
    with pytest.raises(DBAPIError):
        db.commit()
    db.rollback()
    db.delete(db.get(m.FoodNutrient, old_row.id))
    with pytest.raises(DBAPIError):
        db.commit()
    db.rollback()


def test_versions_increment_without_reference_change(db: Session) -> None:
    food = f.make_food(db)
    f.make_nutrient(db, food)
    item, _ = _item(db, food, quantity="50", unit="g")
    versions = [record_estimate(db, item).estimate_version for _ in range(3)]
    db.commit()
    assert versions == [1, 2, 3]
    current = db.scalars(select(m.NutritionEstimate).where(m.NutritionEstimate.is_current.is_(True))).all()
    assert [r.estimate_version for r in current] == [3]
