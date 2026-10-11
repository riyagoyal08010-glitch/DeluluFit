"""Engine versioning and the input snapshot stored with every estimate.

nutrition_estimates.input_snapshot records everything the calculation used,
so an estimate can be explained and reproduced even after the reference data
or this engine changes. Bump ENGINE_VERSION whenever the arithmetic, rounding,
unit conversion or confidence rules change.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.services.nutrition.calculator import NUTRIENTS, UNITS, NutrientAmounts, NutrientProfile
from app.services.nutrition.units import MassResolution

# Stored in nutrition_estimates.engine_version (VARCHAR(20)).
ENGINE_VERSION = "nutrition-1.1.0"
SNAPSHOT_SCHEMA = 2


def _s(value: Decimal | None) -> str | None:
    return None if value is None else format(value, "f")


def build_snapshot(*, match_confidence: str, mass: MassResolution, profile: NutrientProfile | None,
                   amounts: NutrientAmounts, method: str, reason: str | None) -> dict[str, Any]:
    """JSON-safe record of one calculation (decimals as strings, ids as strings)."""
    serving = mass.serving
    return {
        "schema": SNAPSHOT_SCHEMA,
        "engine_version": ENGINE_VERSION,
        "method": method,
        "reason": reason,
        "match_confidence": match_confidence,
        "portion": {
            "quantity": _s(mass.quantity),
            "unit": mass.unit,
            "mass_g": _s(mass.mass_g),
            "mass_source": mass.mass_source,
            "basis": mass.basis or None,
            "missing_reason": mass.missing_reason,
            "serving": None if serving is None else {
                "id": str(serving.id), "label": serving.label, "mass_g": _s(serving.mass_g)},
        },
        "reference": None if profile is None else {
            "food_nutrient_id": None if profile.food_nutrient_id is None else str(profile.food_nutrient_id),
            "reference_mass_g": _s(profile.reference_mass_g),
            "values": {n: _s(profile.value(n)) for n in NUTRIENTS},
            "source_nutrients": sorted(profile.source_nutrients or ()),
            "source_name": profile.source_name,
            "source_reference": profile.source_reference,
            "source_food_id": profile.source_food_id,
            "dataset_version": profile.dataset_version,
        },
        "units": dict(UNITS),
        # Per nutrient: estimated | unknown | not_in_source | no_estimate (see calculator).
        "nutrient_status": {n: amounts.statuses[n] for n in NUTRIENTS},
        "missing_nutrients": list(amounts.missing),
    }
