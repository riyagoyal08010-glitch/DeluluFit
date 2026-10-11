"""Read access to reference foods for the nutrition engine."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Food, FoodAlias, FoodNutrient, FoodServing
from app.services.nutrition.calculator import NUTRIENTS, NutrientProfile
from app.services.nutrition.matching import FoodEntry, FoodIndex
from app.services.nutrition.units import ServingRef


def load_food_index(db: Session) -> FoodIndex:
    """Index of active foods and their aliases."""
    foods = db.execute(select(Food.id, Food.canonical_name, Food.normalized_name)
                       .where(Food.is_active.is_(True))).all()
    aliases: dict[uuid.UUID, dict[str, str]] = {}
    for food_id, key, conf in db.execute(
            select(FoodAlias.food_id, FoodAlias.normalized_alias, FoodAlias.confidence)
            .join(Food, Food.id == FoodAlias.food_id).where(Food.is_active.is_(True))):
        aliases.setdefault(food_id, {})[key] = conf
    return FoodIndex(FoodEntry(fid, name, norm, aliases.get(fid, {})) for fid, name, norm in foods)


def profile_from_row(row: FoodNutrient) -> NutrientProfile:
    return NutrientProfile(reference_mass_g=row.reference_mass_g,
                           values={n: getattr(row, n) for n in NUTRIENTS},
                           source_nutrients=frozenset(row.source_nutrients),
                           food_nutrient_id=row.id, source_name=row.source_name,
                           source_reference=row.source_reference, source_food_id=row.source_food_id,
                           dataset_version=row.dataset_version)


def current_nutrient_profile(db: Session, food_id: uuid.UUID) -> NutrientProfile | None:
    row = db.scalar(select(FoodNutrient).where(FoodNutrient.food_id == food_id, FoodNutrient.is_current.is_(True)))
    return None if row is None else profile_from_row(row)


def food_servings(db: Session, food_id: uuid.UUID) -> list[ServingRef]:
    rows = db.scalars(select(FoodServing).where(FoodServing.food_id == food_id)
                      .order_by(FoodServing.mass_g, FoodServing.label))
    return [ServingRef(r.id, r.food_id, r.label, r.mass_g, r.is_default) for r in rows]
