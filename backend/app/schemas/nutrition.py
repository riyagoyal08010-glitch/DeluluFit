"""Shared response shapes for nutrient values, estimates and totals.

Every nutrient is reported with its status, so a client can never mistake an
unknown value for zero:

    value     stored value (4 dp) as a string, or null
    display   value rounded for presentation (kcal/mg whole, g to 0.1), or null
    status    item:   estimated | unknown | not_in_source | no_estimate
              total:  complete | incomplete | unavailable | empty
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel

from app.schemas.common import OptionalDecimalStr


class NutrientValueOut(BaseModel):
    value: OptionalDecimalStr
    display: OptionalDecimalStr
    unit: str
    status: str


class NutrientTotalOut(BaseModel):
    total: OptionalDecimalStr
    display: OptionalDecimalStr
    unit: str
    status: str
    known_items: int
    missing_items: int


class TotalsOut(BaseModel):
    item_count: int
    complete: bool
    nutrients: dict[str, NutrientTotalOut]
    note: str | None = None


class EstimateProvenanceOut(BaseModel):
    food_nutrient_id: uuid.UUID | None
    source_name: str | None
    source_reference: str | None
    source_food_id: str | None
    dataset_version: str | None
    portion_basis: str | None
    mass_source: str


class EstimateOut(BaseModel):
    version: int
    method: str
    confidence: str
    engine_version: str
    calculated_at: datetime
    reason: str | None
    nutrients: dict[str, NutrientValueOut]
    provenance: EstimateProvenanceOut
