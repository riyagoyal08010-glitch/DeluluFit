"""Actual consumption: meal_logs, consumed_items, nutrition_estimates.

A menu describes planned availability; these tables record what a student
actually ate. Nothing here is created implicitly from a menu.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (Boolean, CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint,
                        Index, Integer, Numeric, String, UniqueConstraint, text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import enums
from app.db.base import Base, TimestampMixin, enum_check, uuid_pk


class MealLog(TimestampMixin, Base):
    __tablename__ = "meal_logs"
    __table_args__ = (
        CheckConstraint(enum_check("meal_type", enums.MEAL_TYPES), name="meal_type"),
        CheckConstraint(enum_check("source", enums.MEAL_LOG_SOURCES), name="source"),
        CheckConstraint("source <> 'mess_menu' OR menu_meal_id IS NOT NULL", name="mess_source_has_menu_meal"),
        # Duplicate-submission protection for one-tap logging and retries.
        UniqueConstraint("user_id", "idempotency_key"),
        UniqueConstraint("id", "user_id"),
        UniqueConstraint("id", "menu_meal_id"),
        Index("ix_meal_logs_user_id_log_date", "user_id", "log_date"),
        Index("ix_meal_logs_menu_meal_id", "menu_meal_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    idempotency_key: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    meal_type: Mapped[str] = mapped_column(String(10), nullable=False)
    source: Mapped[str] = mapped_column(String(10), nullable=False)
    consumed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Calendar date in the student's timezone, used for daily summaries.
    log_date: Mapped[date] = mapped_column(Date, nullable=False)
    menu_meal_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_meals.id", deferrable=True, initially="DEFERRED"))
    location_note: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(String(500))

    items: Mapped[list[ConsumedItem]] = relationship(
        back_populates="meal_log", passive_deletes=True, order_by="ConsumedItem.position",
        foreign_keys="ConsumedItem.meal_log_id")


class ConsumedItem(TimestampMixin, Base):
    __tablename__ = "consumed_items"
    __table_args__ = (
        CheckConstraint("quantity > 0 AND quantity <= 10000", name="quantity_range"),
        CheckConstraint(enum_check("unit", enums.CONSUMED_UNITS), name="unit"),
        CheckConstraint(enum_check("mass_source", enums.MASS_SOURCES), name="mass_source"),
        CheckConstraint(enum_check("match_confidence", enums.CONFIDENCE_LEVELS), name="match_confidence"),
        CheckConstraint("estimated_mass_g IS NULL OR estimated_mass_g > 0", name="mass_positive"),
        CheckConstraint("(estimated_mass_g IS NULL) = (mass_source = 'unknown')", name="mass_source_consistent"),
        CheckConstraint("serving_id IS NULL OR unit = 'serving'", name="serving_only_for_serving_unit"),
        CheckConstraint("menu_item_id IS NULL OR menu_meal_id IS NOT NULL", name="menu_item_requires_meal"),
        CheckConstraint("length(btrim(display_name)) > 0", name="display_name_nonempty"),
        CheckConstraint("position >= 0", name="position_nonnegative"),
        # Integrity rule 5: the consumed menu item belongs to the menu meal of the
        # meal log. Two composite FKs pin both sides of that relationship.
        ForeignKeyConstraint(["meal_log_id", "menu_meal_id"], ["meal_logs.id", "meal_logs.menu_meal_id"],
                             name="fk_consumed_items_log_menu_meal", deferrable=True, initially="DEFERRED"),
        ForeignKeyConstraint(["menu_item_id", "menu_meal_id"], ["menu_items.id", "menu_items.meal_id"],
                             name="fk_consumed_items_menu_item_meal", deferrable=True, initially="DEFERRED"),
        # A serving definition must belong to the matched food.
        ForeignKeyConstraint(["serving_id", "food_id"], ["food_servings.id", "food_servings.food_id"],
                             name="fk_consumed_items_serving_food"),
        Index("ix_consumed_items_meal_log_id", "meal_log_id"),
        Index("ix_consumed_items_food_id", "food_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    meal_log_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meal_logs.id", ondelete="CASCADE"), nullable=False)
    menu_meal_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    menu_item_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="RESTRICT"))
    serving_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    position: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(8), nullable=False)
    estimated_mass_g: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    mass_source: Mapped[str] = mapped_column(String(20), nullable=False)
    match_confidence: Mapped[str] = mapped_column(String(8), nullable=False)
    is_user_corrected: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"),
                                                    default=False)

    meal_log: Mapped[MealLog] = relationship(back_populates="items", foreign_keys=[meal_log_id])
    estimates: Mapped[list[NutritionEstimate]] = relationship(
        back_populates="consumed_item", passive_deletes=True, order_by="NutritionEstimate.estimate_version")


class NutritionEstimate(Base):
    """Immutable, versioned nutrition estimate for one consumed item."""

    __tablename__ = "nutrition_estimates"
    __table_args__ = (
        CheckConstraint(enum_check("method", enums.ESTIMATE_METHODS), name="method"),
        CheckConstraint(enum_check("confidence", enums.CONFIDENCE_LEVELS), name="confidence"),
        CheckConstraint("estimate_version >= 1", name="estimate_version_positive"),
        CheckConstraint("method <> 'per_reference_mass' OR food_nutrient_id IS NOT NULL",
                        name="reference_method_has_source"),
        *[CheckConstraint(f"{c} IS NULL OR {c} >= 0", name=f"{c}_nonnegative")
          for c in ("energy_kcal", "protein_g", "carbohydrate_g", "fat_g", "fibre_g")],
        UniqueConstraint("consumed_item_id", "estimate_version"),
        Index("uq_nutrition_estimates_current", "consumed_item_id", unique=True,
              postgresql_where=text("is_current")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    consumed_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("consumed_items.id", ondelete="CASCADE"), nullable=False)
    food_nutrient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("food_nutrients.id", ondelete="RESTRICT"))
    estimate_version: Mapped[int] = mapped_column(Integer, nullable=False)
    is_current: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    method: Mapped[str] = mapped_column(String(24), nullable=False)
    engine_version: Mapped[str] = mapped_column(String(20), nullable=False)
    confidence: Mapped[str] = mapped_column(String(8), nullable=False)
    energy_kcal: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    protein_g: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    carbohydrate_g: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    fat_g: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    fibre_g: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    input_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    calculated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                    server_default=text("now()"))

    consumed_item: Mapped[ConsumedItem] = relationship(back_populates="estimates")
