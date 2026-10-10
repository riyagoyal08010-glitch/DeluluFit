"""Identity and profile: users, sessions, student_profiles, preferences, allergies."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint,
                        Index, Integer, Numeric, String, Text, UniqueConstraint, func, text)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import enums
from app.db.base import Base, CreatedAtMixin, TimestampMixin, enum_check, uuid_pk


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(enum_check("role", enums.USER_ROLES), name="role"),
        CheckConstraint("email = lower(email) AND position('@' in email) > 1", name="email_normalized"),
        UniqueConstraint("email"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(254), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default="student", default="student")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"), default=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    profile: Mapped[StudentProfile | None] = relationship(back_populates="user", uselist=False,
                                                          passive_deletes=True)


class UserSession(CreatedAtMixin, Base):
    """Server-side session; the cookie carries a random token whose hash is stored here."""

    __tablename__ = "user_sessions"
    __table_args__ = (
        UniqueConstraint("token_hash"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        Index("ix_user_sessions_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False,
                                                   server_default=func.now())


class StudentProfile(TimestampMixin, Base):
    __tablename__ = "student_profiles"
    __table_args__ = (
        CheckConstraint(enum_check("activity_level", enums.ACTIVITY_LEVELS)
                        + " OR activity_level IS NULL", name="activity_level"),
        CheckConstraint(enum_check("dietary_pattern", enums.DIETARY_PATTERNS), name="dietary_pattern"),
        CheckConstraint("height_cm IS NULL OR (height_cm >= 50 AND height_cm <= 272)", name="height_range"),
        CheckConstraint("weight_kg IS NULL OR (weight_kg >= 20 AND weight_kg <= 400)", name="weight_range"),
        CheckConstraint("currency ~ '^[A-Z]{3}$'", name="currency_code"),
        CheckConstraint("onboarding_step >= 0 AND onboarding_step <= 10", name="onboarding_step"),
        CheckConstraint("length(btrim(display_name)) > 0", name="display_name_nonempty"),
        # A hostel may only be selected together with its institution ...
        CheckConstraint("hostel_id IS NULL OR institution_id IS NOT NULL", name="hostel_requires_institution"),
        # ... and must belong to that institution (integrity rule 2).
        ForeignKeyConstraint(["hostel_id", "institution_id"], ["hostels.id", "hostels.institution_id"],
                             name="fk_student_profiles_hostel_institution"),
        Index("ix_student_profiles_institution_id", "institution_id"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    height_cm: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    activity_level: Mapped[str | None] = mapped_column(String(16))
    dietary_pattern: Mapped[str] = mapped_column(String(24), nullable=False,
                                                 server_default="no_preference", default="no_preference")
    institution_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("institutions.id", ondelete="RESTRICT"))
    hostel_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="INR", default="INR")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, server_default="Asia/Kolkata",
                                          default="Asia/Kolkata")
    onboarding_step: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="profile")


class UserFoodPreference(CreatedAtMixin, Base):
    __tablename__ = "user_food_preferences"
    __table_args__ = (
        CheckConstraint(enum_check("preference", enums.PREFERENCE_KINDS), name="preference"),
        CheckConstraint("length(normalized_label) > 0", name="label_nonempty"),
        UniqueConstraint("user_id", "normalized_label"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    normalized_label: Mapped[str] = mapped_column(String(80), nullable=False)
    preference: Mapped[str] = mapped_column(String(8), nullable=False)
    food_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("foods.id", ondelete="SET NULL"))


class UserAllergy(CreatedAtMixin, Base):
    __tablename__ = "user_allergies"
    __table_args__ = (
        CheckConstraint(enum_check("allergen", enums.ALLERGENS), name="allergen"),
        CheckConstraint(enum_check("severity", enums.ALLERGY_SEVERITIES), name="severity"),
        CheckConstraint("allergen <> 'other' OR (custom_label IS NOT NULL AND length(btrim(custom_label)) > 0)",
                        name="other_requires_label"),
        Index("uq_user_allergies_user_allergen_label", "user_id", "allergen",
              text("coalesce(lower(custom_label), '')"), unique=True),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    allergen: Mapped[str] = mapped_column(String(16), nullable=False)
    custom_label: Mapped[str | None] = mapped_column(String(80))
    severity: Mapped[str] = mapped_column(String(10), nullable=False, server_default="unknown", default="unknown")
    notes: Mapped[str | None] = mapped_column(String(280))
