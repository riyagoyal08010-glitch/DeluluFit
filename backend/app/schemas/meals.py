from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.db import enums
from app.schemas.common import DecimalStr, OptionalDecimalStr
from app.schemas.nutrition import EstimateOut, EstimateProvenanceOut, NutrientValueOut, TotalsOut

MealType = Literal["breakfast", "lunch", "snacks", "dinner", "other"]
UnitLit = Literal["g", "ml", "serving"]
MAX_ITEMS_PER_MEAL = 30
assert set(MealType.__args__) == set(enums.MEAL_TYPES)  # type: ignore[attr-defined]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())
    return value or None


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Include a timezone offset, e.g. 2026-10-11T08:30:00+05:30.")
    return value


class MealItemIn(BaseModel):
    """One food. Send `food_id` for a food the student selected from search, or only
    `display_name` for a manual item the dataset could not identify (its nutrition
    is then recorded as unknown, never guessed)."""

    food_id: uuid.UUID | None = None
    display_name: str | None = Field(default=None, max_length=160)
    quantity: Decimal = Field(gt=0, le=10000)
    unit: UnitLit
    serving_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=280)
    # The dish on the meal's menu (`MealIn.menu_meal_id`) this item is, when logged from a menu.
    menu_item_id: uuid.UUID | None = None

    _names = field_validator("display_name", "note")(_clean)

    @model_validator(mode="after")
    def _identify(self) -> MealItemIn:
        if self.food_id is None and not self.display_name:
            raise ValueError("Choose a food or enter its name.")
        if self.serving_id is not None and self.unit != "serving":
            raise ValueError("A serving can only be chosen when the unit is 'serving'.")
        return self


class MealItemUpdate(BaseModel):
    """Partial update. Changing the food, quantity, unit or serving recalculates the
    estimate as a new version; earlier versions are kept."""

    food_id: uuid.UUID | None = None
    display_name: str | None = Field(default=None, max_length=160)
    quantity: Decimal | None = Field(default=None, gt=0, le=10000)
    unit: UnitLit | None = None
    serving_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=280)

    _names = field_validator("display_name", "note")(_clean)


class MealIn(BaseModel):
    meal_type: MealType
    consumed_at: datetime
    note: str | None = Field(default=None, max_length=500)
    location_note: str | None = Field(default=None, max_length=120)
    # Optional client-generated key: resending the same request returns the original meal.
    idempotency_key: uuid.UUID | None = None
    # Set when the student logs what they ate from a confirmed menu meal; the meal's source
    # becomes "mess_menu". Viewing a menu never creates a meal.
    menu_meal_id: uuid.UUID | None = None
    items: list[MealItemIn] = Field(default_factory=list, max_length=MAX_ITEMS_PER_MEAL)

    _at = field_validator("consumed_at")(_aware)
    _texts = field_validator("note", "location_note")(_clean)

    @model_validator(mode="after")
    def _menu_links(self) -> MealIn:
        if self.menu_meal_id is None and any(i.menu_item_id for i in self.items):
            raise ValueError("A menu dish can only be logged together with its menu meal.")
        return self


class MealUpdate(BaseModel):
    meal_type: MealType | None = None
    consumed_at: datetime | None = None
    note: str | None = Field(default=None, max_length=500)
    location_note: str | None = Field(default=None, max_length=120)

    _texts = field_validator("note", "location_note")(_clean)

    @field_validator("consumed_at")
    @classmethod
    def _at(cls, value: datetime | None) -> datetime | None:
        return None if value is None else _aware(value)


class ItemFoodOut(BaseModel):
    id: uuid.UUID
    canonical_name: str


class ItemServingOut(BaseModel):
    id: uuid.UUID
    label: str
    mass_g: DecimalStr


class MealItemOut(BaseModel):
    id: uuid.UUID
    position: int
    display_name: str
    food: ItemFoodOut | None
    is_manual: bool          # true when no dataset food is linked
    quantity: DecimalStr
    unit: str
    serving: ItemServingOut | None
    estimated_mass_g: OptionalDecimalStr
    mass_source: str
    match_confidence: str
    note: str | None
    estimate: EstimateOut | None
    created_at: datetime
    updated_at: datetime


class MealOut(BaseModel):
    id: uuid.UUID
    meal_type: str
    source: str
    consumed_at: datetime
    log_date: date
    note: str | None
    location_note: str | None
    items: list[MealItemOut]
    totals: TotalsOut
    created_at: datetime
    updated_at: datetime


class DayMealsOut(BaseModel):
    date: date
    meals: list[MealOut]
    totals: TotalsOut


class DayTotalsOut(BaseModel):
    date: date
    meal_count: int
    totals: TotalsOut


class RangeSummaryOut(BaseModel):
    start: date
    end: date
    days: list[DayTotalsOut]
    totals: TotalsOut
    days_with_meals: int


class ItemPreviewOut(BaseModel):
    """What an item would be estimated as if saved now. Nothing is stored."""

    food: ItemFoodOut
    quantity: DecimalStr
    unit: str
    serving: ItemServingOut | None
    estimated_mass_g: OptionalDecimalStr
    mass_source: str
    match_confidence: str
    method: str
    confidence: str
    reason: str | None
    nutrients: dict[str, NutrientValueOut]
    provenance: EstimateProvenanceOut
