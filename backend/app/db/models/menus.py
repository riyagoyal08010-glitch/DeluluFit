"""Menu pipeline: uploads, extraction jobs, menus, versions, days, meals, items."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey,
                        ForeignKeyConstraint, Index, Integer, Numeric, String, Text, UniqueConstraint,
                        text)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import enums
from app.db.base import Base, CreatedAtMixin, TimestampMixin, enum_check, uuid_pk


class MenuUpload(CreatedAtMixin, Base):
    """Metadata for a privately stored menu image. The binary lives in object storage."""

    __tablename__ = "menu_uploads"
    __table_args__ = (
        CheckConstraint(enum_check("content_type", enums.UPLOAD_CONTENT_TYPES), name="content_type"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="sha256_hex"),
        UniqueConstraint("storage_key"),
        UniqueConstraint("id", "user_id"),
        UniqueConstraint("user_id", "sha256"),
        Index("ix_menu_uploads_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(200), nullable=False)
    original_filename: Mapped[str | None] = mapped_column(String(120))
    content_type: Mapped[str] = mapped_column(String(32), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    width_px: Mapped[int | None] = mapped_column(Integer)
    height_px: Mapped[int | None] = mapped_column(Integer)


class MenuExtractionJob(TimestampMixin, Base):
    __tablename__ = "menu_extraction_jobs"
    __table_args__ = (
        CheckConstraint(enum_check("status", enums.EXTRACTION_STATUSES), name="status"),
        CheckConstraint("attempt_count >= 0", name="attempt_count_nonnegative"),
        CheckConstraint("status <> 'succeeded' OR result IS NOT NULL", name="succeeded_has_result"),
        # Provenance: the job's owner is the upload's owner (integrity rule 4).
        ForeignKeyConstraint(["upload_id", "user_id"], ["menu_uploads.id", "menu_uploads.user_id"],
                             ondelete="CASCADE", name="fk_menu_extraction_jobs_upload_owner"),
        UniqueConstraint("id", "upload_id"),
        Index("ix_menu_extraction_jobs_upload_id", "upload_id"),
        Index("ix_menu_extraction_jobs_user_id", "user_id"),
        Index("ix_menu_extraction_jobs_queue", "status", "available_at",
              postgresql_where=text("status IN ('queued', 'processing')")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    upload_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False, server_default="queued", default="queued")
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    model: Mapped[str | None] = mapped_column(String(80))
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                   server_default=text("now()"))
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_code: Mapped[str | None] = mapped_column(String(60))
    error_message: Mapped[str | None] = mapped_column(String(500))
    # Normalized, schema-validated structure (dates -> meals -> items). Raw
    # provider payloads are not persisted.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSONB)


class MessMenu(TimestampMixin, Base):
    __tablename__ = "mess_menus"
    __table_args__ = (
        CheckConstraint("length(btrim(title)) > 0", name="title_nonempty"),
        UniqueConstraint("id", "user_id"),
        ForeignKeyConstraint(["mess_id", "user_id"], ["messes.id", "messes.user_id"],
                             name="fk_mess_menus_mess_owner"),
        # The current version must belong to this menu (integrity rule 3).
        # Deferred because menu and first version reference each other.
        ForeignKeyConstraint(["current_version_id", "id"], ["menu_versions.id", "menu_versions.menu_id"],
                             name="fk_mess_menus_current_version", deferrable=True, initially="DEFERRED",
                             use_alter=True),
        Index("ix_mess_menus_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    mess_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))

    versions: Mapped[list[MenuVersion]] = relationship(
        back_populates="menu", foreign_keys="MenuVersion.menu_id", passive_deletes=True,
        order_by="MenuVersion.version_number")


class MenuVersion(CreatedAtMixin, Base):
    """A snapshot of a menu. Once confirmed it is immutable (enforced by triggers)."""

    __tablename__ = "menu_versions"
    __table_args__ = (
        CheckConstraint(enum_check("status", enums.MENU_VERSION_STATUSES), name="status"),
        CheckConstraint(enum_check("source", enums.MENU_VERSION_SOURCES), name="source"),
        CheckConstraint("version_number >= 1", name="version_number_positive"),
        CheckConstraint("(status = 'confirmed') = (confirmed_at IS NOT NULL)", name="confirmed_at_matches_status"),
        CheckConstraint("extraction_job_id IS NULL OR upload_id IS NOT NULL", name="job_requires_upload"),
        CheckConstraint("source <> 'extraction' OR extraction_job_id IS NOT NULL", name="extraction_has_job"),
        UniqueConstraint("menu_id", "version_number"),
        UniqueConstraint("id", "menu_id"),
        # Provenance: the job must have processed exactly this upload (rule 4).
        ForeignKeyConstraint(["extraction_job_id", "upload_id"],
                             ["menu_extraction_jobs.id", "menu_extraction_jobs.upload_id"],
                             name="fk_menu_versions_job_upload"),
        ForeignKeyConstraint(["upload_id"], ["menu_uploads.id"], name="fk_menu_versions_upload_id_menu_uploads"),
        ForeignKeyConstraint(["based_on_version_id", "menu_id"], ["menu_versions.id", "menu_versions.menu_id"],
                             name="fk_menu_versions_based_on"),
        Index("uq_menu_versions_one_draft", "menu_id", unique=True, postgresql_where=text("status = 'draft'")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    menu_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("mess_menus.id", ondelete="CASCADE"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="draft", default="draft")
    source: Mapped[str] = mapped_column(String(12), nullable=False)
    upload_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    extraction_job_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    based_on_version_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(String(500))

    menu: Mapped[MessMenu] = relationship(back_populates="versions", foreign_keys=[menu_id])
    days: Mapped[list[MenuDay]] = relationship(back_populates="version", passive_deletes=True,
                                               order_by="MenuDay.menu_date")


class MenuDay(Base):
    __tablename__ = "menu_days"
    __table_args__ = (
        UniqueConstraint("version_id", "menu_date"),
        Index("ix_menu_days_menu_date", "menu_date"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_versions.id", ondelete="CASCADE"), nullable=False)
    menu_date: Mapped[date] = mapped_column(Date, nullable=False)

    version: Mapped[MenuVersion] = relationship(back_populates="days")
    meals: Mapped[list[MenuMeal]] = relationship(back_populates="day", passive_deletes=True,
                                                 order_by="MenuMeal.sort_order")


class MenuMeal(Base):
    __tablename__ = "menu_meals"
    __table_args__ = (
        CheckConstraint(enum_check("meal_type", enums.MEAL_TYPES), name="meal_type"),
        UniqueConstraint("day_id", "meal_type"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    day_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_days.id", ondelete="CASCADE"), nullable=False)
    meal_type: Mapped[str] = mapped_column(String(10), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)

    day: Mapped[MenuDay] = relationship(back_populates="meals")
    items: Mapped[list[MenuItem]] = relationship(back_populates="meal", passive_deletes=True,
                                                 order_by="MenuItem.position")


class MenuItem(Base):
    __tablename__ = "menu_items"
    __table_args__ = (
        CheckConstraint(enum_check("match_confidence", enums.CONFIDENCE_LEVELS), name="match_confidence"),
        CheckConstraint("extraction_confidence IS NULL OR (extraction_confidence >= 0 AND extraction_confidence <= 1)",
                        name="extraction_confidence_range"),
        CheckConstraint("price IS NULL OR price >= 0", name="price_nonnegative"),
        CheckConstraint("position >= 0", name="position_nonnegative"),
        CheckConstraint("length(btrim(display_name)) > 0", name="display_name_nonempty"),
        UniqueConstraint("meal_id", "position"),
        # Target of the composite FK proving a consumed item came from the logged meal.
        UniqueConstraint("id", "meal_id"),
        Index("ix_menu_items_food_id", "food_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    meal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_meals.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="RESTRICT"))
    match_confidence: Mapped[str] = mapped_column(String(8), nullable=False, server_default="UNKNOWN",
                                                  default="UNKNOWN")
    extraction_confidence: Mapped[Decimal | None] = mapped_column(Numeric(4, 3))
    is_user_corrected: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"),
                                                    default=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))

    meal: Mapped[MenuMeal] = relationship(back_populates="items")
