"""Quantity validation and conversion of (quantity, unit) to a mass in grams.

Supported units mirror consumed_items.unit:

    g        grams entered by the student                    -> mass_source "user_grams"
    serving  quantity x a reference portion of that food      -> "serving_reference"
    ml       millilitres, only for foods with a "1 fl oz"     -> "serving_reference"
             portion (FNDDS lists those for pourable foods);
             density = portion grams / 29.5735 ml

When the mass cannot be determined (no serving chosen, no volume reference)
the result has mass_g=None and mass_source "unknown" with a reason. Nothing
is assumed: in particular "1 cup" portions are not used as a density, because
for solids (bread cubes, chopped fruit) they describe bulk volume.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Literal

Unit = Literal["g", "ml", "serving"]
MassSource = Literal["user_grams", "serving_reference", "unknown"]

UNITS: tuple[str, ...] = ("g", "ml", "serving")
# Mirrors CHECK consumed_items.quantity_range and its NUMERIC(10, 2) scale.
MAX_QUANTITY = Decimal("10000")
QUANTITY_PLACES = 2
GRAM = Decimal("0.01")
# US customary fluid ounce; FNDDS portions use US measures.
FL_OZ_ML = Decimal("29.5735295625")
VOLUME_PORTION_LABEL = "1 fl oz"


class InvalidQuantityError(ValueError):
    """The quantity is not a usable positive amount."""


class UnitConversionError(ValueError):
    """The unit or serving cannot be used for this food."""


@dataclass(frozen=True)
class ServingRef:
    id: uuid.UUID
    food_id: uuid.UUID
    label: str
    mass_g: Decimal
    is_default: bool = False


@dataclass(frozen=True)
class MassResolution:
    quantity: Decimal
    unit: Unit
    mass_g: Decimal | None
    mass_source: MassSource
    serving: ServingRef | None = None
    basis: str = ""
    missing_reason: str | None = None


def parse_quantity(value: object) -> Decimal:
    """Validate a quantity: positive, finite, at most 10000, at most 2 decimal places."""
    if isinstance(value, bool) or value is None:
        raise InvalidQuantityError("Quantity is required.")
    try:
        if isinstance(value, float):
            qty = Decimal(repr(value))
        elif isinstance(value, (int, str, Decimal)):
            qty = Decimal(value.strip() if isinstance(value, str) else value)
        else:
            raise InvalidQuantityError("Quantity must be a number.")
    except InvalidOperation:
        raise InvalidQuantityError("Quantity must be a number.") from None
    if not qty.is_finite():
        raise InvalidQuantityError("Quantity must be a finite number.")
    if qty <= 0:
        raise InvalidQuantityError("Quantity must be greater than zero.")
    if qty > MAX_QUANTITY:
        raise InvalidQuantityError(f"Quantity cannot exceed {MAX_QUANTITY}.")
    step = Decimal(1).scaleb(-QUANTITY_PLACES)
    if qty != qty.quantize(step):
        raise InvalidQuantityError("Quantity can have at most two decimal places.")
    qty = qty.quantize(step)
    # Canonical form: "2", "2.5", "2.25" (never "2.500" or "1E+2").
    return qty.to_integral_value() if qty == qty.to_integral_value() else qty.normalize()


def _grams(value: Decimal) -> Decimal:
    mass = value.quantize(GRAM, ROUND_HALF_UP)
    if mass <= 0:
        raise InvalidQuantityError("Quantity is too small to estimate.")
    return mass


def volume_density(servings: Sequence[ServingRef]) -> tuple[Decimal, ServingRef] | None:
    """Grams per millilitre from the food's "1 fl oz" portion, if it has one."""
    for s in servings:
        if s.label.strip().lower() == VOLUME_PORTION_LABEL:
            return s.mass_g / FL_OZ_ML, s
    return None


def resolve_mass(quantity: object, unit: str, *, food_id: uuid.UUID | None,
                 servings: Sequence[ServingRef] = (), serving_id: uuid.UUID | None = None) -> MassResolution:
    qty = parse_quantity(quantity)
    if unit not in UNITS:
        raise UnitConversionError(f"Unsupported unit {unit!r}; use one of {', '.join(UNITS)}.")
    for s in servings:
        if s.food_id != food_id:
            raise UnitConversionError("Serving list contains a serving of another food.")
    if serving_id is not None and unit != "serving":
        raise UnitConversionError("A serving can only be chosen when the unit is 'serving'.")

    if unit == "g":
        return MassResolution(qty, "g", _grams(qty), "user_grams", basis=f"{qty} g entered")

    if unit == "serving":
        serving: ServingRef | None
        if serving_id is not None:
            serving = next((s for s in servings if s.id == serving_id), None)
            if serving is None:
                raise UnitConversionError("That serving does not belong to this food.")
        else:
            serving = next((s for s in servings if s.is_default), None)
        if serving is None:
            return MassResolution(qty, "serving", None, "unknown", missing_reason="serving_not_selected")
        return MassResolution(qty, "serving", _grams(qty * serving.mass_g), "serving_reference", serving,
                              basis=f"{qty} x {serving.label} ({serving.mass_g} g)")

    density = volume_density(servings)
    if density is None:
        return MassResolution(qty, "ml", None, "unknown", missing_reason="no_volume_reference")
    grams_per_ml, ref = density
    return MassResolution(qty, "ml", _grams(qty * grams_per_ml), "serving_reference", ref,
                          basis=f"{qty} ml x ({ref.mass_g} g per {VOLUME_PORTION_LABEL} = {FL_OZ_ML} ml)")
