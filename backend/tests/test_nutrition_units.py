"""Quantity validation and serving / gram / millilitre conversion."""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.services.nutrition.units import (InvalidQuantityError, ServingRef, UnitConversionError, parse_quantity,
                                          resolve_mass, volume_density)

FOOD = uuid.uuid4()
SMALL = ServingRef(uuid.uuid4(), FOOD, "1 small chappatti or roti (6\")", Decimal("27.0"))
MEDIUM = ServingRef(uuid.uuid4(), FOOD, "1 medium chappatti or roti (7\")", Decimal("40.0"))
FL_OZ = ServingRef(uuid.uuid4(), FOOD, "1 fl oz", Decimal("30.5"))
CUP = ServingRef(uuid.uuid4(), FOOD, "1 cup", Decimal("244.0"))


@pytest.mark.parametrize(("value", "expected"), [
    (1, Decimal("1")), ("2.5", Decimal("2.5")), (Decimal("0.25"), Decimal("0.25")), (1.5, Decimal("1.5")),
    ("2.500", Decimal("2.5")), (" 3 ", Decimal("3")), ("10000", Decimal("10000")), ("100.00", Decimal("100")),
])
def test_valid_quantities(value: object, expected: Decimal) -> None:
    qty = parse_quantity(value)
    assert qty == expected
    assert "E" not in str(qty)


@pytest.mark.parametrize("value", [0, -1, "0.00", "-0.5", "10000.01", "1.005", "abc", "", None, True,
                                   float("nan"), float("inf"), "Infinity", "NaN", [1], 1e-9])
def test_invalid_quantities(value: object) -> None:
    with pytest.raises(InvalidQuantityError):
        parse_quantity(value)


def test_grams_are_taken_as_entered() -> None:
    mass = resolve_mass("150", "g", food_id=FOOD)
    assert mass.mass_g == Decimal("150.00") and mass.mass_source == "user_grams" and mass.serving is None


def test_serving_conversion_multiplies_reference_portion() -> None:
    mass = resolve_mass("2.5", "serving", food_id=FOOD, servings=[SMALL, MEDIUM], serving_id=MEDIUM.id)
    assert mass.mass_g == Decimal("100.00")
    assert mass.mass_source == "serving_reference" and mass.serving == MEDIUM
    assert "40.0 g" in mass.basis


def test_serving_without_choice_uses_default_or_stays_unknown() -> None:
    unknown = resolve_mass(1, "serving", food_id=FOOD, servings=[SMALL, MEDIUM])
    assert unknown.mass_g is None and unknown.mass_source == "unknown"
    assert unknown.missing_reason == "serving_not_selected"
    default = ServingRef(uuid.uuid4(), FOOD, "1 katori", Decimal("150"), is_default=True)
    chosen = resolve_mass(2, "serving", food_id=FOOD, servings=[SMALL, default])
    assert chosen.mass_g == Decimal("300.00") and chosen.serving == default


def test_serving_of_another_food_is_rejected() -> None:
    other = ServingRef(uuid.uuid4(), uuid.uuid4(), "1 bowl", Decimal("200"))
    with pytest.raises(UnitConversionError):
        resolve_mass(1, "serving", food_id=FOOD, servings=[SMALL], serving_id=other.id)
    with pytest.raises(UnitConversionError):
        resolve_mass(1, "serving", food_id=FOOD, servings=[SMALL, other], serving_id=other.id)


def test_serving_id_only_with_serving_unit() -> None:
    with pytest.raises(UnitConversionError):
        resolve_mass(100, "g", food_id=FOOD, servings=[SMALL], serving_id=SMALL.id)


def test_unsupported_unit() -> None:
    for unit in ("cup", "katori", "kg", ""):
        with pytest.raises(UnitConversionError):
            resolve_mass(1, unit, food_id=FOOD)


def test_millilitres_use_fluid_ounce_portion_density() -> None:
    density = volume_density([CUP, FL_OZ])
    assert density is not None and density[1] == FL_OZ
    mass = resolve_mass(200, "ml", food_id=FOOD, servings=[CUP, FL_OZ])
    # 200 ml x 30.5 g / 29.5735295625 ml = 206.266... g
    assert mass.mass_g == Decimal("206.27")
    assert mass.mass_source == "serving_reference" and mass.serving == FL_OZ


def test_millilitres_without_volume_reference_stay_unknown() -> None:
    # A "1 cup" portion alone is not used: for solids it describes bulk volume.
    mass = resolve_mass(200, "ml", food_id=FOOD, servings=[CUP, SMALL])
    assert mass.mass_g is None and mass.mass_source == "unknown"
    assert mass.missing_reason == "no_volume_reference"


def test_conversion_rounds_half_up_to_hundredths() -> None:
    serving = ServingRef(uuid.uuid4(), FOOD, "1 piece", Decimal("33.33"))
    assert resolve_mass("0.15", "serving", food_id=FOOD, servings=[serving],
                        serving_id=serving.id).mass_g == Decimal("5.00")  # 4.9995 -> 5.00
