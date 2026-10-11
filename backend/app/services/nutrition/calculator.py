"""Proportional nutrient arithmetic with explicit unknowns.

    amount = reference_value x consumed_mass_g / reference_mass_g   (exact Decimal)

Rounding: calculations are exact. Values are quantized to 4 decimal places
only when stored (nutrition_estimates is NUMERIC(14, 4)) and rounded half-up
for display by `display_value` (kcal and mg to whole numbers, grams to 0.1).
Totals are summed from the stored 4-dp values, never from display values.

Every nutrient value carries a status, so "zero" and "unknown" can never be
confused:

    profile status (reference data)        item status (one consumed item)
    reported       value from the source   estimated       scaled from a reported value
                   (a reported 0 is a      unknown         source covers it, no value for this food
                   genuine zero)           not_in_source   the source does not provide this nutrient
    unknown        covered, no value       no_estimate     no food match or no portion, so nothing
    not_in_source  not provided at all                     was calculated
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.db.models.foods import NUTRIENT_COLUMNS

NUTRIENTS: tuple[str, ...] = NUTRIENT_COLUMNS
UNITS: dict[str, str] = {"energy_kcal": "kcal", "protein_g": "g", "carbohydrate_g": "g", "fat_g": "g",
                         "fibre_g": "g", "sugars_g": "g", "sodium_mg": "mg"}
STORAGE_PLACES = Decimal("0.0001")
_DISPLAY_STEP = {"kcal": Decimal("1"), "mg": Decimal("1"), "g": Decimal("0.1")}

ProfileStatus = Literal["reported", "unknown", "not_in_source"]
ItemStatus = Literal["estimated", "unknown", "not_in_source", "no_estimate"]
TotalStatus = Literal["complete", "incomplete", "unavailable", "empty"]


class NutritionDataError(ValueError):
    """Reference data cannot be used for calculation."""


@dataclass(frozen=True)
class NutrientProfile:
    """Nutrients per `reference_mass_g` grams of one food, with provenance.

    `source_nutrients` lists the nutrients the source provides. When omitted it
    defaults to the nutrients present as keys in `values` (a key with value
    None then means "covered but unknown").
    """

    reference_mass_g: Decimal
    values: Mapping[str, Decimal | None]
    source_nutrients: frozenset[str] | None = None
    food_nutrient_id: uuid.UUID | None = None
    source_name: str = ""
    source_reference: str | None = None
    source_food_id: str | None = None
    dataset_version: str | None = None

    def __post_init__(self) -> None:
        if not self.reference_mass_g.is_finite() or self.reference_mass_g <= 0:
            raise NutritionDataError("Reference mass must be a positive number of grams.")
        unknown = set(self.values) - set(NUTRIENTS)
        if unknown:
            raise NutritionDataError(f"Unknown nutrients: {sorted(unknown)}")
        if self.source_nutrients is None:
            object.__setattr__(self, "source_nutrients", frozenset(self.values))
        assert self.source_nutrients is not None
        if self.source_nutrients - set(NUTRIENTS):
            raise NutritionDataError(f"Unknown source nutrients: {sorted(self.source_nutrients - set(NUTRIENTS))}")
        for name, value in self.values.items():
            if value is None:
                continue
            if not value.is_finite() or value < 0:
                raise NutritionDataError(f"{name} must be a non-negative number or unknown.")
            if name not in self.source_nutrients:
                raise NutritionDataError(f"{name} has a value but is not listed as provided by the source.")

    def value(self, nutrient: str) -> Decimal | None:
        return self.values.get(nutrient)

    def status(self, nutrient: str) -> ProfileStatus:
        if self.values.get(nutrient) is not None:
            return "reported"
        assert self.source_nutrients is not None
        return "unknown" if nutrient in self.source_nutrients else "not_in_source"


@dataclass(frozen=True)
class NutrientAmounts:
    """One item's nutrients. `values[n]` is None exactly when `statuses[n]` is not "estimated"."""

    values: Mapping[str, Decimal | None]
    statuses: Mapping[str, ItemStatus]

    @classmethod
    def no_estimate(cls) -> NutrientAmounts:
        return cls({n: None for n in NUTRIENTS}, {n: "no_estimate" for n in NUTRIENTS})

    @property
    def missing(self) -> tuple[str, ...]:
        return tuple(n for n in NUTRIENTS if self.values.get(n) is None)

    @property
    def complete(self) -> bool:
        return not self.missing


def scale(profile: NutrientProfile, mass_g: Decimal) -> NutrientAmounts:
    """Exact proportional amounts for `mass_g` grams of the profile's food."""
    if not isinstance(mass_g, Decimal) or not mass_g.is_finite() or mass_g <= 0:
        raise ValueError("Mass must be a positive number of grams.")
    values: dict[str, Decimal | None] = {}
    statuses: dict[str, ItemStatus] = {}
    for n in NUTRIENTS:
        v = profile.value(n)
        values[n] = None if v is None else v * mass_g / profile.reference_mass_g
        status = profile.status(n)
        statuses[n] = "estimated" if status == "reported" else status
    return NutrientAmounts(values, statuses)


def for_storage(value: Decimal | None) -> Decimal | None:
    return None if value is None else value.quantize(STORAGE_PLACES, ROUND_HALF_UP)


def stored(amounts: NutrientAmounts) -> NutrientAmounts:
    """The amounts exactly as they will be persisted (4 decimal places)."""
    return NutrientAmounts({n: for_storage(v) for n, v in amounts.values.items()}, dict(amounts.statuses))


def display_value(nutrient: str, value: Decimal | None) -> Decimal | None:
    """Round for presentation: kcal and mg to whole numbers, grams to one decimal place."""
    if value is None:
        return None
    return value.quantize(_DISPLAY_STEP[UNITS[nutrient]], ROUND_HALF_UP)


@dataclass(frozen=True)
class NutrientTotal:
    nutrient: str
    unit: str
    # Sum of the known values; None when no item has a known value (never a fake 0).
    total: Decimal | None
    known_items: int
    missing_items: int
    status: TotalStatus

    @property
    def is_lower_bound(self) -> bool:
        return self.status == "incomplete"


@dataclass(frozen=True)
class NutrientTotals:
    item_count: int
    nutrients: Mapping[str, NutrientTotal] = field(default_factory=dict)

    def __getitem__(self, nutrient: str) -> NutrientTotal:
        return self.nutrients[nutrient]

    @property
    def complete(self) -> bool:
        return all(t.status in ("complete", "empty") for t in self.nutrients.values())


def total(items: Iterable[NutrientAmounts | None]) -> NutrientTotals:
    """Sum known amounts per nutrient. `None` stands for an item with no estimate at all.

    status: empty (no items), complete (every item known), incomplete (some
    known, some missing: the total is a lower bound), unavailable (no item
    known: the total is None).
    """
    rows = [NutrientAmounts.no_estimate() if i is None else i for i in items]
    out: dict[str, NutrientTotal] = {}
    for n in NUTRIENTS:
        known: list[Decimal] = [v for r in rows if (v := r.values.get(n)) is not None]
        missing = len(rows) - len(known)
        if not rows:
            status: TotalStatus = "empty"
        elif not known:
            status = "unavailable"
        elif missing:
            status = "incomplete"
        else:
            status = "complete"
        value = sum(known, Decimal(0)) if known else None
        out[n] = NutrientTotal(n, UNITS[n], value, len(known), missing, status)
    return NutrientTotals(len(rows), out)
