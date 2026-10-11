from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Query

from app.api.deps import Auth, DbSession
from app.schemas.foods import FoodDetailOut, FoodMatchOut, FoodSearchOut
from app.schemas.meals import ItemPreviewOut
from app.services import food_service, meal_service

router = APIRouter(prefix="/foods", tags=["foods"])


@router.get("/search", response_model=FoodSearchOut)
def search(auth: Auth, db: DbSession, q: str = Query(min_length=1, max_length=80),
           limit: int = Query(default=10, ge=1, le=50)) -> FoodSearchOut:
    return food_service.search(db, q, limit)


@router.get("/match", response_model=FoodMatchOut)
def match(auth: Auth, db: DbSession, name: str = Query(min_length=1, max_length=160)) -> FoodMatchOut:
    """Interpret free text (e.g. a menu line). Anything but status=matched needs the student's choice."""
    return food_service.match(db, name)


@router.get("/{food_id}", response_model=FoodDetailOut)
def detail(food_id: uuid.UUID, auth: Auth, db: DbSession) -> FoodDetailOut:
    return food_service.detail(db, food_id)


@router.get("/{food_id}/estimate", response_model=ItemPreviewOut)
def estimate(food_id: uuid.UUID, auth: Auth, db: DbSession, quantity: Decimal = Query(gt=0, le=10000),
             unit: Literal["g", "ml", "serving"] = Query(), serving_id: uuid.UUID | None = None) -> ItemPreviewOut:
    """Preview the estimate for a portion before saving it. Read-only: nothing is stored."""
    return meal_service.preview_item(db, food_id, quantity=quantity, unit=unit, serving_id=serving_id)
