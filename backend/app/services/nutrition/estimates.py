"""Computing and persisting versioned nutrition estimates.

`compute_estimate` is pure. `record_estimate` stores the result as the next
version for a consumed item: earlier versions are kept unchanged (the
database trigger makes them immutable) and only lose their is_current flag.
Recalculating after the reference data changes therefore never rewrites
history; each version keeps pointing at the food_nutrients row it used.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.models import ConsumedItem, FoodServing, NutritionEstimate
from app.services.nutrition import catalog
from app.services.nutrition.calculator import NUTRIENTS, NutrientAmounts, NutrientProfile, scale, stored
from app.services.nutrition.confidence import Confidence, estimate_confidence
from app.services.nutrition.provenance import ENGINE_VERSION, build_snapshot
from app.services.nutrition.units import MassResolution, ServingRef

Method = Literal["per_reference_mass", "unavailable"]


@dataclass(frozen=True)
class EstimateDraft:
    method: Method
    confidence: Confidence
    amounts: NutrientAmounts
    profile: NutrientProfile | None
    reason: str | None
    snapshot: dict[str, Any]


def compute_estimate(*, match_confidence: str, mass: MassResolution,
                     profile: NutrientProfile | None) -> EstimateDraft:
    if profile is None:
        method: Method = "unavailable"
        reason: str | None = "no_reference_data"
    elif mass.mass_g is None:
        method, reason = "unavailable", mass.missing_reason or "unknown_mass"
    else:
        method, reason = "per_reference_mass", None
    if method == "unavailable":
        amounts = NutrientAmounts.no_estimate()
        conf: Confidence = "UNKNOWN"
    else:
        assert profile is not None and mass.mass_g is not None
        # Quantized to the stored precision (4 dp) so the draft equals what is persisted.
        amounts = stored(scale(profile, mass.mass_g))
        conf = estimate_confidence(match_confidence, mass.mass_source)
    snapshot = build_snapshot(match_confidence=match_confidence, mass=mass, profile=profile, amounts=amounts,
                              method=method, reason=reason)
    return EstimateDraft(method, conf, amounts, profile if method != "unavailable" else None, reason, snapshot)


def mass_from_item(db: Session, item: ConsumedItem) -> MassResolution:
    """The portion as stored on the consumed item (the item is the source of truth)."""
    serving = None
    if item.serving_id is not None:
        row = db.get(FoodServing, item.serving_id)
        if row is not None:
            serving = ServingRef(row.id, row.food_id, row.label, row.mass_g, row.is_default)
    basis = "" if item.estimated_mass_g is None else f"{item.estimated_mass_g} g recorded on the consumed item"
    return MassResolution(quantity=item.quantity, unit=item.unit, mass_g=item.estimated_mass_g,  # type: ignore[arg-type]
                          mass_source=item.mass_source, serving=serving, basis=basis,  # type: ignore[arg-type]
                          missing_reason=None if item.estimated_mass_g is not None else "unknown_mass")


def record_estimate(db: Session, item: ConsumedItem, *, mass: MassResolution | None = None) -> NutritionEstimate:
    """Calculate from the food's current reference data and store it as the item's next version.

    Flushes but does not commit, so it can be part of the caller's transaction
    (for example, logging a meal and its estimates atomically).
    """
    if mass is None:
        mass = mass_from_item(db, item)
    elif mass.mass_g != item.estimated_mass_g or mass.mass_source != item.mass_source:
        raise ValueError("The portion does not match what is stored on the consumed item.")
    profile = catalog.current_nutrient_profile(db, item.food_id) if item.food_id else None
    draft = compute_estimate(match_confidence=item.match_confidence, mass=mass, profile=profile)

    # Lock this item's estimates so concurrent recalculations cannot claim the same version.
    db.execute(select(NutritionEstimate.id).where(NutritionEstimate.consumed_item_id == item.id)
               .with_for_update())
    latest = db.scalar(select(func.max(NutritionEstimate.estimate_version))
                       .where(NutritionEstimate.consumed_item_id == item.id)) or 0
    db.execute(update(NutritionEstimate)
               .where(NutritionEstimate.consumed_item_id == item.id, NutritionEstimate.is_current.is_(True))
               .values(is_current=False)
               .execution_options(synchronize_session="fetch"))
    values: dict[str, Decimal | None] = {n: draft.amounts.values.get(n) for n in NUTRIENTS}
    row = NutritionEstimate(
        consumed_item_id=item.id, food_nutrient_id=draft.profile.food_nutrient_id if draft.profile else None,
        estimate_version=latest + 1, is_current=True, method=draft.method, engine_version=ENGINE_VERSION,
        confidence=draft.confidence, input_snapshot=draft.snapshot, **values)
    db.add(row)
    db.flush()
    return row
