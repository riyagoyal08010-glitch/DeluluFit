"""Food search, free-text matching and food details for the API."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.db.models import Food, FoodAlias, FoodNutrient
from app.schemas.foods import (FoodDetailOut, FoodMatchOut, FoodProvenanceOut, FoodSearchHitOut, FoodSearchOut,
                               MatchCandidateOut, ServingOut)
from app.schemas.nutrition import NutrientValueOut
from app.services.nutrition import catalog
from app.services.nutrition.calculator import NUTRIENTS, UNITS, display_value, for_storage
from app.services.nutrition.units import volume_density

CAVEAT = ("Values describe the reference food from the source dataset, not a specific mess recipe. "
          "Preparation, oil and portion size can differ.")


def search(db: Session, query: str, limit: int) -> FoodSearchOut:
    hits = catalog.load_food_index(db).search(query, limit)
    foods = {f.id: f for f in db.scalars(select(Food).where(Food.id.in_([h.food_id for h in hits])))}
    return FoodSearchOut(query=query, results=[
        FoodSearchHitOut(id=h.food_id, canonical_name=h.canonical_name, category=foods[h.food_id].category,
                         diet_type=foods[h.food_id].diet_type, matched_name=h.matched_key, match_kind=h.kind,
                         score=h.score, alias_confidence=h.alias_confidence)
        for h in hits])


def match(db: Session, name: str) -> FoodMatchOut:
    result = catalog.load_food_index(db).match(name)
    return FoodMatchOut(query=name, status=result.status, reason=result.reason, confidence=result.confidence,
                        candidates=[MatchCandidateOut(id=c.food_id, canonical_name=c.canonical_name,
                                                      confidence=c.confidence, method=c.method,
                                                      matched_name=c.matched_key) for c in result.candidates])


def detail(db: Session, food_id: uuid.UUID) -> FoodDetailOut:
    food = db.get(Food, food_id)
    if food is None or not food.is_active:
        raise NotFoundError("Food not found.")
    row = db.scalar(select(FoodNutrient).where(FoodNutrient.food_id == food.id, FoodNutrient.is_current.is_(True)))
    profile = catalog.profile_from_row(row) if row else None
    nutrients = {}
    for n in NUTRIENTS:
        value = profile.value(n) if profile else None
        nutrients[n] = NutrientValueOut(value=for_storage(value), display=display_value(n, value), unit=UNITS[n],
                                        status=profile.status(n) if profile else "not_in_source")
    servings = catalog.food_servings(db, food.id)
    aliases = sorted(db.scalars(select(FoodAlias.alias).where(FoodAlias.food_id == food.id)))
    units = ["g", "serving"] + (["ml"] if volume_density(servings) else [])
    return FoodDetailOut(
        id=food.id, canonical_name=food.canonical_name, category=food.category, diet_type=food.diet_type,
        known_allergens=list(food.known_allergens), preparation_notes=food.preparation_notes, aliases=aliases,
        reference_mass_g=row.reference_mass_g if row else None, nutrients=nutrients,
        provenance=FoodProvenanceOut(source_name=row.source_name, source_reference=row.source_reference,
                                     source_food_id=row.source_food_id, dataset_version=row.dataset_version)
        if row else None,
        servings=[ServingOut(id=s.id, label=s.label, mass_g=s.mass_g, is_default=s.is_default) for s in servings],
        supported_units=units, caveat=CAVEAT)
