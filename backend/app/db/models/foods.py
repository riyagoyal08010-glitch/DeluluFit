"""Food reference data with provenance: foods, aliases, nutrients, servings."""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import (Boolean, CheckConstraint, ForeignKey, Index, Numeric, String, Text,
                        UniqueConstraint, text)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import enums
from app.db.base import Base, CreatedAtMixin, TimestampMixin, enum_check, uuid_pk

NUTRIENT_COLUMNS = ("energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g")


class Food(TimestampMixin, Base):
    __tablename__ = "foods"
    __table_args__ = (
        UniqueConstraint("normalized_name"),
        CheckConstraint(enum_check("diet_type", enums.DIET_TYPES), name="diet_type"),
        CheckConstraint("length(btrim(canonical_name)) > 0", name="name_nonempty"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    canonical_name: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str | None] = mapped_column(String(60))
    preparation_notes: Mapped[str | None] = mapped_column(Text)
    diet_type: Mapped[str] = mapped_column(String(16), nullable=False, server_default="unknown", default="unknown")
    # Allergens known to be present in the reference recipe. This is never a
    # guarantee about a specific mess dish: the UI always asks students to verify.
    known_allergens: Mapped[list[str]] = mapped_column(ARRAY(String(16)), nullable=False,
                                                       server_default=text("'{}'::varchar[]"), default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)

    aliases: Mapped[list[FoodAlias]] = relationship(back_populates="food", passive_deletes=True)
    servings: Mapped[list[FoodServing]] = relationship(back_populates="food", passive_deletes=True)


class FoodAlias(CreatedAtMixin, Base):
    __tablename__ = "food_aliases"
    __table_args__ = (
        UniqueConstraint("normalized_alias"),
        CheckConstraint("confidence IN ('HIGH', 'MEDIUM', 'LOW')", name="confidence"),
        Index("ix_food_aliases_food_id", "food_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    food_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="CASCADE"), nullable=False)
    alias: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_alias: Mapped[str] = mapped_column(String(160), nullable=False)
    language: Mapped[str | None] = mapped_column(String(32))
    # How well the reference food represents what this name usually means.
    # e.g. "rajma" -> cooked kidney beans is an approximation (MEDIUM).
    confidence: Mapped[str] = mapped_column(String(8), nullable=False, server_default="HIGH", default="HIGH")

    food: Mapped[Food] = relationship(back_populates="aliases")


class FoodNutrient(CreatedAtMixin, Base):
    """One versioned nutrient profile for a food, per `reference_mass_g` grams.

    Rows are immutable (enforced by trigger); a data update inserts a new row
    and flips `is_current`. Historical estimates keep pointing at the row they
    were calculated from. NULL means "unknown", never zero.
    """

    __tablename__ = "food_nutrients"
    __table_args__ = (
        CheckConstraint("reference_mass_g > 0", name="reference_mass_positive"),
        *[CheckConstraint(f"{c} IS NULL OR {c} >= 0", name=f"{c}_nonnegative") for c in NUTRIENT_COLUMNS],
        CheckConstraint("length(btrim(source_name)) > 0", name="source_required"),
        Index("uq_food_nutrients_current", "food_id", unique=True, postgresql_where=text("is_current")),
        Index("ix_food_nutrients_food_id", "food_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    food_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="RESTRICT"), nullable=False)
    reference_mass_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False, server_default="100")
    energy_kcal: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    protein_g: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    carbohydrate_g: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    fat_g: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    fibre_g: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    source_name: Mapped[str] = mapped_column(String(120), nullable=False)
    source_reference: Mapped[str | None] = mapped_column(String(300))
    dataset_version: Mapped[str | None] = mapped_column(String(60))
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)


class FoodServing(CreatedAtMixin, Base):
    __tablename__ = "food_servings"
    __table_args__ = (
        CheckConstraint("mass_g > 0", name="mass_positive"),
        UniqueConstraint("food_id", "label"),
        # Lets consumed_items prove a serving belongs to the logged food.
        UniqueConstraint("id", "food_id"),
        Index("uq_food_servings_default", "food_id", unique=True, postgresql_where=text("is_default")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    food_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    mass_g: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"), default=False)
    source_name: Mapped[str] = mapped_column(String(120), nullable=False)
    source_reference: Mapped[str | None] = mapped_column(String(300))

    food: Mapped[Food] = relationship(back_populates="servings")
