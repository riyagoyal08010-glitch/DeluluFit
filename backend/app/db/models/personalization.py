"""Personalization: budgets, budget transactions, nutrition targets, recommendations."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (CheckConstraint, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index,
                        Numeric, String, UniqueConstraint, text)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import enums
from app.db.base import Base, CreatedAtMixin, TimestampMixin, enum_check, uuid_pk


class UserBudget(TimestampMixin, Base):
    __tablename__ = "user_budgets"
    __table_args__ = (
        CheckConstraint(enum_check("period", enums.BUDGET_PERIODS), name="period"),
        CheckConstraint("amount >= 0", name="amount_nonnegative"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
        CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="effective_range"),
        # At most one open-ended (active) budget per student.
        Index("uq_user_budgets_active", "user_id", unique=True, postgresql_where=text("effective_to IS NULL")),
        Index("ix_user_budgets_user_id_effective_from", "user_id", "effective_from"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    period: Mapped[str] = mapped_column(String(8), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)


class BudgetTransaction(TimestampMixin, Base):
    """Money movement. `amount` is always positive; `kind` decides the sign.

    net_spending = sum(expense amounts) - sum(refund amounts)
    """

    __tablename__ = "budget_transactions"
    __table_args__ = (
        CheckConstraint(enum_check("kind", enums.TRANSACTION_KINDS), name="kind"),
        CheckConstraint(enum_check("category", enums.SPENDING_CATEGORIES), name="category"),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
        CheckConstraint("kind = 'refund' OR refund_of_id IS NULL", name="refund_link_only_on_refunds"),
        UniqueConstraint("id", "user_id"),
        UniqueConstraint("user_id", "idempotency_key"),
        ForeignKeyConstraint(["meal_log_id", "user_id"], ["meal_logs.id", "meal_logs.user_id"],
                             name="fk_budget_transactions_meal_log_owner", deferrable=True, initially="DEFERRED"),
        ForeignKeyConstraint(["refund_of_id", "user_id"], ["budget_transactions.id", "budget_transactions.user_id"],
                             name="fk_budget_transactions_refund_owner", deferrable=True, initially="DEFERRED"),
        Index("ix_budget_transactions_user_id_occurred_on", "user_id", "occurred_on"),
        Index("ix_budget_transactions_meal_log_id", "meal_log_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    idempotency_key: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    category: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str | None] = mapped_column(String(200))
    meal_log_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    refund_of_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class NutritionTarget(TimestampMixin, Base):
    __tablename__ = "nutrition_targets"
    __table_args__ = (
        CheckConstraint(enum_check("source", enums.TARGET_SOURCES), name="source"),
        CheckConstraint("effective_to IS NULL OR effective_to >= effective_from", name="effective_range"),
        CheckConstraint("energy_kcal IS NULL OR (energy_kcal >= 500 AND energy_kcal <= 8000)", name="energy_range"),
        CheckConstraint("protein_g IS NULL OR (protein_g >= 0 AND protein_g <= 500)", name="protein_range"),
        CheckConstraint("carbohydrate_g IS NULL OR (carbohydrate_g >= 0 AND carbohydrate_g <= 1500)",
                        name="carbohydrate_range"),
        CheckConstraint("fat_g IS NULL OR (fat_g >= 0 AND fat_g <= 400)", name="fat_range"),
        CheckConstraint("fibre_g IS NULL OR (fibre_g >= 0 AND fibre_g <= 150)", name="fibre_range"),
        CheckConstraint("num_nonnulls(energy_kcal, protein_g, carbohydrate_g, fat_g, fibre_g) > 0",
                        name="at_least_one_value"),
        Index("uq_nutrition_targets_active", "user_id", unique=True, postgresql_where=text("effective_to IS NULL")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    energy_kcal: Mapped[Decimal | None] = mapped_column(Numeric(7, 1))
    protein_g: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))
    carbohydrate_g: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))
    fat_g: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))
    fibre_g: Mapped[Decimal | None] = mapped_column(Numeric(6, 1))
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(300))


class Recommendation(CreatedAtMixin, Base):
    __tablename__ = "recommendations"
    __table_args__ = (
        CheckConstraint(enum_check("kind", enums.RECOMMENDATION_KINDS), name="kind"),
        CheckConstraint("expires_at IS NULL OR expires_at > generated_at", name="expiry_after_generation"),
        CheckConstraint("estimated_cost IS NULL OR estimated_cost >= 0", name="cost_nonnegative"),
        CheckConstraint("estimated_cost IS NULL OR currency IS NOT NULL", name="cost_has_currency"),
        CheckConstraint("cardinality(reason_codes) > 0", name="has_reason"),
        Index("ix_recommendations_user_id_for_date", "user_id", "for_date"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    explanation: Mapped[str] = mapped_column(String(1000), nullable=False)
    reason_codes: Mapped[list[str]] = mapped_column(ARRAY(String(40)), nullable=False)
    caveats: Mapped[list[str]] = mapped_column(ARRAY(String(300)), nullable=False,
                                               server_default=text("'{}'::varchar[]"), default=list)
    estimated_cost: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    currency: Mapped[str | None] = mapped_column(String(3))
    menu_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_items.id", ondelete="SET NULL"))
    for_date: Mapped[date] = mapped_column(Date, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(20), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                   server_default=text("now()"))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
