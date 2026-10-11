from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import OptionalDecimalStr, ORMModel

ActivityLevel = Literal["sedentary", "light", "moderate", "active", "very_active"]
DietaryPattern = Literal["vegetarian", "eggetarian", "non_vegetarian", "vegan", "jain", "no_preference"]
PreferenceKind = Literal["like", "dislike", "avoid"]
Allergen = Literal["peanut", "tree_nut", "milk", "egg", "wheat_gluten", "soy", "fish", "shellfish", "sesame",
                   "mustard", "other"]
Severity = Literal["mild", "moderate", "severe", "unknown"]
TargetSource = Literal["reference_estimate", "self_set", "professional"]


def _require_text(value: str) -> str:
    """Collapse whitespace and reject names that are blank once trimmed."""
    value = " ".join(value.split())
    if not value:
        raise ValueError("Enter a name.")
    return value


class ProfileUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    height_cm: Decimal | None = Field(default=None, ge=50, le=272, decimal_places=1)
    weight_kg: Decimal | None = Field(default=None, ge=20, le=400, decimal_places=1)
    activity_level: ActivityLevel | None = None
    dietary_pattern: DietaryPattern = "no_preference"
    currency: str = Field(default="INR", pattern=r"^[A-Z]{3}$")
    timezone: str = "Asia/Kolkata"
    institution_id: uuid.UUID | None = None
    hostel_id: uuid.UUID | None = None
    onboarding_step: int | None = Field(default=None, ge=0, le=10)

    @field_validator("display_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("Display name is required.")
        return v

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Unknown timezone.") from exc
        return v

    @model_validator(mode="after")
    def _hostel_needs_institution(self) -> ProfileUpdate:
        if self.hostel_id and not self.institution_id:
            raise ValueError("Select an institution before choosing a hostel.")
        return self


class ProfileOut(ORMModel):
    display_name: str
    height_cm: OptionalDecimalStr
    weight_kg: OptionalDecimalStr
    activity_level: str | None
    dietary_pattern: str
    currency: str
    timezone: str
    institution_id: uuid.UUID | None
    hostel_id: uuid.UUID | None
    onboarding_step: int
    onboarding_completed_at: datetime | None


class PreferenceIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    preference: PreferenceKind


class PreferenceOut(ORMModel):
    id: uuid.UUID
    label: str
    preference: str
    food_id: uuid.UUID | None


class AllergyIn(BaseModel):
    allergen: Allergen
    custom_label: str | None = Field(default=None, max_length=80)
    severity: Severity = "unknown"
    notes: str | None = Field(default=None, max_length=280)

    @model_validator(mode="after")
    def _other_label(self) -> AllergyIn:
        if self.allergen == "other" and not (self.custom_label and self.custom_label.strip()):
            raise ValueError("Describe the allergy when choosing 'other'.")
        if self.allergen != "other":
            self.custom_label = None
        return self


class AllergyOut(ORMModel):
    id: uuid.UUID
    allergen: str
    custom_label: str | None
    severity: str
    notes: str | None


class PreferencesReplace(BaseModel):
    items: list[PreferenceIn] = Field(max_length=100)


class AllergiesReplace(BaseModel):
    items: list[AllergyIn] = Field(max_length=30)


class InstitutionIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    city: str | None = Field(default=None, max_length=80)
    state: str | None = Field(default=None, max_length=80)


class InstitutionOut(ORMModel):
    id: uuid.UUID
    name: str
    city: str | None
    state: str | None


class HostelIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    _name = field_validator("name")(_require_text)


class HostelOut(ORMModel):
    id: uuid.UUID
    institution_id: uuid.UUID
    name: str


class MessIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    _name = field_validator("name")(_require_text)
    institution_id: uuid.UUID | None = None
    hostel_id: uuid.UUID | None = None


class MessOut(ORMModel):
    id: uuid.UUID
    name: str
    institution_id: uuid.UUID | None
    hostel_id: uuid.UUID | None


class TargetIn(BaseModel):
    source: TargetSource
    energy_kcal: Decimal | None = Field(default=None, ge=500, le=8000)
    protein_g: Decimal | None = Field(default=None, ge=0, le=500)
    carbohydrate_g: Decimal | None = Field(default=None, ge=0, le=1500)
    fat_g: Decimal | None = Field(default=None, ge=0, le=400)
    fibre_g: Decimal | None = Field(default=None, ge=0, le=150)
    effective_from: date | None = None
    notes: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _at_least_one(self) -> TargetIn:
        if all(v is None for v in (self.energy_kcal, self.protein_g, self.carbohydrate_g, self.fat_g,
                                   self.fibre_g)):
            raise ValueError("Enter at least one target value.")
        return self


class TargetOut(ORMModel):
    id: uuid.UUID
    source: str
    energy_kcal: OptionalDecimalStr
    protein_g: OptionalDecimalStr
    carbohydrate_g: OptionalDecimalStr
    fat_g: OptionalDecimalStr
    fibre_g: OptionalDecimalStr
    effective_from: date
    effective_to: date | None
    notes: str | None


class ProfileBundle(BaseModel):
    profile: ProfileOut | None
    preferences: list[PreferenceOut]
    allergies: list[AllergyOut]
    institution: InstitutionOut | None
    hostel: HostelOut | None
    active_target: TargetOut | None
