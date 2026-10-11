from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Query, Response, status

from app.api.deps import Auth, DbSession
from app.schemas.common import Page
from app.schemas.meals import (DayMealsOut, MealIn, MealItemIn, MealItemUpdate, MealOut, MealUpdate,
                               RangeSummaryOut)
from app.schemas.nutrition import TotalsOut
from app.services import meal_service

router = APIRouter(tags=["meals"])


@router.post("/meals", response_model=MealOut, status_code=status.HTTP_201_CREATED)
def create_meal(body: MealIn, auth: Auth, db: DbSession, response: Response) -> MealOut:
    meal, created = meal_service.create_meal(db, auth.user.id, body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return meal


@router.get("/meals", response_model=Page[MealOut])
def list_meals(auth: Auth, db: DbSession, start: date | None = None, end: date | None = None,
               limit: int = Query(default=20, ge=1, le=100), offset: int = Query(default=0, ge=0)) -> Page[MealOut]:
    """Most recent first. Without dates this is the "recent meals" list."""
    items, total = meal_service.list_meals(db, auth.user.id, start=start, end=end, limit=limit, offset=offset)
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/meals/day", response_model=DayMealsOut)
def day(auth: Auth, db: DbSession, on: date | None = Query(default=None, alias="date")) -> DayMealsOut:
    """Meals and nutrition totals for one local date (default: today in the profile timezone)."""
    return meal_service.day(db, auth.user.id, on)


@router.get("/meals/{meal_id}", response_model=MealOut)
def get_meal(meal_id: uuid.UUID, auth: Auth, db: DbSession) -> MealOut:
    return meal_service.get_meal(db, auth.user.id, meal_id)


@router.get("/meals/{meal_id}/nutrition", response_model=TotalsOut)
def meal_nutrition(meal_id: uuid.UUID, auth: Auth, db: DbSession) -> TotalsOut:
    return meal_service.get_meal(db, auth.user.id, meal_id).totals


@router.patch("/meals/{meal_id}", response_model=MealOut)
def update_meal(meal_id: uuid.UUID, body: MealUpdate, auth: Auth, db: DbSession) -> MealOut:
    return meal_service.update_meal(db, auth.user.id, meal_id, body)


@router.delete("/meals/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meal(meal_id: uuid.UUID, auth: Auth, db: DbSession) -> Response:
    meal_service.delete_meal(db, auth.user.id, meal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/meals/{meal_id}/items", response_model=MealOut, status_code=status.HTTP_201_CREATED)
def add_item(meal_id: uuid.UUID, body: MealItemIn, auth: Auth, db: DbSession) -> MealOut:
    return meal_service.add_item(db, auth.user.id, meal_id, body)


@router.patch("/meals/{meal_id}/items/{item_id}", response_model=MealOut)
def update_item(meal_id: uuid.UUID, item_id: uuid.UUID, body: MealItemUpdate, auth: Auth, db: DbSession) -> MealOut:
    return meal_service.update_item(db, auth.user.id, meal_id, item_id, body)


@router.delete("/meals/{meal_id}/items/{item_id}", response_model=MealOut)
def delete_item(meal_id: uuid.UUID, item_id: uuid.UUID, auth: Auth, db: DbSession) -> MealOut:
    return meal_service.delete_item(db, auth.user.id, meal_id, item_id)


@router.get("/nutrition/summary", response_model=RangeSummaryOut)
def nutrition_summary(auth: Auth, db: DbSession, start: date | None = None, end: date | None = None,
                      days: int | None = Query(default=None, ge=1, le=92)) -> RangeSummaryOut:
    """Daily totals over an inclusive date range, or the last `days` days ending today (or `end`)."""
    return meal_service.summary(db, auth.user.id, start=start, end=end, days=days)
