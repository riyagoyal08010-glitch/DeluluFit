from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas.common import DecimalStr
from app.schemas.nutrition import NutrientValueOut


class FoodSearchHitOut(BaseModel):
    id: uuid.UUID
    canonical_name: str
    category: str | None
    diet_type: str
    matched_name: str
    match_kind: str          # exact | prefix | words | fuzzy
    score: float             # ranking key in [0, 1]; NOT a probability (see docs)
    alias_confidence: str    # how well this food represents the matched name


class FoodSearchOut(BaseModel):
    query: str
    results: list[FoodSearchHitOut]


class MatchCandidateOut(BaseModel):
    id: uuid.UUID
    canonical_name: str
    confidence: str
    method: str
    matched_name: str


class FoodMatchOut(BaseModel):
    query: str
    status: str              # matched | needs_confirmation | unknown
    reason: str
    confidence: str
    candidates: list[MatchCandidateOut]


class ServingOut(BaseModel):
    id: uuid.UUID
    label: str
    mass_g: DecimalStr
    is_default: bool


class FoodProvenanceOut(BaseModel):
    source_name: str
    source_reference: str | None
    source_food_id: str | None
    dataset_version: str | None


class FoodDetailOut(BaseModel):
    id: uuid.UUID
    canonical_name: str
    category: str | None
    diet_type: str
    known_allergens: list[str]
    preparation_notes: str | None
    aliases: list[str]
    reference_mass_g: DecimalStr | None
    # Per reference_mass_g grams; "reported" | "unknown" | "not_in_source".
    nutrients: dict[str, NutrientValueOut]
    provenance: FoodProvenanceOut | None
    servings: list[ServingOut]
    supported_units: list[str]
    caveat: str
