from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import OptionalDecimalStr
from app.schemas.meals import MealType
from app.schemas.nutrition import NutrientValueOut

MenuStatus = Literal["processing", "failed", "needs_review", "confirmed"]
MAX_MENU_ITEMS = 120


class MenuFoodOut(BaseModel):
    id: uuid.UUID
    canonical_name: str


class MenuItemOut(BaseModel):
    id: uuid.UUID
    meal_id: uuid.UUID
    meal_type: str
    position: int
    name: str
    # "extraction" = read from the photo; "manual" = typed by the student.
    source: str
    is_user_corrected: bool
    extraction_confidence: OptionalDecimalStr
    section_heading: str | None
    serving_note: str | None
    price: OptionalDecimalStr
    food: MenuFoodOut | None
    match_confidence: str


class MenuVersionOut(BaseModel):
    id: uuid.UUID
    version_number: int
    status: str
    source: str
    meal_type_hint: str | None
    menu_date: date
    confirmed_at: datetime | None
    items: list[MenuItemOut]


class ExtractionJobOut(BaseModel):
    status: str
    attempt_count: int
    max_attempts: int
    error_code: str | None
    error_message: str | None
    started_at: datetime | None
    finished_at: datetime | None
    # From the stored, validated result (when it succeeded).
    is_menu: bool | None
    item_count: int | None
    detected_date: date | None


class ExtractionStateOut(BaseModel):
    # Whether this server has a configured provider at all.
    available: bool
    job: ExtractionJobOut | None
    can_start: bool
    can_retry: bool


class MenuImageOut(BaseModel):
    width: int | None
    height: int | None
    size_bytes: int


class MenuSummaryOut(BaseModel):
    id: uuid.UUID
    title: str
    menu_date: date
    meal_type_hint: str | None
    # One of the student's own messes (institution and hostel live on the mess), if chosen.
    mess_id: uuid.UUID | None
    status: MenuStatus
    has_draft: bool
    has_confirmed: bool
    item_count: int
    has_image: bool
    created_at: datetime
    updated_at: datetime


class MenuDetailOut(MenuSummaryOut):
    image: MenuImageOut | None
    extraction: ExtractionStateOut
    draft: MenuVersionOut | None
    confirmed: MenuVersionOut | None


class MenuListOut(BaseModel):
    items: list[MenuSummaryOut]
    total: int
    limit: int
    offset: int


class MenuItemIn(BaseModel):
    """One dish in a draft. `id` keeps an existing dish (and its provenance); omit it for a new one."""

    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=160)
    meal_type: MealType
    food_id: uuid.UUID | None = None
    price: Decimal | None = Field(default=None, ge=0, le=100000, decimal_places=2)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Enter the dish name.")
        return v


class MenuDraftIn(BaseModel):
    menu_date: date
    items: list[MenuItemIn] = Field(max_length=MAX_MENU_ITEMS)


# --- suggestions --------------------------------------------------------------------------------

class SignalOut(BaseModel):
    code: str
    text: str


class DishNutritionOut(BaseModel):
    reference_mass_g: OptionalDecimalStr
    source_name: str | None
    nutrients: dict[str, NutrientValueOut]


class DishSuggestionOut(BaseModel):
    menu_item_id: uuid.UUID
    menu_meal_id: uuid.UUID
    name: str
    meal_type: str
    section_heading: str | None
    serving_note: str | None
    source: str
    is_user_corrected: bool
    # suggested: matched your recorded likes / eating pattern; available: no signal either way;
    # check_first: something you recorded conflicts (allergen listed, avoid, eating pattern).
    group: Literal["suggested", "available", "check_first"]
    score: int
    reasons: list[SignalOut]
    cautions: list[SignalOut]
    food: MenuFoodOut | None
    diet_type: str | None
    nutrition: DishNutritionOut | None
    price: OptionalDecimalStr
    currency: str


class PersonalizationOut(BaseModel):
    personalized: bool
    based_on: list[str]
    message: str


class BudgetContextOut(BaseModel):
    has_budget: bool
    period: str | None
    remaining: OptionalDecimalStr
    currency: str


class MenuSuggestionsOut(BaseModel):
    menu_id: uuid.UUID
    menu_date: date
    status: MenuStatus
    confirmed: bool
    meal_types: list[str]
    meal_type: str | None
    rule_version: str
    personalization: PersonalizationOut
    allergy_notice: str | None
    budget: BudgetContextOut
    dishes: list[DishSuggestionOut]
